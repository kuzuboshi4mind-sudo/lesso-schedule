// アプリの起動と、月の切り替え
import { renderCalendar, escapeHtml } from './calendar.js';
import * as store from './store.js';
import { openNewLesson, openExistingLesson, openDayNote, setOnChanged } from './editor.js';
import { initSelection, afterRender, handleTap, clearSelection } from './selection.js';
import { initSettings } from './settings.js';
import { initZoom, refreshZoom, fitDayHeight } from './zoom.js';
import { requireLogin, watchLogout, logout } from './login.js';
import { initTrashBackup, showLastBackup } from './trash-backup.js';
import { initRecurring } from './recurring.js';
import { initStudents } from './students.js';
import { initLineShare } from './line-share.js';
import { initSummary, updateSummary } from './summary.js';
import { initInlineEdit, editLessonInline, editCellInline } from './inline-edit.js';

const table = document.getElementById('calendar');
const scroller = document.getElementById('calendar-scroll');
const title = document.getElementById('month-title');
const monthStatus = document.getElementById('month-status');
const legend = document.getElementById('type-legend');

// アプリの版。更新するたびに変える(設定画面に出して、最新版が表示されているか確かめられるように)
const APP_VERSION = '送る予定は今月と来月だけ(2026-10-19)';
document.getElementById('app-version').textContent = `アプリの版:${APP_VERSION}`;

// 表示中の年と月(month は 1〜12)
let current = readMonthFromUrl() || thisMonth();
let dayNotes = {};
let shownLessons = [];   // 表に出している予定(ダブルタップの直接入力で使う)

// 表示のしかた:'month'=月の表、'day'=1日ビュー(スマホは開いた瞬間に1日ビュー。今日の1日を大きく)
const phoneQuery = window.matchMedia('(max-width: 600px), (max-height: 500px)');
let viewMode = phoneQuery.matches ? 'day' : 'month';
let selectedDate = readDayFromUrl() || defaultDay();
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const viewToggle = document.getElementById('view-toggle');
const thisMonthBtn = document.getElementById('this-month');

