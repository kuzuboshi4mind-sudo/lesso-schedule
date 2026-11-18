// 前月の生徒で、表示中の月にまだ予定がない人を知らせる(2026-11-09)
// ・月の名前の横に、オレンジの「前月の生徒 未入力 n人」ボタン(いないときは出さない)
// ・押すと一覧:名前・前月の予定(日付と時刻)・「生徒の画面」ボタン(生徒メモ・固定枠・LINE はそこから)
// ・予定を入れると表を描き直すたびに数え直すので、入れた生徒は一覧から消える
// ・「外す」で手で一覧から外せる(2026-11-19):「この月だけ外す」か「今後も出さない」(サンパルなど生徒でないもの)。
//   外した人は一覧の下の「外した人」から戻せる。「戻す」でも元に戻せる
import * as store from './store.js';
import { escapeHtml } from './calendar.js';
import { openStudentByName } from './students.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const chip = document.getElementById('missing-chip');
const dialog = document.getElementById('missing-dialog');
const title = document.getElementById('missing-title');
const note = document.getElementById('missing-note');
const list = document.getElementById('missing-list');

let shown = { year: 0, month: 0, items: [], dismissed: [], types: [] };
let ticket = 0;   // 月を続けて切り替えたとき、古い結果で上書きしないように
let choosing = null;   // 「外す」を押して、外し方を選んでいる人の名前
let onChanged = () => {};

const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

export function initMissingStudents(opts = {}) {
  onChanged = opts.onChanged || onChanged;
  chip.addEventListener('click', () => { choosing = null; render(); dialog.showModal(); title.focus(); });
  dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
  list.addEventListener('click', onClick);
}

async function onClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const name = btn.dataset.name;
  const ym = ymOf(shown.year, shown.month);
  const act = btn.dataset.act;
  if (act === 'open') return openStudentByName(name);
  if (act === 'choose') { choosing = name; return render(); }
  if (act === 'cancel') { choosing = null; return render(); }
  btn.disabled = true;
  choosing = null;
  if (act === 'month') await store.dismissMissing(name, ym);
  else if (act === 'always') await store.dismissMissing(name, null);
  else if (act === 'restore') await store.undismissMissing(name, ym);
  onChanged();   // 表を描き直すと数え直して、この一覧も作り直す
}

// 表を描くたびに呼ぶ(lessons はその月に表に出している予定)
export async function updateMissingStudents(year, month, lessons, types) {
  const my = ++ticket;
  let result = { items: [], dismissed: [] };
  try {
    result = await store.getMissingFromPrevMonth(year, month, lessons);
  } catch (err) {
    console.warn(err);
  }
  if (my !== ticket) return;
  const { items, dismissed } = result;
  shown = { year, month, items, dismissed, types };
  chip.hidden = !items.length;
  chip.innerHTML = `<span class="btn-label">前月の生徒 </span>未入力 <strong>${items.length}人</strong>`;
  chip.setAttribute('aria-label', `前月に予定があって、${month}月にまだ予定がない生徒 ${items.length}人`);
  if (dialog.open) render();
}

function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

function prevText(s, prevMonth, typeById) {
  const type = typeById[s.typeId];
  const dates = s.prev.map(l => `${dateLabel(l.date)} ${l.start}`);
  const shownDates = dates.slice(0, 6).join('、') + (dates.length > 6 ? ` ほか${dates.length - 6}件` : '');
  return `${prevMonth}月:${escapeHtml(shownDates)}${type ? `(${escapeHtml(type.name)})` : ''}`;
}

function render() {
  const { month, items, dismissed, types } = shown;
  const prevMonth = month === 1 ? 12 : month - 1;
  const typeById = Object.fromEntries(types.map(t => [t.id, t]));
  const n = escapeHtml;
  title.textContent = `${month}月にまだ予定がない生徒`;
  note.textContent = items.length
    ? `${prevMonth}月にレッスンがあって、${month}月にはまだ1件も入っていない生徒です(${items.length}人)。予定を入れると一覧から消えます。生徒でないもの・もう来ない人は「外す」で外せます。`
    : '';
  const rows = items.map(s => {
    const swatch = `<span class="legend-swatch pastel counted" style="--type-color:${n(typeById[s.typeId]?.color || '#9e9e9e')}"></span>`;
    const actions = choosing === s.name
      ? `<div class="missing-choose">
           <button type="button" class="btn btn-small" data-act="month" data-name="${n(s.name)}">${month}月だけ外す</button>
           <button type="button" class="btn btn-small" data-act="always" data-name="${n(s.name)}">今後も出さない</button>
           <button type="button" class="btn btn-small" data-act="cancel" data-name="${n(s.name)}">やめる</button>
         </div>`
      : `<div class="missing-actions">
           <button type="button" class="btn btn-small" data-act="open" data-name="${n(s.name)}">生徒の画面</button>
           <button type="button" class="btn btn-small" data-act="choose" data-name="${n(s.name)}">外す</button>
         </div>`;
    return `<li class="missing-row${choosing === s.name ? ' choosing' : ''}">
      ${swatch}
      <div class="missing-main"><strong>${n(s.name)}</strong><small>${prevText(s, prevMonth, typeById)}</small></div>
      ${actions}
    </li>`;
  }).join('');
  const empty = items.length ? '' : `<li class="missing-empty">${prevMonth}月の生徒は、全員${month}月にも予定が入っています${dismissed.length ? '(外した人をのぞく)' : ''}</li>`;
  const off = dismissed.length
    ? `<li class="missing-off-head">外した人(${dismissed.length}人)</li>` + dismissed.map(s => `<li class="missing-row off">
        <div class="missing-main"><strong>${n(s.name)}</strong><small>${s.scope === 'always' ? '今後も出さない' : `${month}月だけ外した`}</small></div>
        <div class="missing-actions"><button type="button" class="btn btn-small" data-act="restore" data-name="${n(s.name)}">一覧に戻す</button></div>
      </li>`).join('')
    : '';
  list.innerHTML = rows + empty + off;
}
