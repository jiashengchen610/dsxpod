// three.js 場景：DSX POD 陣列。所有 POD 共用幾何，用 InstancedMesh 畫（draw call 數與 POD 數無關）；遠景切成方塊（LOD）。
// 座標：USD 是 Z-up（x 長邊、y 短邊）；GLB 已是 Y-up：(x, y, z)_usd → (x, z, −y)_three。POD 角點 (px, py) → three (px, 0, −py)。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const L = 12.192, W = 2.438, CH = 2.896, MH = 3.2;            // 貨櫃長寬高、散熱模組高
const RACKS = Array.from({ length: 7 }, (_, i) => [2.5 + i * 0.6, 0.06]);   // 與 dsxpod/usd_out.rack_positions 一致
const DETAIL_DIST = 260;                                        // 鏡頭距離 > 這個 → 方塊

export class PodScene {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0e0f10); this.scene.fog = new THREE.Fog(0x0e0f10, 600, 3000);
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 8000);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.49;
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2b2c, 1.1));
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
    this.scene.add(sun); this.scene.add(sun.target);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; this.ground = g; this.scene.add(g);
    this.pads = new THREE.Group(); this.scene.add(this.pads);
    this.cap = 0; this.n = 0; this.sets = {}; this.vis = { shell: true, cooler: true, rack: false }; this.lod = 'detail';
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), 0x76b900); this.highlight.visible = false; this.scene.add(this.highlight);
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); r.setSize(innerWidth, innerHeight); });
  }

  async load(base = 'assets/') {
    const loader = new GLTFLoader();
    const grab = async (f) => {
      const g = await loader.loadAsync(base + f); const parts = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => { if (o.isMesh) { const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); const m = o.material.clone(); m.side = THREE.DoubleSide; parts.push({ geo, mat: m }); } });
      return parts;
    };
    [this.shellParts, this.coolerParts] = await Promise.all([grab('container.glb'), grab('cooler_module.glb')]);
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
    // 基座與變電站
    this.pads.clear();
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3a3d3f, roughness: 1 }), subMat = new THREE.MeshStandardMaterial({ color: 0x6d6e66, roughness: 0.8 });
    for (const b of layout.blocks) {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(b.length + 6, b.width + 6), padMat); pad.rotation.x = -Math.PI / 2;
      pad.position.set(b.x + b.length / 2, 0.02, -(b.y + b.width / 2)); pad.receiveShadow = true; this.pads.add(pad);
      if (b.substation) {
        const s = b.substation, box = new THREE.Mesh(new THREE.BoxGeometry(s.l * 0.4, 3, s.w), subMat);
        box.position.set(s.x + s.l / 2, 1.5, -(s.y + 2 + s.w / 2)); box.castShadow = box.receiveShadow = true; this.pads.add(box);
      }
    }
    const [sx, sy] = layout.site_m; this.extent = { sx, sy, cx: sx / 2 - 10, cy: sy / 2 - 10 };
    this.ground.scale.set(sx * 4 + 200, sy * 4 + 200, 1); this.ground.position.set(this.extent.cx, 0, -this.extent.cy);
    const span = Math.max(sx, sy); const sun = this.sun;
    sun.position.set(this.extent.cx - span * 0.6, span * 0.9 + 40, -this.extent.cy + span * 0.5); sun.target.position.set(this.extent.cx, 0, -this.extent.cy);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: span * 4 + 200 }); sun.shadow.camera.updateProjectionMatrix();
    this.highlight.visible = false;
    this._applyVis();
  }

  frame() {
    const { sx, sy, cx, cy } = this.extent; const span = Math.max(sx, sy, 30);
    this.controls.target.set(cx, 0, -cy);
    this.camera.position.set(cx - span * 0.55, span * 0.55 + 12, -cy + span * 0.95 + 12);
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
    const hit = ray.intersectObject(this.picker, false)[0];
    if (!hit || hit.instanceId === undefined) { this.highlight.visible = false; return null; }
    const p = this.pods[hit.instanceId];
    this.highlight.box.set(new THREE.Vector3(p.x - 0.1, -0.05, -(p.y + W + 0.1)), new THREE.Vector3(p.x + L + 0.1, CH + (this.vis.cooler ? MH + 0.4 : 0.1), -p.y + 0.1));
    this.highlight.visible = true;
    return { index: hit.instanceId, ...p };
  }

  start(onFrame) {
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); const lod = this.updateLod(); onFrame && onFrame(lod); this.renderer.render(this.scene, this.camera); };
    loop();
  }
}
