/* Painel Hidroclimático da Bacia do Alto Paraguai — Lucas Barros da Rosa
   Gráficos em SVG feitos aqui; mapas interativos com Leaflet e mapas base da Esri (se o Leaflet não carregar,
   os mapas viram imagens fixas em <canvas>). Lê os arquivos de dados/ gerados pelo pipeline. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const MESES_L = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const fmtMes = ym => MESES[+ym.slice(5, 7) - 1] + '/' + ym.slice(0, 4);
const fmtMesC = ym => MESES[+ym.slice(5, 7) - 1] + '/' + ym.slice(2, 4);
const fmtMesL = ym => MESES_L[+ym.slice(5, 7) - 1] + ' de ' + ym.slice(0, 4);
const fmtData = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const fmtDataL = iso => +iso.slice(8, 10) + ' de ' + MESES_L[+iso.slice(5, 7) - 1];
const fmtDataC = iso => iso.split('-').reverse().join('/');
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const num = (v, c = 0, sinal = false) => v == null || !isFinite(v) ? '–' :
  (sinal && v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }).replace('-', '−');
const escuro = () => document.documentElement.dataset.tema !== 'claro';
function trimestre(t) {                                 // mês central 'AAAA-MM' -> 'ago–out/2026'
  const a = +t.slice(0, 4), m = +t.slice(5, 7), ini = (m + 10) % 12, fim = m % 12;
  return MESES[ini] + '–' + MESES[fim] + '/' + (m === 12 ? a + 1 : a);
}

/* ---------- regiões: nomes por estado ---------- */
const NOMES = { bap: ['Bacia do Alto Paraguai (toda)', 'Bacia toda'], pln: ['Planalto MT', 'Planalto MT'], ptn: ['Pantanal MT', 'Pantanal MT'],
  pls: ['Planalto MS', 'Planalto MS'], pts: ['Pantanal MS', 'Pantanal MS'] };

/* ---------- cores ---------- */
const SECO = ['#8c510a', '#bf812d', '#dfc27d'], UMIDO = ['#80cdc1', '#35978f', '#01665e'];
const FRIO = ['#2166ac', '#67a9cf', '#d1e5f0'], QUENTE = ['#fddbc7', '#ef8a62', '#b2182b'];
const COR = { seco: '#bf812d', umido: '#35978f', frio: '#4393c3', quente: '#d6604d', calor: '#d95926' };
const ANOS_COR = ['#6fa8dc', '#d8749a', '#5cbf9b', '#a58bd6', '#c9a55a', '#8fa6b2'];   // anos de comparação
const corAtual = () => css('--acento');                                                // ano/série atual
function hex2rgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function rampa(ancoras, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = n === 1 ? 0 : i / (n - 1) * (ancoras.length - 1), a = Math.floor(p), b = Math.min(a + 1, ancoras.length - 1), f = p - a;
    const A = hex2rgb(ancoras[a]), B = hex2rgb(ancoras[b]);
    out.push('rgb(' + A.map((v, k) => Math.round(v + (B[k] - v) * f)).join(',') + ')');
  }
  return out;
}
function divergente(neg, pos, nLado) { return rampa(neg, nLado).concat([css('--meio')], rampa(pos, nLado)); }
const ESC = {
  chuva_pct: { un: '%', casas: 0, q: [-80, -60, -40, -20, -10, 10, 20, 40, 60, 80], cores: () => divergente(SECO, UMIDO, 5), sinal: true },
  pct_normal: { un: '% do normal', casas: 0, q: [20, 40, 60, 80, 90, 110, 120, 140, 160, 180], cores: () => divergente(SECO, UMIDO, 5) },
  chuva_anom: { un: 'mm', casas: 0, q: [-150, -100, -50, -25, -10, 10, 25, 50, 100, 150], cores: () => divergente(SECO, UMIDO, 5), sinal: true },
  spi: { un: '', casas: 1, q: [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2], cores: () => divergente(SECO, UMIDO, 4), sinal: true },
  temp: { un: '°C', casas: 1, q: [-4, -3, -2, -1, -0.5, 0.5, 1, 2, 3, 4], cores: () => divergente(FRIO, QUENTE, 5), sinal: true },
  calor: { un: 'dias', casas: 0, q: [1, 3, 5, 10, 15, 20], cores: () => [css('--meio')].concat(rampa(['#fdd9bf', '#f08a4b', '#b9340f', '#6b1505'], 6)) },
  prev_chuva: { un: 'mm/mês', casas: 0, q: [-100, -50, -25, -10, -5, 5, 10, 25, 50, 100], cores: () => divergente(SECO, UMIDO, 5), sinal: true },
  fwi: { un: '', casas: 1, q: [5.2, 11.2, 21.3, 38, 50], cores: () => ['#3f8f5a', '#e8d26a', '#f2a03d', '#e2582c', '#a8201a', '#5c0f2e'],
    nomes: ['baixo', 'moderado', 'alto', 'muito alto', 'extremo', 'muito extremo'] },
  prev_temp: { un: '°C', casas: 2, q: [-2, -1.5, -1, -0.5, -0.25, 0.25, 0.5, 1, 1.5, 2], cores: () => divergente(FRIO, QUENTE, 5), sinal: true }
};
const VARS_MAPA = [
  ['chuva_pct', 'Chuva: diferença em relação à média (%)', 'chuva_pct'], ['chuva_anom', 'Chuva: diferença em relação à média (mm)', 'chuva_anom'],
  ['spi3', 'SPI-3 (seca, 3 meses)', 'spi'], ['spi6', 'SPI-6 (seca, 6 meses)', 'spi'], ['spi12', 'SPI-12 (seca, 12 meses)', 'spi'],
  ['spei3', 'SPEI-3 (chuva − evaporação, 3 meses)', 'spi'], ['spei6', 'SPEI-6', 'spi'], ['spei12', 'SPEI-12', 'spi'],
  ['tmax_anom', 'Temperatura máxima: diferença em relação à média', 'temp'], ['tmed_anom', 'Temperatura média: diferença em relação à média', 'temp'],
  ['calor', 'Dias em onda de calor', 'calor']];
function classe(v, q) { let i = 0; while (i < q.length && v >= q[i]) i++; return i; }
const corDe = (v, esc) => ESC[esc].cores()[classe(v, ESC[esc].q)];
const chip = (v, esc) => v == null ? '' : '<i class="chip" style="background:' + corDe(v, esc) + '"></i>';

/* ---------- dados ---------- */
const D = {};
async function json(arq, opcional) {
  const r = await fetch('dados/' + arq, { cache: 'no-cache' });
  if (!r.ok) { if (opcional) return null; throw new Error(arq); }
  return r.json();
}
const cacheMapas = {};
function mapaJson(arq) { return cacheMapas[arq] || (cacheMapas[arq] = json('mapas/' + arq)); }
const nomeReg = id => (NOMES[id] || [D.meta.regioes.find(r => r.id === id).nome])[0];

/* ---------- dica (tooltip) ---------- */
const dica = $('dica-graf');
function mostraDica(html, x, y) {
  dica.innerHTML = html; dica.hidden = false;
  const w = dica.offsetWidth, h = dica.offsetHeight;
  dica.style.left = Math.max(6, Math.min(innerWidth - w - 6, x + 14)) + 'px';
  dica.style.top = Math.max(6, (y - h - 12 < 6 ? y + 16 : y - h - 12)) + 'px';
}
function escondeDica() { dica.hidden = true; }
addEventListener('scroll', escondeDica, { passive: true });

/* ---------- mapa fixo em canvas (mini-mapa e reserva sem Leaflet) ---------- */
const EXT = { lon0: -60.4, lon1: -52.6, lat0: -13.2, lat1: -23.0 };
const CIDADES = [['Cuiabá', -56.10, -15.60], ['Cáceres', -57.68, -16.07], ['Poconé', -56.62, -16.26], ['Barão de Melgaço', -55.97, -16.19],
  ['Rondonópolis', -54.64, -16.47], ['Tangará da Serra', -57.49, -14.62], ['Diamantino', -56.44, -14.41], ['Coxim', -54.76, -18.51],
  ['Rio Verde de MT', -54.84, -18.92], ['Corumbá', -57.65, -19.01], ['Aquidauana', -55.79, -20.47], ['Miranda', -56.38, -20.24],
  ['Campo Grande', -54.62, -20.47], ['Bonito', -56.48, -21.13], ['Jardim', -56.14, -21.48], ['Porto Murtinho', -57.88, -21.70]];
function desenhaMapa(canvas, m, esc, opc = {}) {
  const larg = canvas.parentElement.clientWidth, kx = Math.cos(18 * Math.PI / 180);
  const alt = Math.round(larg * (EXT.lat0 - EXT.lat1) / ((EXT.lon1 - EXT.lon0) * kx));
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = larg * dpr; canvas.height = alt * dpr; canvas.style.height = alt + 'px';
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = lon => (lon - EXT.lon0) / (EXT.lon1 - EXT.lon0) * larg, Y = lat => (EXT.lat0 - lat) / (EXT.lat0 - EXT.lat1) * alt;
  c.fillStyle = css('--sup'); c.fillRect(0, 0, larg, alt);
  if (m && esc) {
    const cores = esc.cores();
    const dw = X(m.lon0 + m.d) - X(m.lon0), dh = Y(m.lat0 - m.d) - Y(m.lat0);
    for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
      const v = m.v[j * m.nx + i]; if (v == null) continue;
      c.fillStyle = cores[classe(v, esc.q)];
      c.fillRect(X(m.lon0 + i * m.d) - 0.3, Y(m.lat0 - j * m.d) - 0.3, dw + 0.6, dh + 0.6);
    }
  }
  c.strokeStyle = css('--tinta'); c.lineWidth = 1.1; c.lineJoin = 'round';
  const anel = a => { c.beginPath(); a.forEach((p, k) => k ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.closePath(); c.stroke(); };
  const geom = g => { if (!g) return;
    if (g.type === 'Polygon') g.coordinates.forEach(anel);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(anel));
    else if (g.type === 'GeometryCollection') g.geometries.forEach(geom); };
  (D.geo ? D.geo.features : []).forEach(f => geom(f.geometry));
  (opc.pontos || []).forEach(([la, lo, d]) => { c.fillStyle = d <= 1 ? '#ffd23f' : '#ff7a1a'; c.strokeStyle = '#1a0d05'; c.lineWidth = 0.6;
    c.beginPath(); c.arc(X(lo), Y(la), d <= 1 ? 2.6 : 2, 0, 7); c.fill(); c.stroke(); });
  if (!opc.semCidades) {
    c.font = '11px ' + css('--fonte'); c.textBaseline = 'middle';
    CIDADES.forEach(([n, lo, la]) => {
      const x = X(lo), y = Y(la);
      c.fillStyle = css('--sup'); c.beginPath(); c.arc(x, y, 3.6, 0, 7); c.fill();
      c.fillStyle = css('--tinta'); c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill();
      const esq = x > larg * 0.72; c.textAlign = esq ? 'right' : 'left';
      c.lineWidth = 3; c.strokeStyle = css('--sup'); c.strokeText(n, x + (esq ? -6 : 6), y);
      c.fillText(n, x + (esq ? -6 : 6), y);
    });
  }
  canvas.onpointermove = canvas.onpointerdown = ev => {
    if (!m) return;
    const r = canvas.getBoundingClientRect();
    const lon = EXT.lon0 + (ev.clientX - r.left) / r.width * (EXT.lon1 - EXT.lon0), lat = EXT.lat0 - (ev.clientY - r.top) / r.height * (EXT.lat0 - EXT.lat1);
    dicaGrade(m, esc, lat, lon, ev.clientX, ev.clientY);
  };
  canvas.onpointerleave = escondeDica;
}
function dicaGrade(m, esc, lat, lon, x, y) {
  const i = Math.floor((lon - m.lon0) / m.d), j = Math.floor((m.lat0 - lat) / m.d);
  const v = i >= 0 && j >= 0 && i < m.nx && j < m.ny ? m.v[j * m.nx + i] : null;
  if (v == null) return escondeDica();
  mostraDica('<b>' + num(v, esc.casas, esc.sinal) + ' ' + esc.un + '</b>' + num(Math.abs(lat), 2) + '°S, ' + num(Math.abs(lon), 2) + '°O', x, y);
}
function legendaMapa(el, esc, titulo) {
  const cores = esc.cores(), q = esc.q, f = v => num(v, 2).replace(/,?0+$/, '');
  let h = '<div class="tit">' + titulo + '</div>';
  cores.forEach((cor, i) => {
    const rot = i === 0 ? '< ' + f(q[0]) : i === q.length ? '≥ ' + f(q[i - 1]) : f(q[i - 1]) + ' a ' + f(q[i]);
    h += '<div class="cls"><i style="background:' + cor + '"></i>' + (esc.nomes ? '<b>' + esc.nomes[i] + '</b><br>' : '') + rot + '</div>';
  });
  el.innerHTML = h;
}

