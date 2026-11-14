/* Painel Hidroclimático da Bacia do Alto Paraguai — Lucas Barros da Rosa (University of British Columbia)
   Sem bibliotecas externas: mapas em <canvas>, gráficos em SVG. Lê os arquivos de dados/ gerados pelo pipeline. */
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
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const num = (v, c = 0, sinal = false) => v == null || !isFinite(v) ? '–' :
  (sinal && v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }).replace('-', '−');

/* ---------- cores ---------- */
const SECO = ['#8c510a', '#bf812d', '#dfc27d'], UMIDO = ['#80cdc1', '#35978f', '#01665e'];
const FRIO = ['#2166ac', '#67a9cf', '#d1e5f0'], QUENTE = ['#fddbc7', '#ef8a62', '#b2182b'];
const COR = { seco: '#bf812d', umido: '#35978f', frio: '#4393c3', quente: '#d6604d', calor: '#d95926',
  cat: ['#2a78d6', '#eb6834', '#1baf7a', '#c98a00', '#e87ba4'] };
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
  pct_normal: { un: '% da normal', casas: 0, q: [20, 40, 60, 80, 90, 110, 120, 140, 160, 180], cores: () => divergente(SECO, UMIDO, 5) },
  chuva_anom: { un: 'mm', casas: 0, q: [-150, -100, -50, -25, -10, 10, 25, 50, 100, 150], cores: () => divergente(SECO, UMIDO, 5), sinal: true },
  spi: { un: '', casas: 1, q: [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2], cores: () => divergente(SECO, UMIDO, 4), sinal: true },
  temp: { un: '°C', casas: 1, q: [-4, -3, -2, -1, -0.5, 0.5, 1, 2, 3, 4], cores: () => divergente(FRIO, QUENTE, 5), sinal: true },
  calor: { un: 'dias', casas: 0, q: [1, 3, 5, 10, 15, 20], cores: () => [css('--meio')].concat(rampa(['#fdd9bf', '#f08a4b', '#b9340f', '#6b1505'], 6)) },
  prev_chuva: { un: 'mm/mês', casas: 0, q: [-100, -50, -25, -10, -5, 5, 10, 25, 50, 100], cores: () => divergente(SECO, UMIDO, 5), sinal: true },
  prev_temp: { un: '°C', casas: 2, q: [-2, -1.5, -1, -0.5, -0.25, 0.25, 0.5, 1, 1.5, 2], cores: () => divergente(FRIO, QUENTE, 5), sinal: true }
};
const VARS_MAPA = [
  ['chuva_pct', 'Chuva: anomalia (%)', 'chuva_pct'], ['chuva_anom', 'Chuva: anomalia (mm)', 'chuva_anom'],
  ['spi3', 'SPI-3 (seca, 3 meses)', 'spi'], ['spi6', 'SPI-6', 'spi'], ['spi12', 'SPI-12', 'spi'],
  ['spei3', 'SPEI-3 (chuva − evapotranspiração)', 'spi'], ['spei6', 'SPEI-6', 'spi'], ['spei12', 'SPEI-12', 'spi'],
  ['tmax_anom', 'Temperatura máxima: anomalia', 'temp'], ['tmed_anom', 'Temperatura média: anomalia', 'temp'],
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
const nomeReg = id => D.meta.regioes.find(r => r.id === id).nome;

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

/* ---------- mapa em canvas ---------- */
const EXT = { lon0: -60.4, lon1: -52.6, lat0: -13.2, lat1: -23.0 };
const CIDADES = [['Cuiabá', -56.10, -15.60], ['Cáceres', -57.68, -16.07], ['Poconé', -56.62, -16.26], ['Rondonópolis', -54.64, -16.47],
  ['Corumbá', -57.65, -19.01], ['Coxim', -54.76, -18.51], ['Campo Grande', -54.62, -20.47], ['Porto Murtinho', -57.88, -21.70]];
function desenhaMapa(canvas, m, esc, opc = {}) {
  const larg = canvas.parentElement.clientWidth, kx = Math.cos(18 * Math.PI / 180);
  const alt = Math.round(larg * (EXT.lat0 - EXT.lat1) / ((EXT.lon1 - EXT.lon0) * kx));
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = larg * dpr; canvas.height = alt * dpr; canvas.style.height = alt + 'px';
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = lon => (lon - EXT.lon0) / (EXT.lon1 - EXT.lon0) * larg, Y = lat => (EXT.lat0 - lat) / (EXT.lat0 - EXT.lat1) * alt;
  c.fillStyle = css('--sup'); c.fillRect(0, 0, larg, alt);
  const cores = esc.cores();
  if (m) {
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
  if (!opc.semCidades) {
    c.font = '11px system-ui,sans-serif'; c.textBaseline = 'middle';
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
    const i = Math.floor((lon - m.lon0) / m.d), j = Math.floor((m.lat0 - lat) / m.d);
    const v = i >= 0 && j >= 0 && i < m.nx && j < m.ny ? m.v[j * m.nx + i] : null;
    if (v == null) return escondeDica();
    mostraDica('<b>' + num(v, esc.casas, esc.sinal) + ' ' + esc.un + '</b>' + num(Math.abs(lat), 2) + '°S, ' + num(Math.abs(lon), 2) + '°O', ev.clientX, ev.clientY);
  };
  canvas.onpointerleave = escondeDica;
}
function legendaMapa(el, esc, titulo) {
  const cores = esc.cores(), q = esc.q, f = v => num(v, 2).replace(/,?0+$/, '');
  let h = '<div class="tit">' + titulo + '</div>';
  cores.forEach((cor, i) => {
    const rot = i === 0 ? '< ' + f(q[0]) : i === q.length ? '≥ ' + f(q[i - 1]) : f(q[i - 1]) + ' a ' + f(q[i]);
    h += '<div class="cls"><i style="background:' + cor + '"></i>' + rot + '</div>';
  });
  el.innerHTML = h;
}

/* ---------- gráfico SVG ---------- */
function ticksBons(a, b, n) {
  const bruto = (b - a) / n, p = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / p;
  const passo = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(a / passo) * passo; v <= b + 1e-9; v += passo) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out;
}
/* cfg: {x, series:[{nome,tipo:'barra'|'linha'|'banda'|'pontos'|'vazio',y,y2,cor,corNeg,esp,traco,marcas}],
         un, casas, sinal, zero, h, ticksX, rotX, rotDica, marcos:[{i,rotulo}], faixas:[{i0,i1,cor}]} */
function grafico(el, cfg) {
  const W = Math.max(el.clientWidth, 280), H = cfg.h || 250, m = { l: 42, r: 12, t: cfg.marcos && cfg.marcos.length ? 22 : 10, b: 24 }, n = cfg.x.length;
  let lo = Infinity, hi = -Infinity;
  cfg.series.forEach(s => [s.y, s.y2].forEach(a => a && a.forEach(v => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } })));
  if (!isFinite(lo)) { el.innerHTML = '<p class="nota" style="padding:20px">Sem dados para esta seleção.</p>'; return; }
  if (cfg.zero !== false) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) hi = lo + 1;
  const folga = (hi - lo) * 0.06; lo -= lo < 0 || cfg.zero === false ? folga : 0; hi += folga;
  const tk = ticksBons(lo, hi, 5), passo = (W - m.l - m.r) / n;
  const X = i => m.l + (i + 0.5) * passo, Y = v => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const grade = css('--grade'), eixo = css('--eixo'), sup = css('--sup'), nino = css('--nino');
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + (cfg.titulo || 'gráfico') + '">';
  (cfg.faixas || []).forEach(f => { s += '<rect x="' + (X(f.i0) - passo / 2) + '" y="' + m.t + '" width="' + (X(f.i1) - X(f.i0) + passo) + '" height="' + (H - m.t - m.b) + '" fill="' + f.cor + '" opacity="0.12"/>'; });
  tk.forEach(v => { s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="' + (v === 0 ? eixo : grade) + '" stroke-width="1"/>' +
    '<text x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + num(v, Math.abs(tk[1] - tk[0]) < 1 ? 1 : 0) + '</text>'; });
  const tx = cfg.ticksX || (() => { const k = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 80)))), a = []; for (let i = n - 1; i >= 0; i -= k) a.push(i); return a; })();
  tx.forEach(i => { s += '<text x="' + X(i) + '" y="' + (H - 7) + '" text-anchor="' + (!cfg.ticksX && X(i) > W - 34 ? 'end' : 'middle') + '">' + (cfg.rotX ? cfg.rotX(cfg.x[i], i) : cfg.x[i]) + '</text>'; });
  cfg.series.forEach(se => {
    if (se.tipo === 'banda') {
      let seg = [], d = '';
      const fecha = () => { if (seg.length > 1) d += 'M' + seg.map(i => X(i) + ',' + Y(se.y2[i])).join('L') + 'L' + seg.slice().reverse().map(i => X(i) + ',' + Y(se.y[i])).join('L') + 'Z'; seg = []; };
      for (let i = 0; i < n; i++) (se.y[i] != null && se.y2[i] != null) ? seg.push(i) : fecha();
      fecha(); s += '<path d="' + d + '" fill="' + se.cor + '" opacity="0.2"/>';
    } else if (se.tipo === 'barra') {
      const bw = Math.max(1, Math.min(26, passo - (passo > 6 ? 2 : 0.5)));
      for (let i = 0; i < n; i++) { const v = se.y[i]; if (v == null) continue;
        const y0 = Y(0), y1 = Y(v); s += '<rect x="' + (X(i) - bw / 2) + '" y="' + Math.min(y0, y1) + '" width="' + bw + '" height="' + Math.max(Math.abs(y1 - y0), 0.8) + '" fill="' + (v < 0 && se.corNeg ? se.corNeg : se.cor) + '"' + (bw > 7 ? ' rx="2"' : '') + '/>'; }
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
  (cfg.marcos || []).forEach(mc => {
    const x = X(mc.i), esq = x > W * 0.7;
    s += '<line x1="' + x + '" x2="' + x + '" y1="' + (m.t - 4) + '" y2="' + (H - m.b) + '" stroke="' + nino + '" stroke-width="1.6" stroke-dasharray="4 3"/>' +
      '<text class="marco" x="' + (x + (esq ? -5 : 5)) + '" y="' + (m.t - 8) + '" text-anchor="' + (esq ? 'end' : 'start') + '">' + mc.rotulo + '</text>';
  });
  s += '<line id="cz" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="' + eixo + '" stroke-width="1" visibility="hidden"/></svg>';
  el.innerHTML = s;
  const svg = el.firstChild, cz = svg.querySelector('#cz');
  const mover = ev => {
    const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) / r.width * W - m.l) / passo)));
    cz.setAttribute('x1', X(i)); cz.setAttribute('x2', X(i)); cz.setAttribute('visibility', 'visible');
    let h = '<b>' + (cfg.rotDica ? cfg.rotDica(cfg.x[i], i) : cfg.x[i]) + '</b>';
    cfg.series.forEach(se => {
      if (se.semDica) return;
      if (se.tipo === 'banda') { if (se.y[i] != null) h += '<div class="l"><span>' + se.nome + '</span><span>' + num(se.y[i], cfg.casas, cfg.sinal) + ' a ' + num(se.y2[i], cfg.casas, cfg.sinal) + '</span></div>'; }
      else if (se.y[i] != null) h += '<div class="l"><span><i class="chip" style="background:' + (se.y[i] < 0 && se.corNeg ? se.corNeg : se.cor) + '"></i>' + se.nome + '</span><span>' + num(se.y[i], cfg.casas, cfg.sinal) + (cfg.un ? ' ' + cfg.un : '') + '</span></div>';
    });
    (cfg.marcos || []).forEach(mc => { if (mc.i === i) h += '<div class="l" style="color:' + nino + '"><span>' + mc.rotulo + '</span><span></span></div>'; });
    mostraDica(h, ev.clientX, ev.clientY);
  };
  svg.addEventListener('pointermove', mover); svg.addEventListener('pointerdown', mover);
  svg.addEventListener('pointerleave', () => { cz.setAttribute('visibility', 'hidden'); escondeDica(); });
}
function legenda(el, itens) { el.innerHTML = itens.map(([n, c, tipo]) => '<span' + (tipo === 'tr' ? ' style="color:' + c + '"' : '') + '><i class="' + (tipo === 1 ? 'cx' : tipo === 'tr' ? 'tr' : '') + '" style="background:' + c + '"></i>' + n + '</span>').join(''); }
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

