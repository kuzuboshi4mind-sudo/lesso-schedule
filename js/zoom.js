// 表の拡大・縮小
// ・表の上で2本指をつまむ(ピンチイン)と縮小。いちばん小さくすると、その月が1画面に収まる
// ・2本指を広げる(ピンチアウト)と拡大
// ・上の「1か月表示」ボタンで、1画面に収まる大きさと元の大きさを切り替え
// ・Mac:⌘ を押しながらスクロール(またはトラックパッドのピンチ)で拡大・縮小
// 大きさは端末ごとに覚えておく(次に開いたときも同じ大きさ)

const BASE = { timeCol: 56, dayCol: 58, row: 34, headRows: 34 + 26 + 40, rows: 36 };
const MAX = 1.8;            // いちばん大きくしたとき(元の1.8倍)
const SAVE_KEY = 'lesso.zoom';

let scroller, table, btn;
let zx = 1, zy = 1;         // 横(日付の列)と縦(時刻の行)の拡大率
let pinch = null;           // ピンチ中の情報

export function initZoom(opts) {
  ({ scroller, table } = opts);
  btn = document.getElementById('zoom-fit');
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved) ({ zx, zy } = saved);
  } catch { /* 読めなければ元の大きさ */ }

  scroller.addEventListener('touchstart', onTouchStart, { passive: true });
  scroller.addEventListener('touchmove', onTouchMove, { passive: false });
  scroller.addEventListener('touchend', onTouchEnd);
  scroller.addEventListener('touchcancel', onTouchEnd);
  // iPad の Safari が画面全体を拡大しないようにする
  for (const type of ['gesturestart', 'gesturechange']) {
    scroller.addEventListener(type, e => e.preventDefault());
  }
  // Mac:⌘+スクロール / トラックパッドのピンチ(ブラウザでは ctrl+ホイールとして届く)
  scroller.addEventListener('wheel', onWheel, { passive: false });
  btn.addEventListener('click', toggleFit);
  window.addEventListener('resize', () => apply());
}

// 月を描き直したあとに呼ぶ(日数が変わると「1画面に収まる大きさ」も変わるため)
export function refreshZoom() {
  apply();
}

// その月がちょうど1画面に収まる拡大率
function fitScale() {
  const days = table.querySelectorAll('thead .row-date th[data-date]').length || 31;
  const w = scroller.clientWidth;
  const h = scroller.clientHeight;
  // 文字の大きさ(zf)で時刻の列と見出しの高さが変わるので、少しずつ合わせる
  let fx = 1, fy = 1;
  for (let i = 0; i < 4; i++) {
    const zf = fontScale(fx, fy);
    const timeCol = BASE.timeCol * Math.max(zf, 0.8);
    fx = (w - timeCol - 4) / (days * BASE.dayCol);
    fy = (h - BASE.headRows * zf - 4) / (BASE.rows * BASE.row);
  }
  return { fx: Math.min(fx, 1), fy: Math.min(fy, 1) };
}

// 文字の大きさは、横と縦の小さいほうに合わせる(小さくなりすぎないよう 0.6 倍まで)
function fontScale(x, y) {
  return Math.min(1.4, Math.max(0.6, Math.min(x, y)));
}

function clamp() {
  const { fx, fy } = fitScale();
  zx = Math.min(MAX, Math.max(fx, zx));
  zy = Math.min(MAX, Math.max(fy, zy));
  return { fx, fy };
}

function apply() {
  if (!table) return;
  const { fx, fy } = clamp();
  const root = document.documentElement.style;
  root.setProperty('--zx', zx);
  root.setProperty('--zy', zy);
  root.setProperty('--zf', fontScale(zx, zy));
  const isFit = Math.abs(zx - fx) < 0.01 && Math.abs(zy - fy) < 0.01;
  btn.setAttribute('aria-pressed', String(isFit));
  btn.textContent = isFit ? '元の大きさ' : '1か月表示';
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ zx, zy })); } catch { /* 保存できなくても動く */ }
}

// 指定した拡大率に変える。(cx, cy) の画面上の点が、拡大・縮小しても同じ場所に残るようにする
function zoomTo(nx, ny, cx, cy) {
  const r = scroller.getBoundingClientRect();
  const px = cx - r.left, py = cy - r.top;
  const contentX = scroller.scrollLeft + px;
  const contentY = scroller.scrollTop + py;
  const ox = zx, oy = zy;
  zx = nx; zy = ny;
  apply();
  scroller.scrollLeft = contentX * (zx / ox) - px;
  scroller.scrollTop = contentY * (zy / oy) - py;
}

function toggleFit() {
  const { fx, fy } = fitScale();
  const r = scroller.getBoundingClientRect();
  if (btn.getAttribute('aria-pressed') === 'true') {
    zoomTo(1, 1, r.left + r.width / 2, r.top + r.height / 2);
    // 元の大きさに戻したら、今日の列が見えるように
    table.querySelector('thead th.today')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  } else {
    zoomTo(fx, fy, r.left, r.top);
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
  }
}

// ---------------------------------------------------------
// ピンチ(2本指)
// ---------------------------------------------------------
function distance(t1, t2) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function onTouchStart(e) {
  if (e.touches.length !== 2) return;
  const [a, b] = e.touches;
  pinch = { dist: distance(a, b), zx, zy };
}

function onTouchMove(e) {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();   // 2本指のあいだは、表をスクロールさせない
  const [a, b] = e.touches;
  const scale = distance(a, b) / pinch.dist;
  zoomTo(pinch.zx * scale, pinch.zy * scale, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
}

function onTouchEnd(e) {
  if (e.touches.length < 2) pinch = null;
}

function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const scale = Math.exp(-e.deltaY / 200);
  zoomTo(zx * scale, zy * scale, e.clientX, e.clientY);
}
