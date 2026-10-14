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

// 文字を画面に出すときの安全対策(< や & をそのまま表示する)
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "13:15" → 795(0時からの分)
export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// 795 → "13:15"
export function fromMinutes(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// 背景色に合わせて、読みやすい文字色(黒か白)を選ぶ
export function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1c2b2a' : '#ffffff';
}

// 同じ日に時間が重なるレッスンを、横に並べるための位置を決める
// 戻り値:Map(レッスンのid → { lane:何列目, lanes:全部で何列 })
function layoutLanes(lessons) {
  const result = new Map();
  const sorted = [...lessons].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const l of group) {
      const start = toMinutes(l.start);
      let lane = laneEnds.findIndex(end => end <= start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = start + l.duration;
      result.set(l.id, { lane, lanes: 0 });
    }
    for (const l of group) result.get(l.id).lanes = laneEnds.length;
    group = [];
  };
  for (const l of sorted) {
    const start = toMinutes(l.start);
    if (group.length && start >= groupEnd) flush();
    group.push(l);
    groupEnd = Math.max(groupEnd, start + l.duration);
  }
  flush();
  return result;
}

const STATUS_LABEL = { tentative: '仮', confirmed: '確約', cancelled: 'キャンセル', none: '' };

// レッスン1件のブロック(マスの中に重ねて表示する色付きの帯)
// 確約=濃い色+○、仮=薄い色、キャンセル=灰色+×、なし(自分の予定)=左に色の線
function lessonBlock(lesson, type, pos) {
  const offset = toMinutes(lesson.start) % 30;      // マスの上端から何分ずれているか
  const color = type ? type.color : '#9e9e9e';
  const status = lesson.status || 'tentative';
  const width = 100 / pos.lanes;
  const memoMark = lesson.memo ? '<span class="lesson-memo-mark">✎</span>' : '';
  const repeatMark = lesson.recurring ? '<span class="lesson-repeat-mark" title="毎週の固定枠">↻</span>' : '';
  // 長さの表示:30分は省略、2時間を超える予定は終了時刻
  const end = fromMinutes(toMinutes(lesson.start) + lesson.duration);
  const durationLabel = lesson.duration > 120 ? `<span class="lesson-dur">〜${end}</span>`
    : lesson.duration !== 30 ? `<span class="lesson-dur">${lesson.duration}分</span>` : '';
  const name = escapeHtml(lesson.student || '(名前なし)');
  const label = status === 'confirmed' ? `${name}<span class="lesson-mark">○</span>`
    : status === 'cancelled' ? `<span class="lesson-mark">×</span>${name}`
    : name;
  const tip = `${STATUS_LABEL[status] ?? ''} ${lesson.start}〜${end}(${lesson.duration}分) ${type ? type.name : ''}${lesson.memo ? '\n' + lesson.memo : ''}`;
  // 文字色は確約(濃い色の上)だけ背景に合わせて決める。仮・キャンセルは CSS で決める
  const textColor = status === 'confirmed' ? `color:${textColorFor(color)};` : '';
  return `<button type="button" class="lesson ${status}${lesson.duration <= 20 ? ' short' : ''}" data-id="${escapeHtml(lesson.id)}"
    title="${escapeHtml(tip)}"
    style="--offset:${offset};--dur:${lesson.duration};--type-color:${color};${textColor}left:${pos.lane * width}%;width:${width}%">
    <span class="lesson-name">${label}</span>${durationLabel}${memoMark}${repeatMark}
  </button>`;
}

// 表の中身を作って table 要素に入れる
// data = { lessons:[...], dayNotes:{日付:文字}, types:[...] }
export function renderCalendar(table, year, month, data = {}) {
  const { lessons = [], dayNotes = {}, types = [] } = data;
  const days = monthDays(year, month);
  const typeById = Object.fromEntries(types.map(t => [t.id, t]));

  // レッスンを「日付|30分のマスの時刻」ごとに分けておく
  const lanesByDate = {};
  for (const d of days) lanesByDate[d.key] = layoutLanes(lessons.filter(l => l.date === d.key));
  const blocksBySlot = {};
  for (const l of lessons) {
    const slot = fromMinutes(Math.floor(toMinutes(l.start) / 30) * 30);
    const k = `${l.date}|${slot}`;
    (blocksBySlot[k] ||= []).push(lessonBlock(l, typeById[l.typeId], lanesByDate[l.date].get(l.id)));
  }

  const dateRow = days.map(d =>
    `<th class="${colClass(d)} ${weekdayClass(d)}" data-date="${d.key}">${d.day}</th>`).join('');
  const weekRow = days.map(d =>
    `<th class="${colClass(d)} ${weekdayClass(d)}" data-date="${d.key}">${WEEKDAYS[d.weekday]}</th>`).join('');
  // 日ごとのメモ行。タップで入力できる。祝日名もここに出す
  const memoRow = days.map(d => {
    const holiday = d.holiday ? `<span class="holiday-name">${d.holiday}</span>` : '';
    const note = dayNotes[d.key] ? `<span class="day-note">${escapeHtml(dayNotes[d.key])}</span>` : '';
    return `<th class="day-memo ${colClass(d)}" data-date="${d.key}">${holiday}${note}</th>`;
  }).join('');

  const bodyRows = timeSlots().map(time => {
    const cells = days.map(d => {
      const blocks = blocksBySlot[`${d.key}|${time}`];
      return `<td class="${colClass(d)}" data-date="${d.key}" data-time="${time}">${blocks ? `<div class="slot">${blocks.join('')}</div>` : ''}</td>`;
    }).join('');
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
