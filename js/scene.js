// three.js 場景：DSX POD 陣列 + 依氣候帶的基地環境。
// 所有 POD 共用幾何，用 InstancedMesh 畫（draw call 數與 POD 數無關）；遠景切成方塊（LOD）。
// 座標：USD 是 Z-up（x 長邊、y 短邊）；GLB 已是 Y-up：(x, y, z)_usd → (x, z, −y)_three。POD 角點 (px, py) → three (px, 0, −py)。
// 環境（天空、地面、植被、遠山）只是視覺脈絡，不進能耗模型；能耗只看氣象資料。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const L = 12.192, W = 2.438, CH = 2.896, MH = 3.2;            // 貨櫃長寬高、散熱模組高
const SETBACK = 10;                                             // 與 sizing 一致：佈局原點在退縮線內 10 m
const ROAD_Z = SETBACK - 5;                                     // 服務道路中心（three z）= USD y −5：退縮帶內、變電站正門前
const SVC_W = 6, PUB_W = 8, GATE = 4.5;                         // 廠內道路寬、廠外公路寬、大門半寬
const ROAD_LEN = 6000;                                          // 廠外公路往東西兩側各延伸到霧裡
const PUB_Z = SETBACK + 9;                                      // 廠外公路中心（three z）：南側圍籬外 9 m
const RACKS = Array.from({ length: 7 }, (_, i) => [2.5 + i * 0.6, 0.06]);   // 與 dsxpod/usd_out.rack_positions 一致
const DETAIL_DIST = 260;                                        // 鏡頭距離 > 這個 → 方塊
const ACCENT = 0x76b900;
const subScale = s => Math.max(0.4, Math.min(1, s.l / 40));     // 小陣列：變電站等比縮小（接近箱式變電站的量體）

// 六個場址的地景（依柯本氣候：Cfa 桃園、Af 柔佛、BWh 鳳凰城、Cfa 達拉斯、Cfb 都柏林、Dfb 奧斯陸）
export const ENV = {
  taoyuan: { label: '亞熱帶濕潤（Cfa）：水田、竹林與闊葉樹', ground: ['#5f7c3b', '#6f8d45', '#4e6a31', '#7f8c55'], veg: 'broad', density: 0.9, hill: '#4f6b45', hillH: 1.0, turbidity: 8, rayleigh: 2.2, fog: '#c3cdd0', paddy: true },
  johor:   { label: '熱帶雨林（Af）：油棕園與草地', ground: ['#4c7438', '#587f40', '#41682f', '#6a8448'], veg: 'palm', density: 1.4, hill: '#355f30', hillH: 0.7, turbidity: 10, rayleigh: 2.6, fog: '#c9d5d3' },
  phoenix: { label: '熱沙漠（BWh）：礫石地、灌木與仙人掌', ground: ['#c8a376', '#b99368', '#d6b68d', '#a7855f'], veg: 'desert', density: 0.7, hill: '#9c6c4c', hillH: 2.4, turbidity: 3, rayleigh: 1.0, fog: '#e2d3ba' },
  dallas:  { label: '濕潤亞熱帶草原（Cfa）：牧草地與零星橡樹', ground: ['#8d9455', '#7f8949', '#a19f63', '#77834a'], veg: 'broad', density: 0.3, hill: null, hillH: 0, turbidity: 5, rayleigh: 1.6, fog: '#d3d7cf' },
  dublin:  { label: '溫帶海洋性（Cfb）：牧場與樹籬', ground: ['#557f3f', '#618b48', '#4b7338', '#6d9150'], veg: 'hedge', density: 0.6, hill: '#4c7a3e', hillH: 0.6, turbidity: 7, rayleigh: 3.0, fog: '#c7ced4' },
  oslo:    { label: '冷溫帶大陸性（Dfb）：針葉林與林間空地', ground: ['#5d6c46', '#6b7a52', '#4e5d3c', '#7b805d'], veg: 'conifer', density: 1.7, hill: '#34472f', hillH: 1.3, turbidity: 4, rayleigh: 1.8, fog: '#cad2d7' },
};

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clump = (x, z, s = 1) => 0.5 + 0.5 * Math.sin(x / (97 * s) + Math.sin(z / (131 * s)) * 2.1) * Math.cos(z / (83 * s) + Math.cos(x / (151 * s)) * 1.7);

