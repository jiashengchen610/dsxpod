// 中英文字典與切換。靜態 HTML 用 data-i18n="key"（innerHTML）、data-i18n-title、data-i18n-aria；程式字串用 t(key, params)。
// 語言來源：網址 ?lang=en > 使用者上次選的 > 瀏覽器語言。切換不重新整理：app.js 的 setLang 回呼會重畫所有動態文字。
const D = {
zh: {
  'app.title': 'DSX POD 場址模擬',
  'load.libs': '載入 3D 引擎與圖表程式庫…', 'load.climate': '載入氣候資料…', 'load.grid': '載入能耗結果表…', 'load.container': '載入貨櫃模型…',
  'load.cooler': '載入散熱模組模型…', 'load.skid': '載入 800 VDC 電力中心模型…',
  'tip.skid': '800 VDC 電力中心・POD {i}', 'tip.skid.d': '中壓交流 → 800 V 直流，經地面線槽送到貨櫃內機櫃（{kva} kVA）<br>NVIDIA GTC：同樣功率少用 45% 銅。轉換損失暫以 Vertiv APM2 效率代理',
  'unit.skidview': '800 VDC 電力中心', 'unit.skidview.s': '中壓交流 → 800 V 直流，地面線槽接貨櫃', 'unit.skid': '電力中心', 'unit.skid.v': '800 VDC・20 ft・地面線槽接貨櫃東端', 'load.build': '建立場景（地景、道路、變電站）…', 'load.fail': '載入失敗：', 'load.aria': '載入進度',
  'nav.menu': '設定選單', 'nav.aria': '設定', 'nav.site': '① 場址', 'nav.size': '② 規模', 'nav.cool': '③ 散熱', 'nav.unit': '④ 單元',
  'nav.collapse': '縮小設定面板', 'data.collapse': '縮小報告面板', 'data.aria': '結果', 'sheet.open': '展開報告',
  'site.hint': '選一個氣候帶。卡片顯示逐月日最高 / 日最低氣溫帶與柯本分類。',
  'size.mw': '總電量', 'size.site': '基地範圍', 'size.itmw': 'IT 銘牌容量', 'size.exact': '精確輸入', 'size.len': '基地長', 'size.wid': '基地寬',
  'size.pods': 'DSX POD', 'size.pods.v': '{n} 個（{racks} 櫃）', 'size.it': 'IT 銘牌', 'size.base': '基地', 'size.area': '面積', 'size.blocks': '區塊',
  'size.blocks.v': '{n} 個（每塊 56 POD ≈ 53 MW）', 'size.single': '單一陣列',
  'cool.preset': '建議設定', 'cool.energy': '⚡ 最省電', 'cool.water': '💧 最省水',
  'cool.preset.hint': '只從全年每小時都排得掉熱的組合裡挑；改場址或規模會自動重算，手動改下面的選項即為自訂。',
  'cool.strategy': '散熱策略', 'cool.supply': '供水溫度',
  'cool.dry': '純乾冷卻器', 'cool.dry.s': '零用水；熱天可能排不掉', 'cool.chiller': '乾冷卻器＋輔助冰水機', 'cool.chiller.s': '補足熱天；多耗電',
  'cool.evap': '蒸發式（絕熱）', 'cool.evap.s': '熱天噴水；耗水', 'cool.t45': '45 °C（DSX）', 'cool.t32': '32 °C（W32）',
  'cool.name.dry_only': '純乾冷卻器', 'cool.name.dry_plus_chiller': '乾冷卻器＋冰水機', 'cool.name.evaporative': '蒸發式',
  'preset.lab': '{cool}・{sup}・<span class="nw">{gwh} GWh／年</span>・<span class="nw">{water} m³</span>', 'preset.gap': '・⚠ 仍有排熱缺口',
  'reco.dry': '不排熱失敗的方案中 PUE 最低（蒸發式只低 {d}‰ 但每年用水 {w} m³）',
  'reco.best': '每年 0 小時排不掉熱的方案中 PUE 最低', 'reco.best.water': '（代價：每年用水 {w} m³）',
  'reco.none': '三種都有排不掉熱的小時；這個最少，建議改用較低外氣的場址或降低規模',
  'unit.hint': '一個 DSX POD 貨櫃：南牆打開看內部（依 NVIDIA 官方剖面圖排列）。點機櫃、CDU、滅火系統、供回水主管看說明。',
  'unit.inside': '貨櫃內部（剖面）', 'unit.inside.s': '配電盤＋滅火鋼瓶｜3 櫃＋列間 CDU＋4 櫃', 'unit.cool': '疊放散熱模組', 'unit.cool.s': '容量以 Vertiv MCV430 計（N+1）',
  'unit.official': '官方數字：28,500 kg、約 1,000 萬個零件、25 exaFLOPS、17 km 網路線。貨櫃內排列依官方剖面圖；機櫃規格以 GB300 代理 Vera Rubin NVL72。',
  'unit.racks': '機櫃', 'unit.racks.v': '{n} 櫃 Vera Rubin NVL72・<span class="nw">{gpus} GPU</span>', 'unit.compute': '算力', 'unit.compute.v': '{pf} PFLOPS（NVFP4 推論）',
  'unit.it': 'IT 銘牌（代理）', 'unit.it.v': '{mw} MW（GB300 每櫃 136 kW）', 'unit.cdu': 'CDU', 'unit.cdu.v': 'Vertiv XDU2300・2.3 MW・列間',
  'unit.mod': '散熱模組', 'unit.mod.v': '3 × Vertiv MCV430（2 運轉＋1 備援）', 'unit.box': '貨櫃', 'unit.box.v': 'ISO 40 ft 高櫃・<span class="nw">12.19 × 2.44 × 2.90 m</span>', 'unit.weight': '重量（官方）',
  'quality': '畫質', 'quality.high': '高', 'quality.lite': '輕量', 'quality.high.hint': '陰影、天空光、完整植被', 'quality.lite.hint': '無陰影、簡化材質與植被',
  'quality.auto': '畫面約 {fps} fps，已自動切到輕量畫質',
  'tab.sum': '摘要', 'tab.energy': '能耗', 'tab.cmp': '比較', 'tab.clim': '氣候',
  'strip.pue.ok': 'PUE・可滿載', 'strip.pue.bad': 'PUE・⚠缺口', 'strip.energy': '設施耗電／年', 'strip.water': '用水／年', 'strip.compute': '算力（NVFP4）',
  'kpi.compute': 'NVFP4 推論算力・<span class="nw">{gpus} 顆 Vera Rubin GPU</span>', 'kpi.compute.t': '訓練 {pfT} PFLOPS；每櫃 NVFP4 推論 3,600 PFLOPS（effective 值）',
  'kpi.pue': 'PUE（20 年平均）', 'kpi.ok': '全年可滿載', 'kpi.gap': '⚠ 排熱缺口 <span class="nw">{h} h／年</span>',
  'kpi.ok.t': '全年每小時都排得掉熱，PUE 代表真實滿載運轉', 'kpi.gap.t': '每年約 {h} 小時（最壞年 {hmax} h）排不掉熱，那些小時機櫃必須降載，PUE 沒反映這個代價',
  'kpi.energy': '設施耗電／年（不含 IT）', 'kpi.water': '用水／年', 'kpi.rise': '進風溫升', 'kpi.rise.t': '再循環 {r} K＋園區熱島 {i} K（風 3 m/s）',
  'note.layout': '<span class="nw">{pods} 個 DSX POD</span>（{racks} 櫃）・<span class="nw">IT 銘牌 {mw} MW</span>・<span class="nw">基地 {l} × {w} m</span>（{ha} ha）{blocks}',
  'note.blocks': '・{n} 個區塊',
  'note.warn': '<b class="warn">⚠ 這個 PUE 不能單獨看</b>：每年約 {h} 小時（最壞年 {hmax} h）外氣太熱，乾冷卻器無法把水冷到 {sup} 供水溫度。模型在那些小時仍照算耗電，但實際上機櫃得降載或停機，所以 PUE 偏樂觀。要全年滿載，改用「乾冷卻器＋冰水機」或「蒸發式」（比較分頁有對照）。',
  'note.more': '資料來源與限制',
  'note.rubin': '算力用 Vera Rubin NVL72 公開規格（每櫃 NVFP4 推論 3,600 PFLOPS，為 effective 值；訓練 2,500 PFLOPS）；能耗用 GB300 每櫃 136 kW 代理（Vera Rubin 約 190–230 kW），正式數字公開後一起換。',
  'note.screen': '結果為篩選等級：逐時穩態模型＋經驗再循環與熱島，20 年（2005–2024，ERA5）逐時氣象。',
  'energy.year.hint': '每年 PUE（2005–2024）。年際差遠小於場址與散熱策略的差。', 'energy.mix.hint': '一年的設施耗電組成（不含 IT）。',
  'mix.dry_cooler_mwh': '乾冷卻器風扇', 'mix.pumps_mwh': '泵', 'mix.chiller_mwh': '冰水機', 'mix.air_fan_mwh': '氣側風扇', 'mix.air_dx_mwh': '氣側機械冷卻', 'mix.ups_loss_mwh': 'UPS 與配電損失',
  'mix.axis': 'MWh／年', 'mix.tip': ' {v} MWh／年',
  'cmp.hint': '同場址、同規模、同供水溫度下的三種散熱策略。⚠ 表示每年有排不掉熱的小時，PUE 不可直接採信。',
  'cmp.strategy': '策略', 'cmp.unmet': '排不掉熱 h', 'cmp.chiller': '冰水機 MWh', 'cmp.water': '用水 m³', 'cmp.reco': '★ 建議：',
  'clim.absmax': '絕對最高', 'clim.tmax': '日最高平均', 'clim.tmin': '日最低平均', 'clim.absmin': '絕對最低', 'clim.precip': '降水 mm', 'clim.precip.axis': '降水 mm／月',
  'clim.koppen': '柯本', 'clim.ashrae': 'ASHRAE 169', 'clim.map': '年降水', 'clim.rh': '平均 RH', 'clim.t996': '99.6% 設計高溫', 'clim.twb': '濕球最高',
  'clim.above35': '> 35 °C', 'clim.drylimit': '純乾冷極限（45 °C 供水）', 'clim.hpy': '{h} h／年', 'clim.land': '3D 地景',
  'month': ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  'export.btn': '匯出 USD 與參數（zip）', 'export.busy': '產生中…（約 3–10 秒）',
  'export.hint': 'zip 內含 USD 場景（含結果層）、results.json／CSV、params.json；{geo}。',
  'export.t': '用 USD Composer 開；Window > Collection 可一次選取全部 POD／機櫃／CDU。',
  'export.geo.full': '含 Vertiv CDU 與 GB300 機櫃真實模型（約 20 MB）', 'export.geo.vertiv': '含 Vertiv 真實模型', 'export.geo.box': '輕量包（方塊；附 fetch_real_geometry.py 可下載真實模型）',
  'export.noapi': '匯出需要後端：本機執行 .venv\\Scripts\\python.exe -m dsxpod.server（部署版走 /api/export 函式）。',
  'export.done': '已下載 {name}（{kb} KB）', 'export.fail': '匯出失敗：',
  'fs.collapse': '⇔ 收起兩側', 'fs.expand': '⇔ 展開兩側', 'fs.t': '收起 / 展開兩側面板（F）', 'tag.nav': '⚙ 設定 ›', 'tag.nav.t': '展開設定', 'tag.data': '‹ 報告', 'tag.data.t': '展開報告',
  'lang': '語言',
  'tip.sub': '區塊中壓變電站', 'tip.block': '・區塊 {b}', 'tip.sub.d': '高壓 / 中壓進線 → 主變壓器 ×2 → 開關室 → 區塊 {n} 個 POD 的 800 VDC 電力中心<br>IT 銘牌約 {mw} MW（示意，未進能耗模型）',
  'tip.pod': 'POD {i}', 'tip.pod.d': '7 櫃・液冷＋疊放乾冷卻器模組<br>位置 ({x}, {y}) m',
  'scene.site': '基地 {l} × {w} m・{ha} ha', 'scene.use': '使用 {l} × {w} m',
  'part.rack': '機櫃 {i}', 'part.rack.d': 'Vera Rubin NVL72（GB300 規格代理）・72 GPU・NVFP4 推論 3,600 PFLOPS・液冷',
  'part.cdu': 'CDU（冷卻液分配單元）', 'part.cdu.d': 'Vertiv XDU2300・2.3 MW・機櫃液冷迴路 ↔ 乾冷卻器水迴路',
  'part.pdu': '配電盤', 'part.pdu.d': '貨櫃內配電（接園區變電站）', 'part.fire': '潔淨氣體滅火系統', 'part.fire.d': '2 支鋼瓶＋天花板消防管（依官方剖面圖）',
  'part.header': '供回水主管', 'part.header.d': '機櫃液冷迴路 → CDU → 疊放乾冷卻器（TCS 45 °C 溫水）',
  'warn.cap_mw': '超過上限 {v} MW，已截到上限', 'warn.cap_side': '基地邊長超過 {v} m，已截到上限', 'warn.cap_blocks': '基地可放 {a} 個區塊，超過 1 GW 上限，只放 {b} 個（集中排列）',
  'warn.small': '基地太小，放不下一個 POD', 'warn.campus': '超過 {mw} MW：切成 {n} 個區塊（每塊 4 × 14 = 56 POD，約 {mw} MW，各帶一座變電站）；園區熱島為篩選估算，關鍵場址需 CFD 驗證',
  'warn.fill': '補齊成完整陣列：需要 {a} 個 POD，配置 {b} 個（{mw} MW）',
},
en: {
  'app.title': 'DSX POD Site Simulator',
  'load.libs': 'Loading 3D engine and chart library…', 'load.climate': 'Loading climate data…', 'load.grid': 'Loading energy results…', 'load.container': 'Loading container model…',
  'load.cooler': 'Loading cooling module model…', 'load.skid': 'Loading 800 VDC power center model…',
  'tip.skid': '800 VDC power center · POD {i}', 'tip.skid.d': 'MV AC → 800 V DC, fed to the racks through a ground-level busway (<span class="nw">{kva} kVA</span>)<br>NVIDIA GTC: more power with 45% less copper. Conversion loss proxied by Vertiv APM2 efficiency',
  'unit.skidview': '800 VDC power center', 'unit.skidview.s': 'MV AC → 800 V DC, busway to the container', 'unit.skid': 'Power center', 'unit.skid.v': '800 VDC · 20 ft · busway to the container east end', 'load.build': 'Building scene (terrain, roads, substation)…', 'load.fail': 'Load failed: ', 'load.aria': 'Loading progress',
  'nav.menu': 'Settings menu', 'nav.aria': 'Settings', 'nav.site': '① Site', 'nav.size': '② Scale', 'nav.cool': '③ Cooling', 'nav.unit': '④ Unit',
  'nav.collapse': 'Collapse settings panel', 'data.collapse': 'Collapse report panel', 'data.aria': 'Results', 'sheet.open': 'Open report',
  'site.hint': 'Pick a climate zone. Each card shows the monthly daily-high / daily-low band and the Köppen class.',
  'size.mw': 'Total power', 'size.site': 'Site footprint', 'size.itmw': 'IT nameplate', 'size.exact': 'Exact value', 'size.len': 'Site length', 'size.wid': 'Site width',
  'size.pods': 'DSX PODs', 'size.pods.v': '{n} ({racks} racks)', 'size.it': 'IT nameplate', 'size.base': 'Site', 'size.area': 'Area', 'size.blocks': 'Blocks',
  'size.blocks.v': '{n} (56 PODs ≈ 53 MW each)', 'size.single': 'Single array',
  'cool.preset': 'Recommended setup', 'cool.energy': '⚡ Least energy', 'cool.water': '💧 Least water',
  'cool.preset.hint': 'Chosen only among combinations that reject heat every hour of the year. Recalculated when site or scale changes; editing the options below switches to custom.',
  'cool.strategy': 'Cooling strategy', 'cool.supply': 'Supply water temperature',
  'cool.dry': 'Dry coolers only', 'cool.dry.s': 'No water; may fall short on hot days', 'cool.chiller': 'Dry coolers + trim chiller', 'cool.chiller.s': 'Covers hot days; more energy',
  'cool.evap': 'Evaporative (adiabatic)', 'cool.evap.s': 'Sprays water on hot days; uses water', 'cool.t45': '45 °C (DSX)', 'cool.t32': '32 °C (W32)',
  'cool.name.dry_only': 'Dry coolers only', 'cool.name.dry_plus_chiller': 'Dry coolers + chiller', 'cool.name.evaporative': 'Evaporative',
  'preset.lab': '{cool} · {sup} · <span class="nw">{gwh} GWh/yr</span> · <span class="nw">{water} m³</span>', 'preset.gap': ' · ⚠ still has unmet hours',
  'reco.dry': 'Lowest PUE with no unmet hours (evaporative is only {d}‰ lower but uses {w} m³ of water a year)',
  'reco.best': 'Lowest PUE among options with zero unmet hours', 'reco.best.water': ' (cost: {w} m³ of water a year)',
  'reco.none': 'All three have unmet hours; this one has the fewest. Consider a cooler site or a smaller scale.',
  'unit.hint': 'One DSX POD container with the south wall opened (laid out after the NVIDIA cutaway). Click racks, the CDU, fire suppression or the water headers for details.',
  'unit.inside': 'Container interior (cutaway)', 'unit.inside.s': 'Switchboard + fire cylinders | 3 racks + in-row CDU + 4 racks', 'unit.cool': 'Stacked cooling modules', 'unit.cool.s': 'Capacity per Vertiv MCV430 (N+1)',
  'unit.official': 'Official figures: 28,500 kg, about 10 million parts, 25 exaFLOPS, 17 km of network cable. Interior layout follows the official cutaway; rack specs use GB300 as a proxy for Vera Rubin NVL72.',
  'unit.racks': 'Racks', 'unit.racks.v': '{n} × Vera Rubin NVL72 · <span class="nw">{gpus} GPUs</span>', 'unit.compute': 'Compute', 'unit.compute.v': '<span class="nw">{pf} PFLOPS</span> NVFP4 inference',
  'unit.it': 'IT nameplate (proxy)', 'unit.it.v': '<span class="nw">{mw} MW</span> (GB300, <span class="nw">136 kW/rack</span>)', 'unit.cdu': 'CDU', 'unit.cdu.v': 'Vertiv XDU2300 · <span class="nw">2.3 MW</span> · in-row',
  'unit.mod': 'Cooling modules', 'unit.mod.v': '3 × Vertiv MCV430 <span class="nw">(2 duty + 1 standby)</span>', 'unit.box': 'Container', 'unit.box.v': 'ISO 40 ft high cube <span class="nw">12.19 × 2.44 × 2.90 m</span>', 'unit.weight': 'Weight (official)',
  'quality': 'Quality', 'quality.high': 'High', 'quality.lite': 'Lite', 'quality.high.hint': 'Shadows, sky light, full vegetation', 'quality.lite.hint': 'No shadows, simplified materials and vegetation',
  'quality.auto': 'About {fps} fps; switched to Lite automatically',
  'tab.sum': 'Summary', 'tab.energy': 'Energy', 'tab.cmp': 'Compare', 'tab.clim': 'Climate',
  'strip.pue.ok': 'PUE · full load', 'strip.pue.bad': 'PUE · ⚠ unmet', 'strip.energy': 'Facility energy/yr', 'strip.water': 'Water/yr', 'strip.compute': 'Compute (NVFP4)',
  'kpi.compute': 'NVFP4 inference compute · <span class="nw">{gpus} Vera Rubin GPUs</span>', 'kpi.compute.t': 'Training {pfT} PFLOPS; 3,600 PFLOPS NVFP4 inference per rack (effective)',
  'kpi.pue': 'PUE (20-year mean)', 'kpi.ok': 'Full load all year', 'kpi.gap': '⚠ Unmet <span class="nw">{h} h/yr</span>',
  'kpi.ok.t': 'Heat is rejected every hour of the year, so PUE reflects true full-load operation', 'kpi.gap.t': 'About {h} hours a year (worst year {hmax} h) cannot reject heat; racks must throttle in those hours and PUE does not reflect that',
  'kpi.energy': 'Facility energy/yr (excl. IT)', 'kpi.water': 'Water/yr', 'kpi.rise': 'Inlet air temperature rise', 'kpi.rise.t': 'Recirculation {r} K + campus heat island {i} K (3 m/s wind)',
  'note.layout': '<span class="nw">{pods} DSX PODs</span> ({racks} racks) · <span class="nw">IT nameplate {mw} MW</span> · <span class="nw">site {l} × {w} m</span> ({ha} ha){blocks}',
  'note.blocks': ' · {n} blocks',
  'note.warn': '<b class="warn">⚠ Do not read this PUE on its own</b>: for about {h} h a year (worst year {hmax} h) the outdoor air is too hot for dry coolers to reach the {sup} supply temperature. The model still counts energy in those hours, but racks would have to throttle or stop, so PUE is optimistic. For full load all year, use "Dry coolers + chiller" or "Evaporative" (see the Compare tab).',
  'note.more': 'Sources and limitations',
  'note.rubin': 'Compute uses public Vera Rubin NVL72 figures (3,600 PFLOPS NVFP4 inference per rack, effective; 2,500 PFLOPS training). Energy uses GB300 at 136 kW per rack as a proxy (Vera Rubin is about 190–230 kW); both will be replaced together once official numbers are published.',
  'note.screen': 'Screening-grade result: hourly steady-state model plus empirical recirculation and heat island, driven by 20 years (2005–2024, ERA5) of hourly weather.',
  'energy.year.hint': 'PUE by year (2005–2024). Year-to-year spread is far smaller than the spread between sites and cooling strategies.', 'energy.mix.hint': 'Facility energy breakdown for one year (excluding IT).',
  'mix.dry_cooler_mwh': 'Dry cooler fans', 'mix.pumps_mwh': 'Pumps', 'mix.chiller_mwh': 'Chiller', 'mix.air_fan_mwh': 'Air-side fans', 'mix.air_dx_mwh': 'Air-side DX cooling', 'mix.ups_loss_mwh': 'UPS and distribution losses',
  'mix.axis': 'MWh/yr', 'mix.tip': ' {v} MWh/yr',
  'cmp.hint': 'Three cooling strategies at the same site, scale and supply temperature. ⚠ marks unmet hours each year; that PUE cannot be taken at face value.',
  'cmp.strategy': 'Strategy', 'cmp.unmet': 'Unmet h', 'cmp.chiller': 'Chiller MWh', 'cmp.water': 'Water m³', 'cmp.reco': '★ Recommended: ',
  'clim.absmax': 'Absolute max', 'clim.tmax': 'Mean daily high', 'clim.tmin': 'Mean daily low', 'clim.absmin': 'Absolute min', 'clim.precip': 'Precipitation mm', 'clim.precip.axis': 'Precipitation mm/month',
  'clim.koppen': 'Köppen', 'clim.ashrae': 'ASHRAE 169', 'clim.map': 'Annual precipitation', 'clim.rh': 'Mean RH', 'clim.t996': '99.6% design dry-bulb', 'clim.twb': 'Max wet-bulb',
  'clim.above35': '> 35 °C', 'clim.drylimit': 'Dry-cooler limit (45 °C supply)', 'clim.hpy': '{h} h/yr', 'clim.land': '3D landscape',
  'month': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  'export.btn': 'Export USD + parameters (zip)', 'export.busy': 'Generating… (about 3–10 s)',
  'export.hint': 'zip with the USD scene (incl. result layers), results.json / CSV and params.json; {geo}.',
  'export.t': 'Open in USD Composer; Window > Collection selects all PODs / racks / CDUs at once.',
  'export.geo.full': 'with real Vertiv CDU and GB300 rack models (about 20 MB)', 'export.geo.vertiv': 'with real Vertiv models', 'export.geo.box': 'lightweight (boxes; fetch_real_geometry.py downloads the real models)',
  'export.noapi': 'Export needs the backend: run .venv\\Scripts\\python.exe -m dsxpod.server locally (the deployed site uses the /api/export function).',
  'export.done': 'Downloaded {name} ({kb} KB)', 'export.fail': 'Export failed: ',
  'fs.collapse': '⇔ Hide panels', 'fs.expand': '⇔ Show panels', 'fs.t': 'Hide / show both panels (F)', 'tag.nav': '⚙ Settings ›', 'tag.nav.t': 'Open settings', 'tag.data': '‹ Report', 'tag.data.t': 'Open report',
  'lang': 'Language',
  'tip.sub': 'Block MV substation', 'tip.block': ' · block {b}', 'tip.sub.d': 'HV/MV feed → 2 main transformers → switchgear → 800 VDC power centers of the {n} PODs in this block<br>IT nameplate about {mw} MW (illustrative, not in the energy model)',
  'tip.pod': 'POD {i}', 'tip.pod.d': '7 racks · liquid cooled + stacked dry-cooler modules<br>position ({x}, {y}) m',
  'scene.site': 'Site {l} × {w} m · {ha} ha', 'scene.use': 'Used {l} × {w} m',
  'part.rack': 'Rack {i}', 'part.rack.d': 'Vera Rubin NVL72 (GB300 spec proxy) · 72 GPUs · 3,600 PFLOPS NVFP4 inference · liquid cooled',
  'part.cdu': 'CDU (coolant distribution unit)', 'part.cdu.d': 'Vertiv XDU2300 · 2.3 MW · rack liquid loop ↔ dry-cooler water loop',
  'part.pdu': 'Switchboard', 'part.pdu.d': 'In-container power distribution (fed from the campus substation)', 'part.fire': 'Clean-agent fire suppression', 'part.fire.d': '2 cylinders + ceiling pipework (per the official cutaway)',
  'part.header': 'Supply / return headers', 'part.header.d': 'Rack liquid loop → CDU → stacked dry coolers (TCS 45 °C warm water)',
  'warn.cap_mw': 'Above the {v} MW limit; capped', 'warn.cap_side': 'Site side longer than {v} m; capped', 'warn.cap_blocks': 'Site fits {a} blocks, above the 1 GW limit; placing {b} (compact)',
  'warn.small': 'Site too small for one POD', 'warn.campus': 'Above {mw} MW: split into {n} blocks (4 × 14 = 56 PODs, about {mw} MW each, one substation per block); campus heat island is a screening estimate, critical sites need CFD',
  'warn.fill': 'Filled to a complete array: {a} PODs needed, {b} placed ({mw} MW)',
},
};
// 場址與柯本分類英文名（氣候摘要 JSON 只有中文）
const SITE_EN = { taoyuan: 'Taoyuan, Taiwan', johor: 'Johor Sedenak, Malaysia', phoenix: 'Phoenix, Arizona', dallas: 'Dallas, Texas', dublin: 'Dublin, Ireland', oslo: 'Oslo, Norway' };
const KOPPEN_EN = { Cfa: 'Humid subtropical', Af: 'Tropical rainforest', BWh: 'Hot desert', Cfb: 'Temperate oceanic', Dfb: 'Humid continental (warm summer)' };
const LAND_EN = { taoyuan: 'Humid subtropical (Cfa): paddies, bamboo and broadleaf trees', johor: 'Tropical rainforest (Af): oil palm and grassland', phoenix: 'Hot desert (BWh): gravel, scrub and cacti',
  dallas: 'Humid subtropical prairie (Cfa): pasture with scattered oaks', dublin: 'Temperate oceanic (Cfb): pasture and hedgerows', oslo: 'Cold continental (Dfb): conifer forest and clearings' };
