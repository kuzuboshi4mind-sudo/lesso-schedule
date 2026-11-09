// 前月の生徒で、表示中の月にまだ予定がない人を知らせる(2026-11-09)
// ・月の名前の横に、オレンジの「前月の生徒 未入力 n人」ボタン(いないときは出さない)
// ・押すと一覧:名前・前月の予定(日付と時刻)・「生徒の画面」ボタン(生徒メモ・固定枠・LINE はそこから)
// ・予定を入れると表を描き直すたびに数え直すので、入れた生徒は一覧から消える
import * as store from './store.js';
import { escapeHtml } from './calendar.js';
import { openStudentByName } from './students.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const chip = document.getElementById('missing-chip');
const dialog = document.getElementById('missing-dialog');
const title = document.getElementById('missing-title');
const note = document.getElementById('missing-note');
const list = document.getElementById('missing-list');

let shown = { year: 0, month: 0, items: [], types: [] };
let ticket = 0;   // 月を続けて切り替えたとき、古い結果で上書きしないように

export function initMissingStudents() {
  chip.addEventListener('click', () => { render(); dialog.showModal(); title.focus(); });
  dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-name]');
    if (btn) openStudentByName(btn.dataset.name);
  });
}

// 表を描くたびに呼ぶ(lessons はその月に表に出している予定)
export async function updateMissingStudents(year, month, lessons, types) {
  const my = ++ticket;
  let items = [];
  try {
    items = await store.getMissingFromPrevMonth(year, month, lessons);
  } catch (err) {
    console.warn(err);
  }
  if (my !== ticket) return;
  shown = { year, month, items, types };
  chip.hidden = !items.length;
  chip.innerHTML = `<span class="btn-label">前月の生徒 </span>未入力 <strong>${items.length}人</strong>`;
  chip.setAttribute('aria-label', `前月に予定があって、${month}月にまだ予定がない生徒 ${items.length}人`);
  if (dialog.open) render();
}

function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

function render() {
  const { month, items, types } = shown;
  const prevMonth = month === 1 ? 12 : month - 1;
  const typeById = Object.fromEntries(types.map(t => [t.id, t]));
  title.textContent = `${month}月にまだ予定がない生徒`;
  if (!items.length) {
    note.textContent = '';
    list.innerHTML = `<li class="missing-empty">${prevMonth}月の生徒は、全員${month}月にも予定が入っています</li>`;
    return;
  }
  note.textContent = `${prevMonth}月にレッスンがあって、${month}月にはまだ1件も入っていない生徒です(${items.length}人)。予定を入れると一覧から消えます。`;
  list.innerHTML = items.map(s => {
    const type = typeById[s.typeId];
    const dates = s.prev.map(l => `${dateLabel(l.date)} ${l.start}`);
    const shownDates = dates.slice(0, 6).join('、') + (dates.length > 6 ? ` ほか${dates.length - 6}件` : '');
    return `<li class="missing-row">
      <span class="legend-swatch pastel counted" style="--type-color:${escapeHtml(type?.color || '#9e9e9e')}"></span>
      <div class="missing-main">
        <strong>${escapeHtml(s.name)}</strong>
        <small>${prevMonth}月:${escapeHtml(shownDates)}${type ? `(${escapeHtml(type.name)})` : ''}</small>
      </div>
      <button type="button" class="btn btn-small" data-name="${escapeHtml(s.name)}">生徒の画面</button>
    </li>`;
  }).join('');
}
