// DSX POD 場址模擬（MVP）：六選一氣候帶 → 電量或基地 → 散熱與供水 → 看能耗 → 匯出 USD 與參數。
// 結果用預算結果表（dsxpod/precompute.py）在 log(MW) 上內插；匯出呼叫本機或部署的 /api/export。
import { plan } from './sizing.js';
import { PodScene, ENV } from './scene.js';
import { t, lang, locale, setLang, applyStatic, siteName, koppenName, landName, warnText } from './i18n.js';
applyStatic();                                                  // 靜態文字先套語言（載入畫面也要）

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 0) => v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const COOL = { dry_only: 'cool.name.dry_only', dry_plus_chiller: 'cool.name.dry_plus_chiller', evaporative: 'cool.name.evaporative' };   // 顯示用 t(COOL[c])
const SUP = { t45: '45 °C', t32: '32 °C' };
const SITE_ORDER = ['taoyuan', 'johor', 'phoenix', 'dallas', 'dublin', 'oslo'];
// 算力：NVIDIA Vera Rubin NVL72 公開規格（每櫃 72 GPU；NVFP4 推論 3.6 EF〔effective〕、訓練 2.5 EF；2026 年資料，正式規格可能再變）。
// 注意：能耗模型的每櫃功率仍用 GB300 代理（136 kW），Vera Rubin 每櫃約 190–230 kW；算力與功率來自不同代，正式數字公開後一起換。
const RUBIN = { gpus: 72, pf_inf: 3600, pf_train: 2500 };

