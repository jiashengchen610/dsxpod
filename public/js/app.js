// DSX POD 場址模擬（MVP）：氣候 → 單元（產品 / SKU；散熱自動）→ 規模（基地或電量）→ 儀表板 → 匯出 USD 與參數。
// 結果用預算結果表（dsxpod/precompute.py）在 log(MW) 上內插；匯出呼叫本機或部署的 /api/export。
import { plan } from './sizing.js';
import { PodScene, ENV } from './scene.js';
import { PRODUCTS, defaultSku, spec as prodSpec } from './products.js';   // 產品 / SKU 唯一來源（dsxpod/products.py 產生）
import { capex, opex, ELEC } from './capex.js';                                           // 造價：dsxpod/capex.py 產生（同一套規則，係數也在 USD）
import { t, lang, locale, setLang, applyStatic, siteName, koppenName, landName, warnText } from './i18n.js';
applyStatic();                                                  // 靜態文字先套語言（載入畫面也要）

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 0) => v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const COOL = { dry_only: 'cool.name.dry_only', dry_plus_chiller: 'cool.name.dry_plus_chiller', evaporative: 'cool.name.evaporative', chilled_water: 'cool.name.chilled_water' };   // 顯示用 t(COOL[c])
const SUP = { t45: '45 °C', t32: '32 °C', t28: 'CHW 25 °C' };
// 畫面上出現的散熱方式（模型與結果表另有蒸發式、32 °C 供水，使用者 2026-10-26 決定只從畫面拿掉）。
// 散熱不是旋鈕：DSX 用 autoCool() 依 20 年逐時結果決定，GADU 固定冰水機。
const PCOOL = { dsx_pod: ['dry_only', 'dry_plus_chiller'], gadu: ['chilled_water'] };
const coolKeys = () => PCOOL[state.product];
const skuKey = () => state.sku || defaultSku(state.product);
const PR = () => PRODUCTS[state.product], SK = () => prodSpec(state.product, state.sku)[1];
const isGadu = () => state.product === 'gadu';
const supLabel = s => s === 't28' ? `CHW ${SK().chws_c} °C` : SUP[s];      // GADU 的供水標籤依 SKU 的冰水溫度
const SITE_ORDER = ['taoyuan', 'johor', 'phoenix', 'dallas', 'dublin', 'oslo'];
// 算力：NVIDIA Vera Rubin NVL72 公開規格（每櫃 72 GPU；NVFP4 推論 3.6 EF〔effective〕、訓練 2.5 EF；2026 年資料，正式規格可能再變）。
// 每櫃功率：Vera Rubin NVL72 230 kW（Max-P），DSX POD 與 GADU 一致（products.py）。
const RUBIN = { gpus: 72, pf_inf: 3600, pf_train: 2500 };