/* ---------- El Niño: marco nos gráficos ---------- */
function ninoAtual() { return D.series.enso && D.series.enso.atual; }
function marcosNino(x) {                       // x: lista 'AAAA-MM'
  const e = ninoAtual(); if (!e) return [];
  const i = x.indexOf(e.inicio);
  return i >= 0 ? [{ i: i, rotulo: 'Início do El Niño (' + fmtMesC(e.inicio) + ')' }] : [];
}

/* ---------- Visão geral ---------- */
let regAgora = 'bap';
function visao() {
  const S = D.series, M = S.meses, bap = S.regioes.bap, E = S.enso;
  // faixa do El Niño
  const fx = $('faixa-enso');
  if (E && E.serie && E.serie.length) {
    const o = E.serie[E.serie.length - 1], at = E.atual;
    fx.hidden = false;
    fx.innerHTML = at && at.em_curso
      ? '<span class="selo">EL NIÑO EM CURSO</span><span class="num">' + num(o.v, 1, true) + ' °C</span><span class="txt">' + E.indice + ' no trimestre centrado em ' + fmtMes(o.t) +
        ' · intensidade ' + forcaNino(o.v) + ' · início em ' + fmtMesL(at.inicio) + ' (critério NOAA/CPC)' + (E.aviso ? '; alerta oficial da NOAA em ' + E.aviso.split('-').reverse().join('/') : '') + '</span>'
      : '<span class="selo" style="background:var(--mudo)">ENSO</span><span class="num" style="color:var(--tinta)">' + num(o.v, 1, true) + ' °C</span><span class="txt">' + E.indice + ' no trimestre centrado em ' + fmtMes(o.t) + '</span>';
  }
  // últimos dias
  const A = D.agora;
  const seg = $('agora-reg');
  seg.innerHTML = D.meta.regioes.map(r => '<button data-r="' + r.id + '"' + (r.id === regAgora ? ' class="ativo"' : '') + '>' + (r.curto || r.nome) + '</button>').join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { regAgora = b.dataset.r; visao(); });
  if (A) {
    const r = A.regioes[regAgora], partes = [];
    if (A.chuva) partes.push('chuva até ' + fmtDataL(A.chuva.ate) + (A.chuva.preliminar_desde ? ' (preliminar desde ' + fmtData(A.chuva.preliminar_desde) + ')' : ''));
    if (A.temp) partes.push('temperatura até ' + fmtDataL(A.temp.ate));
    $('agora-sub').textContent = partes.join(' · ');
    const tileChuva = (k, n) => {
      const c = r[k]; if (!c) return '';
      const pct = c.pct, larg = Math.min(100, (pct || 0) / 2);
      return '<div class="tile"><div class="rot">Chuva nos últimos ' + n + ' dias</div>' +
        '<div class="val">' + chip(pct, 'pct_normal') + num(pct) + '%</div><div class="barra"><i style="width:' + larg + '%;background:' + corDe(pct, 'pct_normal') + '"></i><b style="left:50%"></b></div>' +
        '<div class="det">' + (A.chuva.preliminar_desde ? '<span class="tag">preliminar</span>' : '') + num(c.mm) + ' mm; normal ' + num(c.normal) + ' mm</div></div>';
    };
    let t = tileChuva('chuva30', 30) + tileChuva('chuva90', 90);
    if (r.calor_mes) t += '<div class="tile"><div class="rot">Dias em onda de calor em ' + MESES_L[+A.temp.mes.slice(5) - 1] + '</div><div class="val">' + chip(r.calor_mes.dias, 'calor') + num(r.calor_mes.dias, 1) + '</div>' +
      '<div class="det">até o dia ' + A.temp.dia + '; normal até essa data: ' + num(r.calor_mes.normal, 1) + '</div></div>';
    if (r.tmax30_anom != null) t += '<div class="tile"><div class="rot">Temperatura máxima, últimos 30 dias</div><div class="val">' + chip(r.tmax30_anom, 'temp') + num(r.tmax30_anom, 1, true) + ' °C</div>' +
      '<div class="det">em relação à média de 1991–2020</div></div>';
    $('agora-tiles').innerHTML = t;
    const mp = A.mapa_chuva30;
    if (mp) {
      desenhaMapa($('agora-mapa'), mp, ESC.pct_normal, { semCidades: true });
      $('agora-mapa-leg').innerHTML = 'Chuva de ' + fmtData(mp.de) + ' a ' + fmtData(mp.ate) + ' em % da normal. ' +
        '<span style="color:' + COR.seco + ';font-weight:600">Marrom</span>: abaixo; <span style="color:' + COR.umido + ';font-weight:600">verde-azulado</span>: acima.';
    } else $('agora-mapa').parentElement.parentElement.hidden = true;
  } else {
    $('agora-sub').textContent = 'Dados diários indisponíveis nesta atualização.';
    $('agora-tiles').innerHTML = ''; $('agora-mapa').parentElement.parentElement.hidden = true;
  }
  // último mês completo
  const ic = ultimoIdx(bap.chuva), it = ultimoIdx(bap.tmax_anom);
  $('mes-titulo').textContent = 'Último mês completo: ' + fmtMesL(M[ic]) + (it !== ic ? ' (temperatura: ' + fmtMesL(M[it]) + ')' : '');
  const s = S.regioes[regAgora], j6 = ultimoIdx(s.spei6);
  $('mes-sub').textContent = nomeReg(regAgora) + ' · anomalias em relação a 1991–2020';
  const tile = (rot, val, c, det) => '<div class="tile"><div class="rot">' + rot + '</div><div class="val">' + (c || '') + val + '</div><div class="det">' + det + '</div></div>';
  $('cartoes').innerHTML =
    tile('Chuva no mês', num(s.chuva_pct[ic], 0, true) + '%', chip(s.chuva_pct[ic], 'chuva_pct'), num(s.chuva[ic]) + ' mm; média ' + num(s.chuva_clim[ic]) + ' mm') +
    tile('Seca em 3 meses (SPI-3)', num(s.spi3[ic], 1, true), chip(s.spi3[ic], 'spi'), classeSeca(s.spi3[ic])) +
    tile('Seca em 6 meses (SPEI-6)', num(s.spei6[j6], 1, true), chip(s.spei6[j6], 'spi'), classeSeca(s.spei6[j6])) +
    tile('Temperatura máxima', num(s.tmax_anom[it], 1, true) + ' °C', chip(s.tmax_anom[it], 'temp'), 'média do mês: ' + num(s.tmax[it], 1) + ' °C') +
    tile('Dias em onda de calor', num(s.calor[it], 1), chip(s.calor[it], 'calor'), 'normal: ' + num(s.calor_clim[it], 1));
  // atalhos
  let at = '';
  (D.rio.estacoes || []).slice(0, 1).forEach(e => { const med = e.clim.p50[diaAno(e.ultimo.data)];
    at += '<a class="atalho" href="#rio" style="--c:#13809a"><div class="rot">Rio Paraguai em ' + e.nome + '</div><div class="val">' + num(e.ultimo.cm) + ' cm</div><div class="det">' +
      (med != null ? num(e.ultimo.cm - med, 0, true) + ' cm em relação à mediana · ' : '') + e.ultimo.data.split('-').reverse().join('/') + '</div><span class="ir">Ver o rio →</span></a>'; });
  const mp = D.prev.modelos[0];
  if (mp) { const r = mp.regioes.bap, soma = r.chuva.media.slice(0, 3).reduce((a, b) => a + (b || 0), 0);
    at += '<a class="atalho" href="#previsao" style="--c:#7656c2"><div class="rot">Previsão de chuva, ' + fmtMes(mp.alvos[0]) + ' a ' + fmtMes(mp.alvos[2]) + '</div><div class="val">' + num(soma, 0, true) + ' mm</div>' +
      '<div class="det">anomalia somada nos 3 meses · ' + mp.nome + '</div><span class="ir">Ver a previsão →</span></a>'; }
  at += '<a class="atalho" href="#series" style="--c:#d65a22"><div class="rot">Chuva acumulada desde outubro · ' + nomeReg(regAgora) + '</div>' + hidroResumo(regAgora) + '<span class="ir">Ver as séries →</span></a>';
  $('atalhos').innerHTML = at;
}
function hidroResumo(reg) {
  const H = D.series.hidro && D.series.hidro.regioes[reg]; if (!H || !H.clim) return '<div class="det">sem dados</div>';
  const p = H.parcial;
  if (p) { const med = H.clim.p50[p.indice];
    return '<div class="val">' + num(p.valor) + ' mm</div><div class="det">ano ' + p.ano + ' até ' + fmtData(p.ate) + (p.preliminar ? ' (preliminar)' : '') + '; mediana ao fim de ' + MESES[(D.series.hidro.mes_inicio - 1 + p.indice) % 12] + ': ' + num(med) + ' mm</div>'; }
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
  mudaVar();
}
async function mapasDesenhar() {
  const v = VARS_MAPA.find(x => x[0] === $('mapa-var').value), mes = $('mapa-mes').value;
  if (!v || !mes) return;
  const esc = ESC[v[2]], m = await mapaJson(v[0] + '_' + mes + '.json');
  if ($('mapa-var').value !== v[0] || $('mapa-mes').value !== mes) return;
  desenhaMapa($('mapa'), m, esc);
  legendaMapa($('mapa-leg'), esc, v[1] + (esc.un && v[1].indexOf('(') < 0 ? ' (' + esc.un + ')' : '') + ' — ' + fmtMes(mes));
  $('mapa-nota').textContent = (v[2] === 'calor' ? 'Número de dias do mês em onda de calor (CTX90pct). ' : 'Anomalia em relação a 1991–2020. ') +
    'Grade de ' + num(m.d, 2) + '° (' + (m.d < 0.08 ? 'CHIRPS' : 'ERA5-Land') + '). Toque no mapa para ver o valor.';
}