/* ---------- mapa interativo (Leaflet + Esri) ---------- */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const BASES = {
  cinza: { nome: 'Cinza', url: () => ESRI + (escuro() ? 'Canvas/World_Dark_Gray_Base' : 'Canvas/World_Light_Gray_Base') + '/MapServer/tile/{z}/{y}/{x}',
    atrib: 'Esri, HERE, Garmin, © OpenStreetMap' },
  relevo: { nome: 'Relevo', url: () => ESRI + 'Elevation/World_Hillshade' + (escuro() ? '_Dark' : '') + '/MapServer/tile/{z}/{y}/{x}',
    atrib: 'Esri, USGS, NGA, NASA, CGIAR' },
  satelite: { nome: 'Satélite', url: () => ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', atrib: 'Esri, Maxar, Earthstar Geographics' }
};
let baseEscolhida = 'cinza';
const MAPAS = {};
const merc = la => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360));
const imerc = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
function imagemGrade(m, esc) {
  // A imagem é feita em projeção de Mercator (a do mapa base), linha a linha, para os pixels caírem nas latitudes certas.
  const ctxCor = document.createElement('canvas').getContext('2d');
  const paleta = esc.cores().map(c => { ctxCor.fillStyle = c; return hex2rgb(ctxCor.fillStyle); });
  const latN = m.lat0, latS = m.lat0 - m.ny * m.d, yN = merc(latN), yS = merc(latS);
  const W = m.nx, H = Math.min(m.ny * 8, 2400);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), img = c.createImageData(W, H);
  for (let r = 0; r < H; r++) {
    const j = Math.min(m.ny - 1, Math.floor((latN - imerc(yN - (r + 0.5) / H * (yN - yS))) / m.d));
    for (let i = 0; i < W; i++) {
      const v = m.v[j * m.nx + i], k = (r * W + i) * 4;
      if (v == null) { img.data[k + 3] = 0; continue; }
      const cor = paleta[classe(v, esc.q)];
      img.data[k] = cor[0]; img.data[k + 1] = cor[1]; img.data[k + 2] = cor[2]; img.data[k + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv.toDataURL();
}
function mapaInterativo(id, m, esc, extra = {}) {
  const el = $(id);
  if (!window.L) {                                          // reserva: mapa fixo
    el.classList.add('sem-base');
    if (!el.querySelector('canvas')) el.innerHTML = '<div class="mapa-wrap"><canvas></canvas></div>';
    desenhaMapa(el.querySelector('canvas'), m, esc, { pontos: extra.pontos });
    return;
  }
  let o = MAPAS[id];
  if (!o) {
    const lim = L.latLngBounds([-23.6, -61.4], [-12.6, -51.6]), bacia = L.latLngBounds([EXT.lat1, EXT.lon0], [EXT.lat0, EXT.lon1]);
    const map = L.map(el, { maxBounds: lim, maxBoundsViscosity: 1, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, maxZoom: 12, attributionControl: true });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.createPane('dados').style.zIndex = 350;
    map.createPane('limites').style.zIndex = 420; map.getPane('limites').style.pointerEvents = 'none';
    map.createPane('cidades').style.zIndex = 440; map.getPane('cidades').style.pointerEvents = 'none';
    o = MAPAS[id] = { map: map, bacia: bacia };
    map.fitBounds(bacia, { padding: [6, 6] });
    map.setMinZoom(Math.max(4, map.getZoom() - 0.5));
    // botões: mapa base e voltar à bacia
    const Ctl = L.Control.extend({ onAdd: () => {
      const d = L.DomUtil.create('div', 'ctl-base');
      d.innerHTML = Object.keys(BASES).map(k => '<button type="button" data-b="' + k + '">' + BASES[k].nome + '</button>').join('');
      L.DomEvent.disableClickPropagation(d);
      d.querySelectorAll('button').forEach(b => b.onclick = () => { baseEscolhida = b.dataset.b; Object.values(MAPAS).forEach(atualizaBase); });
      o.ctlBase = d; return d; } });
    new Ctl({ position: 'topright' }).addTo(map);
    const Rec = L.Control.extend({ onAdd: () => {
      const b = L.DomUtil.create('button', 'ctl-recentra'); b.type = 'button'; b.textContent = 'Ver a bacia toda';
      L.DomEvent.disableClickPropagation(b); b.onclick = () => map.fitBounds(bacia, { padding: [6, 6] }); return b; } });
    new Rec({ position: 'bottomleft' }).addTo(map);
    // cidades
    CIDADES.forEach(([n, lo, la]) => L.circleMarker([la, lo], { pane: 'cidades', radius: 3, weight: 1.5, color: '#fff', fillColor: '#222', fillOpacity: 1, interactive: false })
      .bindTooltip(n, { permanent: true, direction: 'right', className: 'rot-cidade', offset: [3, 0] }).addTo(map));
    const valor = e => { if (o.m) dicaGrade(o.m, o.esc, e.latlng.lat, e.latlng.lng, e.originalEvent.clientX, e.originalEvent.clientY); };
    map.on('mousemove click', valor); map.on('mouseout movestart', escondeDica);
  }
  atualizaBase(o);
  if (o.limites) o.map.removeLayer(o.limites);
  o.limites = L.geoJSON(D.geo, { pane: 'limites', interactive: false, style: { color: css('--tinta'), weight: 1.4, opacity: 0.9, fill: false } }).addTo(o.map);
  if (o.cam) o.map.removeLayer(o.cam);
  o.cam = null; o.m = m; o.esc = esc;
  if (m) o.cam = L.imageOverlay(imagemGrade(m, esc), [[m.lat0 - m.ny * m.d, m.lon0], [m.lat0, m.lon0 + m.nx * m.d]],
    { pane: 'dados', opacity: 0.86, interactive: false, className: 'grade-pixel' }).addTo(o.map);
  if (o.pts) o.map.removeLayer(o.pts);
  o.pts = null;
  if (extra.pontos && extra.pontos.length) {
    const rend = o.rend || (o.rend = L.canvas({ pane: 'limites' }));
    o.pts = L.layerGroup(extra.pontos.map(([la, lo, d]) => L.circleMarker([la, lo], { renderer: rend, radius: d <= 1 ? 3.2 : 2.4, weight: 0.7,
      color: '#1a0d05', fillColor: d <= 1 ? '#ffd23f' : '#ff7a1a', fillOpacity: 0.95, interactive: false }))).addTo(o.map);
  }
  setTimeout(() => o.map.invalidateSize(), 0);
}
function atualizaBase(o) {
  const chave = baseEscolhida + (escuro() ? '-e' : '-c');
  if (o.chaveBase !== chave) {
    if (o.base) o.map.removeLayer(o.base);
    const B = BASES[baseEscolhida];
    o.base = L.tileLayer(B.url(), { attribution: 'Mapa base: ' + B.atrib, maxZoom: 16, maxNativeZoom: baseEscolhida === 'relevo' ? 13 : 16 }).addTo(o.map);
    o.chaveBase = chave;
  }
  if (o.ctlBase) o.ctlBase.querySelectorAll('button').forEach(b => b.classList.toggle('ativo', b.dataset.b === baseEscolhida));
}

/* ---------- gráfico SVG ---------- */
function ticksBons(a, b, n) {
  const bruto = (b - a) / n, p = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / p;
  const passo = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(a / passo) * passo; v <= b + 1e-9; v += passo) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out;
}
function ticksMeses(x, pxMes) {                    // eixo de meses 'AAAA-MM': rótulos espaçados e marquinhas
  const idx = ym => +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1);
  const pr = [1, 3, 6, 12, 24, 60, 120].find(k => k * pxMes >= 48) || 120;
  const pm = [1, 3, 12, 60].find(k => k * pxMes >= 5) || 60;
  const maj = [], min = [];
  x.forEach((ym, i) => { const k = idx(ym); if (k % pm === 0) min.push(i); if (k % pr === 0) maj.push(i); });
  return { maj: maj, min: min, rot: pr >= 12 ? (ym => ym.slice(0, 4)) : fmtMesC };
}
/* cfg: {x, series:[{nome,tipo:'barra'|'linha'|'banda'|'pontos'|'vazio',y,y2,cor,corNeg,esp,traco,marcas,opac}], un, casas, sinal, zero, h,
         eixoMeses (x = 'AAAA-MM'), ticksX, ticksMenores, rotX, rotDica, eventos:[{i0,i1,nome,abreAntes,abertoDepois}], faixas:[{i0,i1,cor}]} */
