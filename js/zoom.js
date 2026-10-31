// 表の拡大・縮小
// ・表の上で2本指をつまむ(ピンチイン)と縮小。いちばん小さくすると、その月が1画面に収まる
// ・2本指を広げる(ピンチアウト)と拡大
// ・上の「1か月表示」ボタンで、1画面に収まる大きさと元の大きさを切り替え
// ・スマホは、文字が読めるように日付の列をせまくしすぎない(縦は1日分が収まり、横はスクロール)
// ・iPad・Mac もスマホと同じ見え方にする(2026-10-31):開いたときは1日(8:00〜24:00)が縦に収まる高さ、
//   横に縮めても文字は小さくしすぎず(0.92倍=約11px まで)、日付の列は 34px より細くしない
// ・Mac:⌘ を押しながらスクロール(またはトラックパッドのピンチ)で拡大・縮小
// 大きさは端末ごとに覚えておく(次に開いたときも同じ大きさ)

const BASE = { timeCol: 56, headRows: 34 + 26 + 40 };
// 時刻の行の数(ふだんは 8:00〜23:30 の32行。8時前に予定がある月は増える)
const rowCount = () => table.querySelectorAll('tbody tr').length || 32;
// 見出し(日付・曜日・予定の行)の高さ。1日ビューでは「予定」の行だけになるので、実際の表から測る
const headHeight = zf => {
  const thead = table.querySelector('thead');
  const now = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zf')) || 1;
  return thead ? thead.offsetHeight / now * zf : BASE.headRows * zf;
};
// 30分の行の高さと日付の列の幅(拡大率1のとき)。スマホでは変わるので、CSS の --row-base / --day-base から読む
const cssPx = (name, fallback) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
const baseRow = () => cssPx('--row-base', 34);
const baseDay = () => cssPx('--day-base', 58);
// スマホ(幅がせまい、または横向きで高さが低い画面)かどうか。CSS の @media と同じ条件
const phoneQuery = window.matchMedia('(max-width: 600px), (max-height: 500px)');
const PHONE_MIN_DAY = 30;     // スマホで日付の列をこれより細くしない(px。名前は折り返さず、はみ出た分は切る)
const PHONE_MIN_FONT = 0.8;   // スマホで文字をこれより小さくしない(元の大きさに対する倍率)
const WIDE_MIN_DAY = 34;      // iPad・Mac で日付の列をこれより細くしない(px)
const WIDE_MIN_FONT = 0.92;   // iPad・Mac で文字をこれより小さくしない(12px × 0.92 ≒ 11px。スマホの文字と同じくらい)
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
  // スマホは開いた瞬間に1日(8:00〜24:00)が縦に全部見える大きさにする(横は元の幅)
  // iPad・Mac も同じく、縦は1日が収まる高さで開く(横は前回の大きさ)
  if (phoneQuery.matches) { zx = 1; zy = 0; } else { zy = 0; }

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

// 縦の大きさを「1日がちょうど入る大きさ」にし直す(月表示と1日ビューを切り替えたとき)
export function fitDayHeight() {
  zy = 0;
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
    fx = (w - timeCol - 4) / (days * baseDay());
    fy = (h - headHeight(zf) - 4) / (rowCount() * baseRow());
  }
  // スマホは1か月を横に全部入れると文字が読めないので、列の幅に下限をつける(残りは横スクロール)
  // iPad・Mac も、文字が読めるよう列の幅に下限をつける(iPad の縦向きは横スクロールになる)
  fx = Math.max(fx, (phoneQuery.matches ? PHONE_MIN_DAY : WIDE_MIN_DAY) / baseDay());
  // 1日ビューは、1日がちょうど画面の高さいっぱいになるように行を伸ばしてよい
  const dayView = document.body.classList.contains('day-view');
  return { fx: Math.min(fx, 1), fy: Math.min(fy, dayView ? MAX : 1) };
}

// 文字の大きさは横の拡大率に合わせる。縦に縮めても文字は小さくしない(スマホと同じ。2026-10-31 に iPad・Mac も)
// 小さくしすぎないよう、スマホは 0.8 倍、iPad・Mac は 0.92 倍まで
function fontScale(x, y) {
  return Math.min(1.4, Math.max(phoneQuery.matches ? PHONE_MIN_FONT : WIDE_MIN_FONT, x));
}

function clamp() {
  const { fx, fy } = fitScale();
  zx = Math.min(MAX, Math.max(fx, zx));
  zy = Math.min(MAX, Math.max(fy, zy));
  return { fx, fy };
}

function apply() {
  if (!table) return;
  const fitY = zy === 0;   // 「1日が縦にちょうど収まる高さ」にするとき
  let { fx, fy } = clamp();
  const root = document.documentElement.style;
  root.setProperty('--zx', zx);
  root.setProperty('--zy', zy);
  root.setProperty('--zf', fontScale(zx, zy));
  // 文字の大きさが変わると見出しの高さも変わるので、実際の見出しの高さでもう一度合わせる(最後の行が切れないように)
  if (fitY) {
    for (let i = 0; i < 2; i++) {
      ({ fx, fy } = fitScale());
      zy = fy;
      root.setProperty('--zy', zy);
    }
  }
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
    scroller.scrollTop = 0;
    // 横に収まりきらないとき(スマホ)は、今日の列が見える位置に。収まるときは左端から
    const today = table.querySelector('thead th.today');
    const timeCol = table.querySelector('.time-col').offsetWidth;
    scroller.scrollLeft = today ? Math.max(0, today.offsetLeft - timeCol - today.offsetWidth) : 0;
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
