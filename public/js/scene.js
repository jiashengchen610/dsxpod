// three.js 場景：DSX POD 陣列 + 依氣候帶的基地環境。
// 所有 POD 共用幾何，用 InstancedMesh 畫（draw call 數與 POD 數無關）；遠景切成方塊（LOD）。
// 座標：USD 是 Z-up（x 長邊、y 短邊）；GLB 已是 Y-up：(x, y, z)_usd → (x, z, −y)_three。POD 角點 (px, py) → three (px, 0, −py)。
// 環境（天空、地面、植被、遠山）只是視覺脈絡，不進能耗模型；能耗只看氣象資料。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FxLayer } from './fx.js';
import { FpsGate } from './perf.js';

const L = 12.192, W = 2.438, CH = 2.896, MH = 3.2;            // 貨櫃長寬高、散熱模組高
const SETBACK = 10;                                             // 與 sizing 一致：佈局原點在退縮線內 10 m
const ROAD_Z = SETBACK - 5;                                     // 服務道路中心（three z）= USD y −5：退縮帶內、變電站正門前
const SVC_W = 6, PUB_W = 8, GATE = 4.5;                         // 廠內道路寬、廠外公路寬、大門半寬
const ROAD_LEN = 6000;                                          // 廠外公路往東西兩側各延伸到霧裡
const PUB_Z = SETBACK + 9;                                      // 廠外公路中心（three z）：南側圍籬外 9 m
// 貨櫃內排列：與 dsxpod/usd_out.INTERIOR 一致（照 NVIDIA DSX POD 官方剖面圖：配電盤 + 滅火鋼瓶 | 3 櫃 + 列間 CDU + 4 櫃）
const INTERIOR = { panel_x: 0.15, panel: [0.6, 0.45, 2.0], bottles_x: [0.98, 1.38], bottle_r: 0.17, bottle_h: 1.5,
  rack_x: [1.8, 2.4, 3.0, 4.95, 5.55, 6.15, 6.75], cdu_x: 3.65, cdu: [1.2, 1.2, 2.4], fire_pipe: { y: 1.3, z: 2.7, r: 0.05 }, headers: { y: [1.85, 2.15], z: 2.45, r: 0.12 } };
const WALL_T = 0.04, FLOOR_Z = 0.10;
const RACKS = INTERIOR.rack_x.map(x => [x, WALL_T + 0.02]);
const SKID_L = 6.058, SKID_H = 2.591, SKID_GAP = 1.5;              // 每個 POD 東端的 20 ft 電力模組（與 sizing / usd_out 一致）
const STILL_MS = 350;                                            // 停下多久後補畫高解析度定格畫面
const BASE_Y = 0.15;                                            // 貨櫃坐在 15 cm 混凝土墩上（也避免和地面基座搶深度而閃爍）
const DETAIL_DIST = 260;                                        // 高畫質：鏡頭距離 > 這個 → 色塊
const ALWAYS_DETAIL = 56;
const FAR_DIST = 900, FAR_MIN_PODS = 120;                         // 遠景：鏡頭 > 900 m 且單元 > 120 個 → 每排合成一根長條（3 m 間隙在這距離不到 1 像素）                                       // 高畫質：POD 數不超過這個時，不論遠近都畫細節模型
// 輕量畫質一律用色塊（白色貨櫃 + 綠色腰帶 + 灰色散熱模組 + 深色風扇面），不畫降級後的細節模型
const ACCENT = 0x76b900;
const subScale = s => Math.max(0.4, Math.min(1, s.l / 40));     // 小陣列：變電站等比縮小（接近箱式變電站的量體）
// 地面疊層（鋪面、基座、道路、路肩、地界）：幾公分的高差在遠景分不出深度 → 一閃一閃（z-fighting）。
// 用 polygonOffset 固定上下順序（layer 越大越上面），再配合相機近平面隨距離調整（start() 裡）。
const flat = (mat, layer) => Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 4 });

// 六個場址的地景（依柯本氣候：Cfa 桃園、Af 柔佛、BWh 鳳凰城、Cfa 達拉斯、Cfb 都柏林、Dfb 奧斯陸）
export const ENV = {
  taoyuan: { label: '亞熱帶濕潤（Cfa）：水田、竹林與闊葉樹', ground: ['#5f7c3b', '#6f8d45', '#4e6a31', '#7f8c55'], veg: 'broad', density: 0.9, hill: '#4f6b45', hillH: 1.0, turbidity: 8, rayleigh: 2.2, fog: '#c3cdd0', paddy: true },
  johor:   { label: '熱帶雨林（Af）：油棕園與草地', ground: ['#4c7438', '#587f40', '#41682f', '#6a8448'], veg: 'palm', density: 1.4, hill: '#355f30', hillH: 0.7, turbidity: 10, rayleigh: 2.6, fog: '#c9d5d3' },
  phoenix: { label: '熱沙漠（BWh）：礫石地、灌木與仙人掌', ground: ['#c8a376', '#b99368', '#d6b68d', '#a7855f'], veg: 'desert', density: 0.7, hill: '#9c6c4c', hillH: 2.4, turbidity: 3, rayleigh: 1.0, fog: '#e2d3ba' },
  dallas:  { label: '濕潤亞熱帶草原（Cfa）：牧草地與零星橡樹', ground: ['#8d9455', '#7f8949', '#a19f63', '#77834a'], veg: 'broad', density: 0.3, hill: null, hillH: 0, turbidity: 5, rayleigh: 1.6, fog: '#d3d7cf' },
  dublin:  { label: '溫帶海洋性（Cfb）：牧場與樹籬', ground: ['#557f3f', '#618b48', '#4b7338', '#6d9150'], veg: 'hedge', density: 0.6, hill: '#4c7a3e', hillH: 0.6, turbidity: 7, rayleigh: 3.0, fog: '#c7ced4' },
  oslo:    { snow: 0.3, label: '冷溫帶大陸性（Dfb）：針葉林與林間空地', ground: ['#5d6c46', '#6b7a52', '#4e5d3c', '#7b805d'], veg: 'conifer', density: 1.7, hill: '#34472f', hillH: 1.3, turbidity: 4, rayleigh: 1.8, fog: '#cad2d7' },
};

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clump = (x, z, s = 1) => 0.5 + 0.5 * Math.sin(x / (97 * s) + Math.sin(z / (131 * s)) * 2.1) * Math.cos(z / (83 * s) + Math.cos(x / (151 * s)) * 1.7);

// 可無縫重複的雜訊貼圖（地面、礫石）
function noiseTex(colors, { size = 512, blobs = 900, rMin = 8, rMax = 60, speck = 7000, seed = 7, rows = 0, snow = 0 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); const r = rng(seed);
  g.fillStyle = colors[0]; g.fillRect(0, 0, size, size);
  if (rows) {                                                   // 水田 / 作物列
    for (let y = 0; y < size; y += size / rows) { g.globalAlpha = 0.18; g.fillStyle = colors[2]; g.fillRect(0, y, size, size / rows * 0.35); }
  }
  for (let i = 0; i < blobs; i++) {
    const x = r() * size, y = r() * size, rad = rMin + r() * (rMax - rMin);
    g.globalAlpha = 0.06 + r() * 0.16; g.fillStyle = colors[1 + Math.floor(r() * (colors.length - 1))];
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill(); }
  }
  for (let i = 0; i < speck; i++) { g.globalAlpha = 0.25; g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.fillRect(r() * size, r() * size, 1 + r() * 1.5, 1 + r() * 1.5); }
  for (let i = 0; i < snow * 200; i++) {                          // 殘雪：成群的柔邊白塊（春分前後的奧斯陸）
    const x = r() * size, y = r() * size, rad = 4 + r() * r() * 46;   // 多數是小塊，少數大塊，減少重複感
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); gr.addColorStop(0, 'rgba(238,241,244,0.75)'); gr.addColorStop(0.55, 'rgba(230,234,238,0.45)'); gr.addColorStop(1, 'rgba(232,236,240,0)');
      g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function label(text, { bg = 'rgba(14,15,16,.82)', fg = '#fff', accent = '#76b900' } = {}) {
  const c = document.createElement('canvas'); const g = c.getContext('2d'); const fs = 44;
  g.font = `600 ${fs}px system-ui, "Noto Sans TC", sans-serif`; const w = Math.ceil(g.measureText(text).width) + 40; c.width = w; c.height = fs + 28;
  g.font = `600 ${fs}px system-ui, "Noto Sans TC", sans-serif`; g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, c.height, 14); g.fill();
  g.fillStyle = accent; g.fillRect(0, 0, 8, c.height); g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, 22, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.userData.aspect = w / c.height; s.renderOrder = 10; return s;
}

// 廠外柏油路貼圖：沿長度 24 m 一格，白色邊線 + 黃色虛線中線
function asphaltTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d'); const r = rng(5);
  g.fillStyle = '#3b3d3f'; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 9000; i++) { g.globalAlpha = 0.18; g.fillStyle = r() < 0.5 ? '#2a2b2c' : '#55585a'; g.fillRect(r() * 512, r() * 128, 1.5, 1.5); }
  g.globalAlpha = 0.9; g.fillStyle = '#e8e8e2'; g.fillRect(0, 6, 512, 4); g.fillRect(0, 118, 512, 4);
  g.fillStyle = '#e2b53a'; g.fillRect(0, 61, 128, 6); g.fillRect(256, 61, 128, 6);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, h, x, y, z, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z);

