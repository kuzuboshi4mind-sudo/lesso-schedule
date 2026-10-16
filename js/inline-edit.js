// ダブルタップで、マスに直接文字を入力する(Numbers のセルに書き込むのと同じ感覚)
// ・空いたマスをダブルタップ → そのマスの上に入力欄が出る。決定で、その時刻から30分の予定を作る(種類・状態は前回と同じ)
// ・予定をダブルタップ → その予定の名前を書き換える(固定枠の予定は「この日だけ変更」になる)
// ・決定:return(改行)か、入力欄の外をタップ。やめる:esc。空のまま決定すると何もしない(予定は消さない)
// ・どれも「戻す」で元に戻せる
import * as store from './store.js';

const box = document.createElement('input');
box.type = 'text';
box.className = 'inline-edit';
box.autocomplete = 'off';
box.setAttribute('autocorrect', 'off');
box.setAttribute('autocapitalize', 'off');
box.spellcheck = false;
box.enterKeyHint = 'done';

let target = null;      // { el, lesson } か { el, date, time }
let onChanged = () => {};
let scroller = null;

export function initInlineEdit(opts) {
  ({ onChanged, scroller } = opts);
  box.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;   // 日本語の変換中の return は決定にしない
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();   // 表のキー操作(選択の矢印など)に渡さない
  });
  box.addEventListener('blur', () => commit());
  scroller?.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);
}

export function isInlineEditing() {
  return !!target;
}

// 予定のブロックを直接書き換える
export function editLessonInline(el, lesson) {
  open({ el, lesson }, lesson.student || '');
}

// 空いたマスに直接書き込む
export function editCellInline(el, date, time) {
  open({ el, date, time }, '');
}

function open(t, value) {
  if (target) commit();
  target = t;
  box.value = value;
  document.body.appendChild(box);
  place();
  // タップの操作の中で focus すると、iPad / iPhone でもキーボードが出る
  box.focus();
  box.select();
}

// 入力欄を、書き込むマス(予定)の上にぴったり重ねる
function place() {
  if (!target) return;
  if (!target.el.isConnected) { close(); return; }
  const r = target.el.getBoundingClientRect();
  const height = Math.max(r.height, 30);
  Object.assign(box.style, {
    left: `${Math.round(r.left)}px`,
    top: `${Math.round(r.top + Math.min(0, (r.height - height) / 2))}px`,
    width: `${Math.round(Math.max(r.width, 140))}px`,
    height: `${Math.round(Math.min(height, 44))}px`,
  });
}

async function commit() {
  if (!target) return;
  const t = target;
  const text = box.value.trim();
  close();
  if (!text) return;
  if (t.lesson) {
    if (text === t.lesson.student) return;
    await store.saveLesson({ ...t.lesson, student: text });
  } else {
    const last = store.getLastInput();
    await store.saveLesson({
      date: t.date, start: t.time, duration: 30,
      student: text, typeId: last.typeId, status: last.status, memo: '',
    });
  }
  onChanged();
}

function close() {
  target = null;
  if (box.isConnected) box.remove();
}