function grafico(el, cfg) {
  const W = Math.max(el.clientWidth, 280), H = cfg.h || 250, n = cfg.x.length;
  const temEv = cfg.eventos && cfg.eventos.length;
  const m = { l: 44, r: 12, t: temEv ? 24 : 10, b: 26 };
  let lo = Infinity, hi = -Infinity;
  cfg.series.forEach(s => [s.y, s.y2].forEach(a => a && a.forEach(v => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } })));
  if (!isFinite(lo)) { el.innerHTML = '<p class="nota" style="padding:20px">Sem dados para esta seleção.</p>'; return; }
  if (cfg.zero !== false) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) hi = lo + 1;
  const folga = (hi - lo) * 0.06; lo -= lo < 0 || cfg.zero === false ? folga : 0; hi += folga;
  const tk = ticksBons(lo, hi, 5), passo = (W - m.l - m.r) / n;
  const X = i => m.l + (i + 0.5) * passo, Y = v => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const grade = css('--grade'), eixo = css('--eixo'), sup = css('--sup'), nino = css('--nino'), base = H - m.b;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + (cfg.titulo || 'gráfico') + '">';
  // períodos de El Niño: faixa, barra no topo e marcas de início e fim
  (cfg.eventos || []).forEach(ev => {
    const x0 = X(ev.i0) - passo / 2, x1 = X(ev.i1) + passo / 2;
    s += '<rect x="' + x0 + '" y="' + m.t + '" width="' + (x1 - x0) + '" height="' + (base - m.t) + '" fill="' + nino + '" opacity="0.08"/>';
    s += '<rect x="' + x0 + '" y="' + (m.t - 5) + '" width="' + (x1 - x0) + '" height="3" rx="1.5" fill="' + nino + '" opacity="' + (ev.provisorio ? 0.5 : 0.9) + '"/>';
    if (!ev.abreAntes) s += '<line x1="' + x0 + '" x2="' + x0 + '" y1="' + (m.t - 7) + '" y2="' + base + '" stroke="' + nino + '" stroke-width="1.3" opacity="0.75"/>';
    if (!ev.abertoDepois) s += '<line x1="' + x1 + '" x2="' + x1 + '" y1="' + (m.t - 7) + '" y2="' + base + '" stroke="' + nino + '" stroke-width="1.3" opacity="0.75" stroke-dasharray="3 3"/>';
    const largTxt = ev.nome.length * 5.6;
    if (x1 - x0 >= largTxt + 6 || ev === cfg.eventos[cfg.eventos.length - 1]) {
      const fim = x0 + largTxt + 4 > W - m.r;
      s += '<text class="evento" x="' + (fim ? Math.min(x1, W - m.r) - 2 : x0 + 3) + '" y="' + (m.t - 9) + '" text-anchor="' + (fim ? 'end' : 'start') + '">' + ev.nome + '</text>';
    }
  });
  (cfg.faixas || []).forEach(f => { s += '<rect x="' + (X(f.i0) - passo / 2) + '" y="' + m.t + '" width="' + (X(f.i1) - X(f.i0) + passo) + '" height="' + (base - m.t) + '" fill="' + f.cor + '" opacity="0.12"/>'; });
  tk.forEach(v => { s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="' + (v === 0 ? eixo : grade) + '" stroke-width="1"/>' +
    '<text x="' + (m.l - 7) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + num(v, Math.abs(tk[1] - tk[0]) < 1 ? 1 : 0) + '</text>'; });
  // eixo x: linha de base, marquinhas e rótulos
  let maj, min, rotX = cfg.rotX;
  if (cfg.eixoMeses) { const t = ticksMeses(cfg.x, passo); maj = t.maj; min = t.min; rotX = rotX || t.rot; }
  else { maj = cfg.ticksX || (() => { const k = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 80)))), a = []; for (let i = n - 1; i >= 0; i -= k) a.push(i); return a; })(); min = cfg.ticksMenores || maj; }
  s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + base + '" y2="' + base + '" stroke="' + eixo + '" stroke-width="1"/>';
  const xm = i => cfg.ticksMenores ? m.l + i * passo : X(i);                 // marcas de borda (dias do ano) ou de centro (meses)
  min.forEach(i => { s += '<line x1="' + xm(i) + '" x2="' + xm(i) + '" y1="' + base + '" y2="' + (base + 3) + '" stroke="' + eixo + '"/>'; });
  maj.forEach(i => { if (!cfg.ticksMenores) s += '<line x1="' + X(i) + '" x2="' + X(i) + '" y1="' + base + '" y2="' + (base + 6) + '" stroke="' + css('--mudo') + '"/>';
    const borda = !cfg.ticksX && !cfg.eixoMeses && X(i) > W - 34;
    s += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (borda ? 'end' : 'middle') + '">' + (rotX ? rotX(cfg.x[i], i) : cfg.x[i]) + '</text>'; });
  (cfg.marcasBase || []).forEach(mb => mb.idx.forEach(i => { s += '<rect x="' + (X(i) - passo / 2 + 1) + '" y="' + (base + 1) + '" width="' + Math.max(passo - 2, 1) + '" height="3" fill="' + mb.cor + '"/>'; }));
  cfg.series.forEach(se => {
    if (se.oculta) return;
    if (se.tipo === 'banda') {
      let seg = [], d = '';
      const fecha = () => { if (seg.length > 1) d += 'M' + seg.map(i => X(i) + ',' + Y(se.y2[i])).join('L') + 'L' + seg.slice().reverse().map(i => X(i) + ',' + Y(se.y[i])).join('L') + 'Z'; seg = []; };
      for (let i = 0; i < n; i++) (se.y[i] != null && se.y2[i] != null) ? seg.push(i) : fecha();
      fecha(); s += '<path d="' + d + '" fill="' + se.cor + '" opacity="' + (se.opac || 0.2) + '"/>';
    } else if (se.tipo === 'barra') {
      const bw = Math.max(1, Math.min(26, passo - (passo > 6 ? 2 : 0.5)));
      for (let i = 0; i < n; i++) { const v = se.y[i]; if (v == null) continue;
        const y0 = Y(0), y1 = Y(v); s += '<rect x="' + (X(i) - bw / 2) + '" y="' + Math.min(y0, y1) + '" width="' + bw + '" height="' + Math.max(Math.abs(y1 - y0), 0.8) + '" fill="' + (se.cores ? se.cores[i] : v < 0 && se.corNeg ? se.corNeg : se.cor) + '"' + (bw > 7 ? ' rx="2"' : '') + (se.contorno ? ' stroke="' + se.contorno[i] + '" stroke-width="' + (se.contorno[i] === 'none' ? 0 : 2) + '"' : '') + '/>'; }
    } else if (se.tipo === 'vazio') {
      for (let i = 0; i < n; i++) if (se.y[i] != null)
        s += '<circle cx="' + X(i) + '" cy="' + Y(se.y[i]) + '" r="5" fill="' + sup + '" stroke="' + se.cor + '" stroke-width="2.5"/>';
    } else {
      if (se.tipo !== 'pontos') { let d = '', aberto = false;
        for (let i = 0; i < n; i++) { const v = se.y[i]; if (v == null) { aberto = false; continue; } d += (aberto ? 'L' : 'M') + X(i) + ',' + Y(v); aberto = true; }
        s += '<path d="' + d + '" fill="none" stroke="' + se.cor + '" stroke-width="' + (se.esp || 2) + '" stroke-linejoin="round" stroke-linecap="round"' + (se.traco ? ' stroke-dasharray="' + se.traco + '"' : '') + '/>'; }
      if (se.tipo === 'pontos' || se.marcas) for (let i = 0; i < n; i++) if (se.y[i] != null)
        s += '<circle cx="' + X(i) + '" cy="' + Y(se.y[i]) + '" r="4" fill="' + se.cor + '" stroke="' + sup + '" stroke-width="2"/>';
    }
  });
  s += '<line id="cz" y1="' + m.t + '" y2="' + base + '" stroke="' + eixo + '" stroke-width="1" visibility="hidden"/></svg>';
  el.innerHTML = s;
  const svg = el.firstChild, cz = svg.querySelector('#cz');
  const mover = ev => {
    const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) / r.width * W - m.l) / passo)));
    cz.setAttribute('x1', X(i)); cz.setAttribute('x2', X(i)); cz.setAttribute('visibility', 'visible');
    let h = '<b>' + (cfg.rotDica ? cfg.rotDica(cfg.x[i], i) : cfg.x[i]) + '</b>';
    cfg.series.forEach(se => {
      if (se.semDica) return;
      if (se.tipo === 'banda') { if (se.y[i] != null) h += '<div class="l"><span>' + se.nome + '</span><span>' + num(se.y[i], cfg.casas, cfg.sinal) + ' a ' + num(se.y2[i], cfg.casas, cfg.sinal) + '</span></div>'; }
      else if (se.y[i] != null) h += '<div class="l"><span><i class="chip" style="background:' + (se.cores ? se.cores[i] : se.y[i] < 0 && se.corNeg ? se.corNeg : se.cor) + '"></i>' + se.nome + '</span><span>' + num(se.y[i], cfg.casas, cfg.sinal) + (cfg.un ? ' ' + cfg.un : '') + '</span></div>';
    });
    if (cfg.dicaExtra) h += cfg.dicaExtra(i);
    (cfg.eventos || []).forEach(ev => { if (i >= ev.i0 && i <= ev.i1) h += '<div class="ev">' + ev.nome + (i === ev.i0 && !ev.abreAntes ? ' · início' : i === ev.i1 && !ev.abertoDepois ? ' · fim' : '') + '</div>'; });
    mostraDica(h, ev.clientX, ev.clientY);
  };
  svg.addEventListener('pointermove', mover); svg.addEventListener('pointerdown', mover);
  svg.addEventListener('pointerleave', () => { cz.setAttribute('visibility', 'hidden'); escondeDica(); });
}
/* legenda: [nome, cor, tipo] — tipo: 'caixa' | 'linha' (padrão) | 'tracejada' | 'linha-ponto' | 'ponto' | 'vazio' | 'evento' */
function legenda(el, itens) {
  const ic = (c, t) => {
    const sv = b => '<svg viewBox="0 0 20 12" aria-hidden="true">' + b + '</svg>';
    if (t === 'caixa') return sv('<rect x="3" y="1" width="14" height="10" rx="2" fill="' + c + '" opacity="0.55"/>');
    if (t === 'fundo') return sv('<rect x="2" y="0" width="16" height="12" fill="' + c + '" opacity="0.22"/>');
    if (t === 'tracejada') return sv('<line x1="1" x2="19" y1="6" y2="6" stroke="' + c + '" stroke-width="2" stroke-dasharray="4 3"/>');
    if (t === 'linha-ponto') return sv('<line x1="1" x2="19" y1="6" y2="6" stroke="' + c + '" stroke-width="3"/><circle cx="10" cy="6" r="3.6" fill="' + c + '" stroke="' + css('--sup') + '" stroke-width="1.5"/>');
    if (t === 'ponto') return sv('<circle cx="10" cy="6" r="4" fill="' + c + '"/>');
    if (t === 'vazio') return sv('<circle cx="10" cy="6" r="4" fill="' + css('--sup') + '" stroke="' + c + '" stroke-width="2.2"/>');
    if (t === 'evento') return sv('<rect x="2" y="1" width="16" height="10" fill="' + c + '" opacity="0.18"/><rect x="2" y="0" width="16" height="2.4" fill="' + c + '"/><line x1="2" x2="2" y1="0" y2="12" stroke="' + c + '" stroke-width="1.3"/><line x1="18" x2="18" y1="0" y2="12" stroke="' + c + '" stroke-width="1.3" stroke-dasharray="2 2"/>');
    return sv('<line x1="1" x2="19" y1="6" y2="6" stroke="' + c + '" stroke-width="' + (t === 'grossa' ? 3.2 : 2) + '" stroke-linecap="round"/>');
  };
  el.innerHTML = itens.map(([n, c, t]) => '<span>' + ic(c, t) + n + '</span>').join('');
}
function opcoes(sel, lista, valor) { sel.innerHTML = lista.map(([v, n]) => '<option value="' + v + '">' + n + '</option>').join(''); if (valor != null) sel.value = valor; }
function tabela(el, cab, linhas) {
  el.innerHTML = '<table class="dados"><thead><tr>' + cab.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
    linhas.map(l => '<tr>' + l.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
const ultimoIdx = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return i; return -1; };
function classeSeca(z) {
  if (z == null) return 'sem dado';
  return z <= -2 ? 'seca extrema' : z <= -1.5 ? 'seca severa' : z <= -1 ? 'seca moderada' : z < 1 ? 'próximo do normal' : z < 1.5 ? 'moderadamente úmido' : z < 2 ? 'muito úmido' : 'extremamente úmido';
}
function forcaNino(v) { return v >= 2 ? 'muito forte' : v >= 1.5 ? 'forte' : v >= 1 ? 'moderado' : 'fraco'; }

/* ---------- El Niño nos gráficos ---------- */
function nomeEvento(ev) {
  const a0 = ev.inicio.slice(0, 4), a1 = ev.fim.slice(0, 4);
  if (ev.em_curso) return 'El Niño ' + a0 + (ev.provisorio ? ' (em curso, provisório)' : ' (em curso)');
  return 'El Niño ' + a0 + (a1 !== a0 ? '–' + a1.slice(2) : '');
}
function eventosNino(x) {                        // períodos de El Niño que cruzam o eixo x ('AAAA-MM')
  const E = D.series.enso; if (!E || !E.eventos || !x.length) return [];
  const ini = x[0], fim = x[x.length - 1];
  return E.eventos.filter(ev => ev.tipo === 'El Niño' && ev.fim >= ini && ev.inicio <= fim).map(ev => {
    const i0 = ev.inicio < ini ? 0 : x.indexOf(ev.inicio);
    const fimEv = ev.em_curso ? fim : ev.fim;                    // em curso: vai até o fim do eixo
    const i1 = fimEv > fim ? x.length - 1 : x.indexOf(fimEv);
    return { i0: i0, i1: i1 < 0 ? x.length - 1 : i1, nome: nomeEvento(ev), provisorio: ev.provisorio, abreAntes: ev.inicio < ini, abertoDepois: ev.em_curso || ev.fim > fim };
  }).filter(e => e.i0 >= 0);
}
const itemEvento = () => ['El Niño: do início (linha cheia) ao fim (tracejada)', css('--nino'), 'evento'];

/* ---------- Visão geral ---------- */
let regAgora = 'bap';
function faixaEnso() {
  const E = D.series.enso, fx = $('faixa-enso');
  if (!E || !E.serie || !E.serie.length) { fx.hidden = true; return; }
  const o = E.serie[E.serie.length - 1], at = E.atual, W = E.semanal, emCurso = at && at.em_curso && at.tipo !== 'La Niña';
  fx.hidden = false; fx.classList.toggle('neutro', !emCurso);
  let estado;
  if (emCurso) {
    const prov = at.provisorio ? '<br>O alerta oficial já está em vigor. O que ainda falta é fechar a classificação histórica do evento, que pede 5 médias de 3 meses seguidas (sobrepostas, como mai–jul, jun–ago, jul–set…) acima de +0,5 °C, cobrindo 7 meses: falta(m) ' + (5 - at.trimestres) + '.' : '';
    estado = '<span class="selo">El Niño</span><strong>El Niño ' + forcaNino(o.v) + ' em curso</strong><span class="det">Começou em ' + fmtMesL(at.inicio) +
      (E.aviso ? ' · alerta oficial da NOAA em ' + fmtDataC(E.aviso) : '') + prov + '</span>';
  } else estado = '<span class="selo">Pacífico equatorial</span><strong>' + (o.v >= 0.5 ? 'Águas mais quentes que o normal' : o.v <= -0.5 ? 'Águas mais frias que o normal (La Niña?)' : 'Sem El Niño ou La Niña') + '</strong><span class="det">Situação do El Niño–Oscilação Sul</span>';
  let h = '<div class="estado">' + estado + '</div>' +
    '<div class="med"><div class="n">' + num(o.v, 1, true) + ' °C</div><div class="r"><b>Índice oficial (' + (E.indice || 'RONI') + ')</b><br>média de ' + trimestre(o.t) + '</div></div>';
  h += W ? '<div class="med"><div class="n">' + num(W.nino34, 1, true) + ' °C</div><div class="r"><b>Última semana</b><br>Niño 3.4, medida tradicional, semana de ' + fmtData(W.semana) + '</div></div>'
    : '<div class="med"><div class="n">–</div><div class="r">valor semanal indisponível</div></div>';
  h += '<details><summary>Entenda os números</summary><div class="explica">' +
    '<p><strong>O que é.</strong> O El Niño é o aquecimento fora do normal das águas do Pacífico equatorial. Ele muda a circulação da atmosfera e, no centro do Brasil, costuma vir com temperaturas mais altas e chuva irregular. A referência internacional é a temperatura do mar na região <strong>Niño 3.4</strong>, no meio do Pacífico.</p>' +
    '<p><strong>Índice oficial (RONI).</strong> Média de 3 meses da região Niño 3.4, descontado o aquecimento de todo o oceano tropical. A NOAA o adotou em fevereiro de 2026 porque o aquecimento global infla a medida antiga. Intensidade: fraco a partir de +0,5 °C; moderado, +1,0; forte, +1,5; muito forte, +2,0.</p>' +
    '<p><strong>Valor semanal.</strong> Retrato da última semana, sem a média de 3 meses e sem descontar o aquecimento geral do oceano. Por isso é maior que o índice oficial: é o número acima de +3 °C que aparece nas notícias. Os dois estão certos; medem coisas diferentes.</p>' +
    (W && W.nino12 != null ? '<p><strong>Junto à costa.</strong> Na região Niño 1+2, perto do Peru e do Equador, a anomalia semanal é de ' + num(W.nino12, 1, true) + ' °C. Ela mostra o aquecimento costeiro, mas não é usada para classificar o evento.</p>' : '') +
    '</div></details>';
  fx.innerHTML = h;
}
function visao() {
  const S = D.series, M = S.meses, bap = S.regioes.bap;
  faixaEnso();
  // últimos dias
  const A = D.agora;
  const seg = $('agora-reg');
  seg.innerHTML = D.meta.regioes.map(r => '<button type="button" data-r="' + r.id + '"' + (r.id === regAgora ? ' class="ativo"' : '') + '>' + (NOMES[r.id] || [0, r.nome])[1] + '</button>').join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { regAgora = b.dataset.r; visao(); });
  if (A) {
    const r = A.regioes[regAgora], partes = [];
    if (A.chuva) partes.push('Chuva até ' + fmtDataL(A.chuva.ate) + (A.chuva.preliminar_desde ? ' (dados preliminares desde ' + fmtData(A.chuva.preliminar_desde) + ')' : ''));
    if (A.temp) partes.push('temperatura até ' + fmtDataL(A.temp.ate));
    $('agora-sub').textContent = nomeReg(regAgora) + ' · ' + partes.join(' · ');
    const tileChuva = (k, n) => {
      const c = r[k]; if (!c) return '';
      const pct = c.pct, larg = Math.min(100, (pct || 0) / 2);
      const frase = pct == null ? '' : pct < 90 ? 'abaixo do normal' : pct > 110 ? 'acima do normal' : 'perto do normal';
      return '<div class="tile"><div class="rot">Chuva nos últimos ' + n + ' dias</div>' +
        '<div class="val">' + chip(pct, 'pct_normal') + num(pct) + '%<small>do normal</small></div><div class="barra"><i style="width:' + larg + '%;background:' + corDe(pct, 'pct_normal') + '"></i><b style="left:50%"></b></div>' +
        '<div class="det">' + (A.chuva.preliminar_desde ? '<span class="tag">preliminar</span>' : '') + 'Choveram ' + num(c.mm) + ' mm; o normal para estes ' + n + ' dias é ' + num(c.normal) + ' mm (' + frase + ').</div></div>';
    };
    let t = tileChuva('chuva30', 30) + tileChuva('chuva90', 90);
    if (r.calor_mes) t += '<div class="tile"><div class="rot">Dias em onda de calor em ' + MESES_L[+A.temp.mes.slice(5) - 1] + '</div><div class="val">' + chip(r.calor_mes.dias, 'calor') + num(r.calor_mes.dias, 1) + '<small>dias</small></div>' +
      '<div class="det">Até o dia ' + A.temp.dia + '. O normal até essa data é ' + num(r.calor_mes.normal, 1) + ' dia(s).</div></div>';
    if (r.tmax30_anom != null) t += '<div class="tile"><div class="rot">Temperatura máxima, 30 dias</div><div class="val">' + chip(r.tmax30_anom, 'temp') + num(r.tmax30_anom, 1, true) + ' °C</div>' +
      '<div class="det">' + (r.tmax30_anom >= 0 ? 'Mais quente' : 'Mais fria') + ' que a média de 1991–2020 para a época.</div></div>';
    $('agora-tiles').innerHTML = t;
  } else {
    $('agora-sub').textContent = 'Dados diários indisponíveis nesta atualização.';
    $('agora-tiles').innerHTML = '';
  }
  mapaAgora();
  // último mês completo
  const ic = ultimoIdx(bap.chuva), it = ultimoIdx(bap.tmax_anom);
  $('mes-titulo').textContent = 'Último mês completo: ' + fmtMesL(M[ic]) + (it !== ic ? ' (temperatura: ' + fmtMesL(M[it]) + ')' : '');
  const s = S.regioes[regAgora], j6 = ultimoIdx(s.spei6);
  $('mes-sub').textContent = nomeReg(regAgora) + ' · comparação com a média de 1991–2020';
  const tile = (rot, val, c, det) => '<div class="tile"><div class="rot">' + rot + '</div><div class="val">' + (c || '') + val + '</div><div class="det">' + det + '</div></div>';
  const pc = s.chuva_pct[ic];
  $('cartoes').innerHTML =
    tile('Chuva no mês', num(pc, 0, true) + '%', chip(pc, 'chuva_pct'), (pc == null ? '' : Math.abs(pc) < 10 ? 'Perto da média. ' : num(Math.abs(pc)) + '% ' + (pc < 0 ? 'abaixo' : 'acima') + ' da média. ') + num(s.chuva[ic]) + ' mm; média ' + num(s.chuva_clim[ic]) + ' mm.') +
    tile('Seca em 3 meses (SPI-3)', num(s.spi3[ic], 1, true), chip(s.spi3[ic], 'spi'), classeSeca(s.spi3[ic])) +
    tile('Seca em 6 meses (SPEI-6)', num(s.spei6[j6], 1, true), chip(s.spei6[j6], 'spi'), classeSeca(s.spei6[j6]) + ', considerando também a evaporação') +
    tile('Temperatura máxima', num(s.tmax_anom[it], 1, true) + ' °C', chip(s.tmax_anom[it], 'temp'), 'Diferença em relação à média. Média do mês: ' + num(s.tmax[it], 1) + ' °C.') +
    tile('Dias em onda de calor', num(s.calor[it], 1), chip(s.calor[it], 'calor'), 'O normal para o mês é ' + num(s.calor_clim[it], 1) + '.');
  // atalhos
  let at = '';
  (D.rio.estacoes || []).slice(0, 1).forEach(e => { const med = e.clim.p50[diaAno(e.ultimo.data)];
    at += '<a class="atalho" href="#rio" style="--c:var(--agua)"><div class="rot">Rio Paraguai em ' + e.nome + '</div><div class="val">' + num(e.ultimo.cm) + ' cm</div><div class="det">' +
      (med != null ? num(e.ultimo.cm - med, 0, true) + ' cm em relação à mediana do dia · ' : '') + fmtDataC(e.ultimo.data) + '</div><span class="ir">Ver o rio →</span></a>'; });
  const mp = D.prev.modelos[0];
  if (mp) { const r = mp.regioes[regAgora] || mp.regioes.bap, soma = r.chuva.media.slice(0, 3).reduce((a, b) => a + (b || 0), 0);
    at += '<a class="atalho" href="#previsao" style="--c:var(--acento)"><div class="rot">Previsão de chuva, ' + fmtMes(mp.alvos[0]) + ' a ' + fmtMes(mp.alvos[2]) + '</div><div class="val">' + num(soma, 0, true) + ' mm</div>' +
      '<div class="det">diferença em relação à média, somada nos 3 meses · ' + mp.nome + '</div><span class="ir">Ver a previsão →</span></a>'; }
  at += '<a class="atalho" href="#series" style="--c:var(--nino)"><div class="rot">Chuva acumulada desde outubro</div>' + hidroResumo(regAgora) + '<span class="ir">Ver as séries →</span></a>';
  $('atalhos').innerHTML = at;
}
/* camadas do mapa "situação agora": [id, nome do botão] */
let camadaAgora = null;
function camadasAgora() {
  const A = D.agora || {}, F = D.fogo || {}, ms = D.meta.mapas.spei3 || [], c = [];
  if (A.mapa_chuva30) c.push(['chuva', 'Chuva, 30 dias']);
  if (ms.length) c.push(['seca', 'Seca']);
  if (A.mapa_tmax30) c.push(['temp', 'Temperatura, 30 dias']);
  if (F.fwi) c.push(['fwi', 'Perigo de fogo']);
  if (F.focos) c.push(['focos', 'Focos de calor']);
  return c;
}
async function mapaAgora() {
  const cams = camadasAgora(); if (!cams.length) { $('agora-mapa').parentElement.parentElement.hidden = true; return; }
  if (!camadaAgora || !cams.some(c => c[0] === camadaAgora)) camadaAgora = cams[0][0];
  $('agora-camadas').innerHTML = cams.map(([k, n]) => '<button type="button" data-c="' + k + '"' + (k === camadaAgora ? ' class="ativo"' : '') + '>' + n + '</button>').join('');
  $('agora-camadas').querySelectorAll('button').forEach(b => b.onclick = () => { camadaAgora = b.dataset.c; mapaAgora(); });
  const A = D.agora, F = D.fogo, k = camadaAgora;
  let m = null, esc = null, tit = '', sub = '', pts = null;
  if (k === 'chuva') { m = A.mapa_chuva30; esc = ESC.pct_normal; tit = 'Chuva de ' + fmtData(m.de) + ' a ' + fmtData(m.ate) + ' (% do normal)';
    sub = 'Marrom: choveu menos que o normal para a época; verde-azulado: mais.' + (A.chuva && A.chuva.preliminar_desde ? ' Dados preliminares desde ' + fmtData(A.chuva.preliminar_desde) + '.' : ''); }
  if (k === 'seca') { const mes = D.meta.mapas.spei3[D.meta.mapas.spei3.length - 1]; m = await mapaJson('spei3_' + mes + '.json'); esc = ESC.spi;
    tit = 'Seca em 3 meses (SPEI-3), até ' + fmtMesL(mes); sub = 'Chuva menos evaporação nos últimos 3 meses. Abaixo de −1, seca moderada; abaixo de −2, seca extrema.'; }
  if (k === 'temp') { m = A.mapa_tmax30; esc = ESC.temp; tit = 'Temperatura máxima de ' + fmtData(m.de) + ' a ' + fmtData(m.ate) + ': diferença da média (°C)';
    sub = 'Comparada com a média de 1991–2020 para os mesmos dias do ano.'; }
  if (k === 'fwi') { m = F.fwi.mapa; esc = ESC.fwi; tit = 'Perigo de fogo (FWI), média de ' + fmtData(m.de || m.data) + ' a ' + fmtData(m.data);
    sub = 'Quão fácil um fogo começaria e se espalharia, pelas condições do tempo.' + (Math.round((Date.now() - new Date(F.fwi.ultimo + 'T12:00:00Z')) / 864e5) > 10 ? ' Atenção: o Copernicus suspendeu temporariamente a atualização deste índice.' : ''); }
  if (k === 'focos') { pts = F.focos.pontos.filter(p => p[2] < 7);
    tit = ''; sub = pts.length + ' focos de calor nos últimos 7 dias, até ' + fmtDataL(F.focos.ultimo) + ' (satélite Aqua, NASA). Amarelos: os do último dia.'; }
  if ($('s-visao').hidden) return;
  mapaInterativo('agora-mapa', m, esc, { pontos: pts });
  if (esc) legendaMapa($('agora-mapa-leg'), esc, tit); else $('agora-mapa-leg').innerHTML = '';
  $('agora-mapa-sub').textContent = sub;
}
function hidroResumo(reg) {
  const H = D.series.hidro && D.series.hidro.regioes[reg]; if (!H || !H.clim) return '<div class="det">sem dados</div>';
  const p = H.parcial;
  if (p) { const med = H.clim.p50[p.indice];
    return '<div class="val">' + num(p.valor) + ' mm</div><div class="det">ano ' + p.ano + ', até ' + fmtData(p.ate) + (p.preliminar ? ' (preliminar)' : '') + '; mediana até o fim de ' + MESES_L[(D.series.hidro.mes_inicio - 1 + p.indice) % 12] + ': ' + num(med) + ' mm</div>'; }
  const anos = Object.keys(H.anos), ult = anos[anos.length - 1], c = H.anos[ult], k = ultimoIdx(c);
  return '<div class="val">' + num(c[k]) + ' mm</div><div class="det">ano ' + ult + '; mediana no mesmo ponto: ' + num(H.clim.p50[k]) + ' mm</div>';
}
function diaAno(iso) { const d = new Date(iso + 'T00:00:00Z'), a = d.getUTCFullYear(); let n = Math.round((d - Date.UTC(a, 0, 1)) / 864e5);
  if (((a % 4 === 0 && a % 100 !== 0) || a % 400 === 0) && n >= 59) n--; return Math.min(n, 364); }

