// 中英文字典與切換。靜態 HTML 用 data-i18n="key"（innerHTML）、data-i18n-title、data-i18n-aria；程式字串用 t(key, params)。
// 語言來源：網址 ?lang=en > 使用者上次選的 > 瀏覽器語言。切換不重新整理：app.js 的 setLang 回呼會重畫所有動態文字。
const D = {
zh: {
  'app.title': 'DSX POD 場址模擬',
  'load.libs': '載入 3D 引擎與圖表程式庫…', 'load.climate': '載入氣候資料…', 'load.grid': '載入能耗結果表…', 'load.container': '載入貨櫃模型…',
  'load.cooler': '載入散熱模組模型…', 'load.skid': '載入 800 VDC 電力中心模型…', 'load.chiller': '載入冰水機模型…',
  // ---- 產品切換 / GADU
  'anim': '動態', 'anim.on': '開', 'anim.off': '關', 'anim.t': '散熱器上方的熱氣、狀態燈與變電站航空障礙燈（畫在 3D 上方的疊層，不會讓 3D 持續重畫）',
  // ---- IA 改版：自動散熱、儀表板
  'unit.coolLabel': '散熱（依氣候與規模自動決定）',
  'auto.dry': '<b>純乾冷卻器</b>：這個場址與規模在 20 年逐時資料裡每小時都排得掉熱，不需要冰水機，用水 0。',
  'auto.chiller': '<b>乾冷卻器＋輔助冰水機</b>：只用乾冷卻器的話，每年平均約 <span class="nw">{h} 小時</span>、最差一年 <span class="nw">{hmax} 小時</span>排不掉熱，所以配輔助冰水機在熱天補足（每年用電約 <span class="nw">{mwh} MWh</span>）。',
  'auto.rule': '規則：20 年內 0 小時排熱缺口才算可行；供水固定 45 °C（DSX 規格）。',
  'dash.title': '儀表板', 'dash.total': '總量', 'dash.perEF': '每 EF', 'dash.more': '細節',
  'dash.power': '電力', 'dash.water': '用水／年', 'dash.land': '土地', 'dash.cost': '造價',
  'dash.power.t': '設施總功率 = IT 銘牌容量 × PUE（20 年平均）', 'dash.water.t': '每年冷卻用水', 'dash.land.t': '基地面積（含退縮、道路、變電站）',
  'dash.cost.soon': '造價模型建置中：含機櫃、設備與材料；不含土地取得與施工人力',
  'dash.status': 'PUE {pue}・{cool}・{sup}', 'dash.gap': '⚠ 每年約 {h} 小時排不掉熱，PUE 偏樂觀',
  'dash.landuse': '土地：陣列使用 {used} ha／基地 {given} ha',
  'strip.power': '電力', 'strip.land': '土地', 'strip.cost': '造價', 'kpi.it': 'IT 銘牌容量',
  'product.label': '產品', 'cool.name.chilled_water': '列間冷卻＋氣冷冰水機',
  'note.warn.gadu': '<b class="warn">⚠ 這個 PUE 不能單獨看</b>：每年約 {h} 小時（最壞年 {hmax} h）外氣太熱、冰水機容量降額後不夠（額定為 35 °C 時 1.2 倍設計排熱，每高 1 K 少 2%），模型照算耗電但實際機櫃得降載。要全年滿載需加大冰水機或選較涼的場址。',
  'gadu.cool.note': 'GADU 的散熱是固定配置：列間 CDU／列間冷卻器＋氣冷冰水機，冰水溫度由機櫃型號決定（液冷 25 °C、氣冷 15 °C）。',
  'size.units': 'GADU 單元', 'grid.missing': '這個產品的結果表還沒算好（python -m dsxpod.precompute --product gadu）。',
  'unit.hint.gadu': '一個 GADU 單元：IT 貨櫃（南牆打開）＋東端 power skid＋北側氣冷冰水機。一排依序是 CDU、運算櫃夾列間冷卻器、網路／管理櫃、CDU。點設備看說明。',
  'unit.inside.s.gadu': 'CDU｜運算櫃＋列間冷卻器｜網路櫃｜CDU', 'unit.cool.gadu': '氣冷冰水機', 'unit.cool.gadu.s': '每單元 1–2 台，接列間 CDU／冷卻器的冰水迴路',
  'unit.skidview.gadu': 'Power skid', 'unit.skidview.gadu.s': '中壓變壓器＋UPS＋低壓配電（交流）',
  'unit.official.gadu': '數字來自技嘉官網 GADU 規格表（2026-10）：每櫃功率 =（IT MW − 網路櫃 × 15 kW）/ 運算櫃數；冰水機、列間冷卻器尺寸與 COP 為一般機型量級假設。',
  'unit.g.racks.v': '{c} 運算櫃 {model}＋{n} 網路／管理櫃（{u}U）・<span class="nw">{gpus} GPU</span>', 'unit.g.it.v': '{mw} MW（官網規格表）',
  'unit.g.cool': '冷卻', 'unit.g.cool.v': '{cdu} 台列間 CDU（N+1）＋{irc} 台列間冷卻器（N+1）＋{ch} 台氣冷冰水機・冰水 {chw} °C',
  'unit.g.power.v': '1 × power skid（交流）', 'unit.g.compute.v': '{pf} PFLOPS（NVFP4 推論，各家口徑不同）',
  'kpi.compute.g': 'NVFP4 推論算力・<span class="nw">{gpus} 顆 GPU</span>（{model}）',
  'note.gadu': '算力與每櫃功率來自技嘉 GADU 規格表；冰水機 COP 用卡諾效率法（η 0.45）、列間冷卻器與冰水泵為比例假設；無乾冷卻器、無用水。',
  'tip.pod.gadu': 'GADU 單元 {i}', 'tip.pod.gadu.d': '{model}・{racks} 櫃・列間 CDU／冷卻器＋氣冷冰水機<br>位置 ({x}, {y}) m',
  'tip.skid.gadu': 'Power skid・單元 {i}', 'tip.skid.gadu.d': '中壓變壓器＋UPS＋低壓配電（{kva} kVA）<br>技嘉 GADU：預先組裝、自成一體的電力單元',
  'tip.chiller': '氣冷冰水機・單元 {i}', 'tip.chiller.d': '冰水 {chw} °C 供列間 CDU／冷卻器；COP 依外氣與熱島逐時計算<br>每單元 {n} 台（官網規格表）',
  'part.rack.g': '運算櫃 {i}', 'part.rack.g.d': '{model}・{kw} kW・{cool}', 'part.net': '網路／管理櫃 {i}', 'part.net.d': '交換器、管理節點、儲存（假設 15 kW）',
  'part.irc': '列間冷卻器 {i}', 'part.irc.d': '冰水盤管＋風扇，排機櫃氣側的熱（N+1）', 'part.header.g': '冰水供回水主管', 'part.header.g.d': '列間 CDU／冷卻器 → 北側氣冷冰水機',
  'part.cdu.g': 'CDU（列間，N+1）', 'part.cdu.g.d': 'Vertiv XDU2300 規格代理・機櫃液冷迴路 ↔ 冰水迴路',
  'tip.skid': '800 VDC 電力中心・POD {i}', 'tip.skid.d': '中壓交流 → 800 V 直流，經地面線槽送到貨櫃內機櫃（{kva} kVA）<br>NVIDIA GTC：同樣功率少用 45% 銅。轉換損失暫以 Vertiv APM2 效率代理',
  'unit.skidview': '800 VDC 電力中心', 'unit.skidview.s': '中壓交流 → 800 V 直流，地面線槽接貨櫃', 'unit.skid': '電力中心', 'unit.skid.v': '800 VDC・20 ft・地面線槽接貨櫃東端', 'load.build': '建立場景（地景、道路、變電站）…', 'load.fail': '載入失敗：', 'load.aria': '載入進度',
  'nav.menu': '設定選單', 'nav.aria': '設定', 'nav.site': '① 氣候', 'nav.size': '③ 規模', 'nav.unit': '② 單元',
  'nav.collapse': '縮小設定面板', 'data.collapse': '縮小報告面板', 'data.aria': '結果', 'sheet.open': '展開報告',
  'site.hint': '選一個氣候帶。卡片顯示逐月日最高 / 日最低氣溫帶與柯本分類。',
  'size.mw': '總電量', 'size.site': '基地範圍', 'size.itmw': 'IT 銘牌容量', 'size.exact': '精確輸入', 'size.len': '基地長', 'size.wid': '基地寬',
  'size.pods': 'DSX POD', 'size.pods.v': '{n} 個（{racks} 櫃）', 'size.it': 'IT 銘牌', 'size.base': '基地', 'size.area': '面積', 'size.blocks': '區塊',
  'size.blocks.v': '{n} 個（每塊 56 POD ≈ 53 MW）', 'size.single': '單一陣列',
  'cool.name.dry_only': '純乾冷卻器', 'cool.name.dry_plus_chiller': '乾冷卻器＋冰水機', 'cool.name.evaporative': '蒸發式',
  'unit.hint': '一個 DSX POD 貨櫃：南牆打開看內部（依 NVIDIA 官方剖面圖排列）。點機櫃、CDU、滅火系統、供回水主管看說明。',
  'unit.inside': '貨櫃內部（剖面）', 'unit.inside.s': '配電盤＋滅火鋼瓶｜3 櫃＋列間 CDU＋4 櫃', 'unit.cool': '疊放散熱模組', 'unit.cool.s': '容量以 Vertiv MCV430 計（N+1）',
  'unit.official': '官方數字：28,500 kg、約 1,000 萬個零件、25 exaFLOPS、17 km 網路線。貨櫃內排列依官方剖面圖；機櫃規格以 GB300 代理 Vera Rubin NVL72。',
  'unit.racks': '機櫃', 'unit.racks.v': '{n} 櫃 Vera Rubin NVL72・<span class="nw">{gpus} GPU</span>', 'unit.compute': '算力', 'unit.compute.v': '{pf} PFLOPS（NVFP4 推論）',
  'unit.it': 'IT 銘牌（代理）', 'unit.it.v': '{mw} MW（GB300 每櫃 136 kW）', 'unit.cdu': 'CDU', 'unit.cdu.v': 'Vertiv XDU2300・2.3 MW・列間',
  'unit.mod': '散熱模組', 'unit.mod.v': '3 × Vertiv MCV430（2 運轉＋1 備援）', 'unit.box': '貨櫃', 'unit.box.v': 'ISO 40 ft 高櫃・<span class="nw">12.19 × 2.44 × 2.90 m</span>', 'unit.weight': '重量（官方）',
  'quality': '畫質', 'quality.high': '高', 'quality.lite': '輕量', 'quality.high.hint': '陰影、天空光、完整植被', 'quality.lite.hint': '無陰影、簡化材質與植被',
  'quality.auto': '畫面約 {fps} fps，已自動切到輕量畫質',
  'tab.sum': '摘要', 'tab.energy': '能耗', 'tab.cmp': '比較', 'tab.clim': '氣候', 'strip.water': '用水／年', 'strip.compute': '算力',
  'kpi.compute': 'NVFP4 推論算力・<span class="nw">{gpus} 顆 Vera Rubin GPU</span>', 'kpi.compute.t': '訓練 {pfT} PFLOPS；每櫃 NVFP4 推論 3,600 PFLOPS（effective 值）',
  'kpi.pue': 'PUE（20 年平均）', 'kpi.ok': '全年可滿載', 'kpi.gap': '⚠ 排熱缺口 <span class="nw">{h} h／年</span>',
  'kpi.ok.t': '全年每小時都排得掉熱，PUE 代表真實滿載運轉', 'kpi.gap.t': '每年約 {h} 小時（最壞年 {hmax} h）排不掉熱，那些小時機櫃必須降載，PUE 沒反映這個代價',
  'kpi.energy': '設施耗電／年（不含 IT）', 'kpi.rise': '進風溫升', 'kpi.rise.t': '再循環 {r} K＋園區熱島 {i} K（風 3 m/s）',
  'note.layout': '<span class="nw">{pods} 個 DSX POD</span>（{racks} 櫃）・<span class="nw">IT 銘牌 {mw} MW</span>・<span class="nw">基地 {l} × {w} m</span>（{ha} ha）{blocks}',
  'note.layout.gadu': '<span class="nw">{pods} 個 GADU 單元</span>（{model}，{racks} 櫃）・<span class="nw">IT 銘牌 {mw} MW</span>・<span class="nw">基地 {l} × {w} m</span>（{ha} ha）{blocks}',
  'note.blocks': '・{n} 個區塊',
  'note.warn': '<b class="warn">⚠ 這個 PUE 不能單獨看</b>：每年約 {h} 小時（最壞年 {hmax} h）外氣太熱，乾冷卻器無法把水冷到 {sup} 供水溫度。模型在那些小時仍照算耗電，但實際上機櫃得降載或停機，所以 PUE 偏樂觀。要全年滿載，改用「乾冷卻器＋冰水機」或「蒸發式」（比較分頁有對照）。',
  'note.more': '資料來源與限制',
  'note.rubin': '算力用 Vera Rubin NVL72 公開規格（每櫃 NVFP4 推論 3,600 PFLOPS，為 effective 值；訓練 2,500 PFLOPS）；能耗用 GB300 每櫃 136 kW 代理（Vera Rubin 約 190–230 kW），正式數字公開後一起換。',
  'note.screen': '結果為篩選等級：逐時穩態模型＋經驗再循環與熱島，20 年（2005–2024，ERA5）逐時氣象。',
  'energy.year.hint': '每年 PUE（2005–2024）。年際差遠小於場址與散熱策略的差。', 'energy.mix.hint': '一年的設施耗電組成（不含 IT）。',
  'mix.dry_cooler_mwh': '乾冷卻器風扇', 'mix.pumps_mwh': '泵', 'mix.chiller_mwh': '冰水機', 'mix.air_fan_mwh': '氣側風扇', 'mix.air_dx_mwh': '氣側機械冷卻', 'mix.ups_loss_mwh': 'UPS 與配電損失',
  'mix.axis': 'MWh／年', 'mix.tip': ' {v} MWh／年',
  'cmp.hint': '純乾冷卻器與加輔助冰水機的比較（同場址、同規模、45 °C 供水）。系統選 20 年內 0 小時排不掉熱、且設備最少的方案（★）。',
  'cmp.strategy': '策略', 'cmp.unmet': '排不掉熱 h', 'cmp.chiller': '冰水機 MWh', 'cmp.water': '用水 m³',
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
  'load.cooler': 'Loading cooling module model…', 'load.skid': 'Loading 800 VDC power center model…', 'load.chiller': 'Loading chiller model…',
  // ---- product switch / GADU
  'anim': 'Motion', 'anim.on': 'On', 'anim.off': 'Off', 'anim.t': 'Heat plumes above the coolers, status lights and substation obstruction lights (an overlay above the 3D view; the 3D scene is not redrawn continuously)',
  // ---- IA redesign: automatic cooling, dashboard
  'unit.coolLabel': 'Cooling (set automatically from climate and scale)',
  'auto.dry': '<b>Dry coolers only</b>: at this site and scale, 20 years of hourly data show heat is rejected every hour. No chiller needed; zero water.',
  'auto.chiller': '<b>Dry coolers + trim chiller</b>: dry coolers alone would miss about <span class="nw">{h} h</span> a year on average and <span class="nw">{hmax} h</span> in the worst year, so a trim chiller covers the hot hours (about <span class="nw">{mwh} MWh</span> a year).',
  'auto.rule': 'Rule: an option counts only with zero unmet hours over 20 years; supply is fixed at 45 °C (DSX spec).',
  'dash.title': 'Dashboard', 'dash.total': 'Total', 'dash.perEF': 'Per EF', 'dash.more': 'Details',
  'dash.power': 'Power', 'dash.water': 'Water/yr', 'dash.land': 'Land', 'dash.cost': 'Capex',
  'dash.power.t': 'Facility power = IT nameplate × PUE (20-year mean)', 'dash.water.t': 'Cooling water per year', 'dash.land.t': 'Site area (incl. setbacks, roads, substations)',
  'dash.cost.soon': 'Capex model in progress: racks, equipment and materials; excludes land and construction labor',
  'dash.status': 'PUE {pue} · {cool} · {sup}', 'dash.gap': '⚠ About {h} h a year of unmet heat rejection; PUE is optimistic',
  'dash.landuse': 'Land: array uses {used} ha of the {given} ha site',
  'strip.power': 'Power', 'strip.land': 'Land', 'strip.cost': 'Capex', 'kpi.it': 'IT nameplate',
  'product.label': 'Product', 'cool.name.chilled_water': 'In-row cooling + air-cooled chillers',
  'note.warn.gadu': '<b class="warn">⚠ Do not read this PUE on its own</b>: for about {h} h a year (worst year {hmax} h) the ambient is so hot that the derated chiller capacity falls short (rated at 1.2 × design heat at 35 °C, −2% per K above). The model still counts the energy, but the racks would have to throttle. Larger chillers or a cooler site would close the gap.',
  'gadu.cool.note': 'GADU cooling is a fixed configuration: in-row CDUs / in-row coolers on a chilled-water loop with packaged air-cooled chillers. Chilled-water temperature follows the rack SKU (DLC 25 °C, air-cooled 15 °C).',
  'size.units': 'GADU units', 'grid.missing': 'The results table for this product has not been computed yet (python -m dsxpod.precompute --product gadu).',
  'unit.hint.gadu': 'One GADU unit: IT container (south wall opened) + power skid at the east end + air-cooled chillers on the north side. The row is CDU, compute racks with in-row coolers between them, network / management racks, CDU. Click equipment for details.',
  'unit.inside.s.gadu': 'CDU | compute racks + in-row coolers | network racks | CDU', 'unit.cool.gadu': 'Air-cooled chillers', 'unit.cool.gadu.s': '1–2 per unit, serving the in-row CDU / cooler chilled-water loop',
  'unit.skidview.gadu': 'Power skid', 'unit.skidview.gadu.s': 'MV transformer + UPS + LV distribution (AC)',
  'unit.official.gadu': 'Figures from the GIGABYTE GADU spec table (Oct 2026): rack power = (IT MW − network racks × 15 kW) / compute racks; chiller and in-row cooler sizes and COP are generic-equipment assumptions.',
  'unit.g.racks.v': '{c} compute racks {model} + {n} network / management racks ({u}U) · <span class="nw">{gpus} GPUs</span>', 'unit.g.it.v': '{mw} MW (spec table)',
  'unit.g.cool': 'Cooling', 'unit.g.cool.v': '{cdu} in-row CDUs (N+1) + {irc} in-row coolers (N+1) + {ch} air-cooled chiller(s) · CHW {chw} °C',
  'unit.g.power.v': '1 × power skid (AC)', 'unit.g.compute.v': '{pf} PFLOPS (NVFP4 inference; vendor conventions differ)',
  'kpi.compute.g': 'NVFP4 inference compute · <span class="nw">{gpus} GPUs</span> ({model})',
  'note.gadu': 'Compute and rack power come from the GIGABYTE GADU spec table; chiller COP uses a Carnot-efficiency method (η 0.45), in-row coolers and CHW pumps are ratio assumptions; no dry coolers, no water use.',
  'tip.pod.gadu': 'GADU unit {i}', 'tip.pod.gadu.d': '{model} · {racks} racks · in-row CDU / coolers + air-cooled chillers<br>position ({x}, {y}) m',
  'tip.skid.gadu': 'Power skid · unit {i}', 'tip.skid.gadu.d': 'MV transformer + UPS + LV distribution (<span class="nw">{kva} kVA</span>)<br>GIGABYTE GADU: preassembled, self-contained power unit',
  'tip.chiller': 'Air-cooled chiller · unit {i}', 'tip.chiller.d': 'CHW {chw} °C to the in-row CDUs / coolers; COP computed hourly from ambient and heat island<br>{n} per unit (spec table)',
  'part.rack.g': 'Compute rack {i}', 'part.rack.g.d': '{model} · {kw} kW · {cool}', 'part.net': 'Network / management rack {i}', 'part.net.d': 'Switches, management nodes, storage (15 kW assumed)',
  'part.irc': 'In-row cooler {i}', 'part.irc.d': 'Chilled-water coil + fans, removes the racks\' air-side heat (N+1)', 'part.header.g': 'Chilled water headers', 'part.header.g.d': 'In-row CDUs / coolers → air-cooled chillers on the north side',
  'part.cdu.g': 'CDU (in-row, N+1)', 'part.cdu.g.d': 'Vertiv XDU2300 spec proxy · rack liquid loop ↔ chilled-water loop',
  'tip.skid': '800 VDC power center · POD {i}', 'tip.skid.d': 'MV AC → 800 V DC, fed to the racks through a ground-level busway (<span class="nw">{kva} kVA</span>)<br>NVIDIA GTC: more power with 45% less copper. Conversion loss proxied by Vertiv APM2 efficiency',
  'unit.skidview': '800 VDC power center', 'unit.skidview.s': 'MV AC → 800 V DC, busway to the container', 'unit.skid': 'Power center', 'unit.skid.v': '800 VDC · 20 ft · busway to the container east end', 'load.build': 'Building scene (terrain, roads, substation)…', 'load.fail': 'Load failed: ', 'load.aria': 'Loading progress',
  'nav.menu': 'Settings menu', 'nav.aria': 'Settings', 'nav.site': '① Climate', 'nav.size': '③ Scale', 'nav.unit': '② Unit',
  'nav.collapse': 'Collapse settings panel', 'data.collapse': 'Collapse report panel', 'data.aria': 'Results', 'sheet.open': 'Open report',
  'site.hint': 'Pick a climate zone. Each card shows the monthly daily-high / daily-low band and the Köppen class.',
  'size.mw': 'Total power', 'size.site': 'Site footprint', 'size.itmw': 'IT nameplate', 'size.exact': 'Exact value', 'size.len': 'Site length', 'size.wid': 'Site width',
  'size.pods': 'DSX PODs', 'size.pods.v': '{n} ({racks} racks)', 'size.it': 'IT nameplate', 'size.base': 'Site', 'size.area': 'Area', 'size.blocks': 'Blocks',
  'size.blocks.v': '{n} (56 PODs ≈ 53 MW each)', 'size.single': 'Single array',
  'cool.name.dry_only': 'Dry coolers only', 'cool.name.dry_plus_chiller': 'Dry coolers + chiller', 'cool.name.evaporative': 'Evaporative',
  'unit.hint': 'One DSX POD container with the south wall opened (laid out after the NVIDIA cutaway). Click racks, the CDU, fire suppression or the water headers for details.',
  'unit.inside': 'Container interior (cutaway)', 'unit.inside.s': 'Switchboard + fire cylinders | 3 racks + in-row CDU + 4 racks', 'unit.cool': 'Stacked cooling modules', 'unit.cool.s': 'Capacity per Vertiv MCV430 (N+1)',
  'unit.official': 'Official figures: 28,500 kg, about 10 million parts, 25 exaFLOPS, 17 km of network cable. Interior layout follows the official cutaway; rack specs use GB300 as a proxy for Vera Rubin NVL72.',
  'unit.racks': 'Racks', 'unit.racks.v': '{n} × Vera Rubin NVL72 · <span class="nw">{gpus} GPUs</span>', 'unit.compute': 'Compute', 'unit.compute.v': '<span class="nw">{pf} PFLOPS</span> NVFP4 inference',
  'unit.it': 'IT nameplate (proxy)', 'unit.it.v': '<span class="nw">{mw} MW</span> (GB300, <span class="nw">136 kW/rack</span>)', 'unit.cdu': 'CDU', 'unit.cdu.v': 'Vertiv XDU2300 · <span class="nw">2.3 MW</span> · in-row',
  'unit.mod': 'Cooling modules', 'unit.mod.v': '3 × Vertiv MCV430 <span class="nw">(2 duty + 1 standby)</span>', 'unit.box': 'Container', 'unit.box.v': 'ISO 40 ft high cube <span class="nw">12.19 × 2.44 × 2.90 m</span>', 'unit.weight': 'Weight (official)',
  'quality': 'Quality', 'quality.high': 'High', 'quality.lite': 'Lite', 'quality.high.hint': 'Shadows, sky light, full vegetation', 'quality.lite.hint': 'No shadows, simplified materials and vegetation',
  'quality.auto': 'About {fps} fps; switched to Lite automatically',
  'tab.sum': 'Summary', 'tab.energy': 'Energy', 'tab.cmp': 'Compare', 'tab.clim': 'Climate', 'strip.water': 'Water/yr', 'strip.compute': 'Compute',
  'kpi.compute': 'NVFP4 inference compute · <span class="nw">{gpus} Vera Rubin GPUs</span>', 'kpi.compute.t': 'Training {pfT} PFLOPS; 3,600 PFLOPS NVFP4 inference per rack (effective)',
  'kpi.pue': 'PUE (20-year mean)', 'kpi.ok': 'Full load all year', 'kpi.gap': '⚠ Unmet <span class="nw">{h} h/yr</span>',
  'kpi.ok.t': 'Heat is rejected every hour of the year, so PUE reflects true full-load operation', 'kpi.gap.t': 'About {h} hours a year (worst year {hmax} h) cannot reject heat; racks must throttle in those hours and PUE does not reflect that',
  'kpi.energy': 'Facility energy/yr (excl. IT)', 'kpi.rise': 'Inlet air temperature rise', 'kpi.rise.t': 'Recirculation {r} K + campus heat island {i} K (3 m/s wind)',
  'note.layout': '<span class="nw">{pods} DSX PODs</span> ({racks} racks) · <span class="nw">IT nameplate {mw} MW</span> · <span class="nw">site {l} × {w} m</span> ({ha} ha){blocks}',
  'note.layout.gadu': '<span class="nw">{pods} GADU units</span> ({model}, {racks} racks) · <span class="nw">IT nameplate {mw} MW</span> · <span class="nw">site {l} × {w} m</span> ({ha} ha){blocks}',
  'note.blocks': ' · {n} blocks',
  'note.warn': '<b class="warn">⚠ Do not read this PUE on its own</b>: for about {h} h a year (worst year {hmax} h) the outdoor air is too hot for dry coolers to reach the {sup} supply temperature. The model still counts energy in those hours, but racks would have to throttle or stop, so PUE is optimistic. For full load all year, use "Dry coolers + chiller" or "Evaporative" (see the Compare tab).',
  'note.more': 'Sources and limitations',
  'note.rubin': 'Compute uses public Vera Rubin NVL72 figures (3,600 PFLOPS NVFP4 inference per rack, effective; 2,500 PFLOPS training). Energy uses GB300 at 136 kW per rack as a proxy (Vera Rubin is about 190–230 kW); both will be replaced together once official numbers are published.',
  'note.screen': 'Screening-grade result: hourly steady-state model plus empirical recirculation and heat island, driven by 20 years (2005–2024, ERA5) of hourly weather.',
  'energy.year.hint': 'PUE by year (2005–2024). Year-to-year spread is far smaller than the spread between sites and cooling strategies.', 'energy.mix.hint': 'Facility energy breakdown for one year (excluding IT).',
  'mix.dry_cooler_mwh': 'Dry cooler fans', 'mix.pumps_mwh': 'Pumps', 'mix.chiller_mwh': 'Chiller', 'mix.air_fan_mwh': 'Air-side fans', 'mix.air_dx_mwh': 'Air-side DX cooling', 'mix.ups_loss_mwh': 'UPS and distribution losses',
  'mix.axis': 'MWh/yr', 'mix.tip': ' {v} MWh/yr',
  'cmp.hint': 'Dry coolers only vs. with a trim chiller (same site, scale and 45 °C supply). The tool picks the option with zero unmet hours over 20 years and the least equipment (★).',
  'cmp.strategy': 'Strategy', 'cmp.unmet': 'Unmet h', 'cmp.chiller': 'Chiller MWh', 'cmp.water': 'Water m³',
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