const store = { get(k, d) { try { const v = localStorage.getItem('dsxpod:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem('dsxpod:' + k, JSON.stringify(v)); } catch {} } };
const state = Object.assign({ site: 'johor', sizeMode: 'mw', mw: 10, siteL: 120, siteW: 100, cooling: 'dry_only', supply: 't45', preset: null }, store.get('state', {}));
// 手機 / 窄螢幕：設定進漢堡選單、報告進底部面板
const MQ = matchMedia('(max-width: 900px)');
const applyMobile = () => { document.body.classList.toggle('mobile', MQ.matches); if (!MQ.matches) document.body.classList.remove('menu-open', 'sheet-open');
  (MQ.matches ? $('#nav') : document.body).appendChild($('#toolbar')); };   // 工具列：桌機浮在左下，手機放進設定面板底部
applyMobile(); MQ.addEventListener?.('change', () => { applyMobile(); setTimeout(() => { Object.values(charts).forEach(c => c.resize()); scene && scene.frame(); }, 300); });
// 畫質：網址 q= > 使用者上次選的 > 預設高畫質（太慢會自動降到輕量）
function initialQuality() {
  const q = new URLSearchParams(location.search).get('q'); if (q === 'high' || q === 'lite') return { q, auto: false };
  const saved = store.get('quality', null); if (saved === 'high' || saved === 'lite') return { q: saved, auto: false };
  // 預設一律高畫質（實機 iPhone 13 mini 跑得動）；跑起來太慢（中位數 < 約 22 fps）才自動降到輕量
  return { q: 'high', auto: true };
}
const QUALITY = initialQuality();
// 網址參數可覆寫（分享 / 測試用）：?site=phoenix&mw=200&cooling=evaporative&supply=t32&tab=cmp&nav=cool
const Q = new URLSearchParams(location.search);
for (const k of ['site', 'cooling', 'supply']) if (Q.get(k)) state[k] = Q.get(k);
if (Q.get('mw')) { state.sizeMode = 'mw'; state.mw = +Q.get('mw'); }
if (Q.get('site_l') && Q.get('site_w')) { state.sizeMode = 'site'; state.siteL = +Q.get('site_l'); state.siteW = +Q.get('site_w'); }
let CLIM, GRID, scene, layout, lastPods = -1, lastSite = null, apiOK = false;
const charts = {};

// ---------------------------------------------------------------- 資料
function interp(site, cooling, supply, itMW) {
  const rows = GRID.rows.filter(r => r.site === site && r.cooling === cooling && r.supply === supply).sort((a, b) => a.it_mw - b.it_mw);
  if (!rows.length) return null;
  const x = Math.log(Math.min(Math.max(itMW, rows[0].it_mw), rows[rows.length - 1].it_mw));
  let a = rows[0], b = rows[0];
  for (let i = 0; i < rows.length - 1; i++) if (Math.log(rows[i].it_mw) <= x && x <= Math.log(rows[i + 1].it_mw)) { a = rows[i]; b = rows[i + 1]; break; }
  if (x >= Math.log(rows[rows.length - 1].it_mw)) a = b = rows[rows.length - 1];
  const t = a === b ? 0 : (x - Math.log(a.it_mw)) / (Math.log(b.it_mw) - Math.log(a.it_mw));
  const lerp = (u, v) => u + (v - u) * t;
  const scale = itMW / lerp(a.it_mw, b.it_mw);                 // 能量按實際 MW 縮放（格點之間 POD 數不同）
  const out = { pue_mean: lerp(a.pue_mean, b.pue_mean), pue_p90: lerp(a.pue_p90, b.pue_p90), unmet_h: lerp(a.unmet_h, b.unmet_h), unmet_h_max: Math.round(lerp(a.unmet_h_max, b.unmet_h_max)),
    chiller_mwh: lerp(a.chiller_mwh, b.chiller_mwh) * scale, water_m3: lerp(a.water_m3, b.water_m3) * scale, facility_mwh: lerp(a.facility_mwh, b.facility_mwh) * scale,
    it_mwh: lerp(a.it_mwh, b.it_mwh) * scale, recirc_k: lerp(a.recirc_k, b.recirc_k), island_k: lerp(a.island_k_3ms, b.island_k_3ms), years: {}, mix: {} };
  for (const y of Object.keys(a.pue_by_year)) out.years[y] = lerp(a.pue_by_year[y], b.pue_by_year[y]);
  for (const k of Object.keys(a.breakdown_mwh)) out.mix[k] = lerp(a.breakdown_mwh[k], b.breakdown_mwh[k]) * scale;
  out.valid = out.unmet_h < 0.5;
  return out;
}

function recommend(site, supply, itMW) {
  const r = Object.keys(COOL).map(c => ({ c, m: interp(site, c, supply, itMW) })).filter(x => x.m);
  const ok = r.filter(x => x.m.valid).sort((a, b) => a.m.pue_mean - b.m.pue_mean);
  if (ok.length) {
    const best = ok[0], dry = ok.find(x => x.c !== 'evaporative');
    if (best.c === 'evaporative' && dry && dry.m.pue_mean - best.m.pue_mean < 0.01) return { c: dry.c, why: t('reco.dry', { d: fmt((dry.m.pue_mean - best.m.pue_mean) * 1000, 1), w: fmt(best.m.water_m3) }) };
    return { c: best.c, why: t('reco.best') + (best.c === 'evaporative' ? t('reco.best.water', { w: fmt(best.m.water_m3) }) : '') };
  }
  const least = r.sort((a, b) => a.m.unmet_h - b.m.unmet_h)[0];
  return { c: least.c, why: t('reco.none') };
}

// ---------------------------------------------------------------- UI：場址卡片
function siteCards() {
  const box = $('#siteCards'); box.innerHTML = '';
  for (const k of SITE_ORDER) {
    const c = CLIM[k]; if (!c) continue;
    const b = document.createElement('button'); b.className = 'site' + (k === state.site ? ' on' : ''); b.dataset.site = k;
    b.innerHTML = `<div class="nm">${siteName(k, c)}</div><div class="kp"><b>${c.koppen}</b>${koppenName(c)}・ASHRAE ${c.ashrae}</div><canvas></canvas>
      <div class="ex"><span>${c.extremes.t_min}°</span><span>RH ${c.extremes.rh_mean}%</span><span>${c.extremes.t_max}°</span></div>`;
    b.onclick = () => { state.site = k; $$('.site').forEach(x => x.classList.toggle('on', x.dataset.site === k)); update(); };
    box.appendChild(b);
    const m = c.monthly;
    new Chart(b.querySelector('canvas'), { type: 'line', data: { labels: m.map(x => x.month), datasets: [
      { data: m.map(x => x.t_max_mean), borderColor: css('--s2'), borderWidth: 1.5, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(217,89,38,.18)', tension: .35 },
      { data: m.map(x => x.t_min_mean), borderColor: css('--s1'), borderWidth: 1.5, pointRadius: 0, fill: false, tension: .35 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false, min: -20, max: 45 } } } });
  }
}

// ---------------------------------------------------------------- UI：規模
const mwFromSlider = v => Math.round(Math.pow(10, (v / 1000) * 3) * 10) / 10;
const sliderFromMw = mw => Math.round(Math.log10(Math.max(1, mw)) / 3 * 1000);
function sizeUI() {
  $$('#sizeMode button').forEach(b => { b.classList.toggle('on', b.dataset.mode === state.sizeMode); b.onclick = () => { state.sizeMode = b.dataset.mode; sizeUI(); update(); }; });
  $('#sizeMW').hidden = state.sizeMode !== 'mw'; $('#sizeSite').hidden = state.sizeMode !== 'site';
  $('#mwRange').value = sliderFromMw(state.mw); $('#mwInput').value = state.mw; $('#mwOut').textContent = `${fmt(state.mw, state.mw < 10 ? 1 : 0)} MW`;
  $('#slRange').value = state.siteL; $('#swRange').value = state.siteW; $('#slOut').textContent = `${state.siteL} m`; $('#swOut').textContent = `${state.siteW} m`;
}
$('#mwRange').oninput = e => { state.mw = mwFromSlider(+e.target.value); sizeUI(); update(); };
$('#mwInput').onchange = e => { state.mw = Math.min(1000, Math.max(0.5, +e.target.value || 1)); sizeUI(); update(); };
$('#slRange').oninput = e => { state.siteL = +e.target.value; sizeUI(); update(); };
$('#swRange').oninput = e => { state.siteW = +e.target.value; sizeUI(); update(); };

// ---------------------------------------------------------------- UI：散熱
function segUI(id, key) { $$(`#${id} button`).forEach(b => { b.classList.toggle('on', b.dataset.v === state[key]); b.onclick = () => { state[key] = b.dataset.v; state.preset = null; segUI(id, key); update(); }; }); }

// ---------------------------------------------------------------- 建議設定（一鍵最佳化）
// 在「全年每小時都排得掉熱」的組合（3 散熱 × 2 供水）裡挑：最省電 = 設施耗電最少；最省水 = 用水最少，同水量再比耗電。
// 沒有任何組合排得掉熱時，退而求其次挑排不掉熱小時最少的，並標示。
function optimize(goal, itMW) {
  const c = [];
  for (const k of Object.keys(COOL)) for (const sp of Object.keys(SUP)) { const m = interp(state.site, k, sp, itMW); if (m) c.push({ c: k, s: sp, m }); }
  const ok = c.filter(x => x.m.valid);
  if (!ok.length) { const b = c.sort((a, b) => a.m.unmet_h - b.m.unmet_h)[0]; return { ...b, feasible: false }; }
  if (goal === 'water') return { ...ok.sort((a, b) => a.m.water_m3 - b.m.water_m3 || a.m.facility_mwh - b.m.facility_mwh)[0], feasible: true };
  // 最省電：耗電最少；但和最少者差 0.5% 以內時，選用水較少的（不為了幾乎看不出的省電去耗大量水）
  const minE = Math.min(...ok.map(x => x.m.facility_mwh));
  const near = ok.filter(x => x.m.facility_mwh <= minE * 1.005).sort((a, b) => a.m.water_m3 - b.m.water_m3 || a.m.facility_mwh - b.m.facility_mwh);
  return { ...near[0], feasible: true };
}
function presetUI(itMW) {
  const lab = o => t('preset.lab', { cool: t(COOL[o.c]), sup: SUP[o.s], gwh: fmt(o.m.facility_mwh / 1000, 1), water: fmt(o.m.water_m3) }) + (o.feasible ? '' : t('preset.gap'));
  const best = { energy: optimize('energy', itMW), water: optimize('water', itMW) };
  $('#pEnergy').innerHTML = lab(best.energy); $('#pWater').innerHTML = lab(best.water);
  $$('#presetSeg button').forEach(b => { b.classList.toggle('on', b.dataset.p === state.preset); b.onclick = () => { state.preset = b.dataset.p; update(); }; });
  return best;
}

// ---------------------------------------------------------------- 結果
function kpiStrip(m) {
  const racks = layout.n_pods * 7, ef = racks * RUBIN.pf_inf / 1000;
  const gwh = m.facility_mwh / 1000;
  $('#dataTagKpi').textContent = `PUE ${fmt(m.pue_mean, 3)}${m.valid ? '' : ' ⚠'}`;
  $('#kpiStrip').innerHTML = [
    [fmt(m.pue_mean, 3), m.valid ? t('strip.pue.ok') : t('strip.pue.bad'), m.valid ? 'good' : 'bad'],
    [gwh >= 1000 ? `${fmt(gwh / 1000, 2)} TWh` : `${fmt(gwh, gwh < 100 ? 1 : 0)} GWh`, t('strip.energy'), ''],
    [`${fmt(m.water_m3)} m³`, t('strip.water'), ''],
    [`${fmt(ef, ef < 100 ? 1 : 0)} EF`, t('strip.compute'), ''],
  ].map(([v, l, c]) => `<div class="${c}"><b>${v}</b><span>${l}</span></div>`).join('');
}

function kpis(m) {
  kpiStrip(m);
  const racks = layout.n_pods * 7, pfI = racks * RUBIN.pf_inf, pfT = racks * RUBIN.pf_train;
  const h = fmt(m.unmet_h), hmax = fmt(m.unmet_h_max);
  const badge = `<span class="badge ${m.valid ? 'good' : 'bad'}" title="${m.valid ? t('kpi.ok.t') : t('kpi.gap.t', { h, hmax })}">${m.valid ? t('kpi.ok') : t('kpi.gap', { h })}</span>`;
  $('#kpis').innerHTML = [
    [`${fmt(pfI)}<small> PFLOPS</small>`, t('kpi.compute', { gpus: fmt(racks * RUBIN.gpus) }), 'ok wide', t('kpi.compute.t', { pfT: fmt(pfT) })],
    [`${fmt(m.pue_mean, 3)}${badge}`, t('kpi.pue'), m.valid ? 'ok' : 'bad', ''],
    [`${fmt(m.facility_mwh / 1000, 1)}<small> GWh</small>`, t('kpi.energy'), 'ok', ''],
    [`${fmt(m.water_m3)}<small> m³</small>`, t('kpi.water'), 'ok', ''],
    [`+${fmt(m.recirc_k + m.island_k, 1)}<small> K</small>`, t('kpi.rise'), 'ok', t('kpi.rise.t', { r: fmt(m.recirc_k, 1), i: fmt(m.island_k, 1) })],
  ].map(([v, l, c, tt]) => `<div class="kpi ${c}" title="${tt}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const notes = [t('note.layout', { pods: fmt(layout.n_pods), racks: fmt(racks), mw: fmt(layout.it_mw, 1), l: fmt(layout.site_m[0]), w: fmt(layout.site_m[1]), ha: fmt(layout.area_ha, 2),
    blocks: layout.n_blocks > 1 ? t('note.blocks', { n: layout.n_blocks }) : '' })];
  if (!m.valid) notes.unshift(t('note.warn', { h, hmax, sup: SUP[state.supply] }));
  $('#sumNotes').innerHTML = '<ul>' + notes.map(n => `<li>${n}</li>`).join('') + '</ul>' +
    `<details><summary>${t('note.more')}</summary><ul><li>${t('note.rubin')}</li><li>${t('note.screen')}</li></ul></details>`;
}

function chartOpts(extra) {
  Chart.defaults.color = css('--muted'); Chart.defaults.borderColor = '#2c2e31'; Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  return Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } }, extra || {});
}
function make(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($('#' + id), cfg); }

function yearChart(all) {
  const ys = Object.keys(all[state.cooling].years).sort();
  const col = { dry_only: css('--s1'), dry_plus_chiller: css('--s2'), evaporative: css('--s3') };
  make('yearChart', { type: 'line', data: { labels: ys, datasets: Object.keys(COOL).filter(c => all[c]).map(c => ({ label: t(COOL[c]), data: ys.map(y => all[c].years[y]),
      borderColor: col[c], backgroundColor: col[c], borderWidth: c === state.cooling ? 2.5 : 1.2, pointRadius: c === state.cooling ? 2.5 : 0, tension: .25 })) },
    options: chartOpts({ plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { y: { title: { display: true, text: 'PUE' } }, x: { grid: { display: false } } } }) });
}

function mixChart(m) {
  const keys = ['dry_cooler_mwh', 'pumps_mwh', 'chiller_mwh', 'air_fan_mwh', 'air_dx_mwh', 'ups_loss_mwh'];
  make('mixChart', { type: 'bar', data: { labels: keys.map(k => t('mix.' + k)), datasets: [{ data: keys.map(k => m.mix[k] || 0), backgroundColor: css('--s1'), borderRadius: 4, maxBarThickness: 22 }] },
    options: chartOpts({ indexAxis: 'y', scales: { x: { title: { display: true, text: t('mix.axis') } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => t('mix.tip', { v: fmt(c.parsed.x) }) } } } }) });
}

function cmpTable(all, reco) {
  $('#cmpTable').innerHTML = `<table><thead><tr><th>${t('cmp.strategy')}</th><th>PUE</th><th>${t('cmp.unmet')}</th><th>${t('cmp.chiller')}</th><th>${t('cmp.water')}</th></tr></thead><tbody>` +
    Object.keys(COOL).filter(c => all[c]).map(c => { const m = all[c]; return `<tr class="${c === state.cooling ? 'sel' : ''}"><td>${t(COOL[c])}${c === reco.c ? ' ★' : ''}</td><td>${fmt(m.pue_mean, 3)}</td><td>${m.valid ? '0' : '⚠ ' + fmt(m.unmet_h)}</td><td>${fmt(m.chiller_mwh)}</td><td>${fmt(m.water_m3)}</td></tr>`; }).join('') + '</tbody></table><p class="hint">' + t('cmp.reco') + reco.why + '</p>';
}

function climCharts() {
  const c = CLIM[state.site], m = c.monthly, lab = m.map(x => t('month')[x.month - 1]);
  make('climT', { type: 'line', data: { labels: lab, datasets: [
    { label: t('clim.absmax'), data: m.map(x => x.t_abs_max), borderColor: css('--s2'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0 },
    { label: t('clim.tmax'), data: m.map(x => x.t_max_mean), borderColor: css('--s2'), backgroundColor: 'rgba(217,89,38,.16)', fill: '+1', borderWidth: 2, pointRadius: 0, tension: .3 },
    { label: t('clim.tmin'), data: m.map(x => x.t_min_mean), borderColor: css('--s1'), borderWidth: 2, pointRadius: 0, tension: .3 },
    { label: t('clim.absmin'), data: m.map(x => x.t_abs_min), borderColor: css('--s1'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0 }] },
    options: chartOpts({ plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 2, font: { size: 11 } } } }, scales: { y: { title: { display: true, text: '°C' } }, x: { grid: { display: false } } } }) });
  make('climP', { type: 'bar', data: { labels: lab, datasets: [{ label: t('clim.precip'), data: m.map(x => x.precip_mm), backgroundColor: css('--s3'), borderRadius: 3, maxBarThickness: 16 }] },
    options: chartOpts({ scales: { y: { title: { display: true, text: t('clim.precip.axis') } }, x: { grid: { display: false } } } }) });
  const e = c.extremes, h = c.hours_per_year;
  $('#climFacts').innerHTML = [[t('clim.koppen'), `${c.koppen} ${koppenName(c)}`], [t('clim.ashrae'), c.ashrae], [t('clim.map'), `${fmt(c.map_mm)} mm`], [t('clim.rh'), `${e.rh_mean}%`],
    [t('clim.t996'), `${e.t_p99_6} °C`], [t('clim.twb'), `${e.twb_max} °C`], [t('clim.above35'), t('clim.hpy', { h: fmt(h.above_35) })], [t('clim.drylimit'), t('clim.hpy', { h: fmt(c.dry_cooler_limit_hours.t45) })], [t('clim.land'), landName(state.site, (ENV[state.site] || {}).label || '–')]]
    .map(([k, v]) => `<div><span>${k}</span><br>${v}</div>`).join('');
}

// ---------------------------------------------------------------- 單元（一個 POD 的組成）
const curView = () => $('#nav .tab.active')?.dataset.tab || 'site';
function unitFacts() {
  const racks = 7;
  $('#unitFacts').innerHTML = [[t('unit.racks'), t('unit.racks.v', { n: racks, gpus: racks * RUBIN.gpus })], [t('unit.compute'), t('unit.compute.v', { pf: fmt(racks * RUBIN.pf_inf) })],
    [t('unit.it'), t('unit.it.v', { mw: fmt(racks * 136 / 1000, 3) })], [t('unit.cdu'), t('unit.cdu.v')], [t('unit.mod'), t('unit.mod.v')],
    [t('unit.box'), t('unit.box.v')], [t('unit.skid'), t('unit.skid.v')], [t('unit.weight'), '28,500 kg']].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------------------------------------------------------------- 主更新
function update() {
  store.set('state', state);
  layout = state.sizeMode === 'mw' ? plan({ mw: state.mw }) : plan({ siteL: state.siteL, siteW: state.siteW });
  const key = `${layout.mode}:${layout.n_pods}:${layout.site_m}`;
  const siteChanged = state.site !== lastSite, layoutChanged = key !== lastPods;
  if (siteChanged) { scene.setEnvironment(state.site, CLIM[state.site].lat, !layoutChanged); lastSite = state.site; }   // 換氣候帶 → 換天空、地面、植被
  if (layoutChanged) { const first = lastPods === -1; scene.setLayout(layout); scene.setView(curView(), { animate: !first, duration: 700 }); lastPods = key; }
  $('#sizeFacts').innerHTML = [[t('size.pods'), t('size.pods.v', { n: fmt(layout.n_pods), racks: fmt(layout.n_pods * 7) })], [t('size.it'), `${fmt(layout.it_mw, 1)} MW`], [t('size.base'), `${fmt(layout.site_m[0])} × ${fmt(layout.site_m[1])} m`],
    [t('size.area'), `${fmt(layout.area_ha, 2)} ha`], [t('size.blocks'), layout.n_blocks > 1 ? t('size.blocks.v', { n: layout.n_blocks }) : t('size.single')]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#sizeWarn').textContent = layout.warnings.map(warnText).join(lang === 'en' ? '; ' : '；');
  const best = presetUI(layout.it_mw);
  if (state.preset && best[state.preset]) { state.cooling = best[state.preset].c; state.supply = best[state.preset].s; segUI('coolSeg', 'cooling'); segUI('supplySeg', 'supply'); store.set('state', state); }
  const all = {}; for (const c of Object.keys(COOL)) all[c] = interp(state.site, c, state.supply, layout.it_mw);
  const m = all[state.cooling]; if (!m) return;
  const reco = recommend(state.site, state.supply, layout.it_mw);
  const site = CLIM[state.site];
  $('#summaryChip').textContent = `${siteName(state.site, site)} (${site.koppen})・${fmt(layout.it_mw, layout.it_mw < 10 ? 1 : 0)} MW・${t(COOL[state.cooling])}・${SUP[state.supply]}・PUE ${fmt(m.pue_mean, 3)}`;
  kpis(m); yearChart(all); mixChart(m); cmpTable(all, reco); climCharts();
}

// ---------------------------------------------------------------- 分頁、收合、顯示、提示、匯出
function tabs(root) { $$(`${root} .tab`).forEach(t => t.onclick = () => { $$(`${root} .tab`).forEach(x => x.classList.toggle('active', x === t)); $$(`${root} .tabpane`).forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab)); Object.values(charts).forEach(c => c.resize()); }); }
$('#menuBtn').onclick = () => { document.body.classList.toggle('menu-open'); document.body.classList.remove('sheet-open'); };
// 底部面板：點把手 / 摘要條切換，或上下滑
const sheetToggle = (open) => { document.body.classList.toggle('sheet-open', open ?? !document.body.classList.contains('sheet-open')); if (document.body.classList.contains('sheet-open')) document.body.classList.remove('menu-open'); setTimeout(() => Object.values(charts).forEach(c => c.resize()), 300); };
$('#sheetHead').onclick = () => sheetToggle();
{ let y0 = null; $('#sheetHead').addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  $('#sheetHead').addEventListener('touchend', e => { if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (Math.abs(dy) > 25) { e.preventDefault(); sheetToggle(dy < 0); } }); }
// 面板縮小 / 展開（桌機、平板）：各自縮成小標籤，左下按鈕一次收起或展開兩側；記住使用者的選擇。不使用瀏覽器全螢幕（平板上會干擾互動）。
function setMin(which, on) {
  document.body.classList.toggle(which + '-min', on);
  store.set('min', { nav: document.body.classList.contains('nav-min'), data: document.body.classList.contains('data-min') });
  const both = document.body.classList.contains('nav-min') && document.body.classList.contains('data-min');
  $('#fsBtn').textContent = both ? t('fs.expand') : t('fs.collapse');
  if (!on) setTimeout(() => Object.values(charts).forEach(c => c.resize()), 300);
}
$('#navCollapse').onclick = () => { if (document.body.classList.contains('mobile')) { document.body.classList.remove('menu-open'); return; } setMin('nav', true); };
$('#dataCollapse').onclick = () => setMin('data', true);
$('#navTag').onclick = () => setMin('nav', false);
$('#dataTag').onclick = () => setMin('data', false);
const toggleBoth = () => { const both = document.body.classList.contains('nav-min') && document.body.classList.contains('data-min'); setMin('nav', !both); setMin('data', !both); };
$('#fsBtn').onclick = toggleBoth;
addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) toggleBoth(); });
{ const m = Q.get('view') === 'full' ? { nav: true, data: true } : store.get('min', { nav: false, data: false }); setMin('nav', !!m.nav); setMin('data', !!m.data); }

let tipTimer;
// 觸控：點一下（移動 < 8 px）顯示資訊，3 秒後消失
{ let d0 = null; $('#scene').addEventListener('pointerdown', e => { d0 = [e.clientX, e.clientY]; });
  $('#scene').addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse' || !d0 || Math.hypot(e.clientX - d0[0], e.clientY - d0[1]) > 8) return;
    showTip(e.clientX, e.clientY); clearTimeout(tipTimer); tipTimer = setTimeout(() => { $('#tip').hidden = true; }, 3000);
  }); }
function showTip(x, y) {
  const p = scene.pick(x, y); const tip = $('#tip');
  if (!p) { tip.hidden = true; return; }
  if (p.kind === 'part') tip.innerHTML = `<b>${p.key ? t(p.key, p.p) : p.name}</b><br>${p.key ? t(p.key + '.d', p.p) : p.detail}`;
  else if (p.kind === 'skid') tip.innerHTML = `<b>${t('tip.skid', { i: p.index + 1 })}</b><br>${t('tip.skid.d', { kva: fmt(Math.ceil(7 * 136 * 1.25 / 100) * 100) })}`;
  else if (p.kind === 'sub') tip.innerHTML = `<b>${t('tip.sub')}${layout.n_blocks > 1 ? t('tip.block', { b: p.block + 1 }) : ''}</b><br>${t('tip.sub.d', { n: fmt(p.n_pods), mw: fmt(p.mw, 1) })}`;
  else tip.innerHTML = `<b>${t('tip.pod', { i: p.index + 1 })}</b>${layout.n_blocks > 1 ? t('tip.block', { b: p.block + 1 }) : ''}<br>${t('tip.pod.d', { x: fmt(p.x, 1), y: fmt(p.y, 1) })}`;
  tip.hidden = false; tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - 270)) + 'px'; tip.style.top = Math.max(8, Math.min(y + 14, innerHeight - 100)) + 'px';
}
addEventListener('pointermove', e => {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  if (e.target !== $('#scene')) { $('#tip').hidden = true; return; }
  clearTimeout(tipTimer); tipTimer = setTimeout(() => {
    showTip(e.clientX, e.clientY);
  }, 40);
});

let apiGeo = 'box';
async function checkApi() {
  try { const r = await fetch('api/health', { cache: 'no-store' }); apiOK = r.ok; if (r.ok) apiGeo = (await r.json()).geometry || 'box'; } catch { apiOK = false; }
  exportUI();
}
function exportUI() {
  $('#exportBtn').disabled = !apiOK;
  $('#exportHint').textContent = apiOK ? t('export.hint', { geo: t('export.geo.' + apiGeo) }) : t('export.noapi');
}
$('#exportBtn').onclick = async () => {
  const btn = $('#exportBtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = t('export.busy');
  try {
    const body = { site: state.site, cooling: state.cooling, supply: state.supply, ...(state.sizeMode === 'mw' ? { mw: state.mw } : { site_l: state.siteL, site_w: state.siteW }) };
    const r = await fetch('api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob(); const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'dsx_pod_export.zip';
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('#exportHint').textContent = t('export.done', { name, kb: fmt(blob.size / 1024) });
  } catch (e) { $('#exportHint').textContent = t('export.fail') + e.message; }
  btn.textContent = old; btn.disabled = !apiOK;
};

// ---------------------------------------------------------------- 啟動
// ---------------------------------------------------------------- 載入進度
// 權重：程式庫（app.js 能跑就代表已載完）、氣候摘要、結果表、兩個 GLB、建場景。CDN 可能壓縮傳輸 → 總量取 content-length 或預估值，進度一律夾在 0–1。
const LOAD = { libs: [0.12, 1], climate: [0.03, 0], grid: [0.27, 0], 'container.glb': [0.13, 0], 'cooler_module.glb': [0.24, 0], 'power_skid.glb': [0.04, 0], build: [0.17, 0] };
const EST = { climate: 15e3, grid: 461e3, 'container.glb': 224e3, 'cooler_module.glb': 503e3, 'power_skid.glb': 83e3 };
const MSG = { climate: 'load.climate', grid: 'load.grid', 'container.glb': 'load.container', 'cooler_module.glb': 'load.cooler', 'power_skid.glb': 'load.skid', build: 'load.build' };
function progress(key, frac) {
  LOAD[key][1] = Math.max(LOAD[key][1], Math.min(1, frac || 0));
  const tot = Object.values(LOAD).reduce((s, [w, f]) => s + w * f, 0);
  const bar = $('.ld-bar'); bar.classList.add('det'); $('#ldFill').style.width = `${(tot * 100).toFixed(1)}%`;
  $('#ldPct').textContent = `${Math.floor(tot * 100)}%`; $('#loading').setAttribute('aria-valuenow', Math.floor(tot * 100));
  const busy = Object.keys(LOAD).find(k => LOAD[k][1] < 1); if (busy) $('#ldMsg').textContent = MSG[busy] ? t(MSG[busy]) : '';
}
async function fetchJSON(url, key) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const total = +r.headers.get('content-length') || EST[key];
  if (!r.body || !r.body.getReader) { const j = await r.json(); progress(key, 1); return j; }
  const reader = r.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; progress(key, got / Math.max(total, got * 1.05)); }
  const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  progress(key, 1); return JSON.parse(new TextDecoder().decode(buf));
}
const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // 讓進度條在同步重活之前先畫出來

(async function main() {
  progress('libs', 1);
  [CLIM, GRID] = await Promise.all([fetchJSON('data/climate_summary.json', 'climate'), fetchJSON('data/results_grid.json', 'grid')]);
  scene = new PodScene($('#scene'), { quality: QUALITY.q, autoDowngrade: QUALITY.auto, labels: { site: (l, w, ha) => t('scene.site', { l, w, ha }), use: (l, w) => t('scene.use', { l, w }) } });
  await scene.load('assets/', (f, loaded, total) => progress(f, loaded / Math.max(total || EST[f], loaded * 1.05)));
  progress('container.glb', 1); progress('cooler_module.glb', 1); progress('power_skid.glb', 1); progress('build', 0.15); await paint();
  const qualityUI = () => $$('#qualitySeg button').forEach(b => { b.classList.toggle('on', b.dataset.q === scene.quality); b.onclick = () => { store.set('quality', b.dataset.q); scene.setQuality(b.dataset.q); qualityUI(); }; });
  let toastTimer;   // 自動降畫質時在工具列短暫提示
  scene.onQualityChange = (q, why) => { qualityUI(); if (why && why.fps) { const el = $('#qualityHint'); el.textContent = t('quality.auto', why); el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 6000); } };
  qualityUI();
  // 語言切換：靜態文字重套，動態文字全部重畫（場址卡片、單元、結果、匯出說明、3D 基地標籤）
  const langUI = () => $$('#langSeg button').forEach(b => { b.classList.toggle('on', b.dataset.lang === lang); b.onclick = () => { if (!setLang(b.dataset.lang)) return; langUI(); siteCards(); unitFacts(); setMin('nav', document.body.classList.contains('nav-min')); update(); exportUI(); scene.setLayout(layout); }; });
  langUI();
  tabs('#nav'); tabs('#data'); siteCards(); sizeUI(); segUI('coolSeg', 'cooling'); segUI('supplySeg', 'supply');
  // 分鏡：每個設定分頁一個鏡頭（場址 = 全景、規模 = 整個基地、散熱 = 散熱模組近景、單元 = 貨櫃剖面）
  $$('#nav .tab').forEach(t => t.addEventListener('click', () => { scene.setView(t.dataset.tab); $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === 'unit')); }));
  $$('#unitSeg button').forEach(b => b.onclick = () => { $$('#unitSeg button').forEach(x => x.classList.toggle('on', x === b)); scene.setView(b.dataset.view); });
  unitFacts();
  progress('build', 0.4); await paint();
  update();
  progress('build', 0.9); await paint();
  if (Q.get('tab')) $(`#data .tab[data-tab="${{ year: 'energy', mix: 'energy' }[Q.get('tab')] || Q.get('tab')}"]`)?.click();
  if (Q.get('nav')) $(`#nav .tab[data-tab="${Q.get('nav')}"]`)?.click();
  if (Q.get('cam')) { scene.setView(Q.get('cam'), { animate: false }); $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === Q.get('cam'))); }   // 分享 / 測試：直接指定鏡頭（site / size / cool / unit / skid）
  if (Q.get('dist')) { const d = +Q.get('dist'), t = scene.controls.target, c = scene.camera.position; const v = c.clone().sub(t).setLength(d); c.copy(t.clone().add(v)); }
  scene.setVisible({ shell: true, cooler: true, rack: false });
  if (Q.get('panel') === 'menu') document.body.classList.add('menu-open'); if (Q.get('panel') === 'sheet') document.body.classList.add('sheet-open');   // 測試 / 分享用
  scene.start();
  progress('build', 1); await paint();
  $('#loading').classList.add('done'); checkApi();
})().catch(e => {                                            // 載入失敗：進度條轉紅並顯示原因
  console.error(e); $('#loading').classList.add('err'); $('.ld-bar').classList.add('det');
  $('#ldMsg').textContent = t('load.fail') + (e && e.message || e); $('#ldPct').textContent = '';
});