/* ---------- Séries ---------- */
const VARS_SERIE = [
  ['chuva_pct', 'Chuva: anomalia (%)', 'sinal', '%', 0, 'seco'], ['chuva', 'Chuva: total e média (mm)', 'clim', 'mm', 0, 'chuva_clim'],
  ['spi3', 'SPI-3', 'sinal', '', 2, 'seco'], ['spi6', 'SPI-6', 'sinal', '', 2, 'seco'], ['spi12', 'SPI-12', 'sinal', '', 2, 'seco'], ['spi1', 'SPI-1', 'sinal', '', 2, 'seco'],
  ['spei3', 'SPEI-3', 'sinal', '', 2, 'seco'], ['spei6', 'SPEI-6', 'sinal', '', 2, 'seco'], ['spei12', 'SPEI-12', 'sinal', '', 2, 'seco'], ['spei1', 'SPEI-1', 'sinal', '', 2, 'seco'],
  ['tmax_anom', 'Temperatura máxima: anomalia (°C)', 'sinal', '°C', 1, 'temp'], ['tmed_anom', 'Temperatura média: anomalia (°C)', 'sinal', '°C', 1, 'temp'],
  ['tmin_anom', 'Temperatura mínima: anomalia (°C)', 'sinal', '°C', 1, 'temp'], ['calor', 'Dias em onda de calor', 'clim', 'dias', 1, 'calor_clim']];