/* ---------- Mapas ---------- */
function mapasIniciar() {
  opcoes($('mapa-var'), VARS_MAPA.filter(v => (D.meta.mapas[v[0]] || []).length).map(v => [v[0], v[1]]));
  const mudaVar = () => { const ms = D.meta.mapas[$('mapa-var').value], atual = $('mapa-mes').value;
    opcoes($('mapa-mes'), ms.slice().reverse().map(m => [m, fmtMes(m)]), ms.includes(atual) ? atual : ms[ms.length - 1]); mapasDesenhar(); };
  $('mapa-var').onchange = mudaVar; $('mapa-mes').onchange = mapasDesenhar;
  const passo = d => { const s = $('mapa-mes'), i = s.selectedIndex - d; if (i >= 0 && i < s.options.length) { s.selectedIndex = i; mapasDesenhar(); } };
  $('mapa-ant').onclick = () => passo(-1); $('mapa-prox').onclick = () => passo(1);
  const ms = D.meta.mapas[$('mapa-var').value]; if (ms) opcoes($('mapa-mes'), ms.slice().reverse().map(m => [m, fmtMes(m)]), ms[ms.length - 1]);
}
async function mapasDesenhar() {
  const v = VARS_MAPA.find(x => x[0] === $('mapa-var').value), mes = $('mapa-mes').value;
  if (!v || !mes) return;
  const esc = ESC[v[2]], m = await mapaJson(v[0] + '_' + mes + '.json');
  if ($('mapa-var').value !== v[0] || $('mapa-mes').value !== mes || $('s-mapas').hidden) return;
  mapaInterativo('mapa', m, esc);
  legendaMapa($('mapa-leg'), esc, v[1] + (esc.un && v[1].indexOf('(') < 0 ? ' (' + esc.un + ')' : '') + ' — ' + fmtMesL(mes));
  $('mapa-nota').textContent = (v[2] === 'calor' ? 'Número de dias do mês em onda de calor (CTX90pct). ' : v[2] === 'spi' ? 'Índice de seca: abaixo de −1, seca moderada; abaixo de −2, seca extrema. ' : 'Diferença em relação à média de 1991–2020. ') +
    'Cada quadrícula tem ' + num(m.d, 2) + '° de lado, cerca de ' + num(m.d * 111, 0) + ' km (' + (m.d < 0.08 ? 'CHIRPS' : 'ERA5-Land') + '). Linhas: limites da bacia, do Pantanal e da divisa MT/MS.';
}

