// マスの選択(Numbers のような操作)
// ・長押し → そのマスを選択。指を離さずになぞると範囲を選択できる
// ・選択中にタップ → そのマスだけを選択し直す(Mac は Shift+クリックで範囲を広げる)
// ・下に出る操作バーで「文字を入力」「コピー」「貼り付け」「削除」
// ・Mac:右クリックでも選択。⌘C / ⌘V / delete / return / esc も使える
import * as store from './store.js';
import { timeSlots, toMinutes, fromMinutes, escapeHtml } from './calendar.js';

const LONG_PRESS_MS = 450;    // 長押しと判定する時間
const MOVE_TOLERANCE = 10;    // これ以上指が動いたら、長押しではなくスクロールとみなす
const DAY_END = 24 * 60;
const SLOTS = timeSlots();
const CLIP_KEY = 'lesso.clipboard';

let table, scroller, onChanged;
let lessons = [];            // 表示中の月の予定
let anchor = null;           // 選択の起点 { date, idx }(idx は時刻の行番号)
let focus = null;            // 選択の終点
let dragging = false;        // 長押しのあと、なぞって範囲を選んでいる最中
let pressTimer = null;
let pressStart = null;
let suppressClickUntil = 0;  // 長押しの指を離した直後に来るタップを無視する(この時刻まで)
let lastTouchAt = 0;         // タッチ操作のあとに来る、まねのマウス操作を無視する

const bar = document.getElementById('selection-bar');
const barInfo = document.getElementById('selection-info');
const pasteBtn = document.getElementById('sel-paste');
const toast = document.getElementById('toast');
const textDialog = document.getElementById('text-dialog');
const textForm = document.getElementById('text-form');
const textInput = document.getElementById('text-input');
const textTarget = document.getElementById('text-target');

// ---------------------------------------------------------
// 準備(main.js から呼ぶ)
// ---------------------------------------------------------
export function initSelection(opts) {
  ({ table, scroller, onChanged } = opts);

  table.addEventListener('touchstart', onTouchStart, { passive: true });
  table.addEventListener('touchmove', onTouchMove, { passive: false });
  table.addEventListener('touchend', onPressEnd);
  table.addEventListener('touchcancel', onPressEnd);
  table.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onPressEnd);
  // 右クリック(Mac)でも選択。iPad の長押しメニューも出さない
  table.addEventListener('contextmenu', e => {
    e.preventDefault();
    const cell = cellAt(e.clientX, e.clientY);
    if (cell) startSelection(cell);
  });

  document.getElementById('sel-text').addEventListener('click', openTextInput);
  document.getElementById('sel-copy').addEventListener('click', copySelection);
  pasteBtn.addEventListener('click', pasteSelection);
  document.getElementById('sel-delete').addEventListener('click', deleteSelection);
  document.getElementById('sel-done').addEventListener('click', clearSelection);
  document.addEventListener('keydown', onKeyDown);

  textForm.addEventListener('submit', e => { e.preventDefault(); saveText(); });
  textDialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => textDialog.close()));
  textDialog.addEventListener('click', e => { if (e.target === textDialog) textDialog.close(); });
}

// 表を描き直したあとに呼ぶ(その月の予定を受け取り、選択の色を付け直す)
export function afterRender(monthLessons) {
  lessons = monthLessons;
  paint();
}

export function isSelecting() {
  return !!anchor;
}

// 表のタップを選択の操作として使ったら true を返す(main.js は何もしない)
export function handleTap(e) {
  // 長押しの指を離した直後のタップ1回だけは無視する
  if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; return true; }
  if (!anchor) return false;
  const cell = cellAt(e.clientX, e.clientY);
  if (cell) {
    if (e.shiftKey) focus = cell; else anchor = focus = cell;
    paint();
  }
  return true;
}

export function clearSelection() {
  anchor = focus = null;
  dragging = false;
  paint();
}

// ---------------------------------------------------------
// 長押しとなぞり
// ---------------------------------------------------------
function onTouchStart(e) {
  lastTouchAt = Date.now();
  if (e.touches.length !== 1) return cancelPress();
  const t = e.touches[0];
  beginPress(t.clientX, t.clientY);
}

function onTouchMove(e) {
  lastTouchAt = Date.now();
  const t = e.touches[0];
  if (dragging) {
    e.preventDefault();           // なぞっている間は表をスクロールさせない
    extendTo(t.clientX, t.clientY);
  } else if (pressStart && moved(t.clientX, t.clientY)) {
    cancelPress();
  }
}