function seriesIniciar() {
  opcoes($('ser-reg'), D.meta.regioes.map(r => [r.id, r.nome]));
  opcoes($('ser-var'), VARS_SERIE.map(v => [v[0], v[1]]));
  ['ser-reg', 'ser-var', 'ser-per'].forEach(id => $(id).onchange = seriesDesenhar);
}
function seriesDesenhar() {
  const S = D.series, v = VARS_SERIE.find(x => x[0] === $('ser-var').value), reg = $('ser-reg').value, s = S.regioes[reg];
  const fim = ultimoIdx(s[v[0]]) + 1, per = +$('ser-per').value, ini = per ? Math.max(0, fim - per) : 0;
  const x = S.meses.slice(ini, fim), corta = a => a.slice(ini, fim);
  let series, leg;
  if (v[2] === 'sinal') {
    const [neg, pos, rn, rp] = v[5] === 'temp' ? [COR.frio, COR.quente, 'abaixo da média', 'acima da média'] : [COR.seco, COR.umido, 'mais seco que a média', 'mais úmido que a média'];
    series = [{ nome: v[1].split(':')[0], tipo: 'barra', y: corta(s[v[0]]), cor: pos, corNeg: neg }]; leg = [[rn, neg, 1], [rp, pos, 1]];
  } else {
    const cor = v[0] === 'calor' ? COR.calor : COR.cat[0];
    series = [{ nome: 'observado', tipo: 'barra', y: corta(s[v[0]]), cor: cor }, { nome: 'média 1991–2020', tipo: 'linha', y: corta(s[v[5]]), cor: css('--tinta2'), esp: 2 }];
    leg = [['observado', cor, 1], ['média 1991–2020', css('--tinta2')]];
  }
  const marcos = marcosNino(x);
  if (marcos.length) leg.push(['início do El Niño', css('--nino'), 'tr']);
  $('ser-titulo').textContent = v[1] + ' — ' + nomeReg(reg);
  legenda($('ser-leg'), leg);
  const rotX = ym => x.length > 72 ? ym.slice(0, 4) : fmtMesC(ym);
  grafico($('ser-graf'), { x: x, series: series, un: v[3], casas: v[4], sinal: v[2] === 'sinal', rotX: rotX, rotDica: fmtMes, titulo: v[1], marcos: marcos });
  tabela($('ser-tab'), ['Mês'].concat(series.map(q => q.nome)), x.map((m, i) => [fmtMes(m)].concat(series.map(q => num(q.y[i], v[4], v[2] === 'sinal')))).reverse());
  // El Niño / La Niña
  const E = S.enso || { serie: [], eventos: [] }, val = {};
  E.serie.forEach(o => val[o.t] = o.v);
  const xe = x.slice();                                  // estende até o último trimestre do índice
  const ultE = E.serie.length ? E.serie[E.serie.length - 1].t : null;
  while (ultE && xe[xe.length - 1] < ultE) { const [a, mm] = xe[xe.length - 1].split('-').map(Number); xe.push(mm === 12 ? (a + 1) + '-01' : a + '-' + String(mm + 1).padStart(2, '0')); }
  const faixas = (E.eventos || []).map(ev => ({ i0: xe.indexOf(ev.inicio), i1: xe.indexOf(ev.fim), cor: ev.tipo === 'El Niño' ? COR.quente : COR.frio, ev: ev }))
    .map(f => { if (f.i0 < 0 && f.ev.inicio < xe[0] && f.ev.fim >= xe[0]) f.i0 = 0; if (f.i1 < 0 && f.ev.fim > xe[xe.length - 1]) f.i1 = xe.length - 1; return f; })
    .filter(f => f.i0 >= 0 && f.i1 >= 0);
  $('enso-sub').textContent = (E.indice || 'índice') + ', NOAA/CPC; faixas: eventos pelo critério oficial (≥ 5 trimestres além de ±0,5 °C)';
  legenda($('enso-leg'), [['El Niño', COR.quente, 1], ['La Niña', COR.frio, 1]].concat(marcosNino(xe).length ? [['início do El Niño atual', css('--nino'), 'tr']] : []));
  grafico($('ser-enso'), { x: xe, series: [{ nome: E.indice || 'índice', tipo: 'barra', y: xe.map(m => val[m] == null ? null : val[m]), cor: COR.quente, corNeg: COR.frio }],
    un: '°C', casas: 1, sinal: true, rotX: ym => xe.length > 72 ? ym.slice(0, 4) : fmtMesC(ym), rotDica: m => 'trimestre centrado em ' + fmtMes(m), h: 170, titulo: 'El Niño',
    marcos: marcosNino(xe), faixas: faixas });
  hidroDesenhar(reg);
}
function hidroDesenhar(reg) {
  const H = D.series.hidro, R = H && H.regioes[reg];
  if (!R || !R.clim) { $('hidro-graf').innerHTML = '<p class="nota">Sem dados.</p>'; return; }
  const x = H.meses.map(m => MESES[+m - 1]);
  const anos = Object.keys(R.anos), atual = R.parcial ? R.parcial.ano : anos[anos.length - 1];
  const series = [{ nome: 'faixa 10–90%', tipo: 'banda', y: R.clim.p10, y2: R.clim.p90, cor: css('--mudo') },
    { nome: 'mediana', tipo: 'linha', y: R.clim.p50, cor: css('--mudo'), esp: 1.5, traco: '4 3' }];
  const leg = [['faixa 10–90% (1990/91–2019/20)', css('--mudo'), 1], ['mediana', css('--mudo')]];
  anos.filter(a => a !== atual).forEach((a, k) => { const c = COR.cat[1 + k % 4]; series.push({ nome: a, tipo: 'linha', y: R.anos[a], cor: c, esp: 1.5 }); leg.push([a, c]); });
  const ya = R.anos[atual] ? R.anos[atual].slice() : x.map(() => null);
  series.push({ nome: atual, tipo: 'linha', y: ya, cor: COR.cat[0], esp: 3, marcas: true }); leg.push([atual, COR.cat[0]]);
  if (R.parcial) {
    const yp = x.map(() => null); yp[R.parcial.indice] = R.parcial.valor;
    series.push({ nome: atual + ' até ' + fmtData(R.parcial.ate) + (R.parcial.preliminar ? ' (prelim.)' : ''), tipo: 'vazio', y: yp, cor: COR.cat[0] });
  }
  $('hidro-titulo').textContent = 'Chuva acumulada no ano hidrológico (mm) — ' + nomeReg(reg);
  legenda($('hidro-leg'), leg);
  grafico($('hidro-graf'), { x: x, series: series, un: 'mm', casas: 0, rotDica: (m, i) => 'até o fim de ' + MESES_L[(H.mes_inicio - 1 + i) % 12], ticksX: x.map((_, i) => i), h: 260 });
}