// 變電站樣板（一個區塊一座）：礫石場、圍籬、兩台主變壓器（散熱片、套管、儲油櫃）、門型鋼構、開關室。
// 原點在變電帶角落，x 沿區塊長邊 0..40 m，z 由 0 往 −16（= USD y 由 s.y 往 s.y+16）。
function substationTemplate() {
  const P = { gravel: [], concrete: [], steel: [], tx: [], fin: [], bushing: [], fence: [], house: [], roof: [], dark: [] };
  P.gravel.push(box(27, 0.12, 14, 13.5, 0.06, -8));
  // 圍籬：柱 + 網
  const fx0 = 0, fx1 = 27, fz0 = -1, fz1 = -15;
  for (let x = fx0; x <= fx1 + 0.01; x += 3) { P.steel.push(cyl(0.05, 2.5, x, 1.25, fz0, 6)); P.steel.push(cyl(0.05, 2.5, x, 1.25, fz1, 6)); }
  for (let z = fz1; z <= fz0 + 0.01; z += 3.5) { P.steel.push(cyl(0.05, 2.5, fx0, 1.25, z, 6)); P.steel.push(cyl(0.05, 2.5, fx1, 1.25, z, 6)); }
  P.fence.push(box(fx1 - fx0, 2.3, 0.03, (fx0 + fx1) / 2, 1.2, fz0), box(fx1 - fx0, 2.3, 0.03, (fx0 + fx1) / 2, 1.2, fz1),
               box(0.03, 2.3, fz0 - fz1, fx0, 1.2, (fz0 + fz1) / 2), box(0.03, 2.3, fz0 - fz1, fx1, 1.2, (fz0 + fz1) / 2));
  // 主變壓器 × 2
  for (const cx of [8, 19]) {
    const cz = -8;
    P.concrete.push(box(6, 0.35, 4.6, cx, 0.17, cz));
    P.tx.push(box(4.2, 3.0, 2.6, cx, 0.35 + 1.5, cz));
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) P.fin.push(box(0.1, 2.4, 1.0, cx - 1.8 + i * 0.6, 0.35 + 1.4, cz + s * (1.3 + 0.5)));
    P.tx.push(new THREE.CylinderGeometry(0.38, 0.38, 2.4, 14).rotateZ(Math.PI / 2).translate(cx - 0.6, 4.25, cz + 0.9));
    P.steel.push(box(0.12, 0.5, 0.12, cx - 1.5, 3.6, cz + 0.9), box(0.12, 0.5, 0.12, cx + 0.3, 3.6, cz + 0.9));
    for (let i = 0; i < 3; i++) { P.bushing.push(cyl(0.13, 1.3, cx - 1.2 + i * 1.2, 3.35 + 0.65, cz - 0.4, 8)); P.bushing.push(cyl(0.08, 0.6, cx - 1.0 + i * 1.0, 3.35 + 0.3, cz + 0.5, 8)); }
  }
  // 門型鋼構（進線）
  for (const gx of [2.5, 24.5]) {
    P.steel.push(box(0.35, 9, 0.35, gx, 4.5, -3), box(0.35, 9, 0.35, gx, 4.5, -13), box(0.35, 0.5, 10.4, gx, 8.8, -8));
    for (let i = 0; i < 3; i++) P.bushing.push(cyl(0.07, 0.9, gx, 8.1, -5.5 - i * 2.5, 6));
  }
  // 開關室（e-house）
  P.concrete.push(box(13, 0.3, 7, 34, 0.15, -8));
  P.house.push(box(12, 3.8, 6, 34, 0.3 + 1.9, -8));
  P.roof.push(box(12.5, 0.25, 6.5, 34, 4.25, -8));
  for (const dx of [-3.5, 3.5]) P.dark.push(box(1.3, 2.4, 0.06, 34 + dx, 1.5, -4.97));
  for (let i = 0; i < 4; i++) P.dark.push(box(1.1, 0.6, 0.06, 34 - 1.8 + i * 1.2, 3.0, -4.97));
  P.steel.push(box(1.2, 0.7, 0.9, 31.5, 4.75, -9), box(1.2, 0.7, 0.9, 36.5, 4.75, -9));
  P.concrete.push(box(1.0, 0.16, 9, 34, 0.08, -15.5));          // 電纜溝蓋板往區塊（加厚，和區塊基座拉開高差）
  const M = {
    gravel: flat(new THREE.MeshStandardMaterial({ color: 0x9c9d97, roughness: 1 }), 7),          // 變電站地面部件排在鋪面（1）、基座（3）、地界（6）之上，避免遠景閃爍
    concrete: flat(new THREE.MeshStandardMaterial({ color: 0xb4b5ae, roughness: 0.9 }), 8),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.45, metalness: 0.7 }),
    tx: new THREE.MeshStandardMaterial({ color: 0x8a948f, roughness: 0.5, metalness: 0.45 }),
    fin: new THREE.MeshStandardMaterial({ color: 0x7c8681, roughness: 0.55, metalness: 0.45 }),
    bushing: new THREE.MeshStandardMaterial({ color: 0x7a4126, roughness: 0.35 }),
    fence: new THREE.MeshStandardMaterial({ color: 0xc4c9cc, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.22, depthWrite: false }),
    house: new THREE.MeshStandardMaterial({ color: 0xe3e5e0, roughness: 0.6, metalness: 0.1 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x5f6468, roughness: 0.7, metalness: 0.3 }),
    dark: flat(new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.6, metalness: 0.3 }), 2),
  };
  return Object.entries(P).map(([k, geos]) => ({ geo: mergeGeometries(geos), mat: M[k], shadow: k !== 'fence' && k !== 'gravel' }));
}

// 植被樣板：每種是若干部件（幾何、材質、是否吃 instanceColor），單位大小，實例縮放
function vegKinds(veg, low = false) {   // low：遠處用的低面數版本（樹冠面數約 1/4）
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true, ...o });
  const trunk = std(0x5a4632);
  const leaf = std(0xffffff);                                    // 顏色由 instanceColor 給
  const K = {};
  K.broad = [{ geo: cyl(0.22, 3.2, 0, 1.6, 0, low ? 4 : 6), mat: trunk }, { geo: new THREE.IcosahedronGeometry(2.6, low ? 0 : 1).scale(1, 0.85, 1).translate(0, 4.6, 0), mat: leaf, tint: true }];
  K.conifer = [{ geo: cyl(0.18, 2, 0, 1, 0, low ? 4 : 5), mat: trunk },
               { geo: low ? new THREE.ConeGeometry(2.0, 8.5, 5).translate(0, 5.5, 0) : mergeGeometries([new THREE.ConeGeometry(2.0, 5.5, 7).translate(0, 4.3, 0), new THREE.ConeGeometry(1.4, 4, 7).translate(0, 7.2, 0)]), mat: leaf, tint: true }];
  const fr = low ? 4 : 7;
  K.palm = [{ geo: new THREE.CylinderGeometry(0.16, 0.24, 7, low ? 4 : 6).translate(0, 3.5, 0), mat: std(0x6e5b44) },
            { geo: mergeGeometries(Array.from({ length: fr }, (_, i) => new THREE.ConeGeometry(0.55, 3.6, low ? 3 : 4).rotateZ(Math.PI / 2 + 0.35).translate(1.6, 7, 0).rotateY(i / fr * Math.PI * 2))), mat: leaf, tint: true }];
  K.shrub = [{ geo: new THREE.IcosahedronGeometry(0.9, 0).scale(1.2, 0.6, 1.2).translate(0, 0.45, 0), mat: leaf, tint: true }];
  K.cactus = [{ geo: mergeGeometries([cyl(0.28, 5, 0, 2.5, 0, 8), cyl(0.18, 1.6, 0.7, 3.2, 0, 6), box(0.7, 0.3, 0.3, 0.35, 2.5, 0), cyl(0.16, 1.2, -0.6, 3.4, 0, 6), box(0.6, 0.3, 0.3, -0.3, 2.9, 0)]), mat: std(0x5d7a45) }];
  K.rock = [{ geo: new THREE.DodecahedronGeometry(1, 0).scale(1.3, 0.6, 1).translate(0, 0.3, 0), mat: std(0x8c6d55) }];
  K.hedge = [{ geo: box(1, 2.2, 1, 0, 1.1, 0), mat: leaf, tint: true }];
  K.bamboo = [{ geo: mergeGeometries(Array.from({ length: 6 }, (_, i) => new THREE.CylinderGeometry(0.05, 0.07, 8, 4).rotateZ(0.08 * Math.cos(i)).translate(Math.cos(i * 2.3) * 0.6, 4, Math.sin(i * 2.3) * 0.6))), mat: std(0x7c9a4a) },
              { geo: new THREE.IcosahedronGeometry(1.6, 0).scale(1, 2.2, 1).translate(0, 6.5, 0), mat: leaf, tint: true }];
  return K;
}


