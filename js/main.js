// アプリの起動と、月の切り替え
import { renderCalendar, escapeHtml } from './calendar.js';
import * as store from './store.js';
import { openNewLesson, openExistingLesson, openDayNote, setOnChanged } from './editor.js';
import { initSelection, afterRender, handleTap, clearSelection } from './selection.js';
import { initSettings } from './settings.js';
import { initZoom, refreshZoom } from './zoom.js';
import { requireLogin, watchLogout, logout } from './login.js';
import { initTrashBackup, showLastBackup } from './trash-backup.js';
import { initRecurring } from './recurring.js';
import { initSummary, updateSummary } from './summary.js';

const table = document.getElementById('calendar');
const scroller = document.getElementById('calendar-scroll');
const title = document.getElementById('month-title');
const legend = document.getElementById('type-legend');

// アプリの版。更新するたびに変える(設定画面に出して、最新版が表示されているか確かめられるように)
const APP_VERSION = '手順8+スマホの行(2026-10-15)';
document.getElementById('app-version').textContent = `アプリの版:${APP_VERSION}`;

// 表示中の年と月(month は 1〜12)
let current = readMonthFromUrl() || thisMonth();
let dayNotes = {};

function thisMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// URL の末尾(#2026-10 のような部分)から月を読む。再読み込みしても同じ月が出るように
function readMonthFromUrl() {
  const m = location.hash.match(/^#(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

// 表を描き直す(keepScroll:スクロール位置をそのままにする)
async function show({ keepScroll = false } = {}) {
  const { year, month } = current;
  title.textContent = `${year}年${month}月`;
  document.title = `${month}月 レッスンスケジュール`;
  history.replaceState(null, '', `#${year}-${String(month).padStart(2, '0')}`);

  const [lessons, notes, types, rules] = await Promise.all([
    store.getLessons(year, month), store.getDayNotes(year, month), store.getTypes(), store.getDurationRules(),
  ]);
  dayNotes = notes;
  const { scrollLeft, scrollTop } = scroller;
  renderCalendar(table, year, month, { lessons, dayNotes, types });
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

function renderLegend(types) {
  legend.innerHTML = types.map(t =>
    `<li><span class="legend-swatch" style="background:${t.color}"></span>${escapeHtml(t.name)}</li>`).join('');
}

// 今日の列が見えるように横スクロールする(今日がない月は左端へ)
// 縦は 8:00 あたりから見えるようにする
function scrollToToday() {
  const todayCell = table.querySelector('thead th.today');
  const timeColWidth = table.querySelector('.time-col').offsetWidth;
  scroller.scrollLeft = todayCell ? Math.max(0, todayCell.offsetLeft - timeColWidth - todayCell.offsetWidth * 2) : 0;
  const eight = table.querySelector('td[data-time="8:00"]');
  const headHeight = table.querySelector('thead').offsetHeight;
  scroller.scrollTop = eight ? eight.offsetTop - headHeight : 0;
}

function moveMonth(diff) {
  clearSelection();
  const d = new Date(current.year, current.month - 1 + diff, 1);
  current = { year: d.getFullYear(), month: d.getMonth() + 1 };
  show();
}

document.getElementById('prev-month').addEventListener('click', () => moveMonth(-1));
document.getElementById('next-month').addEventListener('click', () => moveMonth(1));
document.getElementById('this-month').addEventListener('click', () => {
  clearSelection();
  current = thisMonth();
  show();
});

// 表のタップ:予定のブロック → 編集、空いたマス → 新規、「予定」の行 → 日ごとのメモ
// (長押しで選択中のときは、タップは選択の操作になる)
table.addEventListener('click', e => {
  if (handleTap(e)) return;
  const lesson = e.target.closest('.lesson');
  if (lesson) return openExistingLesson(lesson.dataset.id);
  const memo = e.target.closest('th.day-memo');
  if (memo) return openDayNote(memo.dataset.date, dayNotes[memo.dataset.date]);
  const cell = e.target.closest('td[data-date]');
  if (cell) return openNewLesson(cell.dataset.date, cell.dataset.time);
});

// 保存・削除したら、スクロール位置はそのままで表を描き直す
setOnChanged(() => show({ keepScroll: true }));
initSelection({ table, scroller, onChanged: () => show({ keepScroll: true }) });
initSettings({ onChanged: () => show({ keepScroll: true }) });
initZoom({ table, scroller });
initTrashBackup({ getMonth: () => current, onChanged: () => show({ keepScroll: true }) });
document.getElementById('open-settings').addEventListener('click', showLastBackup);
initRecurring({ onChanged: () => show({ keepScroll: true }) });
initSummary();

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
