// DSX POD 場址模擬（MVP）：六選一氣候帶 → 電量或基地 → 散熱與供水 → 看能耗 → 匯出 USD 與參數。
// 結果用預算結果表（dsxpod/precompute.py）在 log(MW) 上內插；匯出呼叫本機或部署的 /api/export。
import { plan } from './sizing.js';
import { PodScene, ENV } from './scene.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 0) => v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const COOL = { dry_only: '純乾冷卻器', dry_plus_chiller: '乾冷卻器＋冰水機', evaporative: '蒸發式' };
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
const applyMobile = () => { document.body.classList.toggle('mobile', MQ.matches); if (!MQ.matches) document.body.classList.remove('menu-open', 'sheet-open'); };
applyMobile(); MQ.addEventListener?.('change', () => { applyMobile(); setTimeout(() => { Object.values(charts).forEach(c => c.resize()); scene && scene.frame(); }, 300); });
// 畫質：網址 q= > 使用者上次選的 > 自動（觸控 / 窄螢幕 / 記憶體或核心少 → 省電；其餘高，跑起來太慢會自動降）
function initialQuality() {
  const q = new URLSearchParams(location.search).get('q'); if (q === 'high' || q === 'lite') return { q, auto: false };
  const saved = store.get('quality', null); if (saved === 'high' || saved === 'lite') return { q: saved, auto: false };
  const weak = matchMedia('(pointer: coarse)').matches || innerWidth < 900 || (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return { q: weak ? 'lite' : 'high', auto: true };
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
    if (best.c === 'evaporative' && dry && dry.m.pue_mean - best.m.pue_mean < 0.01) return { c: dry.c, why: `不排熱失敗的方案中 PUE 最低（蒸發式只低 ${fmt((dry.m.pue_mean - best.m.pue_mean) * 1000, 1)}‰ 但每年用水 ${fmt(best.m.water_m3)} m³）` };
    return { c: best.c, why: '每年 0 小時排不掉熱的方案中 PUE 最低' + (best.c === 'evaporative' ? `（代價：每年用水 ${fmt(best.m.water_m3)} m³）` : '') };
  }
  const least = r.sort((a, b) => a.m.unmet_h - b.m.unmet_h)[0];
  return { c: least.c, why: '三種都有排不掉熱的小時；這個最少，建議改用較低外氣的場址或降低規模' };
}