// ---------------------------------------------------------------- 貨櫃內部（剖面用；照官方剖面圖：機櫃正面大量黃色網路線、列間 CDU 有螢幕、紅色消防）
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
let _rackTex, _cduTex, _panelTex;
function rackFrontTex() {
  return _rackTex ||= canvasTex(128, 512, (g, w, h) => {
    const r = rng(17);
    g.fillStyle = '#141518'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#23252a'; for (let y = 18; y < h - 18; y += 9) g.fillRect(8, y, w - 16, 6);             // 運算 / 交換托盤
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {                                                                          // 黃色網路線束（整座 17 km）
      const x = 22 + r() * (w - 44), y0 = 30 + r() * 60, y1 = h - 40 - r() * 60;
      g.strokeStyle = `rgba(${235 + r() * 20 | 0},${185 + r() * 40 | 0},${20 + r() * 30 | 0},${0.55 + r() * 0.4})`; g.lineWidth = 1.2 + r() * 1.6;
      g.beginPath(); g.moveTo(x, y0); g.bezierCurveTo(x + (r() - 0.5) * 30, y0 + 120, x + (r() - 0.5) * 30, y1 - 120, x + (r() - 0.5) * 8, y1); g.stroke();
    }
    for (let y = 22; y < h - 20; y += 18) { g.fillStyle = r() < 0.85 ? '#76b900' : '#3987e5'; g.fillRect(10, y, 3, 3); }   // 狀態燈
    g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, w, 12); g.fillRect(0, h - 14, w, 14);
  });
}
function cduFrontTex() {
  return _cduTex ||= canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#18191c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9fd2ff'; g.fillRect(w * 0.36, 60, w * 0.28, 44); g.fillStyle = '#0d2236'; g.fillRect(w * 0.38, 64, w * 0.24, 36);   // 觸控螢幕
    g.fillStyle = '#76b900'; g.fillRect(w * 0.4, 72, w * 0.1, 4); g.fillStyle = '#3987e5'; g.fillRect(w * 0.4, 82, w * 0.16, 4);
    g.fillStyle = '#26282d'; for (let y = 150; y < h - 30; y += 10) g.fillRect(24, y, w - 48, 5);           // 進風格柵
  });
}
function panelTex() {
  return _panelTex ||= canvasTex(128, 384, (g, w, h) => {
    g.fillStyle = '#d4d6d3'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9a9c99'; g.strokeRect(6, 6, w - 12, h - 12);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 4; c++) { g.fillStyle = '#2b2d30'; g.fillRect(18 + c * 24, 40 + r * 30, 16, 20); g.fillStyle = r % 3 ? '#e2e3e0' : '#d95926'; g.fillRect(22 + c * 24, 46 + r * 30, 8, 6); }
    g.fillStyle = '#d8382b'; g.fillRect(w - 30, 18, 14, 10);
  });
}
let _netTex, _ircTex;
function netFrontTex() {                                                          // 網路 / 管理櫃：交換器面板 + 少量藍 / 黃跳線
  return _netTex ||= canvasTex(128, 512, (g, w, h) => {
    const r = rng(29); g.fillStyle = '#17181b'; g.fillRect(0, 0, w, h);
    for (let y = 20; y < h - 20; y += 14) { g.fillStyle = y % 42 === 20 ? '#2b2e34' : '#202329'; g.fillRect(8, y, w - 16, 10); }
    for (let i = 0; i < 26; i++) { g.fillStyle = r() < 0.6 ? '#3987e5' : '#e2b53a'; g.globalAlpha = 0.8; const x = 14 + r() * (w - 28), y0 = 30 + r() * 200; g.fillRect(x, y0, 2, 60 + r() * 120); }
    g.globalAlpha = 1; for (let y = 24; y < h - 20; y += 42) { g.fillStyle = '#76b900'; g.fillRect(10, y, 3, 3); g.fillRect(16, y, 3, 3); }
  });
}
function ircFrontTex() {                                                          // 列間冷卻器：白色門板 + 水平格柵
  return _ircTex ||= canvasTex(64, 512, (g, w, h) => {
    g.fillStyle = '#e4e6e3'; g.fillRect(0, 0, w, h); g.fillStyle = '#9a9d9a';
    for (let y = 30; y < h - 30; y += 9) g.fillRect(8, y, w - 16, 4);
    g.fillStyle = '#3987e5'; g.fillRect(w / 2 - 3, 12, 6, 6);
  });
}
function buildInterior(quality, product = null, sku = null) {
  const G = new THREE.Group(); const Std = quality === 'high' ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial;
  const mat = (o) => { o = { ...o }; if (quality !== 'high') { delete o.metalness; delete o.roughness; } return new Std(o); };
  const own = (mesh, info) => { mesh.userData.own = true; mesh.castShadow = mesh.receiveShadow = true; if (info) mesh.userData.info = info; return mesh; };
  const box = (w, h, d, x, y, z, m, info) => own(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(x + w / 2, y + h / 2, z - d / 2), m), info);
  const yRow = WALL_T + 0.02;                                                     // 一排靠南牆（USD y）→ three z = -y
  if (product && product.cooling_mode === 'chilled_water' && sku && sku.row) {    // ---- GADU：CDU｜運算櫃夾列間冷卻器｜網路櫃｜CDU（products.py 的 row）
    const body = mat({ color: 0x1a1b1e, roughness: 0.55, metalness: 0.5 }), front = mat({ map: rackFrontTex(), roughness: 0.6, metalness: 0.2 });
    const nbody = mat({ color: 0x24262b, roughness: 0.55, metalness: 0.45 }), nfront = mat({ map: netFrontTex(), roughness: 0.6, metalness: 0.2 });
    const cduBody = mat({ color: 0x1d1e21, roughness: 0.5, metalness: 0.4 }), cduFront = mat({ map: cduFrontTex(), roughness: 0.5 });
    const ircBody = mat({ color: 0xdfe1de, roughness: 0.6, metalness: 0.15 }), ircFront = mat({ map: ircFrontTex(), roughness: 0.6 });
    const six = (b, f) => [b, b, b, b, f, b];
    let nr = 0, nn = 0, ni = 0, nc = 0;
    const cool = sku.liquid ? 'DLC' : 'air';
    for (const [kind, x, w] of sku.row) {
      if (kind === 'rack') { nr++; G.add(own(new THREE.Mesh(new THREE.BoxGeometry(w, 2.3, 1.2).translate(x + w / 2, FLOOR_Z + 1.15, -(yRow + 0.6)), six(body, front)),
        { key: 'part.rack.g', p: { i: nr, model: sku.name, kw: Math.round(sku.rack_kw), cool } })); }
      else if (kind === 'net') { nn++; G.add(own(new THREE.Mesh(new THREE.BoxGeometry(w, 2.3, 1.2).translate(x + w / 2, FLOOR_Z + 1.15, -(yRow + 0.6)), six(nbody, nfront)), { key: 'part.net', p: { i: nn } })); }
      else if (kind === 'irc') { ni++; G.add(own(new THREE.Mesh(new THREE.BoxGeometry(w, 2.0, 1.2).translate(x + w / 2, FLOOR_Z + 1.0, -(yRow + 0.6)), six(ircBody, ircFront)), { key: 'part.irc', p: { i: ni } })); }
      else if (kind === 'cdu') { nc++; G.add(own(new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, 1.2).translate(x + w / 2, FLOOR_Z + 1.2, -(yRow + 0.6)), six(cduBody, cduFront)), { key: 'part.cdu.g', p: { i: nc } })); }
    }
    const pipe = mat({ color: 0x6b6f75, roughness: 0.35, metalness: 0.8 }), hd = INTERIOR.headers;
    const hg = new THREE.Group(); hg.userData.info = { key: 'part.header.g', p: {} };
    hd.y.forEach(y => hg.add(own(new THREE.Mesh(new THREE.CylinderGeometry(hd.r, hd.r, L - 0.4, 16).rotateZ(Math.PI / 2).translate(L / 2, hd.z, -y), pipe))));
    G.add(hg);
    const glow = new THREE.MeshBasicMaterial({ color: 0xeef3ff });
    for (let x = 1.2; x < L - 1; x += 2.4) G.add(own(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.12).translate(x, CH - 0.08, -W * 0.45), glow)));
    return G;
  }
  // 機櫃：深色本體 + 正面貼圖
  const body = mat({ color: 0x1a1b1e, roughness: 0.55, metalness: 0.5 });
  const front = mat({ map: rackFrontTex(), roughness: 0.6, metalness: 0.2 });
  const rackMats = [body, body, body, body, front, body];                        // BoxGeometry 面順序 +x −x +y −y +z −z；正面朝南（three +z）
  INTERIOR.rack_x.forEach((x, i) => {
    const m = own(new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.3, 1.2).translate(x + 0.3, FLOOR_Z + 1.15, -(yRow + 0.6)), rackMats),
      { key: 'part.rack', p: { i: i + 1 }, name: `機櫃 ${i + 1}`, detail: 'Vera Rubin NVL72（GB300 規格代理）・72 GPU・NVFP4 推論 3,600 PFLOPS・液冷' });
    G.add(m);
  });
  // 列間 CDU
  const cduBody = mat({ color: 0x1d1e21, roughness: 0.5, metalness: 0.4 }), cduFront = mat({ map: cduFrontTex(), roughness: 0.5 });
  G.add(own(new THREE.Mesh(new THREE.BoxGeometry(...[INTERIOR.cdu[0], INTERIOR.cdu[2], INTERIOR.cdu[1]]).translate(INTERIOR.cdu_x + INTERIOR.cdu[0] / 2, FLOOR_Z + INTERIOR.cdu[2] / 2, -(yRow + INTERIOR.cdu[1] / 2)),
    [cduBody, cduBody, cduBody, cduBody, cduFront, cduBody]), { key: 'part.cdu', name: 'CDU（冷卻液分配單元）', detail: 'Vertiv XDU2300・2.3 MW・機櫃液冷迴路 ↔ 乾冷卻器水迴路' }));
  // 配電盤
  const [pw, pd, ph] = INTERIOR.panel;
  G.add(own(new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd).translate(INTERIOR.panel_x + pw / 2, FLOOR_Z + ph / 2, -(yRow + pd / 2)),
    [mat({ color: 0xc9cbc8 }), mat({ color: 0xc9cbc8 }), mat({ color: 0xc9cbc8 }), mat({ color: 0xc9cbc8 }), mat({ map: panelTex(), roughness: 0.5 }), mat({ color: 0xc9cbc8 })]),
    { key: 'part.pdu', name: '配電盤', detail: '貨櫃內配電（接園區變電站）' }));
  // 潔淨氣體滅火鋼瓶 + 天花板消防管與撒水頭
  const red = mat({ color: 0xc1140f, roughness: 0.35, metalness: 0.3 });
  const fs = new THREE.Group(); fs.userData.info = { key: 'part.fire', name: '潔淨氣體滅火系統', detail: '2 支鋼瓶 + 天花板消防管（依官方剖面圖）' };
  INTERIOR.bottles_x.forEach(x => {
    fs.add(own(new THREE.Mesh(new THREE.CylinderGeometry(INTERIOR.bottle_r, INTERIOR.bottle_r, INTERIOR.bottle_h, 20).translate(x, FLOOR_Z + INTERIOR.bottle_h / 2, -(WALL_T + 0.25)), red)));
    fs.add(own(new THREE.Mesh(new THREE.SphereGeometry(INTERIOR.bottle_r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, FLOOR_Z + INTERIOR.bottle_h, -(WALL_T + 0.25)), red)));
    fs.add(own(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, CH - FLOOR_Z - INTERIOR.bottle_h - 0.35, 8).translate(x, FLOOR_Z + INTERIOR.bottle_h + (CH - FLOOR_Z - INTERIOR.bottle_h - 0.35) / 2 + 0.1, -(WALL_T + 0.25)), red)));
  });
  const fp = INTERIOR.fire_pipe;
  fs.add(own(new THREE.Mesh(new THREE.CylinderGeometry(fp.r, fp.r, L - 0.6, 10).rotateZ(Math.PI / 2).translate(L / 2, fp.z, -fp.y), red)));
  for (let x = 1.0; x < L - 0.5; x += 1.5) fs.add(own(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.18, 8).translate(x, fp.z - 0.12, -fp.y), red)));
  G.add(fs);
  // 供回水主管（北側上方）
  const pipe = mat({ color: 0x6b6f75, roughness: 0.35, metalness: 0.8 }), hd = INTERIOR.headers;
  const hg = new THREE.Group(); hg.userData.info = { key: 'part.header', name: '供回水主管', detail: '機櫃液冷迴路 → CDU → 疊放乾冷卻器（TCS 45 °C 溫水）' };
  hd.y.forEach(y => hg.add(own(new THREE.Mesh(new THREE.CylinderGeometry(hd.r, hd.r, L - 0.4, 16).rotateZ(Math.PI / 2).translate(L / 2, hd.z, -y), pipe))));
  for (let x = 0.8; x < L - 0.4; x += 2.2) hd.y.forEach(y => hg.add(own(new THREE.Mesh(new THREE.CylinderGeometry(hd.r * 1.25, hd.r * 1.25, 0.06, 16).rotateZ(Math.PI / 2).translate(x, hd.z, -y), pipe))));   // 法蘭
  G.add(hg);
  // 天花板燈帶（只是外觀）
  const glow = new THREE.MeshBasicMaterial({ color: 0xeef3ff });
  for (let x = 1.2; x < L - 1; x += 2.4) G.add(own(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.12).translate(x, CH - 0.08, -W * 0.45), glow)));
  return G;
}

