// 月表(30分刻み×日付)を描く
import { holidayName } from './holidays.js';

export const START_HOUR = 6;      // 表の最初の時刻 6:00
export const END_HOUR = 23;       // 最後の行は 23:30(24:00まで)
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 6:00, 6:30, ... 23:30 の一覧
export function timeSlots() {
  const slots = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    slots.push(`${h}:00`, `${h}:30`);
  }
  return slots;
}

// "2026-10-05" の形の文字列にする
export function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// その月の日付の情報を一覧にする(month は 1〜12)
export function monthDays(year, month, today = new Date()) {
  const count = new Date(year, month, 0).getDate(); // その月の日数(28〜31)
  const days = [];
  for (let d = 1; d <= count; d++) {
    const weekday = new Date(year, month - 1, d).getDay();
    const holiday = holidayName(year, month, d);
    days.push({
      day: d,
      key: dateKey(year, month, d),
      weekday,
      holiday,
      isOff: weekday === 0 || weekday === 6 || !!holiday,
      isToday: today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === d,
    });
  }
  return days;
}

// 列ごとの色分け用のクラス名(土日祝=off、今日=today)
function colClass(d) {
  return [d.isOff && 'off', d.isToday && 'today'].filter(Boolean).join(' ');
}

// 曜日の文字色用のクラス名
function weekdayClass(d) {
  if (d.weekday === 0 || d.holiday) return 'sun';
  if (d.weekday === 6) return 'sat';
  return '';
}

// 表の中身を作って table 要素に入れる
export function renderCalendar(table, year, month) {
  const days = monthDays(year, month);

  const dateRow = days.map(d =>
    `<th class="${colClass(d)} ${weekdayClass(d)}" data-date="${d.key}">${d.day}</th>`).join('');
  const weekRow = days.map(d =>
    `<th class="${colClass(d)} ${weekdayClass(d)}" data-date="${d.key}">${WEEKDAYS[d.weekday]}</th>`).join('');
  // 日ごとのメモ行(手順2で入力できるようにする)。今は祝日名だけ出す
  const memoRow = days.map(d =>
    `<th class="${colClass(d)}" data-date="${d.key}">${d.holiday ? `<span class="holiday-name">${d.holiday}</span>` : ''}</th>`).join('');

  const bodyRows = timeSlots().map(time => {
    const cells = days.map(d =>
      `<td class="${colClass(d)}" data-date="${d.key}" data-time="${time}"></td>`).join('');
    const isHour = time.endsWith(':00');
    return `<tr class="${isHour ? 'hour' : ''}"><th class="time-col" scope="row">${time}</th>${cells}</tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr class="row-date"><th class="time-col">時間</th>${dateRow}</tr>
      <tr class="row-week"><th class="time-col">曜日</th>${weekRow}</tr>
      <tr class="row-memo"><th class="time-col">予定</th>${memoRow}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>`;
}