// sizing.js 的警告維持中文（與 sizing.py 逐字一致），顯示時用樣式對應翻譯
const WARN_RX = [
  [/^超過上限 (\S+) MW，已截到上限$/, 'warn.cap_mw', ['v']], [/^基地邊長超過 (\S+) m，已截到上限$/, 'warn.cap_side', ['v']],
  [/^基地可放 (\d+) 個區塊，超過 1 GW 上限，只放 (\d+) 個/, 'warn.cap_blocks', ['a', 'b']], [/^基地太小/, 'warn.small', []],
  [/^超過 (\d+) MW：切成 (\d+) 個區塊/, 'warn.campus', ['mw', 'n']], [/^補齊成完整陣列：需要 (\d+) 個 POD，配置 (\d+) 個（([\d.]+) MW）$/, 'warn.fill', ['a', 'b', 'mw']],
];

const store = { get() { try { return localStorage.getItem('dsxpod:lang'); } catch { return null; } }, set(v) { try { localStorage.setItem('dsxpod:lang', v); } catch {} } };
function pick() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (q && D[q]) return q;
  const s = store.get(); if (s && D[s]) return s;
  return /^zh/i.test(typeof navigator !== 'undefined' && navigator.language || 'zh') ? 'zh' : 'en';
}
export let lang = pick();
export const locale = () => lang === 'en' ? 'en-US' : 'zh-TW';
export function t(key, p) {
  let s = D[lang][key] ?? D.zh[key] ?? key;
  if (Array.isArray(s)) return s;
  if (p) for (const [k, v] of Object.entries(p)) s = s.split('{' + k + '}').join(v);
  return s;
}
export const siteName = (key, c) => lang === 'en' ? (SITE_EN[key] || key) : c.name.replace(/（.*）/, '');
export const koppenName = (c) => lang === 'en' ? (KOPPEN_EN[c.koppen] || c.koppen) : c.koppen_name;
export const landName = (key, zh) => lang === 'en' ? (LAND_EN[key] || '–') : zh;
export function warnText(w) { for (const [rx, key, names] of WARN_RX) { const m = w.match(rx); if (m) { const p = {}; names.forEach((n, i) => p[n] = m[i + 1]); return t(key, p); } } return w; }
// 靜態 HTML：data-i18n（innerHTML）、data-i18n-title、data-i18n-aria（aria-label）
export function applyStatic(root = document) {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
  document.title = t('app.title');
  root.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
export function setLang(l) { if (!D[l] || l === lang) return false; lang = l; store.set(l); applyStatic(); return true; }