/* ---------- Séries ---------- */
const VARS_SERIE = [
  ['chuva_pct', 'Chuva: diferença em relação à média (%)', 'sinal', '%', 0, 'seco'], ['chuva', 'Chuva: total do mês e média (mm)', 'clim', 'mm', 0, 'chuva_clim'],
  ['spi3', 'SPI-3 (seca, 3 meses)', 'sinal', '', 2, 'seco'], ['spi6', 'SPI-6 (seca, 6 meses)', 'sinal', '', 2, 'seco'], ['spi12', 'SPI-12 (seca, 12 meses)', 'sinal', '', 2, 'seco'], ['spi1', 'SPI-1 (seca, 1 mês)', 'sinal', '', 2, 'seco'],
  ['spei3', 'SPEI-3 (chuva − evaporação, 3 meses)', 'sinal', '', 2, 'seco'], ['spei6', 'SPEI-6', 'sinal', '', 2, 'seco'], ['spei12', 'SPEI-12', 'sinal', '', 2, 'seco'], ['spei1', 'SPEI-1', 'sinal', '', 2, 'seco'],
  ['tmax_anom', 'Temperatura máxima: diferença em relação à média (°C)', 'sinal', '°C', 1, 'temp'], ['tmed_anom', 'Temperatura média: diferença em relação à média (°C)', 'sinal', '°C', 1, 'temp'],
  ['tmin_anom', 'Temperatura mínima: diferença em relação à média (°C)', 'sinal', '°C', 1, 'temp'], ['calor', 'Dias em onda de calor', 'clim', 'dias', 1, 'calor_clim'],
  ['focos', 'Focos de calor no mês (MODIS/Aqua)', 'clim', 'focos', 0, 'focos_clim'], ['fwi', 'Perigo de fogo (FWI), média do mês', 'clim', '', 1, 'fwi_clim']];
/* comparação dos El Niños: [chave, nome, unidade, casas, tipo] — tipo 'z': índice padronizado (já de 3 meses);
   'anom': anomalia mensal; 'clim:<chave>': valor menos a média do mês. As anomalias mensais recebem média móvel de 3 meses. */
const VARS_CMP = [['spei3', 'Seca: SPEI-3 (chuva menos evaporação, 3 meses)', '', 1, 'z'], ['spi3', 'Seca: SPI-3 (só chuva, 3 meses)', '', 1, 'z'],
  ['tmax_anom', 'Temperatura máxima: diferença em relação à média (°C)', '°C', 1, 'anom'], ['calor', 'Dias em onda de calor: diferença em relação à média', 'dias', 1, 'clim:calor_clim'],
  ['focos', 'Focos de calor: diferença em relação à média do mês', 'focos', 0, 'clim:focos_clim'], ['fwi', 'Perigo de fogo (FWI): diferença em relação à média', '', 1, 'clim:fwi_clim']];
function seriesIniciar() {
  opcoes($('ser-reg'), D.meta.regioes.map(r => [r.id, nomeReg(r.id)]));
  const tem = k => D.series.regioes.bap[k] && D.series.regioes.bap[k].some(v => v != null);
  opcoes($('ser-var'), VARS_SERIE.filter(v => tem(v[0])).map(v => [v[0], v[1]]));
  opcoes($('cmp-var'), VARS_CMP.filter(v => tem(v[0])).map(v => [v[0], v[1]]));
  ['ser-reg', 'ser-var', 'ser-per'].forEach(id => $(id).onchange = seriesDesenhar);
  ['cmp-var', 'cmp-ev'].forEach(id => $(id).onchange = () => comparaNinos($('ser-reg').value));
  $('cmp-var').value = 'spei3';
}
function seriesDesenhar() {
  const S = D.series, v = VARS_SERIE.find(x => x[0] === $('ser-var').value), reg = $('ser-reg').value, s = S.regioes[reg];
  const fim = ultimoIdx(s[v[0]]) + 1, per = +$('ser-per').value, ini = per ? Math.max(0, fim - per) : 0;
  const x = S.meses.slice(ini, fim), corta = a => a.slice(ini, fim);
  let series, leg;
  if (v[2] === 'sinal') {
    const [neg, pos, rn, rp] = v[5] === 'temp' ? [COR.frio, COR.quente, 'abaixo da média', 'acima da média'] : [COR.seco, COR.umido, 'mais seco que a média', 'mais úmido que a média'];
    series = [{ nome: v[1].split(':')[0].split(' (')[0], tipo: 'barra', y: corta(s[v[0]]), cor: pos, corNeg: neg }]; leg = [[rn, neg, 'caixa'], [rp, pos, 'caixa']];
  } else {
    const cor = v[0] === 'calor' || v[0] === 'focos' || v[0] === 'fwi' ? COR.calor : css('--agua');
    const Pf = D.fogo && D.fogo.focos && D.fogo.focos.periodos, rotMed = v[0] === 'focos' && Pf ? 'média do regime recente (' + Pf[1].a0 + '–' + Pf[1].a1 + ')' : 'média 1991–2020';
    series = [{ nome: 'observado', tipo: 'barra', y: corta(s[v[0]]), cor: cor }, { nome: rotMed, tipo: 'linha', y: corta(s[v[5]]), cor: css('--tinta2'), esp: 2 }];
    leg = [['observado', cor, 'caixa'], [rotMed, css('--tinta2')]];
  }
  const eventos = eventosNino(x);
  if (eventos.length) leg.push(itemEvento());
  $('ser-titulo').textContent = v[1] + ' — ' + nomeReg(reg);
  legenda($('ser-leg'), leg);
  grafico($('ser-graf'), { x: x, series: series, un: v[3], casas: v[4], sinal: v[2] === 'sinal', eixoMeses: true, rotDica: fmtMes, titulo: v[1], eventos: eventos });
  tabela($('ser-tab'), ['Mês'].concat(series.map(q => q.nome)), x.map((m, i) => [fmtMes(m)].concat(series.map(q => num(q.y[i], v[4], v[2] === 'sinal')))).reverse());
  // El Niño / La Niña
  const E = S.enso || { serie: [], eventos: [] }, val = {};
  E.serie.forEach(o => val[o.t] = o.v);
  const xe = x.slice();                                  // estende até o último trimestre do índice
  const ultE = E.serie.length ? E.serie[E.serie.length - 1].t : null;
  while (ultE && xe[xe.length - 1] < ultE) { const [a, mm] = xe[xe.length - 1].split('-').map(Number); xe.push(mm === 12 ? (a + 1) + '-01' : a + '-' + String(mm + 1).padStart(2, '0')); }
  const faixas = (E.eventos || []).filter(ev => ev.tipo === 'La Niña').map(ev => ({ i0: xe.indexOf(ev.inicio), i1: xe.indexOf(ev.fim), cor: COR.frio, ev: ev }))
    .map(f => { if (f.i0 < 0 && f.ev.inicio < xe[0] && f.ev.fim >= xe[0]) f.i0 = 0; if (f.i1 < 0 && f.ev.fim > xe[xe.length - 1]) f.i1 = xe.length - 1; return f; })
    .filter(f => f.i0 >= 0 && f.i1 >= 0);
  $('enso-sub').textContent = 'Índice oficial da NOAA (' + (E.indice || 'RONI') + '), em médias de 3 meses: acima de +0,5 °C, águas do Pacífico equatorial mais quentes que o normal; abaixo de −0,5 °C, mais frias. Um evento exige pelo menos 5 médias de 3 meses seguidas (sobrepostas, cobrindo 7 meses) além desses limites.';
  legenda($('enso-leg'), [['índice acima de zero', COR.quente, 'caixa'], ['abaixo de zero', COR.frio, 'caixa'], itemEvento(), ['período de La Niña', COR.frio, 'fundo']]);
  grafico($('ser-enso'), { x: xe, series: [{ nome: E.indice || 'índice', tipo: 'barra', y: xe.map(m => val[m] == null ? null : val[m]), cor: COR.quente, corNeg: COR.frio }],
    un: '°C', casas: 1, sinal: true, eixoMeses: true, rotDica: m => 'média de ' + trimestre(m), h: 190, titulo: 'El Niño', eventos: eventosNino(xe), faixas: faixas });
  comparaNinos(reg);
  hidroDesenhar(reg);
}
let cmpDestaque = null;                            // inícios ('AAAA-MM') dos El Niños anteriores destacados
function serieCmp(R, v) {
  if (v[4] === 'z') return R[v[0]];
  const base = v[4] === 'anom' ? R[v[0]] : R[v[0]].map((q, i) => q == null || R[v[4].slice(5)][i] == null ? null : q - R[v[4].slice(5)][i]);
  return base.map((_, i) => { const t = [base[i - 1], base[i], base[i + 1]]; return t.every(q => q != null) ? (t[0] + t[1] + t[2]) / 3 : null; });
}
function comparaNinos(reg) {
  const S = D.series, E = S.enso, v = VARS_CMP.find(q => q[0] === $('cmp-var').value);
  if (!E || !E.eventos || !v) { $('cmp-graf').innerHTML = '<p class="nota">Sem dados.</p>'; return; }
  const lim = +$('cmp-ev').value, y = serieCmp(S.regioes[reg], v), M = S.meses;
  const k0 = -3, k1 = 18, x = []; for (let k = k0; k <= k1; k++) x.push(k);
  const nomeEv = e => nomeEvento(e).replace(/ \(em curso.*\)/, '') + ' (pico ' + num(e.pico, 1, true) + ')';
  let atual = null; const ant = [];
  E.eventos.filter(e => e.tipo === 'El Niño' && (e.pico >= lim || e.em_curso)).forEach(e => {
    const i0 = M.indexOf(e.inicio); if (i0 < 0) return;
    const val = x.map(k => { const i = i0 + k; return i >= 0 && i < M.length && y[i] != null ? y[i] : null; });
    if (!val.some(q => q != null)) return;
    if (e.em_curso) atual = { e: e, y: val }; else ant.push({ e: e, y: val });
  });
  if (cmpDestaque === null) cmpDestaque = ant.length ? [ant[ant.length - 1].e.inicio] : [];
  // faixa (menor e maior valor entre os eventos anteriores) e mediana, onde houver ao menos 3 eventos
  const col = j => ant.map(a => a.y[j]).filter(q => q != null).sort((a, b) => a - b);
  const lo = x.map((_, j) => { const c = col(j); return c.length >= 3 ? c[0] : null; });
  const hi = x.map((_, j) => { const c = col(j); return c.length >= 3 ? c[c.length - 1] : null; });
  const med = x.map((_, j) => { const c = col(j), n = c.length; return n >= 3 ? (n % 2 ? c[(n - 1) / 2] : (c[n / 2 - 1] + c[n / 2]) / 2) : null; });
  const mudo = css('--mudo'), series = [], leg = [];
  series.push({ nome: 'faixa dos anteriores', tipo: 'banda', y: lo, y2: hi, cor: mudo, opac: 0.25 },
    { nome: 'mediana dos anteriores', tipo: 'linha', y: med, cor: mudo, esp: 1.6, traco: '5 4' });
  leg.push(['do menor ao maior valor entre os El Niños anteriores*', mudo, 'caixa'], ['mediana dos anteriores', mudo, 'tracejada']);
  let k = 0;
  ant.forEach(a => { const dest = cmpDestaque.includes(a.e.inicio), cor = dest ? ANOS_COR[k++ % ANOS_COR.length] : mudo;
    series.push({ nome: nomeEv(a.e), tipo: 'linha', y: a.y, cor: cor, esp: 1.8, oculta: !dest });
    if (dest) leg.push([nomeEv(a.e), cor]); });
  if (atual) { series.push({ nome: nomeEv(atual.e).replace(' (pico', ' (atual, pico'), tipo: 'linha', y: atual.y, cor: corAtual(), esp: 3.2, marcas: true });
    leg.push(['El Niño atual (' + atual.e.inicio.slice(0, 4) + ')', corAtual(), 'linha-ponto']); }
  legenda($('cmp-leg'), leg);
  // escolha dos eventos destacados
  const dest = ant.filter(a => cmpDestaque.includes(a.e.inicio)), livres = ant.filter(a => !cmpDestaque.includes(a.e.inicio));
  $('cmp-anos').innerHTML = '<span>Destacar:</span>' + dest.map((a, j) => '<span class="ch"><i style="background:' + ANOS_COR[j % ANOS_COR.length] + '"></i>' + nomeEvento(a.e) + '<button type="button" data-a="' + a.e.inicio + '" aria-label="Remover">×</button></span>').join('') +
    (livres.length && dest.length < 4 ? '<select id="cmp-add" aria-label="Destacar outro El Niño"><option value="">+ outro El Niño</option>' + livres.slice().reverse().map(a => '<option value="' + a.e.inicio + '">' + nomeEvento(a.e) + '</option>').join('') + '</select>' : '');
  $('cmp-anos').querySelectorAll('button').forEach(b => b.onclick = () => { cmpDestaque = cmpDestaque.filter(q => q !== b.dataset.a); comparaNinos(reg); });
  if ($('cmp-add')) $('cmp-add').onchange = ev => { if (ev.target.value) { cmpDestaque = cmpDestaque.concat([ev.target.value]); comparaNinos(reg); } };
  $('cmp-n').textContent = ant.length;
  const zero = x.indexOf(0);
  grafico($('cmp-graf'), { x: x, series: series, un: v[2], casas: v[3], sinal: true, h: 290,
    ticksX: x.map((_, i) => i).filter(i => x[i] % 3 === 0), rotX: q => q === 0 ? 'início' : (q > 0 ? '+' : '') + q,
    rotDica: q => q === 0 ? 'mês de início do El Niño' : (q > 0 ? q + (q === 1 ? ' mês depois' : ' meses depois') : -q + (q === -1 ? ' mês antes' : ' meses antes')) + ' do início',
    faixas: zero >= 0 ? [{ i0: zero, i1: zero, cor: css('--nino') }] : [] });
}
function hidroDesenhar(reg) {
  const H = D.series.hidro, R = H && H.regioes[reg];
  if (!R || !R.clim) { $('hidro-graf').innerHTML = '<p class="nota">Sem dados.</p>'; return; }
  const x = H.meses.map(m => MESES[+m - 1]);
  const anos = Object.keys(R.anos), atual = R.parcial ? R.parcial.ano : anos[anos.length - 1];
  const mudo = css('--mudo'), ca = corAtual();
  const series = [{ nome: 'faixa 10–90%', tipo: 'banda', y: R.clim.p10, y2: R.clim.p90, cor: mudo },
    { nome: 'mediana', tipo: 'linha', y: R.clim.p50, cor: mudo, esp: 1.5, traco: '4 3' }];
  const leg = [['faixa 10–90%*', mudo, 'caixa'], ['mediana (1990/91–2019/20)', mudo, 'tracejada']];
  anos.filter(a => a !== atual).forEach((a, k) => { const c = ANOS_COR[k % ANOS_COR.length]; series.push({ nome: a, tipo: 'linha', y: R.anos[a], cor: c, esp: 1.6 }); leg.push([a, c]); });
  const ya = R.anos[atual] ? R.anos[atual].slice() : x.map(() => null);
  series.push({ nome: atual, tipo: 'linha', y: ya, cor: ca, esp: 3, marcas: true }); leg.push([atual + ': fim de cada mês', ca, 'linha-ponto']);
  if (R.parcial) {
    const yp = x.map(() => null); yp[R.parcial.indice] = R.parcial.valor;
    series.push({ nome: atual + ' até ' + fmtData(R.parcial.ate) + (R.parcial.preliminar ? ' (prelim.)' : ''), tipo: 'vazio', y: yp, cor: ca });
    leg.push(['mês em curso, até ' + fmtData(R.parcial.ate) + '**', ca, 'vazio']);
  }
  $('hidro-titulo').textContent = 'Chuva acumulada no ano hidrológico (mm) — ' + nomeReg(reg);
  legenda($('hidro-leg'), leg);
  grafico($('hidro-graf'), { x: x, series: series, un: 'mm', casas: 0, rotDica: (m, i) => 'até o fim de ' + MESES_L[(H.mes_inicio - 1 + i) % 12], ticksX: x.map((_, i) => i), h: 270 });
}

