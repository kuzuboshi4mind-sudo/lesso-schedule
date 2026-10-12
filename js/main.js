// アプリの起動と、月の切り替え
import { renderCalendar } from './calendar.js';

const table = document.getElementById('calendar');
const scroller = document.getElementById('calendar-scroll');
const title = document.getElementById('month-title');

// 表示中の年と月(month は 1〜12)
let current = readMonthFromUrl() || thisMonth();

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

function show() {
  title.textContent = `${current.year}年${current.month}月`;
  document.title = `${current.month}月 レッスンスケジュール`;
  history.replaceState(null, '', `#${current.year}-${String(current.month).padStart(2, '0')}`);
  renderCalendar(table, current.year, current.month);
  scrollToToday();
}

// 今日の列が見えるように横スクロールする(今日がない月は左端へ)
function scrollToToday() {
  const todayCell = table.querySelector('thead th.today');
  const timeColWidth = table.querySelector('.time-col').offsetWidth;
  scroller.scrollLeft = todayCell ? Math.max(0, todayCell.offsetLeft - timeColWidth - todayCell.offsetWidth * 2) : 0;
  scroller.scrollTop = 0;
}

function moveMonth(diff) {
  const d = new Date(current.year, current.month - 1 + diff, 1);
  current = { year: d.getFullYear(), month: d.getMonth() + 1 };
  show();
}

document.getElementById('prev-month').addEventListener('click', () => moveMonth(-1));
document.getElementById('next-month').addEventListener('click', () => moveMonth(1));
document.getElementById('this-month').addEventListener('click', () => {
  current = thisMonth();
  show();
});

show();