/* ---------- Previsão ---------- */
let leadSel = 0;
function previsaoIniciar() {
  const ms = D.prev.modelos;
  if (!ms.length) { $('s-previsao').innerHTML = '<div class="bloco texto"><h2>Previsão indisponível</h2><p>O pipeline rodou sem as previsões do C3S. Configure o acesso ao Copernicus CDS e rode de novo.</p></div>'; return false; }
  opcoes($('prev-mod'), ms.map(m => [m.id, m.nome]));
  opcoes($('prev-reg'), D.meta.regioes.map(r => [r.id, r.nome]));
  ['prev-mod', 'prev-var', 'prev-reg'].forEach(id => $(id).onchange = previsaoDesenhar);
  return true;
}
function previsaoDesenhar() {
  const mod = D.prev.modelos.find(m => m.id === $('prev-mod').value); if (!mod) return;
  const va = $('prev-var').value, reg = $('prev-reg').value, r = mod.regioes[reg][va], nome = nomeReg(reg);
  const eChuva = va === 'chuva', cor = eChuva ? [COR.umido, COR.seco] : [COR.quente, COR.frio];
  const series = [];
  if (r.p10) series.push({ nome: 'faixa 10–90% dos membros', tipo: 'banda', y: r.p10, y2: r.p90, cor: css('--mudo') });
  series.push({ nome: 'média do conjunto', tipo: 'barra', y: r.media, cor: cor[0], corNeg: cor[1] });
  $('prev-titulo').textContent = (eChuva ? 'Anomalia de chuva prevista (mm/mês)' : 'Anomalia de temperatura prevista (°C)') + ' — ' + nome;
  legenda($('prev-leg'), [[eChuva ? 'acima da média' : 'mais quente', cor[0], 1], [eChuva ? 'abaixo da média' : 'mais frio', cor[1], 1]].concat(r.p10 ? [['faixa 10–90% dos membros', css('--mudo'), 1]] : []));
  grafico($('prev-graf'), { x: mod.alvos, series: series, un: eChuva ? 'mm' : '°C', casas: eChuva ? 0 : 2, sinal: true, rotX: fmtMesC, rotDica: fmtMes, ticksX: mod.alvos.map((_, i) => i), h: 230 });
  let f = 'Previsão do <strong>' + mod.nome + '</strong> emitida em ' + fmtMes(mod.inic) + ' (' + mod.membros + ' membros), em relação a ' + D.prev.ref + '. ';
  if (r.frac_neg) f += eChuva ? 'Para ' + fmtMes(mod.alvos[1]) + ', <strong>' + num(r.frac_neg[1]) + '%</strong> dos membros indicam chuva abaixo da média em ' + nome + '.'
    : 'Para ' + fmtMes(mod.alvos[1]) + ', <strong>' + num(100 - r.frac_neg[1]) + '%</strong> dos membros indicam temperatura acima da média em ' + nome + '.';
  $('prev-frase').innerHTML = f;
  leadSel = Math.min(leadSel, mod.alvos.length - 1);
  $('prev-leads').innerHTML = mod.alvos.map((a, i) => '<button data-i="' + i + '"' + (i === leadSel ? ' class="ativo"' : '') + '>' + fmtMes(a) + '</button>').join('');
  $('prev-leads').querySelectorAll('button').forEach(b => b.onclick = () => { leadSel = +b.dataset.i; previsaoDesenhar(); });
  const esc = ESC['prev_' + va], g = mod.grade;
  desenhaMapa($('prev-mapa'), { lon0: g.lon0, lat0: g.lat0, d: g.d, nx: g.nx, ny: g.ny, v: mod.mapas[va][leadSel] }, esc);
  legendaMapa($('prev-mapa-leg'), esc, (eChuva ? 'Anomalia de chuva (mm/mês)' : 'Anomalia de temperatura (°C)') + ' — ' + fmtMes(mod.alvos[leadSel]));
  $('prev-mapa-sub').textContent = mod.nome + ', média do conjunto';
}