// 可無縫重複的雜訊貼圖（地面、礫石）
function noiseTex(colors, { size = 512, blobs = 900, rMin = 8, rMax = 60, speck = 7000, seed = 7, rows = 0 } = {}) {
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
  P.concrete.push(box(1.0, 0.08, 9, 34, 0.04, -15.5));          // 電纜溝蓋板往區塊
  const M = {
    gravel: new THREE.MeshStandardMaterial({ color: 0x9c9d97, roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xb4b5ae, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.45, metalness: 0.7 }),
    tx: new THREE.MeshStandardMaterial({ color: 0x8a948f, roughness: 0.5, metalness: 0.45 }),
    fin: new THREE.MeshStandardMaterial({ color: 0x7c8681, roughness: 0.55, metalness: 0.45 }),
    bushing: new THREE.MeshStandardMaterial({ color: 0x7a4126, roughness: 0.35 }),
    fence: new THREE.MeshStandardMaterial({ color: 0xc4c9cc, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.22, depthWrite: false }),
    house: new THREE.MeshStandardMaterial({ color: 0xe3e5e0, roughness: 0.6, metalness: 0.1 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x5f6468, roughness: 0.7, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.6, metalness: 0.3 }),
  };
  return Object.entries(P).map(([k, geos]) => ({ geo: mergeGeometries(geos), mat: M[k], shadow: k !== 'fence' && k !== 'gravel' }));
}

// 植被樣板：每種是若干部件（幾何、材質、是否吃 instanceColor），單位大小，實例縮放
function vegKinds(veg) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true, ...o });
  const trunk = std(0x5a4632);
  const leaf = std(0xffffff);                                    // 顏色由 instanceColor 給
  const K = {};
  K.broad = [{ geo: cyl(0.22, 3.2, 0, 1.6, 0, 6), mat: trunk }, { geo: new THREE.IcosahedronGeometry(2.6, 1).scale(1, 0.85, 1).translate(0, 4.6, 0), mat: leaf, tint: true }];
  K.conifer = [{ geo: cyl(0.18, 2, 0, 1, 0, 5), mat: trunk },
               { geo: mergeGeometries([new THREE.ConeGeometry(2.0, 5.5, 7).translate(0, 4.3, 0), new THREE.ConeGeometry(1.4, 4, 7).translate(0, 7.2, 0)]), mat: leaf, tint: true }];
  K.palm = [{ geo: new THREE.CylinderGeometry(0.16, 0.24, 7, 6).translate(0, 3.5, 0), mat: std(0x6e5b44) },
            { geo: mergeGeometries(Array.from({ length: 7 }, (_, i) => new THREE.ConeGeometry(0.55, 3.6, 4).rotateZ(Math.PI / 2 + 0.35).translate(1.6, 7, 0).rotateY(i / 7 * Math.PI * 2))), mat: leaf, tint: true }];
  K.shrub = [{ geo: new THREE.IcosahedronGeometry(0.9, 0).scale(1.2, 0.6, 1.2).translate(0, 0.45, 0), mat: leaf, tint: true }];
  K.cactus = [{ geo: mergeGeometries([cyl(0.28, 5, 0, 2.5, 0, 8), cyl(0.18, 1.6, 0.7, 3.2, 0, 6), box(0.7, 0.3, 0.3, 0.35, 2.5, 0), cyl(0.16, 1.2, -0.6, 3.4, 0, 6), box(0.6, 0.3, 0.3, -0.3, 2.9, 0)]), mat: std(0x5d7a45) }];
  K.rock = [{ geo: new THREE.DodecahedronGeometry(1, 0).scale(1.3, 0.6, 1).translate(0, 0.3, 0), mat: std(0x8c6d55) }];
  K.hedge = [{ geo: box(1, 2.2, 1, 0, 1.1, 0), mat: leaf, tint: true }];
  K.bamboo = [{ geo: mergeGeometries(Array.from({ length: 6 }, (_, i) => new THREE.CylinderGeometry(0.05, 0.07, 8, 4).rotateZ(0.08 * Math.cos(i)).translate(Math.cos(i * 2.3) * 0.6, 4, Math.sin(i * 2.3) * 0.6))), mat: std(0x7c9a4a) },
              { geo: new THREE.IcosahedronGeometry(1.6, 0).scale(1, 2.2, 1).translate(0, 6.5, 0), mat: leaf, tint: true }];
  return K;
}