function onMouseDown(e) {
  if (e.button !== 0 || Date.now() - lastTouchAt < 800) return;
  beginPress(e.clientX, e.clientY);
}

function onMouseMove(e) {
  if (Date.now() - lastTouchAt < 800) return;
  if (dragging) extendTo(e.clientX, e.clientY);
  else if (pressStart && moved(e.clientX, e.clientY)) cancelPress();
}

function beginPress(x, y) {
  cancelPress();
  const cell = cellAt(x, y);
  if (!cell) return;
  pressStart = { x, y };
  pressTimer = setTimeout(() => {
    pressTimer = null;
    startSelection(cell);
    dragging = true;
  }, LONG_PRESS_MS);
}

function onPressEnd() {
  cancelPress();
  if (dragging) {
    dragging = false;
    suppressClickUntil = Date.now() + 350;
  }
}

function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
  pressStart = null;
}

function moved(x, y) {
  return Math.hypot(x - pressStart.x, y - pressStart.y) > MOVE_TOLERANCE;
}

function startSelection(cell) {
  anchor = focus = cell;
  if (navigator.vibrate) navigator.vibrate(10);
  paint();
}

function extendTo(x, y) {
  autoScroll(x, y);
  const cell = cellAt(x, y);
  if (cell && (cell.date !== focus.date || cell.idx !== focus.idx)) {
    focus = cell;
    paint();
  }
}

// なぞっている指が表の端に来たら、その方向に少しスクロールする
function autoScroll(x, y) {
  const r = scroller.getBoundingClientRect();
  const edge = 40;
  if (y > r.bottom - edge) scroller.scrollTop += 12;
  else if (y < r.top + 130) scroller.scrollTop -= 12;   // 上は見出しの行の分だけ広めに
  if (x > r.right - edge) scroller.scrollLeft += 12;
  else if (x < r.left + 90) scroller.scrollLeft -= 12;  // 左は時刻の列の分だけ広めに
}

// 画面上の位置 → 表のマス { date, idx }(予定の帯の上でも、その下のマスを返す)
function cellAt(x, y) {
  table.classList.add('picking');
  const el = document.elementFromPoint(x, y);
  table.classList.remove('picking');
  const td = el && el.closest('td[data-date]');
  if (!td || !table.contains(td)) return null;
  return { date: td.dataset.date, idx: SLOTS.indexOf(td.dataset.time) };
}

// ---------------------------------------------------------
// 選択範囲
// ---------------------------------------------------------
function dateColumns() {
  return [...table.querySelectorAll('thead .row-date th[data-date]')].map(th => th.dataset.date);
}

// 選んでいる範囲 { dates:[日付...], i1, i2, top:開始の分, bottom:終わりの分 }
function range() {
  if (!anchor) return null;
  const cols = dateColumns();
  const c1 = cols.indexOf(anchor.date), c2 = cols.indexOf(focus.date);
  if (c1 < 0 || c2 < 0) return null;
  const i1 = Math.min(anchor.idx, focus.idx), i2 = Math.max(anchor.idx, focus.idx);
  return {
    dates: cols.slice(Math.min(c1, c2), Math.max(c1, c2) + 1),
    i1, i2,
    top: toMinutes(SLOTS[i1]),
    bottom: toMinutes(SLOTS[i2]) + 30,
  };
}

// 範囲の中で始まる予定
function lessonsInRange(r) {
  return lessons.filter(l => r.dates.includes(l.date) && toMinutes(l.start) >= r.top && toMinutes(l.start) < r.bottom);
}

function paint() {
  table.querySelectorAll('td.sel').forEach(td => td.classList.remove('sel'));
  const r = range();
  table.classList.toggle('selecting', !!r);
  document.body.classList.toggle('has-selection', !!r);  // 操作バーの分、表の下に余白を作る
  if (!r) {
    bar.hidden = true;
    return;
  }
  for (const date of r.dates) {
    for (let i = r.i1; i <= r.i2; i++) {
      table.querySelector(`td[data-date="${date}"][data-time="${SLOTS[i]}"]`)?.classList.add('sel');
    }
  }
  const first = shortDate(r.dates[0]);
  const last = shortDate(r.dates[r.dates.length - 1]);
  const days = r.dates.length > 1 ? `${first}〜${last}` : first;
  const count = lessonsInRange(r).length;
  barInfo.textContent = `${days} ${SLOTS[r.i1]}〜${fromMinutes(r.bottom)}${count ? `(予定${count}件)` : ''}`;
  pasteBtn.disabled = !readClipboard();
  bar.hidden = false;
}