const store = { get(k, d) { try { const v = localStorage.getItem('dsxpod:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem('dsxpod:' + k, JSON.stringify(v)); } catch {} } };
const state = Object.assign({ site: 'johor', sizeMode: 'mw', mw: 10, siteL: 120, siteW: 100, units: 6, cooling: 'dry_only', supply: 't45', product: 'dsx_pod', sku: null }, store.get('state', {}));
state.sizeMode = 'mw'; state.mw = 10;                              // 啟動固定從 10 MW 開始（使用者 2026-10-26）；網址有規模參數時下面會覆寫
if (!PRODUCTS[state.product]) state.product = 'dsx_pod';
if (state.sku && !PRODUCTS[state.product].skus[state.sku]) state.sku = null;
// 手機 / 窄螢幕：上方一行儀表板（點開看細節）、下方設定面板（點分頁展開）
const MQ = matchMedia('(max-width: 900px)');
const applyMobile = () => { document.body.classList.toggle('mobile', MQ.matches); if (!MQ.matches) document.body.classList.remove('menu-open', 'sheet-open');

};   // 工具列：桌機浮在左下，手機放進設定面板底部
// 手機設定面板打開時，3D 中心點移到畫面上緣 25%（露出來那一半的中間），調參數時看得到模型
const syncFocus = () => scene && scene.setFocusY(document.body.classList.contains('mobile') && document.body.classList.contains('menu-open') ? 0.25 : 0.5);
new MutationObserver(syncFocus).observe(document.body, { attributes: true, attributeFilter: ['class'] });
applyMobile(); MQ.addEventListener?.('change', () => { applyMobile(); setTimeout(() => { Object.values(charts).forEach(c => c.resize()); scene && scene.frame(); }, 300); });
// 畫質：網址 q= > 使用者上次選的 > 預設高畫質（太慢會自動降到輕量）
function initialQuality() {
  const q = new URLSearchParams(location.search).get('q'); if (q === 'high' || q === 'lite') return { q, auto: false };
  const saved = store.get('quality', null); if (saved === 'high' || saved === 'lite') return { q: saved, auto: false };
  // 預設一律高畫質（實機 iPhone 13 mini 跑得動）；跑起來太慢（中位數 < 約 22 fps）才自動降到輕量
  return { q: 'high', auto: true };
}
const QUALITY = initialQuality();
// 網址參數可覆寫（分享 / 測試用）：?site=phoenix&mw=200&product=gadu&sku=hgx_b300&tab=cmp&nav=unit（散熱與供水由 autoCool 決定，不收網址參數）
const Q = new URLSearchParams(location.search);
for (const k of ['site', 'product', 'sku']) if (Q.get(k)) state[k] = Q.get(k);
if (!PRODUCTS[state.product]) state.product = 'dsx_pod'; if (state.sku && !PRODUCTS[state.product].skus[state.sku]) state.sku = null;
if (Q.get('mw')) { state.sizeMode = 'mw'; state.mw = +Q.get('mw'); }
if (Q.get('units')) { state.sizeMode = 'units'; state.units = Math.max(1, Math.round(+Q.get('units'))); }
if (Q.get('site_l') && Q.get('site_w')) { state.sizeMode = 'site'; state.siteL = +Q.get('site_l'); state.siteW = +Q.get('site_w'); }
const GRIDS = {};
let CLIM, GRID, scene, layout, lastPods = -1, lastSite = null, lastProd = null, apiOK = false;
const charts = {};

// ---------------------------------------------------------------- 資料
function interp(site, cooling, supply, itMW, product = state.product, sku = skuKey()) {
  const G = GRIDS[product]; if (!G) return null;
  const rows = G.rows.filter(r => (r.product || 'dsx_pod') === product && (product !== 'gadu' || r.sku === sku) && r.site === site && r.cooling === cooling && r.supply === supply).sort((a, b) => a.it_mw - b.it_mw);
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


// 散熱自動決定（使用者 2026-10-26：0 小時是切點）：純乾冷卻器在 20 年逐時資料裡平均與最差一年都 0 小時排不掉熱 → 用它（省掉冰水機）；
// 否則加輔助冰水機（各場址各規模都 0 小時）。供水固定 45 °C（DSX 規格）。GADU 固定冰水機。
function autoCool(itMW, site = state.site, product = state.product, sku = skuKey()) {
  if (product === 'gadu') return { c: 'chilled_water', s: 't28', dry: null };
  const dry = interp(site, 'dry_only', 't45', itMW, product, sku);
  const ok = !!dry && dry.unmet_h < 1e-6 && dry.unmet_h_max === 0;
  return { c: ok ? 'dry_only' : 'dry_plus_chiller', s: 't45', dry };
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
// 規模換算：總電量 / 基地範圍 / 貨櫃數量（數量 × 每單元 MW → 同一條 plan(mw) 路徑，sizing 兩邊不用改）
const unitMw = (product = state.product, sku = state.sku) => prodSpec(product, sku)[1].it_mw;
const maxUnits = (product = state.product, sku = state.sku) => Math.floor(1000 / unitMw(product, sku) + 1e-9);
function planFor(c) {
  const sku = c.product === 'gadu' ? c.sku : null;
  if (c.sizeMode === 'units') return plan({ mw: Math.min(c.units, maxUnits(c.product, sku)) * unitMw(c.product, sku), product: c.product, sku });
  return c.sizeMode === 'mw' ? plan({ mw: c.mw, product: c.product, sku }) : plan({ siteL: c.siteL, siteW: c.siteW, product: c.product, sku });
}
// 基地滑桿上限：放滿 1 GW 需要的基地（依產品 / SKU）× 1.15；再大也不會多放單元
const siteMaxSide = () => { const cap = plan({ mw: 1000, product: state.product, sku: state.sku }); return Math.min(1500, Math.ceil(Math.max(...cap.site_m) * 1.15 / 10) * 10); };
// 切換規模模式時把目前的配置換算過去（三個模式同步）：單元數照帶、MW 用精確的 IT 功率（換回來同樣單元數）、
// 基地找「剛好排出同樣單元數」的最小長寬（2 m 一格）
function syncScale(to) {
  if (!layout) return;
  if (to === 'units') state.units = layout.n_pods;
  else if (to === 'mw') state.mw = layout.it_mw;
  else if (to === 'site') {                                     // 在目前外框附近找「基地排法剛好排出同樣單元數」的最小基地（10 m 一格）
    const mx = siteMaxSide(), n = layout.n_pods, sku = state.product === 'gadu' ? state.sku : null, c2 = v => Math.ceil(v / 2) * 2;
    let best = null;                                                // 2 m 一格、外框 ±30 m：10 m 一格太粗，常常湊不出剛好的列數 × 個數
    for (let L = Math.max(30, c2(layout.site_m[0]) - 30); L <= Math.min(mx, c2(layout.site_m[0]) + 30); L += 2)
      for (let W = Math.max(30, c2(layout.site_m[1]) - 30); W <= Math.min(mx, c2(layout.site_m[1]) + 30); W += 2) {
        const got = plan({ siteL: L, siteW: W, product: state.product, sku }).n_pods, miss = Math.abs(got - n);
        if (!best || miss < best.miss || (miss === best.miss && L * W < best.L * best.W)) best = { L, W, miss };
      }
    if (best) { state.siteL = best.L; state.siteW = best.W; }
  }
}
function sizeUI() {
  const mx = siteMaxSide(); for (const id of ['#slRange', '#swRange']) $(id).max = mx;
  state.siteL = Math.min(state.siteL, mx); state.siteW = Math.min(state.siteW, mx);
  $$('#sizeMode button').forEach(b => { b.classList.toggle('on', b.dataset.mode === state.sizeMode); b.onclick = () => { if (b.dataset.mode === state.sizeMode) return; syncScale(b.dataset.mode); state.sizeMode = b.dataset.mode; sizeUI(); update(); }; });
  $('#sizeMW').hidden = state.sizeMode !== 'mw'; $('#sizeSite').hidden = state.sizeMode !== 'site'; $('#sizeUnits').hidden = state.sizeMode !== 'units';
  const mu = maxUnits(); state.units = Math.min(Math.max(1, state.units || 1), mu);
  $('#unRange').max = mu; $('#unInput').max = mu; $('#unRange').value = state.units; $('#unInput').value = state.units; $('#unOut').textContent = fmt(state.units);
  $('#mwRange').value = sliderFromMw(state.mw); $('#mwInput').value = state.mw; $('#mwOut').textContent = `${fmt(state.mw, state.mw < 10 ? 1 : 0)} MW`;
  $('#slRange').value = state.siteL; $('#swRange').value = state.siteW; $('#slOut').textContent = `${state.siteL} m`; $('#swOut').textContent = `${state.siteW} m`;
}
$('#mwRange').oninput = e => { state.mw = mwFromSlider(+e.target.value); sizeUI(); update(); };
$('#mwInput').onchange = e => { state.mw = Math.min(1000, Math.max(0.5, +e.target.value || 1)); sizeUI(); update(); };
$('#unRange').oninput = e => { state.units = +e.target.value; sizeUI(); update(); };
$('#unInput').onchange = e => { state.units = Math.max(1, Math.round(+e.target.value || 1)); sizeUI(); update(); };
$('#slRange').oninput = e => { state.siteL = +e.target.value; sizeUI(); update(); };
$('#swRange').oninput = e => { state.siteW = +e.target.value; sizeUI(); update(); };

// ---------------------------------------------------------------- 結果

// 常駐儀表板：總算力 + 電力 / 土地 / 造價（總量與每 EF）。用水不放（使用者 2026-10-26：畫面上的散熱都是閉迴路、冷卻不耗水）。數字變動時旁邊顯示 ▲▼ 百分比：
// 和「上一次停下來的狀態」比（拖動中持續顯示，停 2.5 秒後淡出並把現狀當新基準）。
let dashBase = null, dashTimer = null;
const fmtMW = mw => mw >= 1000 ? `${fmt(mw / 1000, 2)}<small>GW</small>` : `${fmt(mw, mw < 100 ? 1 : 0)}<small>MW</small>`;
const fmtN = v => fmt(v, v > 0 && v < 10 ? 1 : 0);
const fmtUSD = (v, d) => v >= 1e9 ? `${fmt(v / 1e9, 2)}<small>B</small>` : `${fmt(v / 1e6, d ?? (v < 1e8 ? 1 : 0))}<small>M</small>`;
let CX = null, OP = null;                                          // 目前配置的造價與營運（capex.js）
const fmtK = v => v >= 1e6 ? `${fmt(v / 1e6, 2)}<small>M</small>` : `${fmt(v / 1e3, v < 1e4 ? 1 : 0)}<small>k</small>`;
function dashboard(m) {
  const sk = SK(), ef = layout.n_pods * sk.pf_inf_total / 1000, gpus = layout.n_pods * sk.gpus;
  CX = capex(layout, state.product, skuKey(), state.cooling, m.recirc_k + m.island_k, CLIM[state.site].extremes.t_max);
  OP = opex(m.it_mwh, m.facility_mwh, ELEC[state.site].usd_kwh, CX.total);
  const v = { ef, mw: layout.it_mw * m.pue_mean, ha: layout.area_ha, usd: CX.total, opx: OP.energy_usd_per_year };
  v.kw_ef = v.mw * 1000 / ef; v.m2_ef = v.ha * 1e4 / ef; v.usd_ef = v.usd / ef; v.opx_ef = v.opx / ef;
  if (!dashBase) dashBase = v;
  const dl = (k, lowerIsGood) => {
    const a = dashBase[k], b = v[k];
    if (a === b || (!a && !b)) return '';
    const pct = a ? (b - a) / a * 100 : Infinity; if (Math.abs(pct) < 0.5) return '';
    const cls = lowerIsGood == null ? '' : ((b < a) === lowerIsGood ? ' good' : ' bad');
    return `<i class="dl${cls}">${b > a ? '▲' : '▼'}${Number.isFinite(pct) ? fmt(Math.abs(pct), Math.abs(pct) < 10 ? 1 : 0) + '%' : ''}</i>`;
  };
  const rows = [
    ['dash.power', 'dash.power.t', `${fmtMW(v.mw)}${dl('mw')}`, `${fmt(v.kw_ef)}<small>kW</small>${dl('kw_ef', true)}`],
    ['dash.land', 'dash.land.t', `${fmt(v.ha, v.ha < 100 ? 2 : 0)}<small>ha</small>${dl('ha')}`, `${fmtN(v.m2_ef)}<small>m²</small>${dl('m2_ef', true)}`],
    ['dash.cost', 'dash.cost.t', `$${fmtUSD(v.usd)}${dl('usd')}`, `$${fmtUSD(v.usd_ef, 2)}${dl('usd_ef', true)}`],
    ['dash.opex', 'dash.opex.t', `$${fmtUSD(v.opx)}${dl('opx')}`, `$${fmtK(v.opx_ef)}${dl('opx_ef', true)}`],
  ];
  $('#dash').innerHTML = `<div class="dash-top"><b>${fmt(ef, ef < 100 ? 1 : 0)}<small>EF</small>${dl('ef')}</b><span>${isGadu() ? t('kpi.compute.g', { gpus: fmt(gpus), model: sk.name }) : t('kpi.compute', { gpus: fmt(gpus) })}</span></div>` +
    `<table class="dash-t"><thead><tr><th></th><th>${t('dash.total')}</th><th>${t('dash.perEF')}</th></tr></thead><tbody>` +
    rows.map(([k, tt, a, b]) => `<tr title="${t(tt)}"><th>${t(k)}</th><td>${a}</td><td class="pe">${b}</td></tr>`).join('') + '</tbody></table>';
  const req = layout.requested || {}, given = req.site_l ? req.site_l * req.site_w / 1e4 : null;   // 基地模式：陣列用掉的面積 vs 使用者給的基地
  $('#dashStatus').innerHTML = t('dash.status', { pue: fmt(m.pue_mean, 3), cool: t(COOL[state.cooling]), sup: supLabel(state.supply) }) +
    (given ? `<br>${t('dash.landuse', { used: fmt(v.ha, 2), given: fmt(given, 2) })}` : '') + (m.valid ? '' : `<span class="warn">${t('dash.gap', { h: fmt(m.unmet_h) })}</span>`);
  // 手機上方一行：五個總量，長數字用簡寫（1.2K、3.4萬）避免截斷
  const cpt = x => x >= 10000 ? new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(x) : fmt(x, x < 100 && x % 1 ? 1 : 0);
  $('#kpiStrip').innerHTML = [[`${cpt(ef)} EF`, t('strip.compute')], [v.mw >= 1000 ? `${fmt(v.mw / 1000, 2)} GW` : `${fmt(v.mw, v.mw < 100 ? 1 : 0)} MW`, t('strip.power')],
    [`${fmt(v.ha, v.ha < 10 ? 2 : v.ha < 100 ? 1 : 0)} ha`, t('strip.land')], [`$${fmtUSD(v.usd).replace(/<\/?small>/g, '')}`, t('strip.cost')]].map(([a, l]) => `<div><b>${a}</b><span>${l}</span></div>`).join('');
  $('#dataTagKpi').textContent = `${fmt(ef, ef < 100 ? 1 : 0)} EF`;
  clearTimeout(dashTimer); dashTimer = setTimeout(() => { dashBase = v; $$('#dash .dl').forEach(e => e.classList.add('fade')); }, 2500);
}

function coolBox(m, auto) {
  if (isGadu()) { $('#coolAuto').innerHTML = t('gadu.cool.note'); return; }
  const d = auto.dry, lt1 = h => h > 0 && h < 1 ? '<1' : fmt(h);
  $('#coolAuto').innerHTML = (state.cooling === 'dry_only' ? t('auto.dry') : t('auto.chiller', { h: d ? lt1(d.unmet_h) : '–', hmax: d ? fmt(d.unmet_h_max) : '–', mwh: fmt(m.chiller_mwh) })) + `<small>${t('auto.rule')}</small>`;
}

function kpis(m) {
  dashboard(m);
  const sk = SK(), racks = layout.n_pods * sk.racks_total, gpus = layout.n_pods * sk.gpus, pfI = layout.n_pods * sk.pf_inf_total, pfT = sk.pf_inf_per_gpu === 50 ? Math.round(pfI * RUBIN.pf_train / RUBIN.pf_inf) : null;
  const h = fmt(m.unmet_h), hmax = fmt(m.unmet_h_max);
  const badge = `<span class="badge ${m.valid ? 'good' : 'bad'}" title="${m.valid ? t('kpi.ok.t') : t('kpi.gap.t', { h, hmax })}">${m.valid ? t('kpi.ok') : t('kpi.gap', { h })}</span>`;
  $('#kpis').innerHTML = [
    [`${fmt(m.pue_mean, 3)}${badge}`, t('kpi.pue'), (m.valid ? 'ok' : 'bad') + ' wide', ''],
    [`${fmt(pfI)}<small> PFLOPS</small>`, isGadu() ? t('kpi.compute.g', { gpus: fmt(gpus), model: sk.name }) : t('kpi.compute', { gpus: fmt(gpus) }), 'ok wide', pfT ? t('kpi.compute.t', { pfT: fmt(pfT) }) : ''],
    [`${fmt(m.facility_mwh / 1000, 1)}<small> GWh</small>`, t('kpi.energy'), 'ok', ''],
    [`${fmt(layout.it_mw, 1)}<small> MW</small>`, t('kpi.it'), 'ok', ''],
    [`+${fmt(m.recirc_k + m.island_k, 1)}<small> K</small>`, t('kpi.rise'), 'ok wide', t('kpi.rise.t', { r: fmt(m.recirc_k, 1), i: fmt(m.island_k, 1) })],
  ].map(([v, l, c, tt]) => `<div class="kpi ${c}" title="${tt}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const notes = [t(isGadu() ? 'note.layout.gadu' : 'note.layout', { pods: fmt(layout.n_pods), model: sk.name, racks: fmt(racks), mw: fmt(layout.it_mw, 1), l: fmt(layout.site_m[0]), w: fmt(layout.site_m[1]), ha: fmt(layout.area_ha, 2),
    blocks: layout.n_blocks > 1 ? t('note.blocks', { n: layout.n_blocks }) : '' })];
  if (!m.valid) notes.unshift(t(isGadu() ? 'note.warn.gadu' : 'note.warn', { h, hmax, sup: supLabel(state.supply) }));
  notes.push(t('note.water'));
  const grp = { 'cx.compute': ['compute'], 'cx.network': ['network'], 'cx.unit': ['container', 'cdu', 'inrow'], 'cx.cooling': ['dry_cooler', 'chiller'], 'cx.power': ['power_center', 'substation'], 'cx.site': ['site_works', 'buildings'] };
  const capexTable = `<h4 class="sub">${t('cx.title')}</h4><table class="cx"><tbody>` + Object.entries(grp).map(([k, ks]) => { const u = ks.reduce((a, x) => a + (CX.items[x] || 0), 0);
    return `<tr><td>${t(k)}</td><td>$${fmtUSD(u, u < 1e7 ? 2 : 1)}</td><td>${fmt(u / CX.total * 100, u / CX.total < 0.01 ? 2 : 1)}%</td></tr>`; }).join('') +
    `<tr class="tot"><td>${t('cx.total')}</td><td>$${fmtUSD(CX.total)}</td><td>100%</td></tr></tbody></table><p class="hint">${t('cx.hint')}</p>` +
    `<h4 class="sub">${t('op.title')}</h4><table class="cx"><tbody>` +
    `<tr><td>${t('op.price')}</td><td colspan="2">$${fmt(ELEC[state.site].usd_kwh, 3)} / kWh</td></tr>` +
    `<tr><td>${t('op.energy')}</td><td colspan="2">$${fmtUSD(OP.energy_usd_per_year)} ${t('op.peryr')}</td></tr>` +
    `<tr class="tot"><td>${t('op.tco')}</td><td colspan="2">$${fmtUSD(OP.tco_usd_per_year)} ${t('op.peryr')}</td></tr></tbody></table><p class="hint">${t('op.hint', { src: ELEC[state.site].source })}</p>`;
  $('#sumNotes').innerHTML = capexTable + '<ul>' + notes.map(n => `<li>${n}</li>`).join('') + '</ul>' +
    `<details><summary>${t('note.more')}</summary><ul><li>${t(isGadu() ? 'note.gadu' : 'note.rubin')}</li><li>${t('note.screen')}</li></ul></details>`;
}

function chartOpts(extra) {
  Chart.defaults.color = css('--muted'); Chart.defaults.borderColor = '#2c2e31'; Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  return Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } }, extra || {});
}
function make(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($('#' + id), cfg); }

function yearChart(all) {
  const ys = Object.keys(all[state.cooling].years).sort();
  const col = { dry_only: css('--s1'), dry_plus_chiller: css('--s2'), evaporative: css('--s3') };
  make('yearChart', { type: 'line', data: { labels: ys, datasets: coolKeys().filter(c => all[c]).map(c => ({ label: t(COOL[c]), data: ys.map(y => all[c].years[y]),
      borderColor: col[c], backgroundColor: col[c], borderWidth: c === state.cooling ? 2.5 : 1.2, pointRadius: c === state.cooling ? 2.5 : 0, tension: .25 })) },
    options: chartOpts({ plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { y: { title: { display: true, text: 'PUE' } }, x: { grid: { display: false } } } }) });
}

function mixChart(m) {
  const keys = ['dry_cooler_mwh', 'pumps_mwh', 'chiller_mwh', 'air_fan_mwh', 'air_dx_mwh', 'ups_loss_mwh'];
  make('mixChart', { type: 'bar', data: { labels: keys.map(k => t('mix.' + k)), datasets: [{ data: keys.map(k => m.mix[k] || 0), backgroundColor: css('--s1'), borderRadius: 4, maxBarThickness: 22 }] },
    options: chartOpts({ indexAxis: 'y', scales: { x: { title: { display: true, text: t('mix.axis') } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => t('mix.tip', { v: fmt(c.parsed.x) }) } } } }) });
}

function cmpTable(all) {
  $('#cmpTable').innerHTML = `<table><thead><tr><th>${t('cmp.strategy')}</th><th>PUE</th><th>${t('cmp.unmet')}</th><th>${t('cmp.chiller')}</th><th>${t('cmp.capex')}</th></tr></thead><tbody>` +
    coolKeys().filter(c => all[c]).map(c => { const m = all[c]; return `<tr class="${c === state.cooling ? 'sel' : ''}"><td>${t(COOL[c])}${c === state.cooling ? ' ★' : ''}</td><td>${fmt(m.pue_mean, 3)}</td><td>${m.valid ? '0' : '⚠ ' + fmt(m.unmet_h)}</td><td>${fmt(m.chiller_mwh)}</td><td>$${fmtUSD(capex(layout, state.product, skuKey(), c, m.recirc_k + m.island_k, CLIM[state.site].extremes.t_max).total, 1)}</td></tr>`; }).join('') + '</tbody></table>';
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

// ---------------------------------------------------------------- 產品切換（整個場址：DSX POD ↔ GADU；GADU 再選 SKU）
async function ensureGrid(p) {
  if (GRIDS[p]) return;
  try { GRIDS[p] = await fetchJSON(p === 'gadu' ? 'data/results_grid_gadu.json' : 'data/results_grid.json', 'grid'); } catch { GRIDS[p] = { rows: [] }; }
}
const swapI18n = (sel, key) => { const el = $(sel); if (el) { el.dataset.i18n = key; el.innerHTML = t(key); } };
function productUI() {
  const g = isGadu();
  $$('#productSeg button').forEach(b => { b.classList.toggle('on', b.dataset.p === state.product); b.onclick = () => setProduct(b.dataset.p, null); });
  $('#productLink').href = PR().url;                               // 官方產品頁（products.py）
  const sel = $('#skuSel'); sel.hidden = !g;
  sel.innerHTML = Object.entries(PR().skus).map(([k, s]) => `<option value="${k}"${k === skuKey() ? ' selected' : ''}>${s.name} · ${s.it_mw} MW</option>`).join('');
  sel.onchange = () => setProduct(state.product, sel.value);
  document.body.classList.toggle('gadu', g);
  swapI18n('[data-pane="unit"] > p.hint', g ? 'unit.hint.gadu' : 'unit.hint'); swapI18n('[data-pane="unit"] > p.hint:last-of-type', g ? 'unit.official.gadu' : 'unit.official');
  swapI18n('#unitSeg [data-view="unit"] small', g ? 'unit.inside.s.gadu' : 'unit.inside.s');
  swapI18n('#unitSeg [data-view="cool"] span', g ? 'unit.cool.gadu' : 'unit.cool'); swapI18n('#unitSeg [data-view="cool"] small', g ? 'unit.cool.gadu.s' : 'unit.cool.s');
  swapI18n('#unitSeg [data-view="skid"] span', g ? 'unit.skidview.gadu' : 'unit.skidview'); swapI18n('#unitSeg [data-view="skid"] small', g ? 'unit.skidview.gadu.s' : 'unit.skidview.s');
}
async function setProduct(p, sku) {
  state.product = p; state.sku = sku;
  await ensureGrid(p);
  productUI(); unitFacts(); sizeUI(); update();
}

// ---------------------------------------------------------------- 單元（一個 POD 的組成）
const curView = () => $('#nav .tab.active')?.dataset.tab || 'site';
// 官方資料連結（products.py：產品頁、發表新聞稿、SKU 規格頁、整合商自家頁）
const extA = (href, text) => href ? `<a class="ext" href="${href}" target="_blank" rel="noopener">${text} ↗</a>` : '';
function linksRow() {
  const pr = PR(), sk = SK();
  return [t('unit.links'), [extA(pr.url, t('link.product')), extA(pr.press_url, t('link.press')), extA(sk.url, t('link.sku', { name: sk.name })),
    extA(sk.vendor_url, t('link.vendor', { vendor: pr.vendor }))].filter(Boolean).join('<br>')];
}
function unitFacts() {
  const racks = 7, sk = SK();
  if (isGadu()) {
    $('#unitFacts').innerHTML = [[t('unit.racks'), t('unit.g.racks.v', { c: sk.racks_compute, model: sk.name, n: sk.racks_network, u: sk.rack_u, gpus: fmt(sk.gpus) })],
      [t('unit.compute'), t('unit.g.compute.v', { pf: fmt(sk.pf_inf_total) })], [t('unit.it'), t('unit.g.it.v', { mw: sk.it_mw })],
      [t('unit.g.cool'), t('unit.g.cool.v', { cdu: sk.cdus, irc: sk.inrow_coolers, ch: sk.chillers, chw: sk.chws_c })],
      [t('unit.box'), t('unit.box.v')], [t('unit.skid'), t('unit.g.power.v')], linksRow()].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    return;
  }
  $('#unitFacts').innerHTML = [[t('unit.racks'), t('unit.racks.v', { n: racks, gpus: racks * RUBIN.gpus })], [t('unit.compute'), t('unit.compute.v', { pf: fmt(racks * RUBIN.pf_inf) })],
    [t('unit.it'), t('unit.it.v', { mw: fmt(sk.it_mw, 2), kw: fmt(sk.rack_kw) })], [t('unit.cdu'), t('unit.cdu.v')], [t('unit.mod'), t('unit.mod.v')],
    [t('unit.box'), t('unit.box.v')], [t('unit.skid'), t('unit.skid.v')], [t('unit.weight'), '28,500 kg'], linksRow()].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------------------------------------------------------------- 主更新
function update() {
  store.set('state', state);
  const prodKey = `${state.product}:${skuKey()}`;
  if (prodKey !== lastProd) { scene.setProduct(PR(), SK()); lastProd = prodKey; lastPods = -1; }
  layout = planFor(state);
  const key = `${prodKey}:${layout.mode}:${layout.n_pods}:${layout.site_m}`;
  const siteChanged = state.site !== lastSite, layoutChanged = key !== lastPods;
  if (siteChanged) { scene.setEnvironment(state.site, CLIM[state.site].lat, !layoutChanged); lastSite = state.site; }   // 換氣候帶 → 換天空、地面、植被
  if (layoutChanged) { const first = lastPods === -1; scene.setLayout(layout); scene.setView(curView(), { animate: !first, duration: 700 }); lastPods = key; }
  $('#sizeFacts').innerHTML = [[t(isGadu() ? 'size.units' : 'size.pods'), t('size.pods.v', { n: fmt(layout.n_pods), racks: fmt(layout.n_pods * SK().racks_total) })], [t('size.it'), `${fmt(layout.it_mw, 1)} MW`], [t('size.base'), `${fmt(layout.site_m[0])} × ${fmt(layout.site_m[1])} m`],
    [t('size.area'), `${fmt(layout.area_ha, 2)} ha`], [t('size.blocks'), layout.n_blocks > 1 ? t('size.blocks.v', { n: layout.n_blocks, pods: 56, mw: fmt(56 * layout.unit_mw) }) : t('size.single')]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#sizeWarn').textContent = layout.warnings.map(warnText).join(lang === 'en' ? '; ' : '；');
  const auto = autoCool(layout.it_mw); state.cooling = auto.c; state.supply = auto.s; store.set('state', state);
  const all = {}; for (const c of coolKeys()) all[c] = interp(state.site, c, state.supply, layout.it_mw);
  const m = all[state.cooling]; if (!m) { $('#sumNotes').innerHTML = `<p class="warn">${t('grid.missing')}</p>`; $('#kpis').innerHTML = ''; $('#kpiStrip').innerHTML = ''; $('#dash').innerHTML = ''; return; }
  coolBox(m, auto);
  const site = CLIM[state.site];
  $('#summaryChip').textContent = `${PR().short}${isGadu() ? ' ' + SK().name : ''}・${siteName(state.site, site)} (${site.koppen})・${fmt(layout.it_mw, layout.it_mw < 10 ? 1 : 0)} MW・${t(COOL[state.cooling])}・${supLabel(state.supply)}・PUE ${fmt(m.pue_mean, 3)}`;
  kpis(m); yearChart(all); mixChart(m); cmpTable(all); climCharts(); scnUI();
}

// ---------------------------------------------------------------- 方案比較（最多 3 個；存在 localStorage，分享時編進網址 scn=）
const SCN_IDS = ['A', 'B', 'C'];
let SCN = store.get('scn', []);
const cfgOf = () => ({ site: state.site, product: state.product, sku: skuKey(), sizeMode: state.sizeMode, mw: state.mw, siteL: state.siteL, siteW: state.siteW, units: state.units });
const encScn = list => list.map(c => [c.id, c.site, c.product, c.sku, c.sizeMode === 'mw' ? `m${c.mw}` : c.sizeMode === 'units' ? `u${c.units}` : `s${c.siteL}x${c.siteW}`].join('-')).join('~');   // 方案間 ~、欄位間 -（SKU 名有底線、MW 可有小數點）
function decScn(str) {
  return (str || '').split('~').map(x => x.split('-')).filter(a => a.length === 5 && SCN_IDS.includes(a[0]) && SITE_ORDER.includes(a[1])).map(([id, site, product, sku, sz]) => {
    const c = { id, site, product, sku, sizeMode: { m: 'mw', u: 'units', s: 'site' }[sz[0]] || 'mw', mw: 10, siteL: 120, siteW: 100, units: 6 };
    if (c.sizeMode === 'mw') c.mw = +sz.slice(1); else if (c.sizeMode === 'units') c.units = +sz.slice(1); else [c.siteL, c.siteW] = sz.slice(1).split('x').map(Number);
    return PRODUCTS[product] && PRODUCTS[product].skus[sku] ? c : null; }).filter(Boolean).slice(0, 3);
}
if (Q.get('scn')) SCN = decScn(Q.get('scn'));
const saveScnStore = () => store.set('scn', SCN);
function metricsFor(c) {                                       // 一個方案的主要數字（和儀表板同一套算法）
  const lay = planFor(c);
  const au = autoCool(lay.it_mw, c.site, c.product, c.sku), m = interp(c.site, au.c, au.s, lay.it_mw, c.product, c.sku); if (!m) return null;
  const sk = PRODUCTS[c.product].skus[c.sku], ef = lay.n_pods * sk.pf_inf_total / 1000;
  const cx = capex(lay, c.product, c.sku, au.c, m.recirc_k + m.island_k, CLIM[c.site].extremes.t_max), op = opex(m.it_mwh, m.facility_mwh, ELEC[c.site].usd_kwh, cx.total);
  const mw = lay.it_mw * m.pue_mean;
  return { lay, m, sk, ef, mw, ha: lay.area_ha, usd: cx.total, opx: op.energy_usd_per_year, tco: op.tco_usd_per_year, cool: au.c,
           kw_ef: mw * 1000 / ef, m2_ef: lay.area_ha * 1e4 / ef, usd_ef: cx.total / ef, tco_ef: op.tco_usd_per_year / ef };
}
async function loadScn(c) {                                    // 點欄頭 / 標籤：整個配置換過去（3D 與左側設定一起）
  Object.assign(state, { site: c.site, product: c.product, sku: c.product === 'gadu' ? c.sku : null, sizeMode: c.sizeMode, mw: c.mw, siteL: c.siteL, siteW: c.siteW, units: c.units ?? state.units });
  await ensureGrid(c.product);
  $$('.site').forEach(x => x.classList.toggle('on', x.dataset.site === state.site)); sizeUI(); productUI(); unitFacts(); update();
}
function scnUI() {
  const full = SCN.length >= 3, b = $('#saveScn');
  b.disabled = full; b.textContent = full ? t('scn.full') : t('scn.save');
  $('#cartN').textContent = SCN.length; $('#openCmp').hidden = !SCN.length;
  $('#scnChips').innerHTML = SCN.map(c => `<span class="chip" data-id="${c.id}"><b>● ${c.id}</b><span class="t">${siteName(c.site, CLIM[c.site])}・${PRODUCTS[c.product].short}${c.product === 'gadu' ? ' ' + PRODUCTS[c.product].skus[c.sku].name.replace(/^(NVIDIA|AMD) /, '') : ''}</span><button class="x" aria-label="${t('scn.del')}" data-del="${c.id}">×</button></span>`).join('');
  $$('#scnChips .chip').forEach(el => el.onclick = e => { const del = e.target.dataset.del; if (del) { SCN = SCN.filter(c => c.id !== del); saveScnStore(); scnUI(); return; } loadScn(SCN.find(c => c.id === el.dataset.id)); });
  scnTable();
}
$('#saveScn').onclick = () => {
  if (SCN.length >= 3) return;
  const id = SCN_IDS.find(i => !SCN.some(c => c.id === i)); SCN.push({ id, ...cfgOf() }); SCN.sort((a, b) => a.id.localeCompare(b.id)); saveScnStore(); scnUI();
  $('#exportHint').textContent = t('scn.saved', { id });
};
// 全畫面比較表：開 / 關（× 、Esc、點背景）
function openCmp(on) { $('#cmpModal').hidden = !on; if (on) scnTable(); }
$('#openCmp').onclick = () => openCmp(true);
$('#cmpClose').onclick = () => openCmp(false);
$('#cmpModal').onclick = e => { if (e.target === $('#cmpModal')) openCmp(false); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#cmpModal').hidden) openCmp(false); });
async function scnTableAsync() { for (const c of SCN) await ensureGrid(c.product); scnTable(true); }
function scnTable(ready) {
  const box = $('#scnTable'); if (!box) return;
  if (!SCN.length) { box.innerHTML = `<p class="hint">${t('scn.empty')}</p>`; $('#shareBtn').hidden = true; return; }
  $('#shareBtn').hidden = false;
  if (!ready && SCN.some(c => !GRIDS[c.product])) { scnTableAsync(); return; }
  const R = SCN.map(c => ({ c, r: metricsFor(c) }));
  const cell = (r, f) => r ? f(r) : '–';
  const best = key => { const vals = R.filter(x => x.r).map(x => x.r[key]); return vals.length > 1 ? Math.min(...vals) : null; };
  const skuName = c => PRODUCTS[c.product].skus[c.sku].name.replace(/^(NVIDIA|AMD) /, '');
  const cfg = [
    ['scn.site', (r, c) => `${siteName(c.site, CLIM[c.site])}<small>${CLIM[c.site].koppen}</small>`],
    ['scn.product', (r, c) => PRODUCTS[c.product].short], ['scn.sku', (r, c) => skuName(c)],
    ['scn.scale', r => `${fmt(r.lay.it_mw, r.lay.it_mw < 10 ? 1 : 0)}<small>MW</small> · ${fmt(r.lay.n_pods)}<small>${t('scn.units')}</small>`],
    ['scn.base', r => `${fmt(r.lay.site_m[0])} × ${fmt(r.lay.site_m[1])}<small>m</small>`],
    ['scn.cool', r => t(COOL[r.cool])], ['PUE', r => fmt(r.m.pue_mean, 3)],
  ];
  const tot = [
    ['scn.compute', r => `${fmt(r.ef, r.ef < 100 ? 1 : 0)}<small>EF</small>`],
    ['dash.power', r => fmtMW(r.mw)], ['dash.land', r => `${fmt(r.ha, r.ha < 100 ? 2 : 0)}<small>ha</small>`],
    ['dash.cost', r => `$${fmtUSD(r.usd)}`], ['dash.opex', r => `$${fmtUSD(r.opx)}`], ['scn.tco', r => `$${fmtUSD(r.tco)}`],
  ];
  const per = [['dash.power', 'kw_ef', r => `${fmt(r.kw_ef)}<small>kW</small>`], ['dash.land', 'm2_ef', r => `${fmtN(r.m2_ef)}<small>m²</small>`],
               ['dash.cost', 'usd_ef', r => `$${fmtUSD(r.usd_ef, 2)}`], ['scn.tco', 'tco_ef', r => `$${fmtK(r.tco_ef)}`]];
  const lab = k => k === 'PUE' ? 'PUE' : t(k);
  // ⓘ：點了在該列下方展開計算方式（ex.* 字串）；每 EF 段只在段落標題放一個
  const EXK = { 'scn.site': 'ex.site', 'scn.product': 'ex.product', 'scn.sku': 'ex.sku', 'scn.scale': 'ex.scale', 'scn.base': 'ex.base', 'scn.cool': 'ex.cool', PUE: 'ex.pue',
    'scn.compute': 'ex.compute', 'dash.power': 'ex.power', 'dash.land': 'ex.land', 'dash.cost': 'ex.cost', 'dash.opex': 'ex.opex', 'scn.tco': 'ex.tco', 'scn.perEF': 'ex.perEF' };
  const info = k => EXK[k] ? `<button class="info" data-ex="${EXK[k]}" aria-label="${t('ex.aria')}" title="${t('ex.aria')}">i</button>` : '';
  const sec = k => `<tr class="sec"><th colspan="${R.length + 1}">${t(k)}${k === 'scn.perEF' ? info(k) : ''}</th></tr>`;
  const head = R.map(({ c }) => `<th class="scn-h" data-id="${c.id}" title="${t('scn.load')}"><b>● ${c.id}</b><span>${PRODUCTS[c.product].short} ${c.product === 'gadu' ? skuName(c) : ''}</span><span>${siteName(c.site, CLIM[c.site])}</span></th>`).join('');
  box.innerHTML = `<table class="scn"><thead><tr><th></th>${head}</tr></thead><tbody>` +
    sec('scn.sec.cfg') + cfg.map(([k, f]) => `<tr><th>${lab(k)}${info(k)}</th>${R.map(({ c, r }) => `<td>${r ? f(r, c) : '–'}</td>`).join('')}</tr>`).join('') +
    sec('scn.sec.tot') + tot.map(([k, f]) => `<tr><th>${lab(k)}${info(k)}</th>${R.map(({ r }) => `<td>${cell(r, f)}</td>`).join('')}</tr>`).join('') +
    sec('scn.perEF') + per.map(([k, key, f]) => { const b = best(key); return `<tr><th>${lab(k)}</th>${R.map(({ r }) => r && b !== null && Math.abs(r[key] - b) < 1e-9 ? `<td class="best">${f(r)} ★</td>` : `<td>${cell(r, f)}</td>`).join('')}</tr>`; }).join('') +
    '</tbody></table>';
  $$('#scnTable .scn-h').forEach(th => th.onclick = () => { openCmp(false); loadScn(SCN.find(c => c.id === th.dataset.id)); });
  $$('#scnTable .info').forEach(b => b.onclick = e => {
    e.stopPropagation(); const tr = b.closest('tr'), nx = tr.nextElementSibling;
    if (nx && nx.classList.contains('ex')) { nx.remove(); b.classList.remove('on'); return; }
    tr.insertAdjacentHTML('afterend', `<tr class="ex"><td colspan="${R.length + 1}">${t(b.dataset.ex)}</td></tr>`); b.classList.add('on');
  });
  $('#scnHint').textContent = t('scn.hint');
}
$('#shareBtn').onclick = async () => {
  const c = cfgOf(), u = new URL(location.origin + location.pathname);
  u.searchParams.set('site', c.site); u.searchParams.set('product', c.product); if (c.product === 'gadu') u.searchParams.set('sku', c.sku);
  if (c.sizeMode === 'mw') u.searchParams.set('mw', c.mw); else if (c.sizeMode === 'units') u.searchParams.set('units', c.units); else { u.searchParams.set('site_l', c.siteL); u.searchParams.set('site_w', c.siteW); }
  u.searchParams.set('scn', encScn(SCN)); u.searchParams.set('cmp', '1'); if (lang === 'en') u.searchParams.set('lang', 'en');
  try { if (navigator.share && document.body.classList.contains('mobile')) { await navigator.share({ title: t('app.title'), url: u.toString() }); return; }
        await navigator.clipboard.writeText(u.toString()); $('#scnHint').textContent = t('scn.copied'); }
  catch { $('#scnHint').textContent = u.toString(); }
};

// ---------------------------------------------------------------- 分頁、收合、顯示、提示、匯出
function tabs(root) { $$(`${root} .tab`).forEach(t => t.onclick = () => { $$(`${root} .tab`).forEach(x => x.classList.toggle('active', x === t)); $$(`${root} .tabpane`).forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab)); Object.values(charts).forEach(c => c.resize()); }); }
$('#menuBtn').onclick = () => { document.body.classList.toggle('menu-open'); document.body.classList.remove('sheet-open'); };
// 手機下方設定面板：三段高度 收合 / 一半 / 全高。點分頁打開到一半（並切到該分頁）、再點已選的分頁收起；
// 拖把手或分頁列跟手改高度，放開吸附到最近的一段（快速甩動直接往甩的方向跳一段）。兩個面板一次只開一個。
const navState = (st) => { const b = document.body.classList; b.toggle('menu-open', st !== 'closed'); b.toggle('menu-full', st === 'full'); if (st !== 'closed') b.remove('sheet-open'); };
const navToggle = (open) => navState(open ? 'half' : 'closed');
let navDragged = 0;
$('#nav .tabs').addEventListener('click', e => {
  const tb = e.target.closest('.tab'); if (!tb || !document.body.classList.contains('mobile')) return;
  if (performance.now() - navDragged < 350) { e.stopPropagation(); e.preventDefault(); return; }   // 剛拖完，不當成點擊
  navToggle(!(tb.classList.contains('active') && document.body.classList.contains('menu-open')));
}, true);
{ const nav = $('#nav'); let y0 = null, h0 = 0, t0 = 0, last = [0, 0], moved = false;
  const heights = () => { const peek = parseFloat(getComputedStyle(document.body).getPropertyValue('--navPeek')) || 64, dash = parseFloat(getComputedStyle(document.body).getPropertyValue('--dashPeek')) || 58;
    return { closed: peek, half: innerHeight * 0.5, full: innerHeight - dash - 6 }; };
  const start = e => { if (!document.body.classList.contains('mobile')) return; y0 = e.touches[0].clientY; h0 = nav.offsetHeight; t0 = performance.now(); last = [y0, t0]; moved = false; };
  const move = e => { if (y0 === null) return; const y = e.touches[0].clientY, dy = y - y0;
    if (!moved && Math.abs(dy) < 8) return;
    if (!moved) { moved = true; nav.classList.add('dragging'); }
    const H = heights(); nav.style.height = `${Math.min(H.full, Math.max(H.closed, h0 - dy))}px`; last = [y, performance.now()]; e.preventDefault(); };
  const end = e => { if (y0 === null) return; const wasMoved = moved; y0 = null; if (!wasMoved) return;
    navDragged = performance.now(); nav.classList.remove('dragging');
    const H = heights(), h = nav.offsetHeight, v = (e.changedTouches[0].clientY - last[0]) / Math.max(16, performance.now() - last[1]);   // px/ms，負 = 往上
    const order = ['closed', 'half', 'full']; let st = order.reduce((a, k) => Math.abs(H[k] - h) < Math.abs(H[a] - h) ? k : a, 'closed');
    if (Math.abs(v) > 0.5) st = v < 0 ? (order.find(k => H[k] > h + 4) || 'full') : ([...order].reverse().find(k => H[k] < h - 4) || 'closed');
    nav.style.height = ''; navState(st); };
  for (const el of [$('#navGrab'), $('#nav .tabs')]) { el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: false }); el.addEventListener('touchend', end); el.addEventListener('touchcancel', end); }
  $('#navGrab').addEventListener('click', () => { if (performance.now() - navDragged > 350) navState(document.body.classList.contains('menu-open') ? 'closed' : 'half'); }); }
// 手機上方儀表板：點一行切換展開，或上下滑（往下拉展開）
const sheetToggle = (open) => { document.body.classList.toggle('sheet-open', open ?? !document.body.classList.contains('sheet-open')); if (document.body.classList.contains('sheet-open')) document.body.classList.remove('menu-open', 'menu-full'); setTimeout(() => Object.values(charts).forEach(c => c.resize()), 300); };
$('#sheetHead').onclick = () => sheetToggle(); $('#dataGrab').onclick = () => sheetToggle();
for (const el of [$('#sheetHead'), $('#dataGrab')]) { let y0 = null; el.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => { if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (Math.abs(dy) > 25) { e.preventDefault(); sheetToggle(dy > 0); } }); }
// 面板縮小 / 展開（桌機、平板）：各自縮成小標籤，左下按鈕一次收起或展開兩側；記住使用者的選擇。不使用瀏覽器全螢幕（平板上會干擾互動）。
function setMin(which, on) {
  document.body.classList.toggle(which + '-min', on);
  store.set('min', { nav: document.body.classList.contains('nav-min'), data: document.body.classList.contains('data-min') });
  const both = document.body.classList.contains('nav-min') && document.body.classList.contains('data-min');
  $('#fsBtn').textContent = both ? t('fs.expand') : t('fs.collapse');
  if (!on) setTimeout(() => Object.values(charts).forEach(c => c.resize()), 300);
}
$('#navCollapse').onclick = () => { if (document.body.classList.contains('mobile')) { document.body.classList.remove('menu-open'); return; } setMin('nav', true); };
$('#dataCollapse').onclick = e => { e.stopPropagation(); if (document.body.classList.contains('data-wide')) setWide(false); else setMin('data', true); };   // 全畫面 → 退回側欄 → 再按縮到最小
$('#navTag').onclick = () => setMin('nav', false);
$('#dataTag').onclick = () => setMin('data', false);
const toggleBoth = () => { const both = document.body.classList.contains('nav-min') && document.body.classList.contains('data-min'); setMin('nav', !both); setMin('data', !both); };
$('#fsBtn').onclick = toggleBoth;
// 重設視角：關閉剖面（牆板闔上），鏡頭平滑回到目前規模的透視位置（H 鍵）
const resetView = () => { scene && scene.setView('size'); $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === 'unit')); window.__doorUI && window.__doorUI(); };
$('#homeBtn').onclick = resetView; $('#homeFab').onclick = resetView;
addEventListener('keydown', e => { if ((e.key === 'h' || e.key === 'H') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) resetView(); });
// 齒輪：畫質 / 動態 / 語言的彈出面板；點外面或 Esc 關閉
const prefsOpen = (on) => { $('#prefs').hidden = !on; $('#prefsBtn').setAttribute('aria-expanded', on); $('#prefsBtn').classList.toggle('on', on); };
$('#prefsBtn').onclick = e => { e.stopPropagation(); prefsOpen($('#prefs').hidden); };
addEventListener('pointerdown', e => { if (!$('#prefs').hidden && !$('#prefs').contains(e.target) && e.target !== $('#prefsBtn')) prefsOpen(false); });
addEventListener('keydown', e => { if (e.key === 'Escape') prefsOpen(false); });
if (Q.get('prefs')) prefsOpen(true);                              // 測試 / 截圖用
// 右側加寬（桌機）：側欄 ↔ 約 90% 寬，一次看到更多資料；記住選擇
const setWide = on => { document.body.classList.toggle('data-wide', on); store.set('wide', on); setTimeout(() => Object.values(charts).forEach(c => c.resize()), 320); };
$('#dataWide').onclick = e => { e.stopPropagation(); setWide(!document.body.classList.contains('data-wide')); };
setWide(store.get('wide', false));
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
  else if (p.kind === 'skid') { const kva = fmt(Math.ceil(SK().it_mw * 1000 * 1.25 / 100) * 100); tip.innerHTML = isGadu() ? `<b>${t('tip.skid.gadu', { i: p.index + 1 })}</b><br>${t('tip.skid.gadu.d', { kva })}` : `<b>${t('tip.skid', { i: p.index + 1 })}</b><br>${t('tip.skid.d', { kva })}`; }
  else if (p.kind === 'chiller') tip.innerHTML = `<b>${t('tip.chiller', { i: p.index + 1 })}</b><br>${t('tip.chiller.d', { chw: SK().chws_c, n: SK().chillers })}`;
  else if (p.kind === 'sub') tip.innerHTML = `<b>${t('tip.sub')}${layout.n_blocks > 1 ? t('tip.block', { b: p.block + 1 }) : ''}</b><br>${t('tip.sub.d', { n: fmt(p.n_pods), mw: fmt(p.mw, 1) })}`;
  else if (isGadu()) tip.innerHTML = `<b>${t('tip.pod.gadu', { i: p.index + 1 })}</b>${layout.n_blocks > 1 ? t('tip.block', { b: p.block + 1 }) : ''}<br>${t('tip.pod.gadu.d', { model: SK().name, racks: SK().racks_total, x: fmt(p.x, 1), y: fmt(p.y, 1) })}`;
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
  $('#exportBtn').title = apiOK ? t('export.hint', { geo: t('export.geo.' + apiGeo) }) : t('export.noapi');   // 長說明放滑鼠提示，底部只顯示狀態訊息
  $('#exportHint').textContent = apiOK ? '' : t('export.noapi');
}
$('#exportBtn').onclick = async () => {
  const btn = $('#exportBtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = t('export.busy');
  try {
    const body = { site: state.site, cooling: state.cooling, supply: state.supply, product: state.product, sku: skuKey(), ...(state.sizeMode === 'units' ? { mw: Math.min(state.units, maxUnits()) * unitMw() } : state.sizeMode === 'mw' ? { mw: state.mw } : { site_l: state.siteL, site_w: state.siteW }) };
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
const LOAD = { libs: [0.12, 1], climate: [0.03, 0], grid: [0.25, 0], 'container.glb': [0.12, 0], 'cooler_module.glb': [0.20, 0], 'power_skid.glb': [0.04, 0], 'chiller.glb': [0.07, 0], build: [0.17, 0] };
const EST = { climate: 15e3, grid: 461e3, 'container.glb': 48e3, 'cooler_module.glb': 88e3, 'power_skid.glb': 26e3, 'chiller.glb': 48e3 };
const MSG = { climate: 'load.climate', grid: 'load.grid', 'container.glb': 'load.container', 'cooler_module.glb': 'load.cooler', 'power_skid.glb': 'load.skid', 'chiller.glb': 'load.chiller', build: 'load.build' };
function progress(key, frac) {
  if (!LOAD[key]) return;                                      // 不在表上的檔案不算進度（這裡丟例外會卡住下載串流）
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
const paint = () => new Promise(r => { let done = false; const f = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(f); setTimeout(f, 80); });   // 讓進度條先畫出來；分頁被節流（背景、iframe）時 rAF 不一定來，80 ms 後照走

(async function main() {
  progress('libs', 1);
  [CLIM, GRID] = await Promise.all([fetchJSON('data/climate_summary.json', 'climate'), fetchJSON('data/results_grid.json', 'grid')]);
  GRIDS.dsx_pod = GRID; if (isGadu()) await ensureGrid('gadu');
  scene = new PodScene($('#scene'), { quality: QUALITY.q, autoDowngrade: QUALITY.auto, labels: { site: (l, w, ha) => t('scene.site', { l, w, ha }), use: (l, w) => t('scene.use', { l, w }) } });
  await scene.load('assets/', (f, loaded, total) => progress(f, loaded / Math.max(total || EST[f], loaded * 1.05)));
  progress('container.glb', 1); progress('cooler_module.glb', 1); progress('power_skid.glb', 1); progress('chiller.glb', 1); progress('build', 0.15); await paint();
  const qualityUI = () => $$('#qualitySeg button').forEach(b => { b.classList.toggle('on', b.dataset.q === scene.quality); b.onclick = () => { store.set('quality', b.dataset.q); scene.setQuality(b.dataset.q); qualityUI(); }; });
  let toastTimer;   // 自動降畫質時在工具列短暫提示
  scene.onQualityChange = (q, why) => { qualityUI(); if (why && why.fps) { const el = $('#qualityHint'); el.textContent = t('quality.auto', why); el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 6000); } };
  qualityUI();
  // 環境動態開關：網址 anim= > 使用者上次選的 > 系統「減少動態」設定
  scene.setAnim(Q.get('anim') ? Q.get('anim') !== 'off' : store.get('anim', !matchMedia('(prefers-reduced-motion: reduce)').matches));
  const animUI = () => $$('#animSeg button').forEach(b => { b.classList.toggle('on', (b.dataset.a === 'on') === scene.animOn); b.onclick = () => { scene.setAnim(b.dataset.a === 'on'); store.set('anim', scene.animOn); animUI(); }; });
  animUI();
  // 語言切換：靜態文字重套，動態文字全部重畫（場址卡片、單元、結果、匯出說明、3D 基地標籤）
  const langUI = () => $$('#langSeg button').forEach(b => { b.classList.toggle('on', b.dataset.lang === lang); b.onclick = () => { if (!setLang(b.dataset.lang)) return; langUI(); siteCards(); productUI(); unitFacts(); setMin('nav', document.body.classList.contains('nav-min')); update(); exportUI(); scene.setLayout(layout); }; });
  langUI();
  tabs('#nav'); tabs('#data'); siteCards(); sizeUI(); productUI();
  $$('#data .tab').forEach(b => b.addEventListener('click', () => document.body.classList.toggle('dtab-dash', b.dataset.tab === 'dash')));
  document.body.classList.toggle('dtab-dash', ($('#data .tab.active')?.dataset.tab || 'dash') === 'dash');
  if (Q.get('cmp') || Q.get('tab') === 'cmp') openCmp(true);                   // 分享的方案比較：直接開大表
  // 分鏡：每個設定分頁一個鏡頭（氣候 = 全景、單元 = 貨櫃剖面、規模 = 整個基地）
  $$('#nav .tab').forEach(t => t.addEventListener('click', () => { scene.setView(t.dataset.tab); $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === 'unit')); }));
  $$('#unitSeg button').forEach(b => b.onclick = () => { $$('#unitSeg button').forEach(x => x.classList.toggle('on', x === b)); scene.setView(b.dataset.view); doorUI(); });
  // 櫃門開關：停在目前鏡頭切換剖面；切到「貨櫃內部」視角時自動打開
  const doorUI = () => { $('#doorFab').hidden = !(scene.viewMode === 'unit' || scene.doorsOpen);   // 只在看貨櫃剖面時出現
    $$('#doorSeg button').forEach(b => { b.classList.toggle('on', (b.dataset.door === 'open') === scene.doorsOpen); b.onclick = () => { scene.setDoors(b.dataset.door === 'open'); doorUI(); }; }); };
  window.__doorUI = doorUI;
  $$('#nav .tab').forEach(t => t.addEventListener('click', () => setTimeout(doorUI, 0)));
  doorUI();
  unitFacts();
  progress('build', 0.4); await paint();
  update();
  progress('build', 0.9); await paint();
  if (Q.get('tab')) $(`#data .tab[data-tab="${{ year: 'energy', mix: 'energy' }[Q.get('tab')] || Q.get('tab')}"]`)?.click();
  if (Q.get('nav')) $(`#nav .tab[data-tab="${Q.get('nav')}"]`)?.click();
  if (Q.get('cam')) { scene.setView(Q.get('cam'), { animate: false }); $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === Q.get('cam'))); }   // 分享 / 測試：直接指定鏡頭（site / size / cool / unit / skid）
  if (Q.get('dist')) { const d = +Q.get('dist'), t = scene.controls.target, c = scene.camera.position; const v = c.clone().sub(t).setLength(d); c.copy(t.clone().add(v)); }
  scene.setVisible({ shell: true, cooler: true, rack: false });
  if (Q.get('panel') === 'menu') document.body.classList.add('menu-open'); if (Q.get('panel') === 'full') document.body.classList.add('menu-open', 'menu-full'); if (Q.get('panel') === 'sheet') document.body.classList.add('sheet-open');   // 測試 / 分享用
  syncFocus(); scene.start();
  progress('build', 1); await paint();
  $('#loading').classList.add('done'); checkApi();
})().catch(e => {                                            // 載入失敗：進度條轉紅並顯示原因
  console.error(e); $('#loading').classList.add('err'); $('.ld-bar').classList.add('det');
  $('#ldMsg').textContent = t('load.fail') + (e && e.message || e); $('#ldPct').textContent = '';
});