export class PodScene {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.62;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xbfcad0); this.scene.fog = new THREE.Fog(0xbfcad0, 800, 4000);
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 9000);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.47;
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x4a4a3a, 0.55); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff4e5, 3.2); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sky = new Sky(); this.sky.scale.setScalar(8000); this.scene.add(this.sky);
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
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); r.setSize(innerWidth, innerHeight); });
  }

  async load(base = 'assets/') {
    const loader = new GLTFLoader();
    const grab = async (f, dy = 0) => {
      const g = await loader.loadAsync(base + f); const parts = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => { if (o.isMesh) { const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); if (dy) geo.translate(0, dy, 0); const m = o.material.clone(); m.side = THREE.DoubleSide; parts.push({ geo, mat: m }); } });
      return parts;
    };
    // 散熱模組 GLB 以自身底面為 0；疊放在貨櫃頂上 → 墊高一個貨櫃高（USD 端是 Reference 的 translate，同一個數）
    [this.shellParts, this.coolerParts] = await Promise.all([grab('container.glb'), grab('cooler_module.glb', CH)]);
    this.boxShellGeo = new THREE.BoxGeometry(L, CH, W).translate(L / 2, CH / 2, -W / 2);
    this.boxCoolGeo = new THREE.BoxGeometry(L, MH, W).translate(L / 2, CH + MH / 2, -W / 2);
    this.rackGeo = new THREE.BoxGeometry(0.6, 2.3, 1.2).translate(0.3, 0.1 + 1.15, -0.6);
  }

  _alloc(cap) {
    for (const s of Object.values(this.sets)) s.forEach(m => { this.scene.remove(m); m.dispose(); });
    const mk = (geo, mat, c) => { const m = new THREE.InstancedMesh(geo, mat, c); m.castShadow = m.receiveShadow = true; m.count = 0; m.frustumCulled = false; this.scene.add(m); return m; };
    this.sets = {
      shell: this.shellParts.map(p => mk(p.geo, p.mat, cap)),
      cooler: this.coolerParts.map(p => mk(p.geo, p.mat, cap)),
      boxShell: [mk(this.boxShellGeo, new THREE.MeshStandardMaterial({ color: 0xc9cbca, roughness: 0.7, metalness: 0.2 }), cap)],
      boxCool: [mk(this.boxCoolGeo, new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.6, metalness: 0.4 }), cap)],
      rack: [mk(this.rackGeo, new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.5, metalness: 0.6 }), cap * 7)],
    };
    this.picker = this.sets.boxShell[0];
    this.cap = cap;
  }

  setLayout(layout) {
    this.layout = layout;
    const pods = layout.pods; const n = pods.length;
    if (n > this.cap) this._alloc(Math.max(64, 2 ** Math.ceil(Math.log2(n))));
    const M = new THREE.Matrix4();
    const all = [...this.sets.shell, ...this.sets.cooler, ...this.sets.boxShell, ...this.sets.boxCool];
    pods.forEach((p, i) => { M.makeTranslation(p.x, 0, -p.y); all.forEach(m => m.setMatrixAt(i, M)); });
    const rk = this.sets.rack[0]; let k = 0;
    pods.forEach(p => RACKS.forEach(([x, y]) => { M.makeTranslation(p.x + x, 0, -(p.y + y)); rk.setMatrixAt(k++, M); }));
    all.forEach(m => { m.count = n; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });
    rk.count = k; rk.instanceMatrix.needsUpdate = true;
    this.n = n; this.pods = pods;
    const [sx, sy] = layout.site_m; this.extent = { sx, sy, cx: sx / 2 - SETBACK, cy: sy / 2 - SETBACK };
    this._sitePads(layout);
    this._substations(layout);
    this._boundary(layout);
    this._roads(layout);
    this._placeSun();
    this._buildSurroundings();
    this.highlight.visible = false;
    this._applyVis();
  }

  // 基地鋪面（礫石）+ 區塊混凝土基座
  _sitePads(layout) {
    this.pads.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); this.pads.clear();
    const { sx, sy } = this.extent;
    const req = layout.requested || {};
    const [bx, by] = req.site_l ? [req.site_l, req.site_w] : [sx, sy];
    const t = this.gravelTex.clone(); t.needsUpdate = true; t.repeat.set(bx / 24, by / 24);
    const site = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    site.rotation.x = -Math.PI / 2; site.position.set(-SETBACK + bx / 2, 0.03, -(-SETBACK + by / 2)); site.receiveShadow = true; this.pads.add(site);
    const padMat = new THREE.MeshStandardMaterial({ color: 0xb9bab3, roughness: 0.85 });
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
    const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false });
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
    { const s = label(`基地 ${bx.toFixed(1)} × ${by.toFixed(1)} m・${(bx * by / 1e4).toFixed(2)} ha`); s.scale.set(h * s.userData.aspect, h, 1); s.position.set(x0 + h * s.userData.aspect / 2, h * 0.6, z0 + h * 1.5); G.add(s); }
    tag(`${by.toFixed(1)} m`, x1 + h * 2, (z0 + z1) / 2, h * 0.85);
    if (req.site_l) {                                               // 實際使用範圍（佈局外框）
      const u = [[-SETBACK, SETBACK], [-SETBACK + sx, SETBACK], [-SETBACK + sx, SETBACK - sy], [-SETBACK, SETBACK - sy], [-SETBACK, SETBACK]].map(([x, z]) => new THREE.Vector3(x, 0.16, z));
      const dl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(u), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: h * 0.6, gapSize: h * 0.4 })); dl.computeLineDistances(); G.add(dl);
      tag(`使用 ${sx.toFixed(0)} × ${sy.toFixed(0)} m`, -SETBACK + sx / 2, SETBACK - sy - h * 0.6, h * 0.8);
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
    // 環境光：用同一個天空烘 PMREM
    const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); Object.entries(u).forEach(([k, v]) => sky2.material.uniforms[k].value = v.value.clone ? v.value.clone() : v.value); envScene.add(sky2);
    this.envRT?.dispose(); this.envRT = this.pmrem.fromScene(envScene); this.scene.environment = this.envRT.texture;
    const fog = new THREE.Color(e.fog); this.scene.fog.color.copy(fog); this.scene.background = fog;
    this.hemi.color.set(e.fog); this.hemi.groundColor.set(e.ground[0]);
    this.sun.color.set(this.lat > 45 ? 0xffe9d0 : 0xfff6ea);
    const gt = noiseTex(e.ground, { seed: 11, rows: e.paddy ? 8 : 0 }); gt.repeat.set(10000 / 70, 10000 / 70);
    this.groundMat.map?.dispose(); this.groundMat.map = gt; this.groundMat.needsUpdate = true;
    if (rebuild && this.layout) { this._placeSun(); this._roads(this.layout); this._buildSurroundings(); }
  }

  _placeSun() {
    if (!this.extent || !this.sunDir) return;
    const { sx, sy, cx, cy } = this._view(); const span = Math.max(sx, sy, 40); const sun = this.sun;
    const tgt = new THREE.Vector3(cx, 0, -cy);
    sun.target.position.copy(tgt); sun.position.copy(tgt).addScaledVector(this.sunDir, span * 2 + 300);
    const half = span * 0.75 + 30;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: span * 4 + 800 }); sun.shadow.camera.updateProjectionMatrix();
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
    const pick = (k) => { const a = leafCols[k] || leafCols.broad; return a[Math.floor(r() * a.length)]; };
    // 1) 圍籬外的行道樹 / 防風林
    const lineKind = { broad: 'broad', palm: 'palm', conifer: 'conifer', hedge: 'broad', desert: null }[e.veg];
    if (lineKind) {
      const step = lineKind === 'conifer' ? 6 : 9, off = 7;
      const edges = [[x1 + off, z0 + off, x1 + off, z1 - off], [x1 + off, z1 - off, x0 - off, z1 - off]];   // 只種北、東兩側（防風林），不擋預設鏡頭
      for (const [ax, az, bx, bz] of edges) { const len = Math.hypot(bx - ax, bz - az); for (let s = step / 2; s < len; s += step) if (r() > 0.08) add(lineKind, ax + (bx - ax) * s / len + (r() - .5), az + (bz - az) * s / len + (r() - .5), 0.85 + r() * 0.3, pick(lineKind)); }
    }
    // 2) 外圈群落
    const area = (2 * R) ** 2 - (span + 2 * margin) ** 2;
    const N = Math.min(4200, Math.max(200, Math.round(e.density * area / 700)));
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
    // 建 InstancedMesh
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
    const near = span * 0.5 + 260;                                     // 只讓近處樹投影
    for (const [kind, arr] of Object.entries(lists)) {
      if (kind === 'hedgeSeg') continue;
      for (const part of K[kind]) {
        const m = new THREE.InstancedMesh(part.geo, part.mat, arr.length);
        arr.forEach(([x, z, s, ry, col], i) => { Q.setFromAxisAngle(Y, ry); M.compose(P.set(x, 0, z), Q, S.setScalar(s)); m.setMatrixAt(i, M); if (part.tint) m.setColorAt(i, C.set(col || '#5b7a36')); });
        m.castShadow = span < 700; m.receiveShadow = false; this.surround.add(m);
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
    const concrete = new THREE.MeshStandardMaterial({ color: 0xa9aaa3, roughness: 0.85 });
    const curb = new THREE.MeshStandardMaterial({ color: 0xd2d3cc, roughness: 0.8 });
    const flat = (w, d, x, z, y, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat); m.position.set(x, y, z); m.receiveShadow = true; G.add(m); return m; };
    // 1) 廠內服務道路：退縮帶裡、第一排變電站正門前，橫貫基地
    flat(x1 - x0 - 3, SVC_W, (x0 + 1.5 + x1) / 2, ROAD_Z, 0.09, concrete);
    for (const dz of [-SVC_W / 2, SVC_W / 2]) flat(x1 - x0 - 3, 0.25, (x0 + 1.5 + x1) / 2, ROAD_Z + dz, 0.1, curb);
    // 2) 園區：每排區塊前（變電站門前）的東西向道路、區塊之間的南北向道路
    if (layout.mode === 'campus') {
      const b0 = layout.blocks[0]; const cellX = layout.blocks.find(b => b.x > 0)?.x; const rowsY = [...new Set(layout.blocks.map(b => b.substation.y))].filter(y => y > 0);
      for (const y of rowsY) flat(x1 - x0 - 3, 10, (x0 + 1.5 + x1) / 2, -(y - 6), 0.09, concrete);
      if (cellX) for (let x = cellX; x < x1; x += cellX) flat(10, (SETBACK - 2) - (z1 + 2), x - 6, ((SETBACK - 2) + (z1 + 2)) / 2, 0.085, concrete);
    }
    // 3) 大門（南側）：門柱、柵欄機、警衛亭；廠內混凝土車道接到圍籬，圍籬外換柏油接公路
    const { z0 } = this.siteRect; const gx = this.gateX;
    flat(2 * GATE - 1, z0 - (ROAD_Z + SVC_W / 2), gx, (z0 + ROAD_Z + SVC_W / 2) / 2, 0.095, concrete);
    const post = new THREE.MeshStandardMaterial({ color: 0x8d9398, metalness: 0.6, roughness: 0.5 });
    for (const dx of [-GATE, GATE]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.8, 0.5), post); m.position.set(gx + dx, 1.4, z0); m.castShadow = true; G.add(m); }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(GATE * 1.7, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8382b, roughness: 0.5 }));
    arm.position.set(gx - GATE * 0.12, 1.1, z0 + 0.6); G.add(arm);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xe3e5e0, roughness: 0.6 }));
    booth.position.set(gx + GATE + 2.2, 1.3, z0 - 2.0); booth.castShadow = true; G.add(booth);
    // 4) 廠外公路：柏油 + 標線 + 路肩，東西向延伸到霧裡；大門前一段柏油引道
    const t = asphaltTex(); t.repeat.set(2 * ROAD_LEN / 24, 1);
    const asphalt = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
    const plain = new THREE.MeshStandardMaterial({ color: 0x3b3d3f, roughness: 0.95 });
    const shoulder = new THREE.MeshStandardMaterial({ color: this.envKey === 'phoenix' ? 0xb7976f : 0x8a826e, roughness: 1 });
    const cx = (x0 + x1) / 2;
    flat(2 * ROAD_LEN, PUB_W, cx, PUB_Z, 0.1, asphalt);
    for (const dz of [-(PUB_W / 2 + 0.9), PUB_W / 2 + 0.9]) flat(2 * ROAD_LEN, 1.8, cx, PUB_Z + dz, 0.07, shoulder);
    flat(2 * GATE + 2, PUB_Z - PUB_W / 2 - z0, gx, (z0 + PUB_Z - PUB_W / 2) / 2, 0.1, plain);
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

  frame() {
    const { sx, sy, cx, cy } = this._view(); const span = Math.max(sx, sy, 30);
    this.controls.target.set(cx, 0, -cy);
    this.camera.position.set(cx - span * 0.62, span * 0.3 + 12, -cy + span * 1.05 + 22);   // 低一點的視角，看得到地平線與天空
    this.controls.update();
  }

  setVisible(v) { Object.assign(this.vis, v); this._applyVis(); }

  _applyVis() {
    const detail = this.lod === 'detail';
    this.sets.shell.forEach(m => m.visible = detail && this.vis.shell);
    this.sets.cooler.forEach(m => m.visible = detail && this.vis.cooler);
    this.sets.boxShell[0].visible = !detail && this.vis.shell;
    this.sets.boxCool[0].visible = !detail && this.vis.cooler;
    this.sets.rack[0].visible = this.vis.rack;
  }

  updateLod() {
    const d = this.camera.position.distanceTo(this.controls.target);
    const want = d > DETAIL_DIST ? 'box' : 'detail';
    if (want !== this.lod) { this.lod = want; this._applyVis(); }
    return this.lod;
  }

  pick(clientX, clientY) {
    if (!this.picker || !this.n) return null;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(clientX / innerWidth * 2 - 1, -clientY / innerHeight * 2 + 1), this.camera);
    const hp = ray.intersectObject(this.picker, false)[0];
    const hs = this.subHit ? ray.intersectObject(this.subHit, false)[0] : null;
    if (hs && (!hp || hs.distance < hp.distance)) {
      const b = this.subBlocks[hs.instanceId], s = b.substation, k = subScale(s), ox = s.x + Math.max(0, (s.l - 40 * k) / 2), oz = -s.y - (16 - 16 * k) / 2;
      this.highlight.box.set(new THREE.Vector3(ox, -0.05, oz - 16 * k), new THREE.Vector3(ox + 40 * k, 9.2 * k, oz)); this.highlight.visible = true;
      return { kind: 'sub', block: b.index, mw: s.mw ?? null, n_pods: b.n_pods };
    }
    if (!hp || hp.instanceId === undefined) { this.highlight.visible = false; return null; }
    const p = this.pods[hp.instanceId];
    this.highlight.box.set(new THREE.Vector3(p.x - 0.1, -0.05, -(p.y + W + 0.1)), new THREE.Vector3(p.x + L + 0.1, CH + (this.vis.cooler ? MH + 0.4 : 0.1), -p.y + 0.1));
    this.highlight.visible = true;
    return { kind: 'pod', index: hp.instanceId, ...p };
  }

  start(onFrame) {
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); this.sky.position.copy(this.camera.position); const lod = this.updateLod(); onFrame && onFrame(lod); this.renderer.render(this.scene, this.camera); };
    loop();
  }
}