/* ---------- Fogo ---------- */
let regFogo = 'bap', pontosDias = 0, fogoAnos = null;
function fogoDesenhar() {
  const F = D.fogo || {}, Fo = F.focos, Fw = F.fwi;
  const seg = $('fogo-reg');
  seg.innerHTML = D.meta.regioes.map(r => '<button type="button" data-r="' + r.id + '"' + (r.id === regFogo ? ' class="ativo"' : '') + '>' + (NOMES[r.id] || [0, r.nome])[1] + '</button>').join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { regFogo = b.dataset.r; fogoDesenhar(); });
  // aviso se o FWI estiver parado (o Copernicus suspendeu as atualizações em 16/11/2026 para uma migração interna)
  const atrasoFwi = Fw ? Math.round((Date.now() - new Date(Fw.ultimo + 'T12:00:00Z')) / 864e5) : 0;
  $('fwi-aviso').hidden = !(Fw && atrasoFwi > 10);
  if (Fw && atrasoFwi > 10) $('fwi-aviso').innerHTML = '<strong>Perigo de fogo desatualizado:</strong> o último dado do FWI é de ' + fmtDataL(Fw.ultimo) +
    '. O Copernicus suspendeu temporariamente as atualizações desse índice para uma migração interna (anunciada em novembro de 2026); o painel volta a atualizá-lo assim que os dados forem retomados. Os focos de calor continuam em dia.';
  // cartões (curtos: muita gente vê pelo celular)
  let t = '';
  const tileF = (rot, val, det) => '<div class="tile"><div class="rot">' + rot + '</div><div class="val">' + val + '</div><div class="det">' + det + '</div></div>';
  if (Fo) { const r = Fo.regioes[regFogo], rec = Fo.periodos[Fo.periodos.length - 1];
    const comp = (v, ref) => { if (!(ref > 0)) return ''; const d = (v / ref - 1) * 100; return Math.abs(d) < 10 ? 'perto da média' : '<b>' + num(Math.abs(d)) + '% ' + (d > 0 ? 'acima' : 'abaixo') + '</b> da média'; };
    t += tileF('Focos, últimos 30 dias', num(r.ult30), comp(r.ult30, r.normal30[rec.id]) + ' (' + rec.a0 + '–' + rec.a1 + ')');
    t += tileF('Focos no ano', num(r.ano), '<b>' + r.posicao_ano + 'º maior</b> para esta data em ' + r.n_anos + ' anos'); }
  if (Fw) { const r = Fw.regioes[regFogo], cl = classe(r.media7, ESC.fwi.q);
    t += tileF('Perigo de fogo, 7 dias', '<i class="chip" style="background:' + ESC.fwi.cores()[cl] + '"></i>' + num(r.media7, 1) + '<small>' + ESC.fwi.nomes[cl] + '</small>',
      (r.percentil != null ? 'acima de <b>' + num(r.percentil) + '%</b> das semanas desta época' : '') + ' · até ' + fmtData(Fw.ultimo)); }
  const SC = F.seca_calor && F.seca_calor.regioes[regFogo], sp6 = D.series.regioes[regFogo].spei6, j6 = ultimoIdx(sp6);
  if (SC) { const c = classeSecaB(sp6[j6]);
    t += tileF('Seca e ondas de calor', SC.dias_onda_30 + '<small>dias de onda de calor em 30</small>', '<i class="chip" style="background:' + corSecaB(c) + '"></i>' + NOMES_SECA_B[c] + ' (SPEI-6, ' + fmtMesC(D.series.meses[j6]) + ')'); }
  $('fogo-tiles').innerHTML = t || '<p class="nota">Dados de fogo indisponíveis nesta atualização.</p>';
  // mapa
  $('fogo-mapa-bloco').hidden = !(Fw || Fo);
  if (Fw || Fo) {
    $('fogo-pontos').innerHTML = (Fo ? [[0, 'Sem focos'], [7, 'Focos de 7 dias'], [30, 'Focos de 30 dias']] : []).map(([d, n]) => '<button type="button" data-d="' + d + '"' + (d === pontosDias ? ' class="ativo"' : '') + '>' + n + '</button>').join('');
    $('fogo-pontos').querySelectorAll('button').forEach(b => b.onclick = () => { pontosDias = +b.dataset.d; fogoDesenhar(); });
    const pts = Fo && pontosDias ? Fo.pontos.filter(p => p[2] < pontosDias) : [];
    mapaInterativo('fogo-mapa', Fw ? Fw.mapa : null, ESC.fwi, { pontos: pts });
    const perW = Fw ? (Fw.mapa.de ? 'média de ' + fmtData(Fw.mapa.de) + ' a ' + fmtData(Fw.mapa.data) : 'em ' + fmtDataL(Fw.mapa.data)) : '';
    if (Fw) legendaMapa($('fogo-mapa-leg'), ESC.fwi, 'Perigo de fogo (FWI), ' + perW); else $('fogo-mapa-leg').innerHTML = '';
    $('fogo-mapa-sub').textContent = (Fw ? 'Cores: perigo de fogo, ' + perW + '. ' : '') + (Fo && pontosDias ? 'Pontos: ' + pts.length + ' focos de calor dos últimos ' + pontosDias + ' dias, até ' + fmtDataL(Fo.ultimo) + '; amarelos, os do último dia.' : '');
  }
  // focos acumulados no ano
  $('fogo-ac-bloco').hidden = !Fo;
  if (Fo) {
    const R = Fo.regioes[regFogo], anos = Object.keys(R.anos).sort(), atual = anos[anos.length - 1];
    if (!fogoAnos) fogoAnos = ['2020', '2024'].filter(a => R.anos[a] && a !== atual);
    const sel = fogoAnos.filter(a => R.anos[a]), mudo = css('--mudo'), ca = css('--nino');
    const series = [];
    sel.forEach((a, k) => series.push({ nome: a, tipo: 'linha', y: R.anos[a], cor: ANOS_COR[k % ANOS_COR.length], esp: 1.6 }));
    series.push({ nome: atual, tipo: 'linha', y: R.anos[atual], cor: ca, esp: 3 });
    $('fogo-ac-tit').textContent = 'Focos de calor acumulados no ano — ' + nomeReg(regFogo);
    legenda($('fogo-ac-leg'), sel.map((a, k) => [a, ANOS_COR[k % ANOS_COR.length]]).concat([[atual + ' (ano atual)', ca, 'grossa']]));
    const livres = anos.filter(a => a !== atual && !sel.includes(a)).reverse();
    $('fogo-anos').innerHTML = '<span>Comparar com:</span>' + sel.map((a, k) => '<span class="ch"><i style="background:' + ANOS_COR[k % ANOS_COR.length] + '"></i>' + a + '<button type="button" data-a="' + a + '" aria-label="Remover ' + a + '">×</button></span>').join('') +
      (sel.length < 6 ? '<select id="fogo-add" aria-label="Adicionar ano"><option value="">+ adicionar ano</option>' + livres.map(a => '<option>' + a + '</option>').join('') + '</select>' : '');
    $('fogo-anos').querySelectorAll('button').forEach(b => b.onclick = () => { fogoAnos = fogoAnos.filter(a => a !== b.dataset.a); fogoDesenhar(); });
    if ($('fogo-add')) $('fogo-add').onchange = ev => { if (ev.target.value) { fogoAnos = fogoAnos.concat([ev.target.value]); fogoDesenhar(); } };
    const ini = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], x = Array.from({ length: 365 }, (_, i) => i);
    const data = i => { let m = 11; while (ini[m] > i) m--; return 'até ' + (i - ini[m] + 1) + ' de ' + MESES[m]; };
    grafico($('fogo-ac-graf'), { x: x, series: series, un: 'focos', casas: 0, h: 300, ticksX: ini.map(v => v + 14), ticksMenores: ini.concat([365]),
      rotX: (_, i) => MESES[ini.findIndex(v => v + 14 === i)], rotDica: (_, i) => data(i) });
  }
  // FWI: últimos 6 meses
  $('fwi-bloco').hidden = !Fw;
  if (Fw) {
    const R = Fw.regioes[regFogo], x = R.datas, ca = css('--nino'), mudo = css('--mudo');
    $('fwi-tit').textContent = 'Perigo de fogo (FWI) nos últimos 6 meses — ' + nomeReg(regFogo);
    legenda($('fwi-leg'), [['média de ' + Fw.n_media + ' dias', ca, 'grossa'], ['valor de cada dia', css('--mudo'), 'linha'], ['mediana ' + Fw.ref, mudo, 'tracejada'], ['percentil 90 (as 10% semanas mais perigosas)', css('--tinta2'), 'tracejada']]);
    const tk = x.map((d, i) => d.slice(8) === '01' ? i : -1).filter(i => i >= 0);
    grafico($('fwi-graf'), { x: x, series: [{ nome: 'mediana', tipo: 'linha', y: R.p50, cor: mudo, esp: 1.5, traco: '4 3' },
      { nome: 'percentil 90', tipo: 'linha', y: R.p90, cor: css('--tinta2'), esp: 1.3, traco: '2 3' }, { nome: 'no dia', tipo: 'linha', y: R.v, cor: css('--mudo'), esp: 1 },
      { nome: 'média de ' + Fw.n_media + ' dias', tipo: 'linha', y: R.m7 || R.v, cor: ca, esp: 2.6 }],
      un: '', casas: 1, h: 260, ticksX: tk, rotX: d => fmtMesC(d.slice(0, 7)), rotDica: d => fmtDataC(d) });
  }
  secaCalor();
}
/* seca pelo SPEI-6, nas classes usadas por Belém et al. (2026): anormal ≤ −0,5; moderada ≤ −0,8; severa ≤ −1,3; extrema ≤ −1,6; excepcional ≤ −2,0 */
const NOMES_SECA_B = ['sem seca', 'seca anormal', 'seca moderada', 'seca severa', 'seca extrema', 'seca excepcional'];
function classeSecaB(z) { return z == null ? 0 : z <= -2 ? 5 : z <= -1.6 ? 4 : z <= -1.3 ? 3 : z <= -0.8 ? 2 : z <= -0.5 ? 1 : 0; }
function corSecaB(c) {
  const claro = ['#e3cf9a', '#cfa152', '#b8692e', '#9c3b1f', '#6e1a12'], esc = ['#7d6b4a', '#a57c3c', '#c4702f', '#d8492c', '#f2402c'];
  return c === 0 ? css('--meio') : (escuro() ? esc : claro)[c - 1];
}
function secaCalor() {
  const SCt = D.fogo && D.fogo.seca_calor, SC = SCt && SCt.regioes[regFogo];
  $('sq-bloco').hidden = !SC; if (!SC) return;
  const S = D.series, R = S.regioes[regFogo], M = S.meses, [m0, m1] = SCt.temporada;
  const nomeT = MESES[m0 - 1] + '–' + MESES[m1 - 1];
  $('sq-tit').textContent = 'Seca e ondas de calor juntas — ' + nomeReg(regFogo);
  // ---- ano a ano: % da região × dias da temporada em onda de calor, cor = pior SPEI-6 da temporada
  const anos = Object.keys(SC.anual).sort(), info = {};
  anos.forEach(a => {
    const idx = []; for (let m = m0; m <= m1; m++) { const i = M.indexOf(a + '-' + String(m).padStart(2, '0')); if (i >= 0) idx.push(i); }
    const sp = idx.map(i => R.spei6[i]).filter(q => q != null), fo = R.focos ? idx.map(i => R.focos[i]).filter(q => q != null) : [];
    const nino = (S.enso && S.enso.eventos || []).some(e => e.tipo === 'El Niño' && e.inicio <= a + '-' + String(m1).padStart(2, '0') && (e.em_curso || e.fim >= a + '-' + String(m0).padStart(2, '0')));
    info[a] = { sp: sp.length ? Math.min(...sp) : null, nsp: sp.length, fo: fo.length === idx.length && fo.length ? fo.reduce((p, q) => p + q, 0) : null, nino: nino };
  });
  const cl = anos.map(a => classeSecaB(info[a].sp)), y = anos.map(a => SC.anual[a].pct);
  const ordem = y.map((v, i) => [v, i]).sort((p, q) => q[0] - p[0]);
  legenda($('sq-leg'), NOMES_SECA_B.map((n, c) => [n, corSecaB(c), 'caixa']).concat([['El Niño durante a temporada', css('--nino'), 'linha']]));
  grafico($('sq-graf'), { x: anos, series: [{ nome: 'em onda de calor', tipo: 'barra', y: y, cores: cl.map(corSecaB) }], un: '%', casas: 0, h: 250,
    ticksX: anos.map((a, i) => i).filter(i => +anos[i] % 5 === 0), marcasBase: [{ idx: anos.map((a, i) => i).filter(i => info[anos[i]].nino), cor: css('--nino') }],
    rotDica: (a, i) => 'Temporada de ' + nomeT + ' de ' + a + (SC.anual[a].parcial ? ' (até ' + fmtData(SC.anual[a].ate) + ')' : ''),
    dicaExtra: i => { const a = anos[i], q = info[a], pos = ordem.findIndex(o => o[1] === i) + 1;
      return '<div class="l"><span>posição</span><span>' + pos + 'º maior de ' + anos.length + '</span></div>' +
        '<div class="l"><span><i class="chip" style="background:' + corSecaB(cl[i]) + '"></i>seca (pior SPEI-6)</span><span>' + (q.sp == null ? '–' : num(q.sp, 1, true) + ', ' + NOMES_SECA_B[cl[i]]) + '</span></div>' +
        (q.fo != null ? '<div class="l"><span>focos de calor em ' + nomeT + '</span><span>' + num(q.fo) + '</span></div>' : '') + (q.nino ? '<div class="ev">El Niño</div>' : ''); } });
  const det = $('sq-graf').closest('details');
  if (det && !det.dataset.ok) { det.dataset.ok = 1; det.addEventListener('toggle', () => { if (det.open) secaCalor(); }); }
  // ---- últimos 12 meses, dia a dia
  const Dd = SC.diario, x = Dd.datas, faixas = [];
  for (let i = 0; i < x.length; i++) if (Dd.onda[i]) { let j = i; while (j + 1 < x.length && Dd.onda[j + 1]) j++; faixas.push({ i0: i, i1: j, cor: COR.calor }); i = j; }
  const tk = x.map((d, i) => d.slice(8) === '15' ? i : -1).filter(i => i >= 0), tkm = x.map((d, i) => d.slice(8) === '01' ? i : -1).filter(i => i >= 0);
  legenda($('sq-dia-leg'), [['temperatura máxima do dia, média da região', COR.calor, 'linha'], ['percentil 90 do dia em ' + SCt.ref, css('--tinta2'), 'tracejada'], ['onda de calor: 3 dias ou mais acima do percentil 90', COR.calor, 'fundo']]);
  grafico($('sq-dia'), { x: x, series: [{ nome: 'percentil 90', tipo: 'linha', y: Dd.p90, cor: css('--tinta2'), esp: 1.3, traco: '4 3' }, { nome: 'Tmax', tipo: 'linha', y: Dd.tmax, cor: COR.calor, esp: 1.7 }],
    un: '°C', casas: 1, zero: false, h: 220, faixas: faixas, ticksX: tk, rotX: d => MESES[+d.slice(5, 7) - 1], rotDica: d => fmtDataC(d),
    dicaExtra: i => Dd.onda[i] ? '<div class="ev" style="color:' + COR.calor + '">dia de onda de calor</div>' : '' });
  // faixa da seca (SPEI-6 de cada mês), alinhada ao eixo do gráfico diário
  const el = $('sq-seca'), W = Math.max(el.clientWidth, 280), ml = 44, mr = 12, n = x.length, passo = (W - ml - mr) / n, H = 34;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Seca mês a mês pelo SPEI-6"><text x="' + (ml - 7) + '" y="15" text-anchor="end">seca</text>';
  for (let i = 0; i < n;) { const mes = x[i].slice(0, 7); let j = i; while (j + 1 < n && x[j + 1].slice(0, 7) === mes) j++;
    const im = M.indexOf(mes), z = im >= 0 ? R.spei6[im] : null, c = classeSecaB(z);
    s += '<rect x="' + (ml + i * passo + 1) + '" y="4" width="' + Math.max((j - i + 1) * passo - 2, 1) + '" height="16" rx="2" fill="' + (z == null ? 'none' : corSecaB(c)) + '"' + (z == null ? ' stroke="' + css('--grade') + '" stroke-dasharray="3 2"' : '') + ' data-m="' + mes + '"/>';
    i = j + 1; }
  el.innerHTML = s + '</svg>';
  el.firstChild.addEventListener('pointermove', ev => { const m = ev.target.dataset && ev.target.dataset.m; if (!m) return escondeDica();
    const im = M.indexOf(m), z = im >= 0 ? R.spei6[im] : null;
    mostraDica('<b>' + fmtMesL(m) + '</b>' + (z == null ? 'SPEI-6 ainda não disponível (falta o mês completo)' : '<div class="l"><span><i class="chip" style="background:' + corSecaB(classeSecaB(z)) + '"></i>SPEI-6</span><span>' + num(z, 1, true) + ', ' + NOMES_SECA_B[classeSecaB(z)] + '</span></div>'), ev.clientX, ev.clientY); });
  el.firstChild.addEventListener('pointerleave', escondeDica);
}

