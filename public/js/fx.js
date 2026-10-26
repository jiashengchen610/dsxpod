// 環境動態疊層：散熱熱氣與閃燈用 DOM + CSS 動畫畫在 3D 畫布上方。
// WebGL 維持按需渲染（畫面不動就不重畫）；只有鏡頭移動、真的重畫那一幀才重新投影錨點，
// 閃爍與上升動畫本身只動 transform / opacity，由瀏覽器合成器跑，不佔主執行緒也不喚醒 WebGL。
// 限制：DOM 不會被 3D 物件遮住，所以只畫最近的 N 個、正面朝外的燈只在看得到那一面時顯示。
import * as THREE from 'three';

// kind → 每幀最多幾個、最小像素（太遠就不畫）、DOM 基準尺寸（px，之後用 scale 縮放）
const KINDS = {
  heat:   { cap: [18, 8],  minPx: 14, base: 100 },
  beacon: { cap: [16, 8],  minPx: 1.5, base: 16 },
  status: { cap: [40, 16], minPx: 1.5, base: 16 },
  power:  { cap: [24, 10], minPx: 1.5, base: 16 },
};

export class FxLayer {
  constructor(el) {
    this.el = el; this.on = false; this.lite = false; this.anchors = [];
    this.live = new Map(); this.pool = {}; this.v = new THREE.Vector3();
  }
  // 錨點：{ key, kind, x, y, z, m（世界尺寸，公尺）, face（+1 = 只在鏡頭位於 +z 側時看得到） }
  setAnchors(list) { this.anchors = list; }
  setOn(on) { this.on = !!on; this.el.hidden = !this.on; if (!this.on) this._clear(); }
  setLite(lite) { this.lite = !!lite; }
  setMoving(on) { this.el.classList.toggle('moving', !!on); }   // 移動中先藏熱氣模糊（backdrop-filter 每次重畫都要重算，手機上不便宜）

  _make(kind) {
    const w = document.createElement('div'); w.className = 'fx-' + kind;
    w.innerHTML = kind === 'heat' ? '<i></i><i></i><i></i>' : '<i></i>';
    this.el.appendChild(w); return w;
  }
  _release(key) {
    const e = this.live.get(key); if (!e) return;
    e.el.style.display = 'none'; (this.pool[e.kind] ||= []).push(e.el); this.live.delete(key);
  }
  _clear() { [...this.live.keys()].forEach(k => this._release(k)); }

  update(camera, W, H, show = true) {
    if (!this.on) return;
    if (!show) { this._clear(); return; }
    const cp = camera.position, focal = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const pick = {}; for (const k in KINDS) pick[k] = [];
    for (const a of this.anchors) {
      if (a.face && (cp.z - a.z) * a.face <= 0) continue;              // 看不到那一面
      const K = KINDS[a.kind], dx = a.x - cp.x, dy = a.y - cp.y, dz = a.z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
      const dMax = a.m * focal / K.minPx; if (d2 > dMax * dMax) continue; // 先用距離篩，免得每個都投影
      pick[a.kind].push([d2, a]);
    }
    const keep = new Set(), v = this.v;
    for (const k in pick) {
      const K = KINDS[k], cap = K.cap[this.lite ? 1 : 0], list = pick[k].sort((p, q) => p[0] - q[0]);
      let n = 0;
      for (const [d2, a] of list) {
        if (n >= cap) break;
        v.set(a.x, a.y, a.z).project(camera);
        if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.2) continue;
        const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H, size = a.m * focal / Math.sqrt(d2);
        const s = k === 'heat' ? size / K.base : Math.min(22, Math.max(5, size * 2.2)) / K.base;
        let e = this.live.get(a.key);
        if (!e) {
          const el = (this.pool[k] || []).pop() || this._make(k);
          el.style.display = ''; el.style.setProperty('--d', a.delay ?? 0);
          e = { el, kind: k }; this.live.set(a.key, e);
        }
        e.el.style.transform = `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0) scale(${s.toFixed(3)})`;
        keep.add(a.key); n++;
      }
    }
    for (const key of [...this.live.keys()]) if (!keep.has(key)) this._release(key);
  }
}
