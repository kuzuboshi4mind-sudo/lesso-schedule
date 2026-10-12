// 予定の入力画面(レッスン)と、日ごとのメモの入力画面
import * as store from './store.js';
import { escapeHtml, toMinutes, fromMinutes, textColorFor, START_HOUR } from './calendar.js';

const DAY_END = 24 * 60; // 24:00

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// "2026-10-05" → "10月5日(月)"
function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}月${d}日(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

// ---------------------------------------------------------
// レッスンの入力画面
// ---------------------------------------------------------
const dialog = document.getElementById('lesson-dialog');
const form = document.getElementById('lesson-form');
const f = {
  title: document.getElementById('lesson-dialog-title'),
  date: document.getElementById('lesson-date'),
  start: document.getElementById('lesson-start'),
  student: document.getElementById('lesson-student'),
  studentList: document.getElementById('student-names'),
  durations: document.getElementById('lesson-durations'),
  types: document.getElementById('lesson-types'),
  memo: document.getElementById('lesson-memo'),
  error: document.getElementById('lesson-error'),
  del: document.getElementById('lesson-delete'),
};

let editing = null;   // 編集中のレッスン(新規なら id なし)
let onChanged = () => {};

// 6:00〜23:45 を15分刻みで選べるようにする
for (let m = START_HOUR * 60; m < DAY_END; m += 15) {
  f.start.add(new Option(fromMinutes(m), fromMinutes(m)));
}

// 長さのボタンを並べる
for (const min of store.DURATIONS) {
  f.durations.insertAdjacentHTML('beforeend',
    `<label class="chip"><input type="radio" name="duration" value="${min}"><span>${min}分</span></label>`);
}

// 種類(色つき)のボタンを並べる
async function renderTypeChips() {
  const types = await store.getTypes();
  f.types.innerHTML = types.map(t =>
    `<label class="chip type-chip" style="--type-color:${t.color};--type-text:${textColorFor(t.color)}">
      <input type="radio" name="typeId" value="${escapeHtml(t.id)}"><span>${escapeHtml(t.name)}</span>
    </label>`).join('');
}

async function renderStudentNames() {
  const names = await store.getStudentNames();
  f.studentList.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

function check(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${CSS.escape(String(value))}"]`);
  if (input) input.checked = true;
}

// 新しく入れる(date:"2026-10-05", time:"13:00")
export async function openNewLesson(date, time) {
  const last = store.getLastInput();
  await openLesson({ date, start: time, duration: last.duration, student: '', typeId: last.typeId, memo: '' });
}

// 入っている予定を開く
export async function openExistingLesson(id) {
  const lesson = await store.getLesson(id);
  if (lesson) await openLesson(lesson);
}

async function openLesson(lesson) {
  editing = lesson;
  await Promise.all([renderTypeChips(), renderStudentNames()]);
  f.title.textContent = lesson.id ? '予定を編集' : '予定を追加';
  f.date.value = lesson.date;
  f.start.value = lesson.start;
  f.student.value = lesson.student;
  f.memo.value = lesson.memo || '';
  form.querySelectorAll('input[type="radio"]').forEach(r => { r.checked = false; });
  check('duration', lesson.duration);
  check('typeId', lesson.typeId);
  if (!form.querySelector('input[name="typeId"]:checked')) form.querySelector('input[name="typeId"]').checked = true;
  f.error.textContent = '';
  f.del.hidden = !lesson.id;
  dialog.showModal();
  // 新規のときは名前の欄にすぐ入力できるように(iPhone はキーボードが出る)
  if (!lesson.id) f.student.focus();
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const duration = Number(form.querySelector('input[name="duration"]:checked')?.value);
  const typeId = form.querySelector('input[name="typeId"]:checked')?.value;
  const start = f.start.value;
  const date = f.date.value;
  if (!date) { f.error.textContent = '日付を選んでください'; return; }
  if (!duration) { f.error.textContent = '長さを選んでください'; return; }
  if (toMinutes(start) + duration > DAY_END) { f.error.textContent = '24:00 を過ぎてしまいます。開始時刻か長さを変えてください'; return; }

  await store.saveLesson({
    ...editing,
    date,
    start,
    duration,
    typeId,
    student: f.student.value.trim(),
    memo: f.memo.value.trim(),
  });
  store.setLastInput(typeId, duration);
  dialog.close();
  onChanged();
});

f.del.addEventListener('click', async () => {
  if (!editing?.id) return;
  if (!confirm(`「${editing.student || '(名前なし)'}」の予定を削除しますか?`)) return;
  await store.deleteLesson(editing.id);
  dialog.close();
  onChanged();
});

// ---------------------------------------------------------
// 日ごとのメモ(「予定」の行)の入力画面
// ---------------------------------------------------------
const noteDialog = document.getElementById('note-dialog');
const noteForm = document.getElementById('note-form');
const noteDate = document.getElementById('note-date');
const noteText = document.getElementById('note-text');
let noteEditingDate = null;

export async function openDayNote(date, current) {
  noteEditingDate = date;
  noteDate.textContent = dateLabel(date);
  noteText.value = current || '';
  noteDialog.showModal();
  noteText.focus();
}

noteForm.addEventListener('submit', async e => {
  e.preventDefault();
  await store.saveDayNote(noteEditingDate, noteText.value);
  noteDialog.close();
  onChanged();
});

document.getElementById('note-clear').addEventListener('click', async () => {
  await store.saveDayNote(noteEditingDate, '');
  noteDialog.close();
  onChanged();
});

// ---------------------------------------------------------
// 共通
// ---------------------------------------------------------
// 「やめる」ボタンと、画面の外側のタップで閉じる
for (const d of [dialog, noteDialog]) {
  d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
}

// 保存・削除のあとに呼ぶ関数(表を描き直す)を登録する
export function setOnChanged(fn) {
  onChanged = fn;
}