function pad(n) { return String(n).padStart(2, '0'); }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
// 表示中の月の中で、1日ビューに出す日(今日がその月なら今日、ちがえば1日)
function defaultDay() {
  const t = todayKey();
  return t.startsWith(`${current.year}-${pad(current.month)}`) ? t : `${current.year}-${pad(current.month)}-01`;
}
function readDayFromUrl() {
  const m = location.hash.match(/^#(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
}

function thisMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// URL の末尾(#2026-10 のような部分)から月を読む。再読み込みしても同じ月が出るように
function readMonthFromUrl() {
  const m = location.hash.match(/^#(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

// 表を描き直す(keepScroll:スクロール位置をそのままにする)
async function show({ keepScroll = false } = {}) {
  const { year, month } = current;
  const dayView = viewMode === 'day';
  if (dayView && !selectedDate.startsWith(`${year}-${pad(month)}`)) selectedDate = defaultDay();
  const [, , dd] = selectedDate.split('-').map(Number);
  title.textContent = dayView ? `${month}月${dd}日(${WEEKDAYS[new Date(year, month - 1, dd).getDay()]})` : `${year}年${month}月`;
  document.title = `${month}月 レッスンスケジュール`;
  history.replaceState(null, '', dayView ? `#${selectedDate}` : `#${year}-${pad(month)}`);
  document.body.classList.toggle('day-view', dayView);
  viewToggle.hidden = !phoneQuery.matches && !dayView;
  viewToggle.textContent = dayView ? '月表示' : '1日表示';
  thisMonthBtn.textContent = dayView ? '今日' : '今月';

  const [lessons, notes, types, rules, tentative] = await Promise.all([
    store.getLessons(year, month), store.getDayNotes(year, month), store.getTypes(), store.getDurationRules(),
    store.isTentativeMonth(year, month),
  ]);
  showMonthStatus(tentative);
  updateStudentsBadge();
  dayNotes = notes;
  shownLessons = lessons;
  const { scrollLeft, scrollTop } = scroller;
  renderCalendar(table, year, month, { lessons, dayNotes, types, onlyDate: dayView ? selectedDate : null });
  refreshZoom();
  renderLegend(types);
  updateSummary(year, month, lessons, types, rules);
  afterRender(lessons);
  if (keepScroll) {
    scroller.scrollLeft = scrollLeft;
    scroller.scrollTop = scrollTop;
  } else {
    scrollToToday();
  }
}

// 「👤 生徒」ボタンの数字:仮の予定があって、まだ LINE で送っていない生徒の人数(表を描くのを待たせないよう後ろで数える)
const studentsBadge = document.getElementById('students-badge');
function updateStudentsBadge() {
  store.countStudentsToContact().then(n => {
    studentsBadge.hidden = !n;
    studentsBadge.textContent = n;
    studentsBadge.title = `連絡が必要な生徒 ${n}人`;
  }).catch(() => { studentsBadge.hidden = true; });
}

// 仮の月:月の名前の横の印を「仮」に、表の見出しをオレンジの点線で囲む
function showMonthStatus(tentative) {
  monthStatus.textContent = tentative ? '仮' : '確定';
  monthStatus.setAttribute('aria-pressed', String(tentative));
  monthStatus.setAttribute('aria-label', tentative ? 'この月は仮です(タップで確定にする)' : 'この月は確定です(タップで仮にする)');
  document.body.classList.toggle('month-tentative', tentative);
  document.title = `${current.month}月${tentative ? '仮' : ''} レッスンスケジュール`;
}

monthStatus.addEventListener('click', async () => {
  const tentative = monthStatus.getAttribute('aria-pressed') !== 'true';
  showMonthStatus(tentative);   // 先に見た目を変える(保存は後ろで)
  await store.setTentativeMonth(current.year, current.month, tentative);
});

function renderLegend(types) {
  legend.innerHTML = types.map(t =>
    `<li><span class="legend-swatch pastel${t.countInTotal ? ' counted' : ''}" style="--type-color:${t.color}"></span>${escapeHtml(t.name)}</li>`).join('');
}

// 今日の列が見えるように横スクロールする(今日がない月は左端へ)
// 縦は 8:00 あたりから見えるようにする
function scrollToToday() {
  if (viewMode === 'day') scroller.scrollLeft = 0;
  const todayCell = viewMode === 'day' ? null : table.querySelector('thead th.today');
  const timeColWidth = table.querySelector('.time-col').offsetWidth;
  scroller.scrollLeft = todayCell ? Math.max(0, todayCell.offsetLeft - timeColWidth - todayCell.offsetWidth * 2) : 0;
  const eight = table.querySelector('td[data-time="8:00"]');
  const headHeight = table.querySelector('thead').offsetHeight;
  scroller.scrollTop = eight ? eight.offsetTop - headHeight : 0;
}

// 1日ビュー:前の日・次の日(月をまたぐときは、その月を読み込む)
function moveDay(diff) {
  clearSelection();
  const [y, m, d] = selectedDate.split('-').map(Number);
  const next = new Date(y, m - 1, d + diff);
  selectedDate = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  current = { year: next.getFullYear(), month: next.getMonth() + 1 };
  show();
}

function moveMonth(diff) {
  if (viewMode === 'day') return moveDay(diff);
  clearSelection();
  const d = new Date(current.year, current.month - 1 + diff, 1);
  current = { year: d.getFullYear(), month: d.getMonth() + 1 };
  show();
}

document.getElementById('prev-month').addEventListener('click', () => moveMonth(-1));
document.getElementById('next-month').addEventListener('click', () => moveMonth(1));
thisMonthBtn.addEventListener('click', () => {
  clearSelection();
  current = thisMonth();
  selectedDate = todayKey();
  show();
});

// 「月表示 / 1日表示」の切り替え(スマホ)
viewToggle.addEventListener('click', () => {
  clearSelection();
  viewMode = viewMode === 'day' ? 'month' : 'day';
  if (viewMode === 'day') selectedDate = defaultDay();
  show().then(fitDayHeight);
});

// 1日ビューでは、指で左右になぞると前後の日に移る
let swipe = null;
scroller.addEventListener('touchstart', e => {
  swipe = viewMode === 'day' && e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
}, { passive: true });
scroller.addEventListener('touchend', e => {
  if (!swipe || table.classList.contains('selecting') || scroller.classList.contains('drag-lock')) { swipe = null; return; }
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  const quick = Date.now() - swipe.t < 700;
  swipe = null;
  if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) moveDay(dx < 0 ? 1 : -1);
});

// 表のタップ:予定のブロック → 編集、空いたマス → 新規、「予定」の行 → 日ごとのメモ
// (長押しで選択中のときは、タップは選択の操作になる)
// ダブルタップ:マスや予定に直接文字を入力する(js/inline-edit.js)。
// 1回目のタップは、2回目が来ないと決まってから(DOUBLE_TAP_MS 後に)入力画面を開く
const DOUBLE_TAP_MS = 280;
let pendingTap = null;    // { key, timer }
table.addEventListener('click', e => {
  if (handleTap(e)) return;
  const memo = e.target.closest('th.day-memo');
  if (memo) return openDayNote(memo.dataset.date, dayNotes[memo.dataset.date]);
  const lessonEl = e.target.closest('.lesson');
  const cell = e.target.closest('td[data-date]');
  if (!lessonEl && !cell) return;
  const key = lessonEl ? `L:${lessonEl.dataset.id}` : `C:${cell.dataset.date} ${cell.dataset.time}`;
  if (pendingTap && pendingTap.key === key) {
    // 2回目のタップ → 直接入力
    clearTimeout(pendingTap.timer);
    pendingTap = null;
    const lesson = lessonEl && shownLessons.find(l => l.id === lessonEl.dataset.id);
    if (lesson) editLessonInline(lessonEl, lesson);
    else if (cell && !lessonEl) editCellInline(cell, cell.dataset.date, cell.dataset.time);
    return;
  }
  if (pendingTap) { clearTimeout(pendingTap.timer); pendingTap.run(); }
  const run = lessonEl
    ? () => openExistingLesson(lessonEl.dataset.id)
    : () => openNewLesson(cell.dataset.date, cell.dataset.time);
  pendingTap = { key, run, timer: setTimeout(() => { pendingTap = null; run(); }, DOUBLE_TAP_MS) };
});

// 保存・削除したら、スクロール位置はそのままで表を描き直す
setOnChanged(() => show({ keepScroll: true }));
initSelection({ table, scroller, onChanged: () => show({ keepScroll: true }) });
initInlineEdit({ scroller, onChanged: () => show({ keepScroll: true }) });
initSettings({ onChanged: () => show({ keepScroll: true }) });
initZoom({ table, scroller });
initTrashBackup({ getMonth: () => current, onChanged: () => show({ keepScroll: true }) });
document.getElementById('open-settings').addEventListener('click', showLastBackup);
initRecurring({ onChanged: () => show({ keepScroll: true }) });
initSummary();
initLineShare();
initStudents({ onChanged: () => show({ keepScroll: true }) });

// 保存やクラウドとの通信に失敗したら、内容を知らせる(気づかないまま消えないように)
window.addEventListener('unhandledrejection', e => {
  alert(e.reason?.message || '保存できませんでした。もう一度試してください。');
});

// 起動:クラウド保存ならログインを待ってから表を出す
async function start() {
  const user = await requireLogin();
  const info = document.getElementById('account-info');
  if (user) {
    info.textContent = `クラウドに保存しています(${user.email} でログイン中)。どの端末からも同じデータが見られます。`;
    const btn = document.getElementById('logout');
    btn.hidden = false;
    btn.addEventListener('click', logout);
    watchLogout();
  } else {
    info.textContent = 'この端末の中に保存しています(クラウドは未設定)。ほかの端末とは共有されません。';
  }
  show();
  // 30日より前にゴミ箱に入れた予定を完全に消す(失敗しても表示には影響しない)
  store.purgeOldTrash().catch(err => console.warn(err));
}

start();
