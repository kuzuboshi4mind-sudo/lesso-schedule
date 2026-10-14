// マスの選択(Numbers のような操作)
// ・長押し → そのマスを選択。指を離さずになぞると範囲を選択できる
// ・選んである範囲に指を置いてなぞる → 長押しなしで範囲を広げられる(Numbers の範囲の端をドラッグするのと同じ)
// ・選択中にタップ → そのマスだけを選択し直す
// ・⇧(Shift)を押しながら長押し・タップ・クリック → 離れたマスを追加で選ぶ(複数選択)。
//   もう一度 ⇧+タップすると、そのマスの選択を外す。キーボードがないときは操作バーの「⇧ 追加選択」を使う
// ・下に出る操作バーで「文字を入力」「コピー」「貼り付け」「削除」
// ・「戻す」「やり直す」で、直前の操作を取り消す/もう一度行う
// ・Mac のキー操作(選択中):矢印で移動、Shift+矢印で範囲、⌘A 全部、⌘C コピー、⌘X 切り取り、⌘V 貼り付け、
//   delete 削除、return 編集(予定が1件なら入力画面、それ以外は文字を入力)、esc 選択をやめる
//   (いつでも):⌘Z 元に戻す、⇧⌘Z / ⌘Y やり直す
import * as store from './store.js';
import { openExistingLesson } from './editor.js';
import { timeSlots, toMinutes, fromMinutes, escapeHtml } from './calendar.js';

const LONG_PRESS_MS = 450;    // 長押しと判定する時間
const MOVE_TOLERANCE = 10;    // これ以上指が動いたら、長押しではなくスクロールとみなす
const DAY_END = 24 * 60;
const SLOTS = timeSlots();
const CLIP_KEY = 'lesso.clipboard';

let table, scroller, onChanged;
let lessons = [];            // 表示中の月の予定
let anchor = null;           // いま選んでいる範囲の起点 { date, idx }(idx は時刻の行番号)
let focus = null;            // いま選んでいる範囲の終点
let others = [];             // 複数選択のとき、ほかに選んである範囲 [{ anchor, focus }, ...]
let multiMode = false;       // 操作バーの「⇧ 追加選択」がオンのとき true
let pressAdd = false;        // 長押しを始めたときに ⇧ が押されていたか
let dragging = false;        // 長押しのあと、なぞって範囲を選んでいる最中
let dragMoved = false;       // なぞる操作で実際に指が動いたか(動かなければタップとして扱う)
let pressTimer = null;
let pressStart = null;
let suppressClickUntil = 0;  // 長押しの指を離した直後に来るタップを無視する(この時刻まで)
let lastTouchAt = 0;         // タッチ操作のあとに来る、まねのマウス操作を無視する

const bar = document.getElementById('selection-bar');
const barInfo = document.getElementById('selection-info');
const pasteBtn = document.getElementById('sel-paste');
const undoBtn = document.getElementById('sel-undo');
const redoBtn = document.getElementById('sel-redo');
const multiBtn = document.getElementById('sel-multi');
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
    if (cell) startSelection(cell, e.shiftKey || e.metaKey || multiMode);
  });

  document.getElementById('sel-text').addEventListener('click', openTextInput);
  document.getElementById('sel-copy').addEventListener('click', () => copySelection());
  pasteBtn.addEventListener('click', pasteSelection);
  document.getElementById('sel-delete').addEventListener('click', deleteSelection);
  document.getElementById('sel-done').addEventListener('click', clearSelection);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  multiBtn.addEventListener('click', () => { multiMode = !multiMode; paint(); });
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
    if (e.shiftKey || e.metaKey || multiMode) toggleCell(cell);
    else { others = []; anchor = focus = cell; }
    paint();
  }
  return true;
}

export function clearSelection() {
  anchor = focus = null;
  others = [];
  multiMode = false;
  endDrag();
  paint();
}

function sameCell(a, b) {
  return a.date === b.date && a.idx === b.idx;
}

// 複数選択:そのマスだけの選択がすでにあれば外す、なければ追加する
function toggleCell(cell) {
  const pieces = [...others, { anchor, focus }];
  const i = pieces.findIndex(p => sameCell(p.anchor, cell) && sameCell(p.focus, cell));
  if (i >= 0) {
    pieces.splice(i, 1);
    if (!pieces.length) { anchor = focus = null; others = []; return; }
  } else {
    pieces.push({ anchor: cell, focus: cell });
  }
  ({ anchor, focus } = pieces.pop());
  others = pieces;
}

