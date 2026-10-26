// 自動降級的判斷（不依賴 three.js，可單獨測：node dsxpod/tests/test_perf_gate.mjs）
// 餵進「連續重畫」的影格間隔（ms）；回傳 null = 照舊，數字 = 該降級了（估計 fps）。
// 規則：每 20 幀看一次中位數，> 40 ms（約 < 25 fps）就降級；連續 5 幀 > 150 ms（卡住）立刻降級；
// 前 10 幀是 shader 編譯與上傳，不算。整段期間持續檢查，不是只量一次。
export class FpsGate {
  constructor({ window = 20, medianMs = 40, stallMs = 150, stallRun = 5, warmup = 10 } = {}) {
    Object.assign(this, { window, medianMs, stallMs, stallRun, warmup }); this.reset();
  }
  reset() { this.n = 0; this.dts = []; this.slow = 0; }
  push(dt) {
    if (++this.n <= this.warmup) return null;
    this.dts.push(dt); this.slow = dt > this.stallMs ? this.slow + 1 : 0;
    let med = null;
    if (this.slow >= this.stallRun) med = dt;
    else if (this.dts.length >= this.window) { med = [...this.dts].sort((a, b) => a - b)[this.window >> 1]; this.dts.length = 0; if (med <= this.medianMs) med = null; }
    if (med === null) return null;
    this.dts.length = 0; this.slow = 0;
    return Math.max(1, Math.round(1000 / med));
  }
}