export class PodScene {
  // 畫質：high = 陰影、天空 shader + 環境光、PBR 材質、完整植被；lite（輕量）= 無陰影、純色天空、Lambert 材質、植被 1/3、像素密度 1、提早換方塊。
  // 兩種都「按需渲染」：鏡頭沒動、資料沒變就不重畫（手機省電、筆電不發燙）。
  constructor(canvas, { quality = 'high', autoDowngrade = false, labels = null } = {}) {
    this.labels = labels;                                          // 基地標籤文字（app.js 依語言給；null 用中文）
    this.canvas = canvas; this.quality = quality; this.autoDowngrade = autoDowngrade; this.dirty = true; this.onQualityChange = null;
    // 抗鋸齒一律開：輕量模式關掉 MSAA 時，遠處細小的貨櫃 / 圍籬 / 樹邊緣鋸齒在轉動時閃爍，看起來像顆粒；手機的分塊式 GPU 做 MSAA 幾乎不花成本。
    // （MSAA 只能在建立時決定，所以高畫質自動降到輕量時也要先開著）
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: quality === 'high' ? 'high-performance' : 'low-power' });
    r.setPixelRatio(this._dpr()); r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = quality === 'high'; r.shadowMap.type = THREE.PCFSoftShadowMap; r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = quality === 'high' ? 0.62 : 0.85;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xbfcad0); this.scene.fog = new THREE.Fog(0xbfcad0, 800, 4000);
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 9000);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.47;
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x4a4a3a, quality === 'high' ? 0.55 : 1.15); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff4e5, 3.2); sun.castShadow = quality === 'high'; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sky = new Sky(); this.sky.scale.setScalar(8000); this.sky.visible = quality === 'high'; this.scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    this.groundMat.vertexColors = true;
    const gg = new THREE.PlaneGeometry(10000, 10000, 250, 250); const gp = gg.attributes.position; const vc = new Float32Array(gp.count * 3); const gr = rng(21);
    for (let i = 0; i < gp.count; i++) {                         // 大尺度明暗變化，蓋掉貼圖重複感
      const x = gp.getX(i), y = gp.getY(i);
      const v = 0.8 + 0.22 * clump(x, y, 2.5) + 0.1 * clump(y + 300, x - 700, 0.7) + (gr() - 0.5) * 0.06;
      vc.set([v, v, v * 0.98], i * 3);
    }
    gg.setAttribute('color', new THREE.BufferAttribute(vc, 3));
    const g = new THREE.Mesh(gg, this.groundMat);
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; this.ground = g; this.scene.add(g);
    this.pads = new THREE.Group(); this.scene.add(this.pads);
    this.surround = new THREE.Group(); this.scene.add(this.surround);
    this.cap = 0; this.n = 0; this.sets = {}; this.vis = { shell: true, cooler: true, rack: false }; this.lod = 'detail';
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), ACCENT); this.highlight.visible = false; this.scene.add(this.highlight);
    this.subParts = substationTemplate(); this.subSets = []; this.subHit = null;
    this.gravelTex = noiseTex(['#8e8f89', '#7f807a', '#a0a19a', '#727470'], { blobs: 500, rMin: 2, rMax: 10, speck: 16000, seed: 3 });
    this.focusY = this.curFocusY = 0.5;                            // 目標點在畫面上的高度比例（0.5 = 正中）；手機設定面板打開時移到 0.25
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this._applyFocus(); r.setSize(innerWidth, innerHeight); this.dirty = true; });
    this.fx = new FxLayer(document.getElementById('fx')); this.fx.setLite(quality !== 'high');   // 熱氣 / 閃燈：DOM 疊層（見 fx.js）
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.addEventListener('start', () => { this.tween = null; });          // 使用者一拖動就交還控制
  }

  // 遠景方塊 / 機櫃材質：高畫質 PBR，輕量 Lambert（沒有環境光時 PBR 金屬感會發黑）
  _boxMat(kind) {
    this._boxMats ||= {
      high: { shell: new THREE.MeshStandardMaterial({ color: 0xdcdedb, roughness: 0.6, metalness: 0.15 }), cool: new THREE.MeshStandardMaterial({ color: 0x9a9fa5, roughness: 0.55, metalness: 0.35 }), rack: new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.5, metalness: 0.6 }),
              band: new THREE.MeshStandardMaterial({ color: 0x76b900, roughness: 0.6 }), deck: new THREE.MeshStandardMaterial({ color: 0x4a4e53, roughness: 0.7, metalness: 0.3 }),
              plinth: new THREE.MeshStandardMaterial({ color: 0xa9aaa3, roughness: 0.9 }), skid: new THREE.MeshStandardMaterial({ color: 0xd6d8d8, roughness: 0.55, metalness: 0.2 }), busway: new THREE.MeshStandardMaterial({ color: 0x1e2023, roughness: 0.7, metalness: 0.4 }),
              fan: flat(new THREE.MeshStandardMaterial({ color: 0x232528, roughness: 0.6, metalness: 0.3 }), 1), fanRing: flat(new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.5, metalness: 0.4 }), 2) },
      lite: { shell: new THREE.MeshLambertMaterial({ color: 0xe8eae7 }), cool: new THREE.MeshLambertMaterial({ color: 0xa3a8ae }), rack: new THREE.MeshLambertMaterial({ color: 0x2a2a2e }),
              band: new THREE.MeshLambertMaterial({ color: 0x76b900 }), deck: new THREE.MeshLambertMaterial({ color: 0x55595e }),
              plinth: new THREE.MeshLambertMaterial({ color: 0xb4b5ae }), skid: new THREE.MeshLambertMaterial({ color: 0xdcdedd }), busway: new THREE.MeshLambertMaterial({ color: 0x2a2c30 }),
              fan: flat(new THREE.MeshLambertMaterial({ color: 0x2c2e31 }), 1), fanRing: flat(new THREE.MeshLambertMaterial({ color: 0xc4c7ca }), 2) },
    };
    if (!this._boxBandSet && this.product) { const c = new THREE.Color(...(this.product.band_rgb || [0.46, 0.73, 0])); for (const q of ['high', 'lite']) this._boxMats[q].band.color.copy(c); this._boxBandSet = true; }   // 材質晚於 setProduct 建立時補上產品色帶
    return this._boxMats[this.quality][kind];
  }

  // 定格渲染：移動中（拖動、轉場、滑桿）用低解析度求流暢；停下 STILL_MS 後補畫一張高解析度的定格畫面（畫面不動時本來就不重畫，多畫一張很便宜）
  _dpr() { return Math.min(devicePixelRatio, 2); }                                                     // 定格
  _dprMotion() { return Math.min(devicePixelRatio, this.quality === 'high' ? 1.25 : 1); }           // 移動中

  // 執行中切換畫質（抗鋸齒在建立時決定，其餘都可即時切）
  setQuality(q, why = null) {
    if (q === this.quality) return;
    this.quality = q; const hi = q === 'high'; this.fx.setLite(!hi);
    this.renderer.setPixelRatio(this._dpr()); this.lowRes = false; this.renderer.shadowMap.enabled = hi; this.sun.castShadow = hi;
    this.sky.visible = hi; this.hemi.intensity = hi ? 0.55 : 1.15; this.renderer.toneMappingExposure = hi ? 0.62 : 0.85;   // 輕量沒有天空環境光 → 曝光拉高，色塊才乾淨
    if (hi && this.envDirty) this._bakeEnv();
    this.scene.environment = hi && this.envRT ? this.envRT.texture : null;
    for (const [k, parts] of [['shell', this.shellParts], ['cooler', this.coolerParts]]) (this.sets[k] || []).forEach((m, i) => { m.material = hi ? parts[i].mat : parts[i].lite; });
    (this.sets.skid || []).forEach((m, i) => { m.material = hi ? this.skidParts[i].mat : this.skidParts[i].lite; });
    (this.sets.chiller || []).forEach((m, i) => { m.material = hi ? this.chillerParts[i].mat : this.chillerParts[i].lite; });
    if (this.sets.boxChiller) ['cool', 'fan', 'fanRing'].forEach((k, i) => { this.sets.boxChiller[i].material = this._boxMat(k); });
    if (this.sets.boxSkid) this.sets.boxSkid[0].material = this._boxMat('skid');
    if (this.sets.boxShell) { this.sets.boxShell[0].material = this._boxMat('shell'); this.sets.boxCool[0].material = this._boxMat('cool'); this.sets.boxCool[1].material = this._boxMat('deck'); this.sets.boxCool[2].material = this._boxMat('fan'); this.sets.boxCool[3].material = this._boxMat('fanRing'); this.sets.boxBand[0].material = this._boxMat('band'); this.sets.rack[0].material = this._boxMat('rack'); }
    this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
    this._groundLook(); if (this.layout) { this._sitePads(this.layout); this._roads(this.layout); }
    this.lod = null; this.updateLod(); this._buildSurroundings(); this.dirty = true;
    this.onQualityChange && this.onQualityChange(q, why);
  }

  async load(base = 'assets/', onProgress = null) {
    const loader = new GLTFLoader();
    const grab = async (f, dy = 0) => {
      const g = await loader.loadAsync(base + f, e => onProgress && onProgress(f, e.loaded, e.total)); const parts = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => { if (o.isMesh) { let geo = o.geometry.clone();
        if (!geo.attributes.normal) { geo = geo.toNonIndexed(); geo.computeVertexNormals(); }   // 精簡 GLB 只存位置 + 索引：展開成每三角形獨立頂點，算面法線（= 平面著色）
        geo.applyMatrix4(o.matrixWorld); if (dy) geo.translate(0, dy, 0); const m = o.material.clone(); m.side = THREE.DoubleSide;
        const lite = new THREE.MeshLambertMaterial({ color: m.color, map: m.map || null, side: THREE.DoubleSide, vertexColors: m.vertexColors, flatShading: m.flatShading });   // GLB 沒有法線 → GLTFLoader 開了 flatShading，要一起帶
        parts.push({ geo, mat: m, lite, name: o.name }); } });
      return parts;
    };
    // 散熱模組 GLB 以自身底面為 0；疊放在貨櫃頂上 → 墊高一個貨櫃高（USD 端是 Reference 的 translate，同一個數）
    [this.shellParts, this.coolerParts, this.skidParts, this.chillerParts] = await Promise.all([grab('container.glb'), grab('cooler_module.glb', CH), grab('power_skid.glb'), grab('chiller.glb')]);
    this.boxChillerGeo = new THREE.BoxGeometry(6.0, 2.6, 2.4).translate(3.0, 1.3, -1.2);
    this.bandMats = this.shellParts.filter(p => /Band/.test(p.name)).flatMap(p => [p.mat, p.lite]);   // 產品色帶（DSX 綠 / GADU 藍灰）
    this.boxSkidGeo = new THREE.BoxGeometry(SKID_L, SKID_H, W).translate(SKID_L / 2, SKID_H / 2, -W / 2);
    this.boxShellGeo = new THREE.BoxGeometry(L, CH, W).translate(L / 2, CH / 2, -W / 2);
    this.boxCoolGeo = new THREE.BoxGeometry(L, MH, W).translate(L / 2, CH + MH / 2, -W / 2);
    this.boxBandGeo = new THREE.BoxGeometry(L + 0.03, 0.9, W + 0.03).translate(L / 2, 0.55, -W / 2);               // 綠色下段（同 GLB 的 Band，約下 1/3）
    this.boxDeckGeo = new THREE.BoxGeometry(L - 0.5, 0.08, W - 0.5).translate(L / 2, CH + MH + 0.04, -W / 2);      // 風扇面
    this.rackGeo = new THREE.BoxGeometry(0.6, 2.3, 1.2).translate(0.3, 0.1 + 1.15, -0.6);
    // 方塊模式的風扇示意：頂板上的暗色圓盤 + 淺色外環（位置同 assetgen：散熱模組 6 個 r 0.95、冰水機 4 個 r 0.5）
    const fans = (xs, z, y, r) => [mergeGeometries(xs.map(x => new THREE.CircleGeometry(r * 0.88, 24).rotateX(-Math.PI / 2).translate(x, y, z))),
                                   mergeGeometries(xs.map(x => new THREE.RingGeometry(r * 0.88, r, 24).rotateX(-Math.PI / 2).translate(x, y, z)))];
    [this.boxFanGeo, this.boxFanRingGeo] = fans([0, 1, 2, 3, 4, 5].map(i => L / 6 * (i + 0.5)), -W / 2, CH + MH + 0.081, 0.95);
    [this.chFanGeo, this.chFanRingGeo] = fans([0, 1, 2, 3].map(i => 1.6 + (6.0 - 1.6) / 4 * (i + 0.5)), -1.2, 2.601, 0.5);
  }

  _alloc(cap) {
    for (const s of Object.values(this.sets)) s.forEach(m => { this.scene.remove(m); m.dispose(); });
    const mk = (geo, mat, c) => { const m = new THREE.InstancedMesh(geo, mat, c); m.castShadow = m.receiveShadow = true; m.count = 0; m.frustumCulled = false; this.scene.add(m); return m; };
    this.sets = {
      shell: this.shellParts.map(p => mk(p.geo, this.quality === 'high' ? p.mat : p.lite, cap)),
      cooler: this.coolerParts.map(p => mk(p.geo, this.quality === 'high' ? p.mat : p.lite, cap)),
      boxShell: [mk(this.boxShellGeo, this._boxMat('shell'), cap)],
      boxCool: [mk(this.boxCoolGeo, this._boxMat('cool'), cap), mk(this.boxDeckGeo, this._boxMat('deck'), cap), mk(this.boxFanGeo, this._boxMat('fan'), cap), mk(this.boxFanRingGeo, this._boxMat('fanRing'), cap)],
      boxBand: [mk(this.boxBandGeo, this._boxMat('band'), cap)],
      plinth: [mk(new THREE.BoxGeometry(L - 0.4, BASE_Y, W - 0.3).translate(L / 2, -BASE_Y / 2, -W / 2), this._boxMat('plinth'), cap)],
      rack: [mk(this.rackGeo, this._boxMat('rack'), cap * 7)],
      skid: this.skidParts.map(p => mk(p.geo, this.quality === 'high' ? p.mat : p.lite, cap)),
      boxSkid: [mk(this.boxSkidGeo, this._boxMat('skid'), cap)],
      skidPlinth: [mk(new THREE.BoxGeometry(SKID_L - 0.3, BASE_Y, W - 0.3).translate(SKID_L / 2, -BASE_Y / 2, -W / 2), this._boxMat('plinth'), cap)],
      chiller: this.chillerParts.map(p => mk(p.geo, this.quality === 'high' ? p.mat : p.lite, cap * 2)),
      boxChiller: [mk(this.boxChillerGeo, this._boxMat('cool'), cap * 2), mk(this.chFanGeo, this._boxMat('fan'), cap * 2), mk(this.chFanRingGeo, this._boxMat('fanRing'), cap * 2)],
      busway: [mk(new THREE.BoxGeometry(SKID_GAP + 0.3, 0.2, 0.8).translate(-(SKID_GAP + 0.3) / 2 + 0.15, 0.1 - BASE_Y, -W / 2), this._boxMat('busway'), cap)],   // 800 VDC 地面線槽
    };
    this.skidPicker = this.sets.boxSkid[0]; this.chillerPicker = this.sets.boxChiller[0];
    this.picker = this.sets.boxShell[0];
    this.cap = cap;
  }

  setLayout(layout) {
    this.layout = layout;
    const pods = layout.pods; const n = pods.length;
    if (n > this.cap) this._alloc(Math.max(64, 2 ** Math.ceil(Math.log2(n))));
    const M = new THREE.Matrix4();
    const all = [...this.sets.shell, ...this.sets.cooler, ...this.sets.boxShell, ...this.sets.boxCool, ...this.sets.boxBand, ...this.sets.plinth];
    pods.forEach((p, i) => { M.makeTranslation(p.x, BASE_Y, -p.y); all.forEach(m => m.setMatrixAt(i, M)); });
    this.hiddenPod = null;
    const rk = this.sets.rack[0]; let k = 0;
    pods.forEach(p => RACKS.forEach(([x, y]) => { M.makeTranslation(p.x + x, BASE_Y, -(p.y + y)); rk.setMatrixAt(k++, M); }));
    all.forEach(m => { m.count = n; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });
    rk.count = k; rk.instanceMatrix.needsUpdate = true;
    const sk = [...this.sets.skid, ...this.sets.boxSkid, ...this.sets.skidPlinth, ...this.sets.busway];   // 800 VDC 電力中心：貨櫃東端 + 1.5 m，中間地面線槽
    pods.forEach((p, i) => { M.makeTranslation(p.x + L + SKID_GAP, BASE_Y, -p.y); sk.forEach(m => m.setMatrixAt(i, M)); });
    sk.forEach(m => { m.count = n; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });
    const nCh = this.sku ? Number(this.sku.chillers) : 0, chs = [...this.sets.chiller, ...this.sets.boxChiller]; let kc = 0;   // GADU：每單位 1–2 台冰水機（北側）
    if (nCh) pods.forEach(p => { for (let k = 0; k < nCh; k++) { M.makeTranslation(p.x + 0.5 + k * 6.6, 0, -(p.y + W + 1.0)); chs.forEach(m => m.setMatrixAt(kc, M)); kc++; } });
    chs.forEach(m => { m.count = kc; m.instanceMatrix.needsUpdate = true; if (kc) m.computeBoundingSphere(); });
    this.n = n; this.pods = pods;
    const [sx, sy] = layout.site_m; this.extent = { sx, sy, cx: sx / 2 - SETBACK, cy: sy / 2 - SETBACK };
    this._sitePads(layout);
    this._strips(layout);
    this._substations(layout);
    this._boundary(layout);
    this._roads(layout);
    this._placeSun();
    this._buildSurroundings();
    this.highlight.visible = false;
    this._applyVis(); this.dirty = true;
    if (this.cut) this._unit(true, true);
    this._fxAnchors(layout);
  }

  setAnim(on) { this.fx.setOn(on); this.dirty = true; }

  // 畫面中心點的高度（比例）：用投影的視窗偏移平移畫面，鏡頭位置與角度不變；點選與疊層投影都跟著對齊
  setFocusY(f) { this.focusY = f; this.dirty = true; }
  _applyFocus() {
    const W = innerWidth, H = innerHeight, off = (0.5 - this.curFocusY) * H;
    if (Math.abs(off) < 0.5) this.camera.clearViewOffset(); else this.camera.setViewOffset(W, H, 0, off, W, H);
  }
  get animOn() { return this.fx.on; }

  // 疊層錨點：散熱器頂（DSX 散熱模組 / GADU 冰水機）冒熱氣、POD 正面狀態燈、電力中心燈、變電站門型架航空障礙燈
  _fxAnchors(layout) {
    const A = [], gadu = !!(this.sku && Number(this.sku.chillers)), nCh = gadu ? Number(this.sku.chillers) : 0;
    const front = new Map();                                       // 每個區塊每一欄最南邊的 POD：正面燈只放這排（後排會被前排擋住，DOM 疊層沒有遮擋）
    this.pods.forEach(p => { const k = p.block + ':' + Math.round(p.x); if (!front.has(k) || p.y < front.get(k)) front.set(k, p.y); });
    this.pods.forEach((p, i) => {
      const r = ((i * 7919) % 1000) / 1000;                       // 固定的偽亂數相位，燈不會一起閃
      if (gadu) for (let k = 0; k < nCh; k++) A.push({ key: `h${i}.${k}`, kind: 'heat', x: p.x + 0.5 + k * 6.6 + 3.0, y: 2.6, z: -(p.y + W + 2.2), m: 5.4, delay: -(r + k * 0.37) * 4.5 });
      else A.push({ key: `h${i}`, kind: 'heat', x: p.x + L / 2, y: BASE_Y + CH + MH, z: -(p.y + W / 2), m: L * 0.85, delay: -r * 4.5 });
      if (front.get(p.block + ':' + Math.round(p.x)) !== p.y) return;
      A.push({ key: `s${i}`, kind: 'status', x: p.x + 0.35, y: BASE_Y + 2.55, z: -p.y + 0.07, m: 0.18, face: 1, delay: -r * 3 });
      A.push({ key: `p${i}`, kind: 'power', x: p.x + L + SKID_GAP + 0.4, y: BASE_Y + SKID_H - 0.35, z: -p.y + 0.05, m: 0.18, face: 1, delay: -r * 2 });
    });
    layout.blocks.filter(b => b.substation).forEach((b, j) => {
      const s = b.substation, k = subScale(s), ox = s.x + Math.max(0, (s.l - 40 * k) / 2), oz = -s.y - (16 - 16 * k) / 2;
      [2.5, 24.5].forEach(gx => [-3, -13].forEach(gz => A.push({ key: `b${j}.${gx}.${gz}`, kind: 'beacon', x: ox + gx * k, y: 9.25 * k, z: oz + gz * k, m: 0.3, delay: 0 })));
    });
    this.fx.setAnchors(A);
  }

  // 基地鋪面（礫石）+ 區塊混凝土基座
  _sitePads(layout) {
    this.pads.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); this.pads.clear();
    const { sx, sy } = this.extent;
    const req = layout.requested || {};
    const [bx, by] = req.site_l ? [req.site_l, req.site_w] : [sx, sy];
    const lite = this.quality === 'lite', t = lite ? null : this.gravelTex.clone(); if (t) { t.needsUpdate = true; t.repeat.set(bx / 24, by / 24); }
    const site = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), flat(new THREE.MeshStandardMaterial(lite ? { color: 0x8c8d87, roughness: 1 } : { map: t, roughness: 1 }), 1));   // 輕量：礫石改純色
    site.rotation.x = -Math.PI / 2; site.position.set(-SETBACK + bx / 2, 0.03, -(-SETBACK + by / 2)); site.receiveShadow = true; this.pads.add(site);
    const padMat = flat(new THREE.MeshStandardMaterial({ color: 0xb9bab3, roughness: 0.85 }), 3);
    for (const b of layout.blocks) {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(b.length + 5, b.width + 5), padMat); pad.rotation.x = -Math.PI / 2;
      pad.position.set(b.x + b.length / 2, 0.06, -(b.y + b.width / 2)); pad.receiveShadow = true; this.pads.add(pad);
    }
  }

  _substations(layout) {
    this.subSets.forEach(m => { this.scene.remove(m); m.dispose(); }); this.subSets = [];
    if (this.subHit) { this.scene.remove(this.subHit); this.subHit.dispose(); this.subHit = null; }
    const subs = layout.blocks.filter(b => b.substation); if (!subs.length) return;
    const M = new THREE.Matrix4();
    const place = (m) => { subs.forEach((b, i) => { const s = b.substation, k = subScale(s); M.compose(new THREE.Vector3(s.x + Math.max(0, (s.l - 40 * k) / 2), 0, -s.y - (16 - 16 * k) / 2), new THREE.Quaternion(), new THREE.Vector3(k, k, k)); m.setMatrixAt(i, M); }); m.count = subs.length; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); };
    for (const p of this.subParts) {
      const m = new THREE.InstancedMesh(p.geo, p.mat, subs.length); m.castShadow = p.shadow; m.receiveShadow = true; m.frustumCulled = false; place(m); this.scene.add(m); this.subSets.push(m);
    }
    this.subHit = new THREE.InstancedMesh(new THREE.BoxGeometry(40, 9, 16).translate(20, 4.5, -8), new THREE.MeshBasicMaterial({ visible: false }), subs.length);
    place(this.subHit); this.scene.add(this.subHit); this.subBlocks = subs;
  }

  // 基地範圍：地面色帶 + 線 + 圍籬柱 + 尺寸標註。基地輸入模式另畫「使用範圍」虛線。
  _boundary(layout) {
    if (this.bound) { this.bound.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); }); this.scene.remove(this.bound); }
    const G = this.bound = new THREE.Group(); this.scene.add(G);
    const { sx, sy } = this.extent; const req = layout.requested || {};
    const [bx, by] = req.site_l ? [req.site_l, req.site_w] : [sx, sy];
    const x0 = -SETBACK, z0 = SETBACK, x1 = x0 + bx, z1 = z0 - by;   // three 座標
    const span = Math.max(bx, by);
    const w = Math.max(0.5, span / 320);
    const mat = flat(new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false }), 6);
    const strip = (len, along) => new THREE.Mesh(new THREE.PlaneGeometry(along === 'x' ? len + w : w, along === 'x' ? w : len + w).rotateX(-Math.PI / 2), mat);
    for (const [x, z, len, a] of [[(x0 + x1) / 2, z0, bx, 'x'], [(x0 + x1) / 2, z1, bx, 'x'], [x0, (z0 + z1) / 2, by, 'z'], [x1, (z0 + z1) / 2, by, 'z']]) {
      const m = strip(len, a); m.position.set(x, 0.12, z); m.renderOrder = 2; G.add(m);
    }
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, 0.15, z));
    G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ACCENT })));
    // 圍籬柱（每 4 m）+ 網
    const posts = []; const step = 4;
    // 南側圍籬在大門處留缺口（大門對準第一座變電站的開關室）
    const gx = this.gateX = this._gateX(layout, x0, x1);
    const perim = [[x0, z0, gx - GATE, z0], [gx + GATE, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]].filter(([a, b, c, d]) => Math.hypot(c - a, d - b) > 0.3);
    for (const [ax, az, bx2, bz] of perim) { const len = Math.hypot(bx2 - ax, bz - az); for (let s = 0; s < len; s += step) posts.push([ax + (bx2 - ax) * s / len, az + (bz - az) * s / len]); }
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x8d9398, metalness: 0.6, roughness: 0.5 }), posts.length);
    const M = new THREE.Matrix4(); posts.forEach(([x, z], i) => pm.setMatrixAt(i, M.makeTranslation(x, 0, z))); pm.castShadow = true; G.add(pm);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xc4c9cc, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    for (const [ax, az, bx2, bz] of perim) { const len = Math.hypot(bx2 - ax, bz - az); const n = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.2), netMat); n.position.set((ax + bx2) / 2, 1.15, (az + bz) / 2); n.rotation.y = Math.atan2(-(bz - az), bx2 - ax); G.add(n); }
    // 尺寸標註
    const tag = (text, x, z, h) => { const s = label(text); s.scale.set(h * s.userData.aspect, h, 1); s.position.set(x, h * 0.6, z); G.add(s); };
    const h = Math.max(2.4, span / 36);
    { const s = label(this.labels ? this.labels.site(bx.toFixed(1), by.toFixed(1), (bx * by / 1e4).toFixed(2)) : `基地 ${bx.toFixed(1)} × ${by.toFixed(1)} m・${(bx * by / 1e4).toFixed(2)} ha`); s.scale.set(h * s.userData.aspect, h, 1); s.position.set(x0 + h * s.userData.aspect / 2, h * 0.6, z0 + h * 1.5); G.add(s); }
    tag(`${by.toFixed(1)} m`, x1 + h * 2, (z0 + z1) / 2, h * 0.85);
    if (req.site_l) {                                               // 實際使用範圍（佈局外框）
      const u = [[-SETBACK, SETBACK], [-SETBACK + sx, SETBACK], [-SETBACK + sx, SETBACK - sy], [-SETBACK, SETBACK - sy], [-SETBACK, SETBACK]].map(([x, z]) => new THREE.Vector3(x, 0.16, z));
      const dl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(u), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: h * 0.6, gapSize: h * 0.4 })); dl.computeLineDistances(); G.add(dl);
      tag(this.labels ? this.labels.use(sx.toFixed(0), sy.toFixed(0)) : `使用 ${sx.toFixed(0)} × ${sy.toFixed(0)} m`, -SETBACK + sx / 2, SETBACK - sy - h * 0.6, h * 0.8);
    }
    this.siteRect = { x0, z0, x1, z1 };
  }

  // 依緯度放太陽：春分上午約 9:20（時角 −40°），北半球從東南照
  setEnvironment(siteKey, lat, rebuild = true) {
    this.envKey = siteKey; this.env = ENV[siteKey] || ENV.dallas; this.lat = lat ?? 30;
    const e = this.env, phi = THREE.MathUtils.degToRad(this.lat), h = THREE.MathUtils.degToRad(-40);
    const E = -Math.sin(h), N = -Math.sin(phi) * Math.cos(h), U = Math.cos(phi) * Math.cos(h);
    this.sunDir = new THREE.Vector3(E, U, -N).normalize();
    const u = this.sky.material.uniforms;
    u.turbidity.value = e.turbidity; u.rayleigh.value = e.rayleigh; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8; u.sunPosition.value.copy(this.sunDir);
    // 環境光：用同一個天空烘 PMREM（只有高畫質需要；省電畫質等切回高畫質再烘）
    this.envDirty = true; if (this.quality === 'high') this._bakeEnv(); else this.scene.environment = null;
    const fog = new THREE.Color(e.fog); this.scene.fog.color.copy(fog); this.scene.background = fog;
    this.hemi.color.set(e.fog); this.hemi.groundColor.set(e.ground[0]);
    this.sun.color.set(this.lat > 45 ? 0xffe9d0 : 0xfff6ea);
    const gt = noiseTex(e.ground, { seed: 11, rows: e.paddy ? 8 : 0, snow: e.snow || 0 }); gt.repeat.set(10000 / 70, 10000 / 70);
    this.groundTex?.dispose(); this.groundTex = gt; this._groundLook();
    if (rebuild && this.layout) { this._placeSun(); this._roads(this.layout); this._buildSurroundings(); }
    this.dirty = true;
  }

  // 地面：高畫質 = 噪點貼圖 + 大尺度明暗；輕量 = 氣候帶的平均色（乾淨純色）
  _groundLook() {
    if (!this.env) return;
    const lite = this.quality === 'lite', g = this.groundMat;
    g.map = lite ? null : this.groundTex; g.vertexColors = !lite;
    if (lite) { const c = new THREE.Color(0, 0, 0); this.env.ground.forEach(h => c.add(new THREE.Color(h))); g.color.copy(c.multiplyScalar(1 / this.env.ground.length));
      if (this.env.snow) g.color.lerp(new THREE.Color(0xdfe4e8), this.env.snow * 0.35); } else g.color.set(0xffffff);   // 殘雪：純色地面偏白
    g.needsUpdate = true; this.dirty = true;
  }

  _bakeEnv() {
    const u = this.sky.material.uniforms;
    const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); Object.entries(u).forEach(([k, v]) => sky2.material.uniforms[k].value = v.value.clone ? v.value.clone() : v.value); envScene.add(sky2);
    this.envRT?.dispose(); this.envRT = this.pmrem.fromScene(envScene); this.scene.environment = this.envRT.texture; this.envDirty = false;
    sky2.geometry.dispose(); sky2.material.dispose();
  }

  _placeSun() {
    if (!this.extent || !this.sunDir) return;
    const { sx, sy, cx, cy } = this._view(); const span = Math.max(sx, sy, 40); const sun = this.sun;
    const tgt = new THREE.Vector3(cx, 0, -cy);
    sun.target.position.copy(tgt); sun.position.copy(tgt).addScaledVector(this.sunDir, span * 2 + 300);
    const half = span * 0.75 + 30;
    const sfar = span * 4 + 800;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: sfar }); sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.01 / sfar; sun.shadow.normalBias = Math.max(0.04, half * 2 / 4096 * 1.5);   // 深度偏移只留約 1 cm（原本 -0.0003 × 上千公尺 ≈ 30 cm，風扇圈等矮物件的影子會脫離底部像浮空）；條紋改用沿法線偏移（約 1.5 個陰影貼圖像素）壓掉
    const near = span * 1.2 + 500, far = Math.max(4200, span * 8);
    this.scene.fog.near = near; this.scene.fog.far = far;
  }

  // 周邊：植被（基地外圍行道樹 + 外圈群落）、樹籬、遠山
  _buildSurroundings() {
    if (!this.env || !this.extent) return;
    this.surround.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); this.surround.clear();
    const e = this.env, K = vegKinds(e.veg), r = rng(this.envKey.length * 977 + Math.round(this.extent.sx));
    const { x0, z0, x1, z1 } = this.siteRect; const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const span = Math.max(x1 - x0, z0 - z1);
    const R = span / 2 + Math.max(320, span * 1.1);
    const margin = 14;
    const inSite = (x, z, m = margin) => x > x0 - m && x < x1 + m && z < z0 + m && z > z1 - m;
    const lists = {};                                                // kind → [x, z, scale, rotY, colorHex]
    const onRoad = (x, z, m = 0) => Math.abs(z - PUB_Z) < PUB_W / 2 + 6 + m || (Math.abs(x - this.gateX) < GATE + 4 && z > z0 - 2 && z < PUB_Z);   // 公路走廊、大門不種樹
    const add = (kind, x, z, s, col) => { if (!onRoad(x, z)) (lists[kind] ||= []).push([x, z, s, r() * Math.PI * 2, col]); };
    const leafCols = { broad: ['#4f6e2f', '#5b7a36', '#456528', '#6a843d'], palm: ['#4f7a2a', '#5e8a32', '#43701f'], conifer: ['#2f4a2a', '#36522f', '#294226', '#3d5a33'],
                       shrub: ['#7d7a4a', '#6f7044', '#8a8455'], hedge: ['#3f6a2c', '#4a7433'], bamboo: ['#6f9442', '#7fa24c'] };
    const pick = (k) => { const a = leafCols[k] || leafCols.broad, j = Math.floor(r() * a.length); return this.quality === 'lite' ? a[0] : a[j]; };   // 輕量：同種樹同一色
    // 1) 圍籬外的行道樹 / 防風林
    const lineKind = { broad: 'broad', palm: 'palm', conifer: 'conifer', hedge: 'broad', desert: null }[e.veg];
    if (lineKind) {
      const step = lineKind === 'conifer' ? 6 : 9, off = 7;
      const edges = [[x1 + off, z0 + off, x1 + off, z1 - off], [x1 + off, z1 - off, x0 - off, z1 - off]];   // 只種北、東兩側（防風林），不擋預設鏡頭
      for (const [ax, az, bx, bz] of edges) { const len = Math.hypot(bx - ax, bz - az); for (let s = step / 2; s < len; s += step) if (r() > 0.08) add(lineKind, ax + (bx - ax) * s / len + (r() - .5), az + (bz - az) * s / len + (r() - .5), 0.85 + r() * 0.3, pick(lineKind)); }
    }
    // 2) 外圈群落
    const area = (2 * R) ** 2 - (span + 2 * margin) ** 2;
    const lite = this.quality === 'lite';
    const N = Math.min(lite ? 1200 : 4200, Math.max(lite ? 80 : 200, Math.round(e.density * area / 700 * (lite ? 0.33 : 1))));
    for (let i = 0, tries = 0; i < N && tries < N * 8; tries++) {
      const x = cx + (r() * 2 - 1) * R, z = cz + (r() * 2 - 1) * R;
      if (inSite(x, z, margin + 10)) continue;
      const c = clump(x, z, e.veg === 'conifer' ? 0.8 : 1.2);
      if (e.veg === 'desert') {
        const k = r(); if (k < 0.12) add('cactus', x, z, 0.7 + r() * 0.6); else if (k < 0.22) add('rock', x, z, 0.6 + r() * 1.8); else add('shrub', x, z, 0.5 + r() * 0.9, pick('shrub'));
      } else if (e.veg === 'conifer') {
        if (c > 0.35 || r() < 0.05) add('conifer', x, z, 0.7 + r() * 0.7, pick('conifer')); else if (r() < 0.3) add('broad', x, z, 0.6 + r() * 0.4, '#6c8a3a'); else continue;
      } else if (e.veg === 'palm') {
        // 油棕園：規則格點（每 9 m）落在群落區；其餘零星闊葉
        if (c > 0.45) { const gx = Math.round(x / 9) * 9, gz = Math.round(z / 9) * 9 + (Math.round(x / 9) % 2) * 4.5; if (!inSite(gx, gz, margin + 10)) add('palm', gx, gz, 0.85 + r() * 0.3, pick('palm')); }
        else if (r() < 0.25) add('broad', x, z, 0.8 + r() * 0.6, pick('broad')); else continue;
      } else if (e.veg === 'hedge') {
        if (r() < 0.35) add('broad', x, z, 0.8 + r() * 0.6, pick('broad')); else continue;
      } else {                                                         // broad（桃園、達拉斯）
        if (c > 0.55 || r() < 0.12) add('broad', x, z, 0.7 + r() * 0.7, pick('broad'));
        else if (e.paddy && r() < 0.06) add('bamboo', x, z, 0.8 + r() * 0.4, pick('bamboo')); else continue;
      }
      i++;
    }
    // 3) 都柏林：樹籬圍出的牧場格
    if (e.veg === 'hedge') {
      const fx = 140, fz = 100; const segs = [];
      for (let gx = Math.floor((cx - R) / fx) * fx; gx <= cx + R; gx += fx) for (let gz = Math.floor((cz - R) / fz) * fz; gz <= cz + R; gz += fz) {
        if (r() > 0.15) segs.push([gx + fx / 2, gz, fx, 'x']); if (r() > 0.15) segs.push([gx, gz + fz / 2, fz, 'z']);
      }
      for (const [x, z, len, a] of segs) {
        if (inSite(x, z, margin + len / 2)) continue;
        if (a === 'x' ? Math.abs(z - PUB_Z) < PUB_W + 6 : Math.abs(z - PUB_Z) < len / 2 + PUB_W) continue;
        (lists.hedgeSeg ||= []).push([x, z, len, a, pick('hedge')]);
        for (let k = 0; k < 3; k++) if (r() < 0.5) { const t = (r() - 0.5) * len; add('broad', a === 'x' ? x + t : x, a === 'x' ? z : z + t, 0.8 + r() * 0.5, pick('broad')); }
      }
    }
    // 建 InstancedMesh：近處（基地中心 near 以內）用完整樹形，遠處用低面數版本（樹是場景裡三角形最多的東西）
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
    const near = span * 0.5 + 260;                                     // 只讓近處樹投影
    const KL = vegKinds(e.veg, true), SNOW = new THREE.Color(0xeef2f5);
    for (const [kind, all] of Object.entries(lists)) {
      if (kind === 'hedgeSeg') continue;
      const nearArr = all.filter(([x, z]) => Math.hypot(x - cx, z - cz) <= near), farArr = all.filter(([x, z]) => Math.hypot(x - cx, z - cz) > near);
      for (const [arr, kinds, isNear] of [[nearArr, K, true], [farArr, KL, false]]) {
        if (!arr.length) continue;
        for (const part of kinds[kind]) {
          const m = new THREE.InstancedMesh(part.geo, part.mat, arr.length);
          arr.forEach(([x, z, s, ry, col], i) => { Q.setFromAxisAngle(Y, ry); M.compose(P.set(x, 0, z), Q, S.setScalar(s)); m.setMatrixAt(i, M);
            if (part.tint) { C.set(col || '#5b7a36'); if (e.snow) C.lerp(SNOW, e.snow * (0.1 + 0.5 * ((i * 37) % 10) / 10)); m.setColorAt(i, C); } });   // 殘雪：樹冠混白
          m.castShadow = isNear && span < 700; m.receiveShadow = false; this.surround.add(m);
        }
      }
    }
    if (lists.hedgeSeg) {
      const part = K.hedge[0]; const arr = lists.hedgeSeg; const m = new THREE.InstancedMesh(part.geo, part.mat, arr.length);
      arr.forEach(([x, z, len, a, col], i) => { M.compose(P.set(x, 0, z), Q.identity(), a === 'x' ? S.set(len, 1, 1.8) : S.set(1.8, 1, len)); m.setMatrixAt(i, M); m.setColorAt(i, C.set(col)); });
      m.castShadow = span < 700; this.surround.add(m);
    }
    // 4) 遠山（落在霧裡，給地平線一點起伏）
    if (e.hill) {
      const n = 34, hr = rng(5 + this.envKey.length);
      const geo = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2); const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {                        // 平滑起伏的山丘（半球 + 低頻位移）
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x);
        const k = 1 + 0.18 * Math.sin(a * 3 + 1.3) + 0.1 * Math.sin(a * 7);
        pos.setXYZ(i, x * k, y * (0.75 + 0.35 * Math.sin(a * 2 + 0.4) ** 2), z * k);
      }
      geo.computeVertexNormals();
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), n);
      const dist = Math.max(2600, span * 4);
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + hr() * 0.15, d = dist * (1 + hr() * 0.6), rad = 260 + hr() * 420;
        M.compose(P.set(cx + Math.cos(a) * d, -2, cz + Math.sin(a) * d), Q.setFromAxisAngle(Y, hr() * 6), S.set(rad * 1.4, rad * 0.22 * e.hillH * (0.6 + hr() * 0.8), rad * (1.0 + hr() * 0.5)));
        m.setMatrixAt(i, M); m.setColorAt(i, C.set(e.hill).offsetHSL(0, 0, (hr() - .5) * 0.06));
      }
      this.surround.add(m);
    }
  }

  // 道路：廠內混凝土（變電站前的服務道路 + 區塊間道路）；南側大門出去接廠外柏油公路（東西向，延伸到地平線）
  _roads(layout) {
    if (this.roads) { this.roads.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); }); this.scene.remove(this.roads); }
    const G = this.roads = new THREE.Group(); this.scene.add(G);
    const { x0, x1, z1 } = this.siteRect;
    const concrete = flat(new THREE.MeshStandardMaterial({ color: 0xa9aaa3, roughness: 0.85 }), 2);
    const curb = flat(new THREE.MeshStandardMaterial({ color: 0xd2d3cc, roughness: 0.8 }), 4);
    const strip = (w, d, x, z, y, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat); m.position.set(x, y, z); m.receiveShadow = true; G.add(m); return m; };
    // 1) 廠內服務道路：退縮帶裡、第一排變電站正門前，橫貫基地
    strip(x1 - x0 - 3, SVC_W, (x0 + 1.5 + x1) / 2, ROAD_Z, 0.09, concrete);
    for (const dz of [-SVC_W / 2, SVC_W / 2]) strip(x1 - x0 - 3, 0.25, (x0 + 1.5 + x1) / 2, ROAD_Z + dz, 0.1, curb);
    // 2) 園區：每排區塊前（變電站門前）的東西向道路、區塊之間的南北向道路
    if (layout.mode === 'campus') {
      const b0 = layout.blocks[0]; const cellX = layout.blocks.find(b => b.x > 0)?.x; const rowsY = [...new Set(layout.blocks.map(b => b.substation.y))].filter(y => y > 0);
      for (const y of rowsY) strip(x1 - x0 - 3, 10, (x0 + 1.5 + x1) / 2, -(y - 6), 0.09, concrete);
      if (cellX) for (let x = cellX; x < x1; x += cellX) strip(10, (SETBACK - 2) - (z1 + 2), x - 6, ((SETBACK - 2) + (z1 + 2)) / 2, 0.085, concrete);
    }
    // 3) 大門（南側）：門柱、柵欄機、警衛亭；廠內混凝土車道接到圍籬，圍籬外換柏油接公路
    const { z0 } = this.siteRect; const gx = this.gateX;
    strip(2 * GATE - 1, z0 - (ROAD_Z + SVC_W / 2), gx, (z0 + ROAD_Z + SVC_W / 2) / 2, 0.095, concrete);
    const post = new THREE.MeshStandardMaterial({ color: 0x8d9398, metalness: 0.6, roughness: 0.5 });
    for (const dx of [-GATE, GATE]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.8, 0.5), post); m.position.set(gx + dx, 1.4, z0); m.castShadow = true; G.add(m); }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(GATE * 1.7, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8382b, roughness: 0.5 }));
    arm.position.set(gx - GATE * 0.12, 1.1, z0 + 0.6); G.add(arm);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xe3e5e0, roughness: 0.6 }));
    booth.position.set(gx + GATE + 2.2, 1.3, z0 - 2.0); booth.castShadow = true; G.add(booth);
    // 4) 廠外公路：柏油 + 標線 + 路肩，東西向延伸到霧裡；大門前一段柏油引道
    const lite = this.quality === 'lite', t = lite ? null : asphaltTex(); if (t) t.repeat.set(2 * ROAD_LEN / 24, 1);
    const asphalt = flat(new THREE.MeshStandardMaterial(lite ? { color: 0x3b3d3f, roughness: 0.95 } : { map: t, roughness: 0.95 }), 3);   // 輕量：柏油不貼圖
    const plain = flat(new THREE.MeshStandardMaterial({ color: 0x3b3d3f, roughness: 0.95 }), 3);
    const shoulder = flat(new THREE.MeshStandardMaterial({ color: this.envKey === 'phoenix' ? 0xb7976f : 0x8a826e, roughness: 1 }), 2);
    const cx = (x0 + x1) / 2;
    strip(2 * ROAD_LEN, PUB_W, cx, PUB_Z, 0.1, asphalt);
    for (const dz of [-(PUB_W / 2 + 0.9), PUB_W / 2 + 0.9]) strip(2 * ROAD_LEN, 1.8, cx, PUB_Z + dz, 0.07, shoulder);
    strip(2 * GATE + 2, PUB_Z - PUB_W / 2 - z0, gx, (z0 + PUB_Z - PUB_W / 2) / 2, 0.1, plain);
  }

  _gateX(layout, x0, x1) {                                        // 大門對準第一座變電站開關室（樣板 x = 34 m），沒有就放中間
    const b = layout.blocks.find(q => q.substation);
    if (!b) return (x0 + x1) / 2;
    const s = b.substation, k = subScale(s);
    return Math.min(x1 - GATE - 2, Math.max(x0 + GATE + 2, s.x + Math.max(0, (s.l - 40 * k) / 2) + 34 * k));
  }

  _view() {                                                       // 鏡頭 / 陰影 / 霧以基地範圍為準（基地輸入時可能比佈局大）
    const r = this.siteRect; if (!r) return this.extent;
    const sx = r.x1 - r.x0, sy = r.z0 - r.z1; return { sx, sy, cx: (r.x0 + r.x1) / 2, cy: -(r.z0 + r.z1) / 2 };
  }

  // ---------------------------------------------------------------- 鏡頭分鏡
  // site：低角度全景（看得到遠山）；size：鳥瞰整個基地；cool：拉近一個 POD 的散熱模組；unit：打開一個貨櫃南牆看內部。
  _sizePose() {
    const { sx, sy, cx, cy } = this._view(); const span = Math.max(sx, sy, 30);
    const tgt = new THREE.Vector3(cx, 0, -cy);
    const side = this.camera.aspect < 1 ? 0.28 : 0.62;                   // 直式螢幕用比較正面的視角，基地才放得進中間
    const pos = new THREE.Vector3(cx - span * side, span * 0.3 + 12, -cy + span * 1.05 + 22);
    // 依水平視角算距離：基地外接圓（半徑約 0.62 × 邊長）要放得進左右視野；直式手機會自動拉遠
    const v = pos.clone().sub(tgt);
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
    const need = (span * 0.62) / Math.sin(hHalf);
    if (v.length() < need) pos.copy(tgt).add(v.setLength(need));
    return { pos, tgt };
  }

  isGadu() { return !!(this.product && this.product.cooling_mode === 'chilled_water'); }

  // 產品切換：色帶顏色、冰水機 / 散熱模組顯示、內部排列（setLayout 之前呼叫）
  setProduct(product, sku) {
    this.product = product; this.sku = sku;
    const c = new THREE.Color(...(product.band_rgb || [0.46, 0.73, 0]));
    (this.bandMats || []).forEach(m => m.color.copy(c));
    for (const q of ['high', 'lite']) if (this._boxMats) this._boxMats[q].band.color.copy(c); this._boxBandSet = !!this._boxMats;
    if (this.sets.shell) this._applyVis();
    this.dirty = true;
  }

  _focusPod() { return this.pods && this.pods[0]; }              // 西南角第一個 POD（最靠近鏡頭、在大門那一側）

  _viewPose(mode) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    if (mode === 'size' || !this.pods || !this.pods.length) return this._sizePose();
    if (mode === 'site') {
      const { sx, sy, cx, cy } = this._view(); const span = Math.max(sx, sy, 30);
      const d = Math.max(span * 2.6, 380), tgt = V(cx, span * 0.05, -cy);
      return { tgt, pos: tgt.clone().add(V(-0.5 * d, 0.13 * d, 0.86 * d)) };
    }
    const p = this._focusPod(), k = Math.max(1, Math.sqrt(1 / this.camera.aspect));
    const pc = V(p.x + L / 2, BASE_Y, -(p.y + W / 2));
    if (mode === 'cool' && this.isGadu()) {                      // GADU：北側的氣冷冰水機（從北邊看，貨櫃在後面）
      const n = Number(this.sku.chillers) || 1, cc = V(p.x + 0.5 + (n * 6.6 - 0.6) / 2, BASE_Y + 1.3, -(p.y + W + 1.0 + 1.2));
      return { tgt: cc, pos: cc.clone().add(V(-9 * k, 6 + 2 * k, -12 * k)) };
    }
    if (mode === 'cool') return { tgt: pc.clone().add(V(0, CH + MH * 0.5, 0)), pos: pc.clone().add(V(-12 * k, CH + MH + 8 * k, 15 * k)) };
    if (mode === 'skid') {                                       // 800 VDC 電力中心 + 地面線槽 + 貨櫃東端
      const sc = V(p.x + L + SKID_GAP + SKID_L * 0.35, BASE_Y + 1.2, -(p.y + W / 2));
      const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect), d = Math.max(14, 6.5 / Math.tan(hHalf));
      return { tgt: sc, pos: sc.clone().add(V(-6, 4.5, 12).setLength(d)) };
    }
    // unit：依水平視角算距離，讓 12 m 長的貨櫃（加一點邊）放得進畫面；桌機兩側面板之間、手機直式都適用
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
    const tgt = pc.clone().add(V(-0.3, 1.3, 0)), d = Math.max(17, 7.4 / Math.tan(hHalf));
    return { tgt, pos: tgt.clone().add(V(-2.5, 2.6, 16.5).setLength(d)) };
  }

  setView(mode = 'size', { animate = true, duration = 1000 } = {}) {
    if (!this.extent) return;
    this.viewMode = mode;
    this._unit(mode === 'unit');
    const { pos, tgt } = this._viewPose(mode);
    if (!animate) { this.tween = null; this.camera.position.copy(pos); this.controls.target.copy(tgt); this.controls.update(); this.dirty = true; return; }
    this.tween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: tgt, start: performance.now(), dur: duration };
    this.dirty = true;
  }

  frame() { this.setView(this.viewMode || 'size', { animate: false }); }

  // ---------------------------------------------------------------- 剖面：一個貨櫃打開南牆，畫內部設備
  _hidePod(i) {
    const M = new THREE.Matrix4(), Z = new THREE.Matrix4().makeScale(0, 0, 0);
    const sets = [...this.sets.shell, ...this.sets.boxShell, ...this.sets.boxBand];
    if (this.hiddenPod != null) { const q = this.pods[this.hiddenPod]; if (q) { M.makeTranslation(q.x, BASE_Y, -q.y); sets.forEach(m => { m.setMatrixAt(this.hiddenPod, M); m.instanceMatrix.needsUpdate = true; }); } }
    this.hiddenPod = i;
    if (i != null) sets.forEach(m => { m.setMatrixAt(i, Z); m.instanceMatrix.needsUpdate = true; });
  }

  _unit(on, rebuild = false) {
    if (this.cut && (!on || rebuild)) {
      this.scene.remove(this.cut); this.cut.traverse(o => { if (o.isMesh && o.userData.own) { o.geometry.dispose(); } }); this.cut = null; this._hidePod(null);
    }
    if (!on || this.cut || !this.pods || !this.pods.length) { this.dirty = true; return; }
    const p = this._focusPod(), G = this.cut = new THREE.Group(); G.position.set(p.x, BASE_Y, -p.y);
    const CUT = new Set(['Wall_S', 'Wall_S_Band', 'Door_Hardware']);
    for (const part of this.shellParts) if (!CUT.has(part.name)) { const m = new THREE.Mesh(part.geo, this.quality === 'high' ? part.mat : part.lite); m.castShadow = m.receiveShadow = true; G.add(m); }
    G.add(buildInterior(this.quality, this.product, this.sku));
    this.scene.add(G); this._hidePod(0); this.dirty = true;
  }

  setVisible(v) { Object.assign(this.vis, v); this._applyVis(); this.dirty = true; }

  // 遠景長條：每個區塊每一排（同一個 x）的貨櫃、散熱模組（DSX）、電力模組、冰水機（GADU）各合成一根方塊，四個網格畫完整個園區
  _strips(layout) {
    (this.stripMeshes || []).forEach(([m]) => { this.scene.remove(m); m.geometry.dispose(); }); this.stripMeshes = [];
    const rows = new Map();
    for (const p of layout.pods) { const k = p.block + ':' + p.x.toFixed(2); const r = rows.get(k); if (r) { r.y0 = Math.min(r.y0, p.y); r.y1 = Math.max(r.y1, p.y); } else rows.set(k, { x: p.x, y0: p.y, y1: p.y }); }
    const gadu = this.isGadu(), nCh = gadu ? Number(this.sku.chillers) || 1 : 0, geos = { shell: [], cool: [], skid: [], chiller: [] };
    const bx = (kind, x0, x1, y0, y1, z0, z1) => geos[kind].push(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    for (const r of rows.values()) {
      const z0 = -(r.y1 + W), z1 = -r.y0;
      bx('shell', r.x, r.x + L, BASE_Y, BASE_Y + CH, z0, z1);
      if (!gadu) bx('cool', r.x, r.x + L, BASE_Y + CH, BASE_Y + CH + MH, z0, z1);
      bx('skid', r.x + L + SKID_GAP, r.x + L + SKID_GAP + SKID_L, BASE_Y, BASE_Y + SKID_H, z0, z1);
      if (gadu) bx('chiller', r.x + 0.5, r.x + 0.5 + nCh * 6.6 - 0.6, 0, 2.6, z0 - 1.0 - 2.4, z0 - 1.0);
    }
    for (const [kind, list] of Object.entries(geos)) {
      if (!list.length) continue;
      const m = new THREE.Mesh(mergeGeometries(list), this._boxMat(kind === 'chiller' ? 'cool' : kind)); m.visible = false; m.receiveShadow = true;
      this.scene.add(m); this.stripMeshes.push([m, kind === 'chiller' ? 'cool' : kind]);
    }
  }

  _applyVis() {
    const far = this.lod === 'far';
    (this.stripMeshes || []).forEach(([m, kind]) => { m.visible = far; m.material = this._boxMat(kind); });
    if (far) {                                                     // 遠景：單元層的實例全部藏起來，只畫長條
      for (const [k, list] of Object.entries(this.sets)) if (k !== 'rack') list.forEach(m => m.visible = false);
      this.sets.rack[0].visible = false; return;
    }
    for (const k of ['plinth', 'skidPlinth', 'busway']) (this.sets[k] || []).forEach(m => m.visible = true);
    const detail = this.lod === 'detail';
    this.sets.shell.forEach(m => m.visible = detail && this.vis.shell);
    const gadu = this.isGadu();
    this.sets.cooler.forEach(m => m.visible = detail && this.vis.cooler && !gadu);
    this.sets.chiller.forEach(m => m.visible = detail && gadu);
    this.sets.boxChiller.forEach(m => m.visible = !detail && gadu);
    this.sets.boxShell[0].visible = !detail && this.vis.shell;
    this.sets.boxCool.forEach(m => m.visible = !detail && this.vis.cooler && !gadu);
    this.sets.boxBand[0].visible = !detail && this.vis.shell;
    this.sets.rack[0].visible = this.vis.rack;
    this.sets.skid.forEach(m => m.visible = detail);
    this.sets.boxSkid[0].visible = !detail;
  }

  updateLod() {
    const d = this.camera.position.distanceTo(this.controls.target);
    const want = d > FAR_DIST && this.n > FAR_MIN_PODS ? 'far' : this.quality === 'lite' || (d > DETAIL_DIST && this.n > ALWAYS_DETAIL) ? 'box' : 'detail';
    if (want !== this.lod) { this.lod = want; this._applyVis(); }
    return this.lod;
  }

  // 滑鼠 hover：只有外框真的變了才重畫，而且是「安靜重畫」（不算移動：不降解析度、不藏熱氣）
  pick(clientX, clientY) {
    const key = () => this.highlight.visible ? this.highlight.box.min.toArray().concat(this.highlight.box.max.toArray()).join(',') : '-';
    const before = key(), r = this._pick(clientX, clientY);
    if (key() !== before) this.dirtyQuiet = true;
    return r;
  }

  _pick(clientX, clientY) {
    if (!this.picker || !this.n) return null;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(clientX / innerWidth * 2 - 1, -clientY / innerHeight * 2 + 1), this.camera);
    if (this.cut) {                                              // 剖面內部設備優先
      const hit = ray.intersectObject(this.cut, true).find(h => { let o = h.object; while (o && !o.userData.info) o = o.parent; return o; });
      if (hit) {
        let o = hit.object; while (!o.userData.info) o = o.parent;
        this.highlight.box.setFromObject(o); this.highlight.visible = true;
        return { kind: 'part', ...o.userData.info };
      }
    }
    const hp = ray.intersectObject(this.picker, false)[0];
    const hs = this.subHit ? ray.intersectObject(this.subHit, false)[0] : null;
    const hc = this.chillerPicker && this.chillerPicker.count ? ray.intersectObject(this.chillerPicker, false)[0] : null;
    if (hc && hc.instanceId !== undefined && (!hp || hc.distance < hp.distance) && (!hs || hc.distance < hs.distance)) {
      const nCh = Number(this.sku.chillers) || 1, pi = Math.floor(hc.instanceId / nCh), k = hc.instanceId % nCh, p = this.pods[pi], x0 = p.x + 0.5 + k * 6.6, z0 = -(p.y + W + 1.0);
      this.highlight.box.set(new THREE.Vector3(x0 - 0.1, -0.05, z0 - 2.5), new THREE.Vector3(x0 + 6.1, 2.75, z0 + 0.1)); this.highlight.visible = true;
      return { kind: 'chiller', index: pi, k, ...p };
    }
    const hk = ray.intersectObject(this.skidPicker, false)[0];
    if (hk && hk.instanceId !== undefined && (!hp || hk.distance < hp.distance) && (!hs || hk.distance < hs.distance)) {   // 電力模組
      const p = this.pods[hk.instanceId], x0 = p.x + L + SKID_GAP;
      this.highlight.box.set(new THREE.Vector3(x0 - 0.1, -0.05, -(p.y + W + 0.1)), new THREE.Vector3(x0 + SKID_L + 0.35, BASE_Y + SKID_H + 0.1, -p.y + 0.1)); this.highlight.visible = true;
      return { kind: 'skid', index: hk.instanceId, ...p };
    }
    if (hs && (!hp || hs.distance < hp.distance)) {
      const b = this.subBlocks[hs.instanceId], s = b.substation, k = subScale(s), ox = s.x + Math.max(0, (s.l - 40 * k) / 2), oz = -s.y - (16 - 16 * k) / 2;
      this.highlight.box.set(new THREE.Vector3(ox, -0.05, oz - 16 * k), new THREE.Vector3(ox + 40 * k, 9.2 * k, oz)); this.highlight.visible = true;
      return { kind: 'sub', block: b.index, mw: s.mw ?? null, n_pods: b.n_pods };
    }
    if (!hp || hp.instanceId === undefined) { this.highlight.visible = false; return null; }
    const p = this.pods[hp.instanceId];
    this.highlight.box.set(new THREE.Vector3(p.x - 0.1, -0.05, -(p.y + W + 0.1)), new THREE.Vector3(p.x + L + 0.1, BASE_Y + CH + (this.vis.cooler ? MH + 0.4 : 0.1), -p.y + 0.1));
    this.highlight.visible = true;
    return { kind: 'pod', index: hp.instanceId, ...p };
  }

  start(onFrame) {
    let last = 0; const gate = new FpsGate();
    this.bench = 45;                                               // 載入後先強制畫 45 幀量效能（不必等使用者拖動）
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (this.tween) {                                          // 分鏡轉場（easeInOutCubic）
        const t = Math.min(1, (now - this.tween.start) / this.tween.dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e); this.controls.target.lerpVectors(this.tween.t0, this.tween.t1, e);
        if (t >= 1) this.tween = null;
        this.dirty = true;
      }
      if (Math.abs(this.focusY - this.curFocusY) > 1e-3) {              // 中心點平滑移動（約 0.25 秒，跟面板動畫同步）
        this.curFocusY += (this.focusY - this.curFocusY) * 0.22; if (Math.abs(this.focusY - this.curFocusY) <= 1e-3) this.curFocusY = this.focusY;
        this._applyFocus(); this.dirty = true;
      }
      const moved = this.controls.update();
      if (this.bench > 0 && this.autoDowngrade && this.quality === 'high' && this.layout) { this.bench--; this.dirty = true; }
      const quiet = !moved && !this.dirty && this.dirtyQuiet; this.dirtyQuiet = false;   // 只有 hover 外框變了：照目前解析度重畫一張
      if (!moved && !this.dirty && !quiet) {                             // 按需渲染：沒變化就不畫
        last = 0;
        if (this.lowRes && now - this.lastActive > STILL_MS) { this.lowRes = false; this.stillPending = true; this.renderer.setPixelRatio(this._dpr()); this.fx.setMoving(false); this.dirty = true; }
        return;
      }
      if (this.stillPending || quiet) this.stillPending = false;            // 定格的高解析度畫面，或 hover 的安靜重畫
      else { this.lastActive = now; if (!this.lowRes) { this.lowRes = true; this.renderer.setPixelRatio(this._dprMotion()); this.fx.setMoving(this.quality === 'lite'); } }   // 高畫質移動中熱氣照常；輕量才暫藏
      this.dirty = false;
      this.sky.position.copy(this.camera.position); const lod = this.updateLod(); onFrame && onFrame(lod);
      // 近平面隨鏡頭距離調整：遠景時把 near 推遠，深度精度集中在看得到的範圍（解決地面疊層閃爍）
      const dist = this.camera.position.distanceTo(this.controls.target);
      const near = THREE.MathUtils.clamp(dist / 120, 0.3, 30), far = Math.max(6000, dist * 14);
      if (Math.abs(near - this.camera.near) > this.camera.near * 0.15 || far > this.camera.far * 1.2 || far < this.camera.far * 0.6) {
        this.camera.near = near; this.camera.far = far; this.camera.updateProjectionMatrix();
      }
      this.renderer.render(this.scene, this.camera);
      this.fx.update(this.camera, innerWidth, innerHeight, !this.cut);   // 剖面視角不畫疊層（燈會穿過貨櫃）           // 只在重畫的那一幀重新投影疊層
      // 自動降級（使用者沒手動選畫質時）：連續重畫的影格間隔交給 FpsGate 判斷（規則見 perf.js）
      if (this.autoDowngrade && this.quality === 'high' && last) { const fps = gate.push(now - last); if (fps) this.setQuality('lite', { fps }); }
      last = now;
    };
    requestAnimationFrame(loop);
  }
}