/* ---------- Previsto x observado ---------- */
function verifIniciar() {
  const ms = D.verif.modelos;
  if (!ms.length) { $('s-verificacao').innerHTML = '<div class="bloco texto"><h2>Comparação indisponível</h2><p>Sem previsões arquivadas do C3S nesta atualização.</p></div>'; return false; }
  opcoes($('ver-mod'), ms.map(m => [m.id, m.nome]));
  opcoes($('ver-reg'), D.meta.regioes.map(r => [r.id, r.nome]));
  opcoes($('ver-lead'), [1, 2, 3, 4, 5, 6].map(l => [l, l === 1 ? '1 (mês da emissão)' : l + ' meses']), 2);
  ['ver-mod', 'ver-var', 'ver-reg', 'ver-lead'].forEach(id => $(id).onchange = verifDesenhar);
  return true;
}
function verifDesenhar() {
  const mod = D.verif.modelos.find(m => m.id === $('ver-mod').value); if (!mod) return;
  const va = $('ver-var').value, reg = $('ver-reg').value, L = +$('ver-lead').value, todos = mod.regioes[reg][va], eChuva = va === 'chuva';
  const pts = todos.filter(p => p.lead === L).sort((a, b) => a.alvo < b.alvo ? -1 : 1);
  const corObs = css('--tinta'), corPrev = COR.cat[0], x = pts.map(p => p.alvo), marcos = marcosNino(x);
  $('ver-titulo').textContent = 'Anomalia ' + (eChuva ? 'de chuva (mm/mês)' : 'de temperatura (°C)') + ' — ' + nomeReg(reg);
  legenda($('ver-leg'), [['observado', corObs], ['previsto com antecedência ' + L, corPrev]].concat(marcos.length ? [['início do El Niño', css('--nino'), 'tr']] : []));
  grafico($('ver-graf'), { x: x, series: [
    { nome: 'observado', tipo: 'linha', marcas: true, y: pts.map(p => p.obs), cor: corObs },
    { nome: 'previsto', tipo: 'linha', marcas: true, y: pts.map(p => p.prev), cor: corPrev }],
    un: eChuva ? 'mm' : '°C', casas: eChuva ? 0 : 2, sinal: true, rotX: fmtMesC, rotDica: fmtMes, h: 250, marcos: marcos });
  const linhas = [1, 2, 3, 4, 5, 6].map(l => { const q = todos.filter(p => p.lead === l && p.obs != null); if (!q.length) return [l, 0, '–', '–', '–'];
    const e = q.map(p => p.prev - p.obs), vies = e.reduce((a, b) => a + b, 0) / e.length, mae = e.reduce((a, b) => a + Math.abs(b), 0) / e.length;
    const sinal = q.filter(p => Math.sign(p.prev) === Math.sign(p.obs)).length;
    return [l, q.length, num(vies, eChuva ? 0 : 2, true), num(mae, eChuva ? 0 : 2), sinal + ' de ' + q.length]; });
  tabela($('ver-tab'), ['Antecedência', 'Meses comparados', 'Erro médio (previsto − observado)', 'Erro absoluto médio', 'Acertou o sinal'], linhas);
}