// ---------------------------------------------------------
// 長押しとなぞり
// ---------------------------------------------------------
function onTouchStart(e) {
  lastTouchAt = Date.now();
  if (e.touches.length !== 1) { endDrag(); return cancelPress(); }
  const t = e.touches[0];
  // 選んである範囲の上に指を置いたときは、長押しを待たずになぞって広げられるようにする
  const cell = anchor && cellAt(t.clientX, t.clientY);
  if (cell && isInActiveRange(cell)) {
    cancelPress();
    beginDrag(false);
    return;
  }
  beginPress(t.clientX, t.clientY, e.shiftKey);
}

function onTouchMove(e) {
  lastTouchAt = Date.now();
  const t = e.touches[0];
  if (dragging) {
    e.preventDefault();           // なぞっている間は表をスクロールさせない
    dragMoved = true;
    extendTo(t.clientX, t.clientY);
  } else if (pressStart && moved(t.clientX, t.clientY)) {
    cancelPress();
  }
}

function onMouseDown(e) {
  if (e.button !== 0 || Date.now() - lastTouchAt < 800) return;
  // Mac:選んである範囲の上で押してドラッグすると、範囲を広げられる
  const cell = anchor && !e.shiftKey && !e.metaKey && cellAt(e.clientX, e.clientY);
  if (cell && isInActiveRange(cell)) { beginDrag(false); return; }
  beginPress(e.clientX, e.clientY, e.shiftKey || e.metaKey);
}

function onMouseMove(e) {
  if (Date.now() - lastTouchAt < 800) return;
  if (dragging) { dragMoved = true; extendTo(e.clientX, e.clientY); }
  else if (pressStart && moved(e.clientX, e.clientY)) cancelPress();
}

function beginPress(x, y, add) {
  cancelPress();
  const cell = cellAt(x, y);
  if (!cell) return;
  pressStart = { x, y };
  pressAdd = add || multiMode;
  pressTimer = setTimeout(() => {
    pressTimer = null;
    startSelection(cell, pressAdd);
    beginDrag(true);
  }, LONG_PRESS_MS);
}

// なぞる操作を始める。fromLongPress:長押しから始まったか(そのときは指を離したあとのタップを無視する)
function beginDrag(fromLongPress) {
  dragging = true;
  dragMoved = fromLongPress;
  scroller.classList.add('drag-lock');   // なぞっている間は表を動かさない(iPad でスクロールに取られないように)
}

function endDrag() {
  dragging = false;
  scroller.classList.remove('drag-lock');
}

function onPressEnd() {
  cancelPress();
  if (dragging) {
    // 指が動いていなければふつうのタップとして扱う(選び直し)
    if (dragMoved) suppressClickUntil = Date.now() + 350;
    endDrag();
  }
}

// いま選んでいる範囲(最後に選んだ範囲)の中のマスか
function isInActiveRange(cell) {
  const r = range();
  return !!r && r.dates.includes(cell.date) && cell.idx >= r.i1 && cell.idx <= r.i2;
}

function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
  pressStart = null;
}

function moved(x, y) {
  return Math.hypot(x - pressStart.x, y - pressStart.y) > MOVE_TOLERANCE;
}