/* ---------- Previsão ---------- */
let leadSel = 0;
function previsaoIniciar() {
  const ms = D.prev.modelos;
  if (!ms.length) { $('s-previsao').innerHTML = '<div class="bloco"><h2>Previsão indisponível</h2><p>Esta atualização rodou sem as previsões do C3S. Elas voltam na próxima atualização em que o Copernicus responder.</p></div>'; return false; }
  opcoes($('prev-mod'), ms.map(m => [m.id, m.nome]));
  opcoes($('prev-reg'), D.meta.regioes.map(r => [r.id, nomeReg(r.id)]));
  ['prev-mod', 'prev-var', 'prev-reg'].forEach(id => $(id).onchange = previsaoDesenhar);
  return true;
}
function previsaoDesenhar() {
  const mod = D.prev.modelos.find(m => m.id === $('prev-mod').value); if (!mod) return;
  const va = $('prev-var').value, reg = $('prev-reg').value, r = mod.regioes[reg][va], nome = nomeReg(reg);
  const eChuva = va === 'chuva', cor = eChuva ? [COR.umido, COR.seco] : [COR.quente, COR.frio];
  const series = [];
  if (r.p10) series.push({ nome: 'faixa dos membros', tipo: 'banda', y: r.p10, y2: r.p90, cor: css('--mudo') });
  series.push({ nome: 'média do conjunto', tipo: 'barra', y: r.media, cor: cor[0], corNeg: cor[1] });
  $('prev-titulo').textContent = (eChuva ? 'Chuva prevista: diferença em relação à média (mm/mês)' : 'Temperatura prevista: diferença em relação à média (°C)') + ' — ' + nome;
  legenda($('prev-leg'), [[eChuva ? 'mais chuva que a média' : 'mais quente', cor[0], 'caixa'], [eChuva ? 'menos chuva que a média' : 'mais frio', cor[1], 'caixa']]
    .concat(r.p10 ? [['faixa com 80% dos membros*', css('--mudo'), 'caixa']] : []));
  grafico($('prev-graf'), { x: mod.alvos, series: series, un: eChuva ? 'mm' : '°C', casas: eChuva ? 0 : 2, sinal: true, rotX: fmtMesC, rotDica: fmtMes, ticksX: mod.alvos.map((_, i) => i), h: 240 });
  let f = 'Previsão do <strong>' + mod.nome + '</strong> emitida em ' + fmtMesL(mod.inic) + ', com ' + mod.membros + ' membros. ';
  if (r.frac_neg) f += eChuva ? 'Para ' + fmtMesL(mod.alvos[1]) + ', <strong>' + num(r.frac_neg[1]) + '%</strong> dos membros indicam chuva abaixo da média em ' + nome + '.'
    : 'Para ' + fmtMesL(mod.alvos[1]) + ', <strong>' + num(100 - r.frac_neg[1]) + '%</strong> dos membros indicam temperatura acima da média em ' + nome + '.';
  $('prev-frase').innerHTML = f;
  leadSel = Math.min(leadSel, mod.alvos.length - 1);
  $('prev-leads').innerHTML = mod.alvos.map((a, i) => '<button type="button" data-i="' + i + '"' + (i === leadSel ? ' class="ativo"' : '') + '>' + fmtMes(a) + '</button>').join('');
  $('prev-leads').querySelectorAll('button').forEach(b => b.onclick = () => { leadSel = +b.dataset.i; previsaoDesenhar(); });
  const esc = ESC['prev_' + va], g = mod.grade;
  mapaInterativo('prev-mapa', { lon0: g.lon0, lat0: g.lat0, d: g.d, nx: g.nx, ny: g.ny, v: mod.mapas[va][leadSel] }, esc);
  legendaMapa($('prev-mapa-leg'), esc, (eChuva ? 'Chuva: diferença em relação à média (mm/mês)' : 'Temperatura: diferença em relação à média (°C)') + ' — ' + fmtMesL(mod.alvos[leadSel]));
  $('prev-mapa-sub').textContent = mod.nome + ', média dos membros';
}