// ---------------------------------------------------------------- UI：場址卡片
function siteCards() {
  const box = $('#siteCards'); box.innerHTML = '';
  for (const k of SITE_ORDER) {
    const c = CLIM[k]; if (!c) continue;
    const b = document.createElement('button'); b.className = 'site' + (k === state.site ? ' on' : ''); b.dataset.site = k;
    b.innerHTML = `<div class="nm">${c.name.replace(/（.*）/, '')}</div><div class="kp"><b>${c.koppen}</b>${c.koppen_name}・ASHRAE ${c.ashrae}</div><canvas></canvas>
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
  const lab = o => `${COOL[o.c]}・${SUP[o.s]}・${fmt(o.m.facility_mwh / 1000, 1)} GWh／年・${fmt(o.m.water_m3)} m³${o.feasible ? '' : '・⚠ 仍有排熱缺口'}`;
  const best = { energy: optimize('energy', itMW), water: optimize('water', itMW) };
  $('#pEnergy').textContent = lab(best.energy); $('#pWater').textContent = lab(best.water);
  $$('#presetSeg button').forEach(b => { b.classList.toggle('on', b.dataset.p === state.preset); b.onclick = () => { state.preset = b.dataset.p; update(); }; });
  return best;
}

// ---------------------------------------------------------------- 結果
function kpiStrip(m) {
  const racks = layout.n_pods * 7, ef = racks * RUBIN.pf_inf / 1000;
  const gwh = m.facility_mwh / 1000;
  $('#kpiStrip').innerHTML = [
    [fmt(m.pue_mean, 3), m.valid ? 'PUE・可滿載' : 'PUE・⚠缺口', m.valid ? 'good' : 'bad'],
    [gwh >= 1000 ? `${fmt(gwh / 1000, 2)} TWh` : `${fmt(gwh, gwh < 100 ? 1 : 0)} GWh`, '設施耗電／年', ''],
    [`${fmt(m.water_m3)} m³`, '用水／年', ''],
    [`${fmt(ef, ef < 100 ? 1 : 0)} EF`, '算力（NVFP4）', ''],
  ].map(([v, l, c]) => `<div class="${c}"><b>${v}</b><span>${l}</span></div>`).join('');
}

function kpis(m) {
  kpiStrip(m);
  const pueCls = m.valid ? 'ok' : 'bad';
  const racks = layout.n_pods * 7, pfI = racks * RUBIN.pf_inf, pfT = racks * RUBIN.pf_train;
  $('#kpis').innerHTML = [
    [`${fmt(pfI)}<small> PFLOPS</small>`, `算力（NVFP4 推論，${fmt(pfI / 1000, 1)} EF）・訓練 ${fmt(pfT)} PFLOPS・${fmt(racks * RUBIN.gpus)} 顆 Vera Rubin GPU`, 'ok wide'],
    [`${fmt(m.pue_mean, 3)}<span class="badge ${m.valid ? 'good' : 'bad'}" title="${m.valid ? '全年每小時都排得掉熱，PUE 代表真實滿載運轉' : '有些小時排不掉熱：那些小時機櫃必須降載，PUE 沒反映這個代價'}">${m.valid ? '全年可滿載' : '⚠ 有排熱缺口'}</span>`, 'PUE（20 年平均）', pueCls],
    [`${fmt(m.unmet_h)}<small> h</small>`, '每年排不掉熱的小時（最壞 ' + fmt(m.unmet_h_max) + ' h）', m.valid ? 'ok' : 'bad'],
    [`${fmt(m.facility_mwh / 1000, 1)}<small> GWh</small>`, '設施耗電／年（不含 IT）', 'ok'],
    [`${fmt(m.chiller_mwh)}<small> MWh</small>`, '冰水機耗電／年', 'ok'],
    [`${fmt(m.water_m3)}<small> m³</small>`, '用水／年', 'ok'],
    [`+${fmt(m.recirc_k + m.island_k, 1)}<small> K</small>`, `進風溫升（再循環 ${fmt(m.recirc_k, 1)}＋熱島 ${fmt(m.island_k, 1)}，風 3 m/s）`, 'ok'],
  ].map(([v, l, c]) => `<div class="kpi ${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const notes = [`${layout.n_pods} 個 DSX POD（${fmt(layout.n_pods * 7)} 櫃）、IT 銘牌 ${fmt(layout.it_mw, 1)} MW、基地 ${fmt(layout.site_m[0])} × ${fmt(layout.site_m[1])} m（${fmt(layout.area_ha, 2)} ha）${layout.n_blocks > 1 ? `、${layout.n_blocks} 個區塊` : ''}`,
    '算力用 Vera Rubin NVL72 公開規格（每櫃 NVFP4 推論 3,600 PFLOPS，為 effective 值；訓練 2,500 PFLOPS）；能耗用 GB300 每櫃 136 kW 代理（Vera Rubin 約 190–230 kW），兩者正式數字出來再一起換。',
    '結果為篩選等級（逐時穩態模型＋經驗再循環與熱島）。'];
  if (!m.valid) notes.unshift(`<b class="warn">⚠ 這個 PUE 不能單獨看</b>：每年約 ${fmt(m.unmet_h)} 小時（最壞年 ${fmt(m.unmet_h_max)} h）外氣太熱，乾冷卻器無法把水冷到 ${SUP[state.supply]} 供水溫度。模型在那些小時仍照算耗電，但實際上機櫃得降載或停機，所以 PUE 偏樂觀。要全年滿載，改用「乾冷卻器＋冰水機」或「蒸發式」（比較分頁有三者對照）。`);
  $('#sumNotes').innerHTML = '<ul>' + notes.map(n => `<li>${n}</li>`).join('') + '</ul>';
}

function chartOpts(extra) {
  Chart.defaults.color = css('--muted'); Chart.defaults.borderColor = '#2c2e31'; Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  return Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } }, extra || {});
}
function make(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($('#' + id), cfg); }