// add が true なら、いまの選択を残したまま新しい範囲を足す(複数選択)
function startSelection(cell, add = false) {
  if (add && anchor) others.push({ anchor, focus });
  else others = [];
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

// 起点と終点から範囲を作る { dates:[日付...], i1, i2, top:開始の分, bottom:終わりの分 }
function toRange(a, f, cols = dateColumns()) {
  const c1 = cols.indexOf(a.date), c2 = cols.indexOf(f.date);
  if (c1 < 0 || c2 < 0) return null;
  const i1 = Math.min(a.idx, f.idx), i2 = Math.max(a.idx, f.idx);
  return {
    dates: cols.slice(Math.min(c1, c2), Math.max(c1, c2) + 1),
    c1: Math.min(c1, c2),
    i1, i2,
    top: toMinutes(SLOTS[i1]),
    bottom: toMinutes(SLOTS[i2]) + 30,
  };
}

// いま選んでいる範囲(複数選択のときは最後に選んだもの)
function range() {
  return anchor ? toRange(anchor, focus) : null;
}

// 選んでいるすべての範囲
function ranges() {
  if (!anchor) return [];
  const cols = dateColumns();
  return [...others, { anchor, focus }].map(p => toRange(p.anchor, p.focus, cols)).filter(Boolean);
}

// 1マスだけを選んでいるか
function isSingleCell() {
  const rs = ranges();
  return rs.length === 1 && rs[0].dates.length === 1 && rs[0].i1 === rs[0].i2;
}

// 範囲の中で始まる予定
function lessonsInRange(r) {
  return lessons.filter(l => r.dates.includes(l.date) && toMinutes(l.start) >= r.top && toMinutes(l.start) < r.bottom);
}

// 選んでいるすべての範囲の中の予定(重なりは1件として数える)
function lessonsInSelection() {
  const seen = new Map();
  for (const r of ranges()) for (const l of lessonsInRange(r)) seen.set(l.id, l);
  return [...seen.values()];
}

function paint() {
  table.querySelectorAll('td.sel').forEach(td => td.classList.remove('sel'));
  const rs = ranges();
  const r = rs[rs.length - 1];
  table.classList.toggle('selecting', !!r);
  document.body.classList.toggle('has-selection', !!r);  // 操作バーの分、表の下に余白を作る
  if (!r) {
    bar.hidden = true;
    return;
  }
  for (const each of rs) {
    for (const date of each.dates) {
      for (let i = each.i1; i <= each.i2; i++) {
        table.querySelector(`td[data-date="${date}"][data-time="${SLOTS[i]}"]`)?.classList.add('sel');
      }
    }
  }
  const count = lessonsInSelection().length;
  const countText = count ? `(予定${count}件)` : '';
  if (rs.length > 1) {
    barInfo.textContent = `${rs.length}か所を選択${countText}`;
  } else {
    const first = shortDate(r.dates[0]);
    const last = shortDate(r.dates[r.dates.length - 1]);
    const days = r.dates.length > 1 ? `${first}〜${last}` : first;
    barInfo.textContent = `${days} ${SLOTS[r.i1]}〜${fromMinutes(r.bottom)}${countText}`;
  }
  multiBtn.setAttribute('aria-pressed', String(multiMode));
  pasteBtn.disabled = !readClipboard();
  undoBtn.disabled = !store.canUndo();
  redoBtn.disabled = !store.canRedo();
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
// 1マスに予定が1件だけのときは、その予定(名前の書き換え・編集の対象)
function singleLesson() {
  if (!isSingleCell()) return null;
  const inside = lessonsInSelection();
  return inside.length === 1 ? inside[0] : null;
}

function openTextInput() {
  const rs = ranges();
  if (!rs.length) return;
  const target = singleLesson();
  textInput.value = target ? target.student : '';
  const r = rs[0];
  const count = rs.reduce((n, each) => n + each.dates.length, 0);
  textTarget.textContent = target
    ? `「${target.student || '(名前なし)'}」の名前を書き換えます`
    : rs.length > 1
      ? `選んだ${rs.length}か所に、合わせて${count}件の予定を作ります(種類・状態は前回と同じ)`
      : `${r.dates.length}日分 × ${SLOTS[r.i1]}〜${fromMinutes(r.bottom)} に予定を作ります(種類・状態は前回と同じ)`;
  textDialog.showModal();
  textInput.focus();
}

async function saveText() {
  const text = textInput.value.trim();
  const rs = ranges();
  textDialog.close();
  if (!text || !rs.length) return;
  const target = singleLesson();
  if (target) {
    await store.saveLesson({ ...target, student: text });
  } else {
    // 範囲ごと・日ごとに1件ずつ作る
    const last = store.getLastInput();
    await store.addLessons(rs.flatMap(r => r.dates.map(date => ({
      date, start: SLOTS[r.i1], duration: r.bottom - r.top,
      student: text, typeId: last.typeId, status: last.status, memo: '',
    }))), `文字を入力「${text}」`);
  }
  onChanged();
}

function readClipboard() {
  try { return JSON.parse(localStorage.getItem(CLIP_KEY)); } catch { return null; }
}

async function copySelection({ cut = false } = {}) {
  const rs = ranges();
  if (!rs.length) return;
  const items = lessonsInSelection();
  if (!items.length) return showToast(`${cut ? '切り取る' : 'コピーする'}予定がありません`);
  // 選んだ範囲(複数なら全体)の左上からの「何日後・何分後」で覚える(貼り付け先でも同じ並びになる)
  const left = rs.reduce((a, b) => (b.c1 < a.c1 ? b : a)).dates[0];
  const top = Math.min(...rs.map(r => r.top));
  const clip = items.map(l => ({
    dayOffset: daysBetween(left, l.date),
    minOffset: toMinutes(l.start) - top,
    duration: l.duration, student: l.student, typeId: l.typeId, status: l.status, memo: l.memo || '',
  }));
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { /* 保存できなくても続ける */ }
  // ほかのアプリ(メモなど)にも貼れるよう、文字でもコピーしておく
  const text = items.map(l => `${shortDate(l.date)} ${l.start} ${l.student}(${l.duration}分)`).join('\n');
  navigator.clipboard?.writeText(text).catch(() => {});
  if (cut) {
    await store.deleteLessons(items.map(l => l.id), '切り取り');
    showToast(`${items.length}件切り取りました`);
    onChanged();
  } else {
    showToast(`${items.length}件コピーしました`);
    paint();
  }
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
  if (added.length) await store.addLessons(added, '貼り付け');
  showToast(`${added.length}件貼り付けました${skipped ? `(${skipped}件は24:00を過ぎるため省略)` : ''}`);
  onChanged();
}

async function deleteSelection() {
  if (!anchor) return;
  const items = lessonsInSelection();
  if (!items.length) return showToast('削除する予定がありません');
  // 「戻す」で元に戻せるので、確認は出さない(Numbers と同じ)
  await store.deleteLessons(items.map(l => l.id));
  showToast(`${items.length}件削除しました(「戻す」で元に戻せます)`);
  onChanged();
}

// 元に戻す・やり直す
async function undo() {
  const label = await store.undo();
  showToast(label ? `元に戻しました:${label}` : 'これ以上戻せません');
  if (label) onChanged(); else paint();
}

async function redo() {
  const label = await store.redo();
  showToast(label ? `やり直しました:${label}` : 'やり直す操作がありません');
  if (label) onChanged(); else paint();
}

// return:1マスに予定が1件ならその入力画面、それ以外は「文字を入力」
function editSelection() {
  if (!anchor) return;
  const target = singleLesson();
  if (target) openExistingLesson(target.id);
  else openTextInput();
}

// 矢印キー:選択を動かす(Shift を押しながらだと範囲を広げる)
function moveSelection(dCol, dRow, extend) {
  const cols = dateColumns();
  if (!anchor) {
    // まだ何も選んでいなければ、今日(なければ1日)の 10:00 から始める
    const today = table.querySelector('thead .row-date th.today')?.dataset.date;
    anchor = focus = { date: today || cols[0], idx: SLOTS.indexOf('10:00') };
  } else {
    const from = extend ? focus : anchor;
    const col = Math.min(cols.length - 1, Math.max(0, cols.indexOf(from.date) + dCol));
    const idx = Math.min(SLOTS.length - 1, Math.max(0, from.idx + dRow));
    const next = { date: cols[col], idx };
    if (extend) focus = next;
    else { anchor = focus = next; others = []; }
  }
  paint();
  table.querySelector(`td[data-date="${focus.date}"][data-time="${SLOTS[focus.idx]}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function selectAll() {
  const cols = dateColumns();
  others = [];
  anchor = { date: cols[0], idx: 0 };
  focus = { date: cols[cols.length - 1], idx: SLOTS.length - 1 };
  paint();
}

// Mac のキーボード操作(iPad に外付けキーボードをつないだときも同じ)
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function onKeyDown(e) {
  // 入力画面が開いているとき・文字を打っているときは、キーをそのまま入力に使う
  if (document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  // いつでも使える:元に戻す・やり直す
  if (mod && key === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && key === 'y') { e.preventDefault(); return redo(); }
  if (mod && key === 'a') { e.preventDefault(); return selectAll(); }
  if (ARROWS[e.key] && !mod) {
    e.preventDefault();
    return moveSelection(...ARROWS[e.key], e.shiftKey);
  }

  // ここから下は、マスを選んでいるときだけ
  if (!anchor) return;
  if (e.key === 'Escape') clearSelection();
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); }
  else if (e.key === 'Enter') { e.preventDefault(); editSelection(); }
  else if (mod && key === 'c') { e.preventDefault(); copySelection(); }
  else if (mod && key === 'x') { e.preventDefault(); copySelection({ cut: true }); }
  else if (mod && key === 'v') { e.preventDefault(); pasteSelection(); }
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