/* ---------- Rio ---------- */
function rioIniciar() {
  const es = D.rio.estacoes || [];
  if (!es.length) { $('s-rio').innerHTML = '<div class="bloco texto"><h2>Nível do rio indisponível</h2><p>O serviço da ANA não respondeu nesta atualização.</p></div>'; return false; }
  opcoes($('rio-est'), es.map(e => [e.codigo, e.nome])); $('rio-est').onchange = rioDesenhar; return true;
}
function rioDesenhar() {
  const e = D.rio.estacoes.find(q => q.codigo === $('rio-est').value); if (!e) return;
  const anos = Object.keys(e.anos).sort(), atual = anos[anos.length - 1], med = e.clim.p50[diaAno(e.ultimo.data)];
  $('rio-tiles').innerHTML = '<div class="tile"><div class="rot">Último nível (' + e.ultimo.data.split('-').reverse().join('/') + ')</div><div class="val">' + num(e.ultimo.cm) + ' cm</div><div class="det">' + (med != null ? 'mediana para a data: ' + num(med) + ' cm' : '') + '</div></div>' +
    '<div class="tile"><div class="rot">Diferença para a mediana</div><div class="val">' + (med != null ? num(e.ultimo.cm - med, 0, true) + ' cm' : '–') + '</div><div class="det">referência 1991–2020 (' + e.ref_anos + ' anos com dados)</div></div>' +
    '<div class="tile"><div class="rot">Mínimo da série</div><div class="val">' + num(e.min_hist.cm) + ' cm</div><div class="det">' + e.min_hist.data.split('-').reverse().join('/') + '</div></div>';
  const x = Array.from({ length: 365 }, (_, i) => i), series = [{ nome: 'faixa 10–90%', tipo: 'banda', y: e.clim.p10, y2: e.clim.p90, cor: css('--mudo') },
    { nome: 'mediana', tipo: 'linha', y: e.clim.p50, cor: css('--mudo'), esp: 1.5, traco: '4 3' }], leg = [['faixa 10–90% (1991–2020)', css('--mudo'), 1], ['mediana', css('--mudo')]];
  anos.filter(a => a !== atual).forEach((a, k) => { series.push({ nome: a, tipo: 'linha', y: e.anos[a], cor: COR.cat[1 + k % 4], esp: 1.5 }); leg.push([a, COR.cat[1 + k % 4]]); });
  series.push({ nome: atual, tipo: 'linha', y: e.anos[atual], cor: COR.cat[0], esp: 3 }); leg.push([atual, COR.cat[0]]);
  $('rio-titulo').textContent = 'Nível do rio Paraguai em ' + e.nome + ' ao longo do ano (cm)';
  legenda($('rio-leg'), leg);
  const ini = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const data = i => { let m = 11; while (ini[m] > i) m--; return (i - ini[m] + 1) + ' de ' + MESES[m]; };
  grafico($('rio-graf'), { x: x, series: series, un: 'cm', casas: 0, zero: false, h: 300, ticksX: ini.map(v => v + 14), rotX: (_, i) => MESES[ini.findIndex(v => v + 14 === i)], rotDica: (_, i) => data(i) });
}