function shortDate(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

// ---------------------------------------------------------
// 操作:文字を入力・コピー・貼り付け・削除
// ---------------------------------------------------------
// 文字を入力:選んだ範囲に予定を作る(1マスに予定が1件だけあるときは、その名前を書き換える)
function openTextInput() {
  const r = range();
  if (!r) return;
  const inside = lessonsInRange(r);
  const renaming = r.dates.length === 1 && r.i1 === r.i2 && inside.length === 1;
  textInput.value = renaming ? inside[0].student : '';
  textTarget.textContent = renaming
    ? `「${inside[0].student || '(名前なし)'}」の名前を書き換えます`
    : `${r.dates.length}日分 × ${SLOTS[r.i1]}〜${fromMinutes(r.bottom)} に予定を作ります(種類・状態は前回と同じ)`;
  textDialog.showModal();
  textInput.focus();
}

async function saveText() {
  const text = textInput.value.trim();
  const r = range();
  textDialog.close();
  if (!text || !r) return;
  const inside = lessonsInRange(r);
  if (r.dates.length === 1 && r.i1 === r.i2 && inside.length === 1) {
    await store.saveLesson({ ...inside[0], student: text });
  } else {
    const last = store.getLastInput();
    await store.addLessons(r.dates.map(date => ({
      date, start: SLOTS[r.i1], duration: r.bottom - r.top,
      student: text, typeId: last.typeId, status: last.status, memo: '',
    })));
  }
  onChanged();
}

function readClipboard() {
  try { return JSON.parse(localStorage.getItem(CLIP_KEY)); } catch { return null; }
}

async function copySelection() {
  const r = range();
  if (!r) return;
  const items = lessonsInRange(r);
  if (!items.length) return showToast('コピーする予定がありません');
  // 選んだ範囲の左上からの「何日後・何分後」で覚える(貼り付け先でも同じ並びになる)
  const clip = items.map(l => ({
    dayOffset: daysBetween(r.dates[0], l.date),
    minOffset: toMinutes(l.start) - r.top,
    duration: l.duration, student: l.student, typeId: l.typeId, status: l.status, memo: l.memo || '',
  }));
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { /* 保存できなくても続ける */ }
  // ほかのアプリ(メモなど)にも貼れるよう、文字でもコピーしておく
  const text = items.map(l => `${shortDate(l.date)} ${l.start} ${l.student}(${l.duration}分)`).join('\n');
  navigator.clipboard?.writeText(text).catch(() => {});
  showToast(`${items.length}件コピーしました`);
  paint();
}

async function pasteSelection() {
  const r = range();
  const clip = readClipboard();
  if (!r || !clip?.length) return;
  const added = [];
  let skipped = 0;
  for (const c of clip) {
    const start = r.top + c.minOffset;
    if (start + c.duration > DAY_END) { skipped++; continue; }
    const { dayOffset, minOffset, ...rest } = c;
    added.push({ ...rest, date: addDays(r.dates[0], dayOffset), start: fromMinutes(start) });
  }
  if (added.length) await store.addLessons(added);
  showToast(`${added.length}件貼り付けました${skipped ? `(${skipped}件は24:00を過ぎるため省略)` : ''}`);
  onChanged();
}

async function deleteSelection() {
  const r = range();
  if (!r) return;
  const items = lessonsInRange(r);
  if (!items.length) return showToast('削除する予定がありません');
  const names = items.slice(0, 5).map(l => l.student || '(名前なし)').join('、') + (items.length > 5 ? ' ほか' : '');
  if (!confirm(`${items.length}件の予定を削除しますか?\n${names}`)) return;
  await store.deleteLessons(items.map(l => l.id));
  showToast(`${items.length}件削除しました`);
  onChanged();
}

// Mac のキーボード操作
function onKeyDown(e) {
  if (!anchor || document.querySelector('dialog[open]')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') clearSelection();
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); }
  else if (e.key === 'Enter') { e.preventDefault(); openTextInput(); }
  else if (mod && e.key === 'c') { e.preventDefault(); copySelection(); }
  else if (mod && e.key === 'v') { e.preventDefault(); pasteSelection(); }
}

// ---------------------------------------------------------
// 小さな道具
// ---------------------------------------------------------
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

let toastTimer = null;
function showToast(message) {
  toast.innerHTML = escapeHtml(message);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
}