function yearChart(all) {
  const ys = Object.keys(all[state.cooling].years).sort();
  const col = { dry_only: css('--s1'), dry_plus_chiller: css('--s2'), evaporative: css('--s3') };
  make('yearChart', { type: 'line', data: { labels: ys, datasets: Object.keys(COOL).filter(c => all[c]).map(c => ({ label: COOL[c], data: ys.map(y => all[c].years[y]),
      borderColor: col[c], backgroundColor: col[c], borderWidth: c === state.cooling ? 2.5 : 1.2, pointRadius: c === state.cooling ? 2.5 : 0, tension: .25 })) },
    options: chartOpts({ plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { y: { title: { display: true, text: 'PUE' } }, x: { grid: { display: false } } } }) });
}

function mixChart(m) {
  const lab = { dry_cooler_mwh: '乾冷卻器風扇', pumps_mwh: '泵', chiller_mwh: '冰水機', air_fan_mwh: '氣側風扇', air_dx_mwh: '氣側機械冷卻', ups_loss_mwh: 'UPS 與配電損失' };
  const keys = Object.keys(lab);
  make('mixChart', { type: 'bar', data: { labels: keys.map(k => lab[k]), datasets: [{ data: keys.map(k => m.mix[k] || 0), backgroundColor: css('--s1'), borderRadius: 4, maxBarThickness: 22 }] },
    options: chartOpts({ indexAxis: 'y', scales: { x: { title: { display: true, text: 'MWh / 年' } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.x)} MWh/年` } } } }) });
}

function cmpTable(all, reco) {
  $('#cmpTable').innerHTML = `<table><thead><tr><th>策略</th><th>PUE</th><th>排不掉熱 h</th><th>冰水機 MWh</th><th>用水 m³</th></tr></thead><tbody>` +
    Object.keys(COOL).filter(c => all[c]).map(c => { const m = all[c]; return `<tr class="${c === state.cooling ? 'sel' : ''}"><td>${COOL[c]}${c === reco.c ? ' ★' : ''}</td><td>${fmt(m.pue_mean, 3)}</td><td>${m.valid ? '0' : '⚠ ' + fmt(m.unmet_h)}</td><td>${fmt(m.chiller_mwh)}</td><td>${fmt(m.water_m3)}</td></tr>`; }).join('') + '</tbody></table><p class="hint">★ 推薦：' + reco.why + '</p>';
}

function climCharts() {
  const c = CLIM[state.site], m = c.monthly, lab = m.map(x => x.month + '月');
  make('climT', { type: 'line', data: { labels: lab, datasets: [
    { label: '絕對最高', data: m.map(x => x.t_abs_max), borderColor: css('--s2'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0 },
    { label: '日最高平均', data: m.map(x => x.t_max_mean), borderColor: css('--s2'), backgroundColor: 'rgba(217,89,38,.16)', fill: '+1', borderWidth: 2, pointRadius: 0, tension: .3 },
    { label: '日最低平均', data: m.map(x => x.t_min_mean), borderColor: css('--s1'), borderWidth: 2, pointRadius: 0, tension: .3 },
    { label: '絕對最低', data: m.map(x => x.t_abs_min), borderColor: css('--s1'), borderDash: [4, 3], borderWidth: 1, pointRadius: 0 }] },
    options: chartOpts({ plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 2, font: { size: 11 } } } }, scales: { y: { title: { display: true, text: '°C' } }, x: { grid: { display: false } } } }) });
  make('climP', { type: 'bar', data: { labels: lab, datasets: [{ label: '降水 mm', data: m.map(x => x.precip_mm), backgroundColor: css('--s3'), borderRadius: 3, maxBarThickness: 16 }] },
    options: chartOpts({ scales: { y: { title: { display: true, text: '降水 mm／月' } }, x: { grid: { display: false } } } }) });
  const e = c.extremes, h = c.hours_per_year;
  $('#climFacts').innerHTML = [['柯本', `${c.koppen} ${c.koppen_name}`], ['ASHRAE 169', c.ashrae], ['年降水', `${fmt(c.map_mm)} mm`], ['平均 RH', `${e.rh_mean}%`],
    ['99.6% 設計高溫', `${e.t_p99_6} °C`], ['濕球最高', `${e.twb_max} °C`], ['> 35 °C', `${fmt(h.above_35)} h／年`], ['純乾冷極限（45 °C 供水）', `${fmt(c.dry_cooler_limit_hours.t45)} h／年`], ['3D 地景', (ENV[state.site] || {}).label || '–']]
    .map(([k, v]) => `<div><span>${k}</span><br>${v}</div>`).join('');
}

// ---------------------------------------------------------------- 主更新
function update() {
  store.set('state', state);
  layout = state.sizeMode === 'mw' ? plan({ mw: state.mw }) : plan({ siteL: state.siteL, siteW: state.siteW });
  const key = `${layout.mode}:${layout.n_pods}:${layout.site_m}`;
  const siteChanged = state.site !== lastSite, layoutChanged = key !== lastPods;
  if (siteChanged) { scene.setEnvironment(state.site, CLIM[state.site].lat, !layoutChanged); lastSite = state.site; }   // 換氣候帶 → 換天空、地面、植被
  if (layoutChanged) { scene.setLayout(layout); scene.frame(); lastPods = key; }
  $('#sizeFacts').innerHTML = [['DSX POD', `${fmt(layout.n_pods)} 個（${fmt(layout.n_pods * 7)} 櫃）`], ['IT 銘牌', `${fmt(layout.it_mw, 1)} MW`], ['基地', `${fmt(layout.site_m[0])} × ${fmt(layout.site_m[1])} m`],
    ['面積', `${fmt(layout.area_ha, 2)} ha`], ['區塊', layout.n_blocks > 1 ? `${layout.n_blocks} 個（每塊 4 × 14 = 56 POD ≈ 53 MW，各一座變電站）` : '單一陣列']].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#sizeWarn').textContent = layout.warnings.join('；');
  const best = presetUI(layout.it_mw);
  if (state.preset && best[state.preset]) { state.cooling = best[state.preset].c; state.supply = best[state.preset].s; segUI('coolSeg', 'cooling'); segUI('supplySeg', 'supply'); store.set('state', state); }
  const all = {}; for (const c of Object.keys(COOL)) all[c] = interp(state.site, c, state.supply, layout.it_mw);
  const m = all[state.cooling]; if (!m) return;
  const reco = recommend(state.site, state.supply, layout.it_mw);
  $('#reco').innerHTML = `推薦：<b>${COOL[reco.c]}</b>。${reco.why}。`;
  const site = CLIM[state.site];
  $('#summaryChip').textContent = `${site.name.replace(/（.*）/, '')}（${site.koppen}）・${fmt(layout.it_mw, layout.it_mw < 10 ? 1 : 0)} MW・${COOL[state.cooling]}・${SUP[state.supply]}・PUE ${fmt(m.pue_mean, 3)}`;
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
$('#navCollapse').onclick = () => { if (document.body.classList.contains('mobile')) { document.body.classList.remove('menu-open'); return; } $('#nav').classList.toggle('collapsed'); $('#navCollapse').textContent = $('#nav').classList.contains('collapsed') ? '›' : '‹'; };
// 顯示：貨櫃殼與散熱模組全開、內部機櫃不顯示（不再提供切換）
// 全螢幕瀏覽：收起兩側面板＋瀏覽器全螢幕；Esc、F 或按鈕還原
function setImmersive(on) {
  document.body.classList.toggle('immersive', on);
  $('#fsBtn').textContent = on ? '✕ 顯示面板' : '⛶ 全螢幕瀏覽';
  try {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } catch {}
}
$('#fsBtn').onclick = () => setImmersive(!document.body.classList.contains('immersive'));
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('immersive')) setImmersive(false); });
addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) setImmersive(!document.body.classList.contains('immersive')); });
if (Q.get('view') === 'full') { document.body.classList.add('immersive'); $('#fsBtn').textContent = '✕ 顯示面板'; }

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
  if (p.kind === 'sub') tip.innerHTML = `<b>變電站${layout.n_blocks > 1 ? `・區塊 ${p.block + 1}` : ''}</b><br>中壓進線 → 主變壓器 ×2 → 開關室 → 區塊 ${fmt(p.n_pods)} 個 POD<br>IT 銘牌約 ${fmt(p.mw, 1)} MW（示意，未進能耗模型）`;
  else tip.innerHTML = `<b>POD ${p.index + 1}</b>${layout.n_blocks > 1 ? `・區塊 ${p.block + 1}` : ''}<br>7 櫃・液冷 + 疊放乾冷卻器模組<br>位置 (${fmt(p.x, 1)}, ${fmt(p.y, 1)}) m`;
  tip.hidden = false; tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - 270)) + 'px'; tip.style.top = Math.max(8, Math.min(y + 14, innerHeight - 100)) + 'px';
}
addEventListener('pointermove', e => {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  if (e.target !== $('#scene')) { $('#tip').hidden = true; return; }
  clearTimeout(tipTimer); tipTimer = setTimeout(() => {
    showTip(e.clientX, e.clientY);
  }, 40);
});

async function checkApi() {
  try { const r = await fetch('api/health', { cache: 'no-store' }); apiOK = r.ok; } catch { apiOK = false; }
  $('#exportBtn').disabled = !apiOK;
  $('#exportHint').textContent = apiOK ? 'zip：USD（pod.usda／campus.usda、結果層、檢查層、資產）＋ results.json／CSV＋ params.json。用 USD Composer 開。' : '匯出需要後端：本機執行 .venv\\Scripts\\python.exe -m dsxpod.server（部署版走 /api/export 函式）。';
}
$('#exportBtn').onclick = async () => {
  const btn = $('#exportBtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = '產生中…（約 3–10 秒）';
  try {
    const body = { site: state.site, cooling: state.cooling, supply: state.supply, ...(state.sizeMode === 'mw' ? { mw: state.mw } : { site_l: state.siteL, site_w: state.siteW }) };
    const r = await fetch('api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob(); const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'dsx_pod_export.zip';
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('#exportHint').textContent = `已下載 ${name}（${fmt(blob.size / 1024)} KB）`;
  } catch (e) { $('#exportHint').textContent = '匯出失敗：' + e.message; }
  btn.textContent = old; btn.disabled = !apiOK;
};

// ---------------------------------------------------------------- 啟動
(async function main() {
  [CLIM, GRID] = await Promise.all([fetch('data/climate_summary.json').then(r => r.json()), fetch('data/results_grid.json').then(r => r.json())]);
  scene = new PodScene($('#scene'), { quality: QUALITY.q, autoDowngrade: QUALITY.auto }); await scene.load();
  const qualityUI = () => { $$('#qualitySeg button').forEach(b => { b.classList.toggle('on', b.dataset.q === scene.quality); b.onclick = () => { store.set('quality', b.dataset.q); scene.setQuality(b.dataset.q); qualityUI(); }; });
    $('#qualityHint').textContent = scene.quality === 'lite' ? '無陰影、簡化材質與植被' : '陰影、天空光、完整植被'; };
  scene.onQualityChange = (q, why) => { qualityUI(); if (why) $('#qualityHint').textContent = why; };
  qualityUI();
  tabs('#nav'); tabs('#data'); siteCards(); sizeUI(); segUI('coolSeg', 'cooling'); segUI('supplySeg', 'supply');
  update(); scene.frame();
  if (Q.get('tab')) $(`#data .tab[data-tab="${Q.get('tab')}"]`)?.click();
  if (Q.get('nav')) $(`#nav .tab[data-tab="${Q.get('nav')}"]`)?.click();
  if (Q.get('dist')) { const d = +Q.get('dist'), t = scene.controls.target, c = scene.camera.position; const v = c.clone().sub(t).setLength(d); c.copy(t.clone().add(v)); }
  scene.setVisible({ shell: true, cooler: true, rack: false });
  if (Q.get('panel') === 'menu') document.body.classList.add('menu-open'); if (Q.get('panel') === 'sheet') document.body.classList.add('sheet-open');   // 測試 / 分享用
  scene.start();
  $('#loading').classList.add('done'); checkApi();
})();