/* ---------- navegação ---------- */
const ABAS = ['visao', 'mapas', 'series', 'previsao', 'verificacao', 'rio', 'sobre'];
const desenha = { visao: visao, mapas: mapasDesenhar, series: seriesDesenhar, previsao: previsaoDesenhar, verificacao: verifDesenhar, rio: rioDesenhar, sobre: () => {} };
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
  } catch (e) {
    ABAS.forEach(x => $('s-' + x).hidden = true); $('s-vazio').hidden = false; $('abas').hidden = true; return;
  }
  D.meta.regioes.forEach(r => { const c = { bap: 'Bacia', pln: 'Planalto N', ptn: 'Pantanal N', pls: 'Planalto S', pts: 'Pantanal S' }[r.id]; if (!r.curto) r.curto = c || r.nome; });
  $('aviso-demo').hidden = !D.meta.demo;
  $('atual').textContent = 'Atualizado em ' + D.meta.atualizado.slice(0, 10).split('-').reverse().join('/');
  $('citacao').textContent = 'Barros da Rosa, L. (' + D.meta.atualizado.slice(0, 4) + '). Painel Hidroclimático da Bacia do Alto Paraguai. University of British Columbia. ' + location.origin + location.pathname;
  const F = D.meta.fontes || {}; if (F.regioes) $('txt-regioes').textContent = F.regioes; if (F.chuva) $('txt-chuva').textContent = F.chuva;
  mapasIniciar(); seriesIniciar();
  pronto.previsao = previsaoIniciar(); pronto.verificacao = verifIniciar(); pronto.rio = rioIniciar();
  rota();
}
function temaBotao() { const esc = document.documentElement.dataset.tema !== 'claro'; $('tema').textContent = esc ? '☀ Fundo claro' : '☾ Fundo escuro'; }
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