/* ---------- Previsto x observado ---------- */
function verifIniciar() {
  const ms = D.verif.modelos;
  if (!ms.length) { $('s-verificacao').innerHTML = '<div class="bloco"><h2>Comparação indisponível</h2><p>Ainda não há previsões arquivadas do C3S para comparar.</p></div>'; return false; }
  opcoes($('ver-mod'), ms.map(m => [m.id, m.nome]));
  opcoes($('ver-reg'), D.meta.regioes.map(r => [r.id, nomeReg(r.id)]));
  opcoes($('ver-lead'), [1, 2, 3, 4, 5, 6].map(l => [l, l === 1 ? '1 mês (emitida no próprio mês)' : l + ' meses (emitida ' + (l - 1) + ' ' + (l === 2 ? 'mês' : 'meses') + ' antes)']), 2);
  ['ver-mod', 'ver-var', 'ver-reg', 'ver-lead'].forEach(id => $(id).onchange = verifDesenhar);
  return true;
}
function verifDesenhar() {
  const mod = D.verif.modelos.find(m => m.id === $('ver-mod').value); if (!mod) return;
  const va = $('ver-var').value, reg = $('ver-reg').value, L = +$('ver-lead').value, todos = mod.regioes[reg][va], eChuva = va === 'chuva';
  const pts = todos.filter(p => p.lead === L).sort((a, b) => a.alvo < b.alvo ? -1 : 1);
  const corObs = css('--tinta'), corPrev = corAtual(), x = pts.map(p => p.alvo), eventos = eventosNino(x);
  const temFaixa = pts.some(p => p.p10 != null);
  $('ver-titulo').textContent = (eChuva ? 'Chuva' : 'Temperatura') + ': diferença em relação à média 1993–2016 (' + (eChuva ? 'mm/mês' : '°C') + ') — ' + nomeReg(reg);
  legenda($('ver-leg'), [['observado', corObs, 'linha-ponto'], ['previsto (média dos membros), antecedência de ' + L + (L === 1 ? ' mês' : ' meses'), corPrev, 'linha-ponto']]
    .concat(temFaixa ? [['faixa com 80% dos membros', corPrev, 'caixa']] : []).concat(eventos.length ? [itemEvento()] : []));
  const series = [];
  if (temFaixa) series.push({ nome: 'faixa dos membros', tipo: 'banda', y: pts.map(p => p.p10 ?? null), y2: pts.map(p => p.p90 ?? null), cor: corPrev, opac: 0.18 });
  series.push({ nome: 'observado', tipo: 'linha', marcas: true, y: pts.map(p => p.obs), cor: corObs },
    { nome: 'previsto', tipo: 'linha', marcas: true, y: pts.map(p => p.prev), cor: corPrev });
  grafico($('ver-graf'), { x: x, series: series, un: eChuva ? 'mm' : '°C', casas: eChuva ? 0 : 2, sinal: true, eixoMeses: x.length > 8, rotX: x.length > 8 ? null : fmtMesC,
    ticksX: x.length > 8 ? null : x.map((_, i) => i), rotDica: fmtMes, h: 260, eventos: eventos });
  const cs = eChuva ? 0 : 2;
  const linhas = [1, 2, 3, 4, 5, 6].map(l => { const q = todos.filter(p => p.lead === l && p.obs != null); if (!q.length) return [l + (l === 1 ? ' mês' : ' meses'), 0, '–', '–', '–', '–'];
    const e = q.map(p => p.prev - p.obs), vies = e.reduce((a, b) => a + b, 0) / e.length, mae = e.reduce((a, b) => a + Math.abs(b), 0) / e.length;
    const sinal = q.filter(p => Math.sign(p.prev) === Math.sign(p.obs)).length;
    const qf = q.filter(p => p.p10 != null), dentro = qf.filter(p => p.obs >= p.p10 && p.obs <= p.p90).length;
    return [l + (l === 1 ? ' mês' : ' meses'), q.length, num(vies, cs, true), num(mae, cs), sinal + ' de ' + q.length, qf.length ? dentro + ' de ' + qf.length : '–']; });
  tabela($('ver-tab'), ['Antecedência', 'Meses comparados', 'Erro médio', 'Erro típico', 'Acertou o lado', 'Dentro da faixa'], linhas);
}

/* ---------- Rio ---------- */
let rioAnos = null;
function rioIniciar() {
  const es = D.rio.estacoes || [];
  if (!es.length) { $('s-rio').innerHTML = '<div class="bloco"><h2>Nível do rio indisponível</h2><p>Sem dados da ANA nesta atualização.</p></div>'; return false; }
  opcoes($('rio-est'), es.map(e => [e.codigo, e.nome])); $('rio-est').onchange = rioDesenhar; return true;
}
const NOTAS_RIO = {
  'Cáceres': 'Em Cáceres o rio Paraguai ainda está perto das cabeceiras: sobe e desce em poucos dias a cada chuva forte, por isso a linha é "nervosa". Essas oscilações são reais.',
  'Ladário': 'Em Ladário a água já atravessou boa parte do Pantanal, que funciona como uma esponja: a cheia chega meses depois da chuva e varia devagar.',
  'Porto Murtinho': 'Porto Murtinho fica na saída do Pantanal: o nível reflete a água que escoou de toda a planície, com atraso de meses em relação à chuva.'
};
function rioDesenhar() {
  const e = D.rio.estacoes.find(q => q.codigo === $('rio-est').value); if (!e) return;
  const anos = Object.keys(e.anos).sort(), atual = anos[anos.length - 1], med = e.clim.p50[diaAno(e.ultimo.data)];
  if (!rioAnos) rioAnos = (e.padrao || anos.slice(-3)).filter(a => a !== atual);
  const sel = rioAnos.filter(a => e.anos[a]);
  $('rio-tiles').innerHTML = '<div class="tile"><div class="rot">Último nível · ' + fmtDataC(e.ultimo.data) + '</div><div class="val">' + num(e.ultimo.cm) + ' cm</div><div class="det">' + (med != null ? 'A mediana para este dia do ano é ' + num(med) + ' cm.' : '') + '</div></div>' +
    '<div class="tile"><div class="rot">Diferença para a mediana</div><div class="val">' + (med != null ? num(e.ultimo.cm - med, 0, true) + ' cm' : '–') + '</div><div class="det">Referência 1991–2020 (' + e.ref_anos + ' anos com dados).</div></div>' +
    '<div class="tile"><div class="rot">Mínimo da série</div><div class="val">' + num(e.min_hist.cm) + ' cm</div><div class="det">Em ' + fmtDataC(e.min_hist.data) + '.</div></div>';
  const mudo = css('--mudo'), ca = corAtual();
  const x = Array.from({ length: 365 }, (_, i) => i), series = [{ nome: 'faixa 10–90%', tipo: 'banda', y: e.clim.p10, y2: e.clim.p90, cor: mudo },
    { nome: 'mediana', tipo: 'linha', y: e.clim.p50, cor: mudo, esp: 1.5, traco: '4 3' }], leg = [['faixa 10–90% (1991–2020)*', mudo, 'caixa'], ['mediana', mudo, 'tracejada']];
  sel.forEach((a, k) => { series.push({ nome: a, tipo: 'linha', y: e.anos[a], cor: ANOS_COR[k % ANOS_COR.length], esp: 1.6 }); });
  series.push({ nome: atual, tipo: 'linha', y: e.anos[atual], cor: ca, esp: 3 }); leg.push([atual + ' (ano atual)', ca, 'grossa']);
  $('rio-titulo').textContent = 'Nível do rio Paraguai em ' + e.nome + ' ao longo do ano (cm)';
  legenda($('rio-leg'), leg);
  // escolha dos anos de comparação
  const livres = anos.filter(a => a !== atual && !sel.includes(a)).reverse();
  $('rio-anos').innerHTML = '<span>Comparar com:</span>' + sel.map((a, k) => '<span class="ch"><i style="background:' + ANOS_COR[k % ANOS_COR.length] + '"></i>' + a +
    '<button type="button" data-a="' + a + '" aria-label="Remover ' + a + '">×</button></span>').join('') +
    (sel.length < 6 ? '<select id="rio-add" aria-label="Adicionar ano"><option value="">+ adicionar ano</option>' + livres.map(a => '<option>' + a + '</option>').join('') + '</select>' : '');
  $('rio-anos').querySelectorAll('button').forEach(b => b.onclick = () => { rioAnos = rioAnos.filter(a => a !== b.dataset.a); rioDesenhar(); });
  if ($('rio-add')) $('rio-add').onchange = ev => { if (ev.target.value) { rioAnos = rioAnos.concat([ev.target.value]); rioDesenhar(); } };
  const ini = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const data = i => { let m = 11; while (ini[m] > i) m--; return (i - ini[m] + 1) + ' de ' + MESES[m]; };
  grafico($('rio-graf'), { x: x, series: series, un: 'cm', casas: 0, zero: false, h: 310, ticksX: ini.map(v => v + 14), ticksMenores: ini.concat([365]),
    rotX: (_, i) => MESES[ini.findIndex(v => v + 14 === i)], rotDica: (_, i) => data(i) });
  $('rio-nota').textContent = (NOTAS_RIO[e.nome.replace(/ \(.*\)$/, '')] || '') + ' Fonte: Agência Nacional de Águas e Saneamento Básico (ANA).';
}

/* ---------- Sobre ---------- */
function sobre() {
  $('n-refs').textContent = '(' + $('refs').children.length + ')';
}

/* ---------- navegação ---------- */
const ABAS = ['visao', 'mapas', 'series', 'fogo', 'previsao', 'verificacao', 'rio', 'sobre'];
const desenha = { visao: visao, mapas: mapasDesenhar, series: seriesDesenhar, fogo: fogoDesenhar, previsao: previsaoDesenhar, verificacao: verifDesenhar, rio: rioDesenhar, sobre: sobre };
const pronto = {};
function rota() {
  let a = location.hash.replace('#', ''); if (!ABAS.includes(a)) a = 'visao';
  ABAS.forEach(x => { $('s-' + x).hidden = x !== a; });
  document.querySelectorAll('#abas a').forEach(l => l.classList.toggle('ativa', l.getAttribute('href') === '#' + a));
  escondeDica();
  if (!D.meta) return;
  if (pronto[a] !== false) desenha[a]();
  const at = document.querySelector('#abas a.ativa'); if (at && at.scrollIntoView) at.scrollIntoView({ block: 'nearest', inline: 'center' });
}
async function iniciar() {
  $('ano').textContent = new Date().getFullYear();
  try {
    [D.meta, D.series, D.geo, D.prev, D.verif, D.rio] = await Promise.all(['meta.json', 'series.json', 'regioes.geojson', 'previsao.json', 'verificacao.json', 'rio.json'].map(a => json(a)));
    D.agora = await json('agora.json', true);
    D.fogo = await json('fogo.json', true);
  } catch (e) {
    ABAS.forEach(x => $('s-' + x).hidden = true); $('s-vazio').hidden = false; $('abas').hidden = true; return;
  }
  $('aviso-demo').hidden = !D.meta.demo;
  $('atual').textContent = 'Atualizado em ' + fmtDataC(D.meta.atualizado.slice(0, 10));
  $('citacao').textContent = 'Barros da Rosa, L. (' + D.meta.atualizado.slice(0, 4) + '). Painel Hidroclimático da Bacia do Alto Paraguai [painel on-line]. Disponível em: ' + location.origin + location.pathname + '. Acesso em: ' + fmtDataC(new Date().toISOString().slice(0, 10)) + '.';
  $('copiar-cit').onclick = () => { try { navigator.clipboard.writeText($('citacao').textContent); $('copiar-cit').querySelector('span').textContent = 'Copiado'; } catch (e) {} };
  const F = D.meta.fontes || {}; if (F.regioes) $('txt-regioes').textContent = F.regioes; if (F.chuva) $('txt-chuva').textContent = F.chuva;
  mapasIniciar(); seriesIniciar();
  pronto.previsao = previsaoIniciar(); pronto.verificacao = verifIniciar(); pronto.rio = rioIniciar();
  rota();
}
function temaBotao() { const e = escuro(); $('tema').querySelector('span').textContent = e ? 'Fundo claro' : 'Fundo escuro'; $('tema').querySelector('use').setAttribute('href', e ? '#i-sol' : '#i-lua'); }
$('tema').onclick = () => {
  const novo = document.documentElement.dataset.tema === 'claro' ? 'escuro' : 'claro';
  document.documentElement.dataset.tema = novo;
  try { localStorage.setItem('tema', novo); } catch (e) {}
  temaBotao(); rota();                                   // redesenha mapas e gráficos com as cores do tema
};
temaBotao();
addEventListener('hashchange', rota);
let tr, larguraAnt = innerWidth; addEventListener('resize', () => { if (innerWidth === larguraAnt) return; larguraAnt = innerWidth; clearTimeout(tr); tr = setTimeout(rota, 150); });
iniciar();
})();
