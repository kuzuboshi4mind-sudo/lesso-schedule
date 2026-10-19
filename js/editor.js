// 予定の入力画面(レッスン)と、日ごとのメモの入力画面
import * as store from './store.js';
import { escapeHtml, toMinutes, fromMinutes, textColorFor, START_HOUR } from './calendar.js';
import { openLineShare } from './line-share.js';

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
  suggest: document.getElementById('student-suggest'),
  studentMemo: document.getElementById('lesson-student-memo'),
  durations: document.getElementById('lesson-durations'),
  endField: document.getElementById('lesson-end-field'),
  end: document.getElementById('lesson-end'),
  endLength: document.getElementById('lesson-end-length'),
  statuses: document.getElementById('lesson-statuses'),
  types: document.getElementById('lesson-types'),
  memo: document.getElementById('lesson-memo'),
  memoLabel: document.getElementById('lesson-memo-label'),
  memoHint: document.getElementById('lesson-memo-hint'),
  line: document.getElementById('lesson-line'),
  error: document.getElementById('lesson-error'),
  recurringInfo: document.getElementById('lesson-recurring-info'),
  repeatField: document.getElementById('repeat-field'),
  repeat: document.getElementById('lesson-repeat'),
  repeatEndField: document.getElementById('repeat-end-field'),
  repeatEnd: document.getElementById('lesson-repeat-end'),
  del: document.getElementById('lesson-delete'),
};

let editing = null;   // 編集中のレッスン(新規なら id なし)
let onChanged = () => {};
let studentNames = []; // 前に入れた名前(候補用)
let studentMemos = []; // 生徒メモ(名前の下に出す用)
let typeList = [];     // 種類の一覧(メモの欄を生徒メモにするか決める用)
let memoMode = 'lesson';   // 'student'=メモの欄は生徒メモ、'lesson'=この予定だけのメモ
let memoDirty = false;     // メモの欄を手で直したか(直したあとは自動で入れ替えない)

// 6:00〜23:45 を15分刻みで選べるようにする
for (let m = START_HOUR * 60; m < DAY_END; m += 15) {
  f.start.add(new Option(fromMinutes(m), fromMinutes(m)));
}

let durations = [];   // 長さの選択肢(設定画面の換算表から)

// 長さのボタンを並べる。最後に「終了時刻で指定」(長い予定用)
async function renderDurationChips() {
  durations = await store.getDurations();
  f.durations.innerHTML = durations.map(min =>
    `<label class="chip"><input type="radio" name="duration" value="${min}"><span>${min}分</span></label>`).join('')
    + `<label class="chip"><input type="radio" name="duration" value="end"><span>終了時刻で指定</span></label>`;
}

// 終了時刻の選択肢を、開始時刻の15分後〜24:00 で作り直す
function renderEndOptions(keepEnd) {
  const start = toMinutes(f.start.value);
  f.end.innerHTML = '';
  for (let m = start + 15; m <= DAY_END; m += 15) f.end.add(new Option(fromMinutes(m), m));
  const want = keepEnd && keepEnd > start ? Math.min(keepEnd, DAY_END) : Math.min(start + 150, DAY_END);
  f.end.value = String(want);
  updateEndLength();
}

function updateEndLength() {
  const min = Number(f.end.value) - toMinutes(f.start.value);
  f.endLength.textContent = min > 0 ? `(${Math.floor(min / 60) ? Math.floor(min / 60) + '時間' : ''}${min % 60 ? (min % 60) + '分' : ''})` : '';
}

function syncEndField() {
  f.endField.hidden = form.querySelector('input[name="duration"]:checked')?.value !== 'end';
}

f.durations.addEventListener('change', () => {
  syncEndField();
  if (!f.endField.hidden) renderEndOptions(Number(f.end.value));
});
f.start.addEventListener('change', () => renderEndOptions(Number(f.end.value)));
f.end.addEventListener('change', updateEndLength);

// くり返しの選択肢を、いまの日付に合わせて作り直す(選んでいた種類はなるべく残す)
function renderRepeatOptions() {
  const keep = f.repeat.value;
  const options = f.date.value ? store.ruleOptions(f.date.value) : [];
  f.repeat.innerHTML = '<option value="">くり返さない</option>'
    + options.map(o => `<option value="${o.rule}">${o.label}</option>`).join('');
  f.repeat.value = options.some(o => o.rule === keep) ? keep : '';
  f.repeatEndField.hidden = !f.repeat.value;
}
f.date.addEventListener('change', renderRepeatOptions);
// くり返すときだけ終了日の欄を出す
f.repeat.addEventListener('change', () => { f.repeatEndField.hidden = !f.repeat.value; });

// 固定枠の予定を変える・消すとき「この日だけ / この日以降」を選ぶ。選んだ value を返す(やめたら null)
const scopeDialog = document.getElementById('scope-dialog');
function askScope(title, text, options) {
  document.getElementById('scope-title').textContent = title;
  document.getElementById('scope-text').textContent = text;
  const box = document.getElementById('scope-buttons');
  box.innerHTML = options.map(o =>
    `<button type="button" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-value="${o.value}">${o.label}</button>`).join('');
  scopeDialog.showModal();
  scopeDialog.querySelector('h2').focus();
  return new Promise(resolve => {
    const done = value => { scopeDialog.close(); resolve(value); };
    box.onclick = e => { const b = e.target.closest('[data-value]'); if (b) done(b.dataset.value); };
    scopeDialog.querySelector('[data-close]').onclick = () => done(null);
    scopeDialog.oncancel = () => resolve(null);
  });
}

// 仮・確約・キャンセルのボタンを並べる
for (const st of store.STATUSES) {
  f.statuses.insertAdjacentHTML('beforeend',
    `<label class="chip status-chip status-${st.id}"><input type="radio" name="status" value="${st.id}"><span>${st.label}</span></label>`);
}

// 種類(色つき)のボタンを並べる
async function renderTypeChips() {
  const types = await store.getTypes();
  typeList = types;
  f.types.innerHTML = types.map(t =>
    `<label class="chip type-chip" style="--type-color:${t.color};--type-text:${textColorFor(t.color)}">
      <input type="radio" name="typeId" value="${escapeHtml(t.id)}"><span>${escapeHtml(t.name)}</span>
    </label>`).join('');
}

// 名前の候補。ブラウザの候補表示(datalist)は iPad で入力のじゃまになるため、自前で出す
async function loadStudentNames() {
  [studentNames, studentMemos] = await Promise.all([store.getStudentNames(), store.getStudents()]);
}

// 名前の欄の生徒に生徒メモがあれば、名前の下に出す
// (メモの欄が生徒メモになっているときは、同じ内容なので出さない)
function renderStudentMemo() {
  refreshMemoField();
  // レッスンの予定なら「LINE で予定を送る」を出す
  f.line.hidden = memoMode !== 'student';
  const memo = memoMode === 'lesson' && studentMemos.find(s => s.name === f.student.value.trim())?.memo;
  f.studentMemo.hidden = !memo;
  f.studentMemo.textContent = memo ? `📝 ${memo}` : '';
}

// ---- メモの欄:レッスンの予定なら「生徒メモ」と同じもの(2026-10-16)----
// 名前があり、集計に入れる種類(レッスン)で、状態が「なし(自分の予定)」でないとき、メモの欄は生徒メモになる。
// 生徒メモが空で、この予定だけのメモがあるときは、それを入れておく(保存すると生徒メモに移る)
function wantedMemoMode() {
  const name = f.student.value.trim();
  const typeId = form.querySelector('input[name="typeId"]:checked')?.value;
  const status = form.querySelector('input[name="status"]:checked')?.value;
  const type = typeList.find(t => t.id === typeId);
  return name && type?.countInTotal && status !== 'none' ? 'student' : 'lesson';
}
function studentMemoOf(name) {
  return studentMemos.find(s => s.name === name)?.memo || '';
}
function memoFor(mode) {
  const own = editing?.memo || '';
  if (mode === 'lesson') return own;
  const shared = studentMemoOf(f.student.value.trim());
  return shared && own && !shared.includes(own) ? `${shared}\n${own}` : (shared || own);
}
function refreshMemoField() {
  const mode = wantedMemoMode();
  const changed = mode !== memoMode;
  memoMode = mode;
  f.memoLabel.textContent = mode === 'student' ? '生徒メモ(希望の曜日・時間、注文など)' : 'メモ(この予定だけ)';
  f.memoHint.hidden = mode !== 'student';
  if (!memoDirty || changed) { f.memo.value = memoFor(mode); memoDirty = false; }
}
f.memo.addEventListener('input', () => { memoDirty = true; });
// この予定の生徒に、今月・来月の予定を LINE で送る(この予定は、確約でもはじめからチェック)
f.line.addEventListener('click', () => {
  const name = f.student.value.trim();
  if (name) openLineShare(name, { lessonId: editing?.id });
});
form.addEventListener('change', e => {
  if (e.target.name === 'typeId' || e.target.name === 'status') renderStudentMemo();
});

function renderSuggest() {
  const text = f.student.value.trim();
  const hits = studentNames.filter(n => n !== text && (!text || n.includes(text))).slice(0, 8);
  f.suggest.innerHTML = hits.map(n => `<button type="button" class="suggest-item">${escapeHtml(n)}</button>`).join('');
  f.suggest.hidden = hits.length === 0 || document.activeElement !== f.student;
}

f.student.addEventListener('input', renderSuggest);
f.student.addEventListener('input', renderStudentMemo);
f.student.addEventListener('focus', renderSuggest);
f.student.addEventListener('blur', () => setTimeout(() => { f.suggest.hidden = true; }, 200));
// 候補をタップしたら名前の欄に入れる(押した瞬間に入力欄から離れないよう pointerdown で止める)
f.suggest.addEventListener('pointerdown', e => e.preventDefault());
f.suggest.addEventListener('click', e => {
  const item = e.target.closest('.suggest-item');
  if (!item) return;
  f.student.value = item.textContent;
  f.suggest.hidden = true;
  renderStudentMemo();
});

function check(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${CSS.escape(String(value))}"]`);
  if (input) input.checked = true;
}

// 新しく入れる(date:"2026-10-05", time:"13:00")
export async function openNewLesson(date, time) {
  const last = store.getLastInput();
  await openLesson({ date, start: time, duration: last.duration, student: '', typeId: last.typeId, status: last.status, memo: '' });
}

// 入っている予定を開く
export async function openExistingLesson(id) {
  const lesson = await store.getLesson(id);
  if (lesson) await openLesson(lesson);
}

async function openLesson(lesson) {
  editing = lesson;
  await Promise.all([renderTypeChips(), renderDurationChips(), loadStudentNames()]);
  f.title.textContent = lesson.id ? '予定を編集' : '予定を追加';
  f.date.value = lesson.date;
  f.start.value = lesson.start;
  f.student.value = lesson.student;
  form.querySelectorAll('input[type="radio"]').forEach(r => { r.checked = false; });
  // 長さが選択肢にないとき(長い予定など)は「終了時刻で指定」にする
  if (durations.includes(lesson.duration)) check('duration', lesson.duration);
  else check('duration', 'end');
  renderEndOptions(toMinutes(lesson.start) + lesson.duration);
  syncEndField();
  f.suggest.hidden = true;
  check('typeId', lesson.typeId);
  check('status', lesson.status || 'tentative');
  if (!form.querySelector('input[name="typeId"]:checked')) form.querySelector('input[name="typeId"]').checked = true;
  memoMode = null;
  memoDirty = false;
  renderStudentMemo();
  f.error.textContent = '';
  f.del.hidden = !lesson.id;
  // 固定枠から入った予定なら説明を出し、「くり返し」の欄はかくす
  const occ = store.isOccurrenceId(lesson.id);
  f.recurringInfo.hidden = !occ;
  f.recurringInfo.textContent = occ ? `↻ ${store.slotLabel(lesson.slot)} の固定枠から入った予定です` : '';
  f.repeatField.hidden = occ;
  f.repeat.value = '';
  renderRepeatOptions();
  f.repeatEnd.value = '';
  f.repeatEndField.hidden = true;
  f.del.textContent = occ ? 'この日を休みにする・固定枠を終える…' : 'この予定を削除';
  dialog.showModal();
  // 題名の部分を選んだ状態で開く(日付の欄が選ばれて、カレンダーが勝手に開かないように)
  f.title.focus();
  dialog.scrollTop = 0;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const picked = form.querySelector('input[name="duration"]:checked')?.value;
  const duration = picked === 'end' ? Number(f.end.value) - toMinutes(f.start.value) : Number(picked);
  const typeId = form.querySelector('input[name="typeId"]:checked')?.value;
  const status = form.querySelector('input[name="status"]:checked')?.value || 'tentative';
  const start = f.start.value;
  const date = f.date.value;
  if (!date) { f.error.textContent = '日付を選んでください'; return; }
  if (!(duration > 0)) { f.error.textContent = picked === 'end' ? '終了時刻を開始より後にしてください' : '長さを選んでください'; return; }
  if (toMinutes(start) + duration > DAY_END) { f.error.textContent = '24:00 を過ぎてしまいます。開始時刻か長さを変えてください'; return; }

  const memoText = f.memo.value.trim();
  const sharedMemo = wantedMemoMode() === 'student';
  // レッスンの予定のメモは生徒メモに入れる(予定そのもののメモは空にする)
  const values = { ...editing, date, start, duration, typeId, status, student: f.student.value.trim(), memo: sharedMemo ? '' : memoText };
  if (store.isOccurrenceId(editing.id)) {
    // 固定枠の予定:この日だけ変えるか、この日以降の固定枠を変えるか
    const scope = await askScope('固定枠の予定を変更', `${store.slotLabel(editing.slot)} の固定枠です。どちらを変えますか?`, [
      { value: 'this', label: 'この日だけ変更' },
      { value: 'from', label: 'この日以降をすべて変更' },
    ]);
    if (!scope) return;
    if (scope === 'this') await store.saveLesson(values);
    else await store.changeSlotFrom(editing.id, values);
  } else if (f.repeat.value) {
    // 毎週くり返す:固定枠として登録する
    if (f.repeatEnd.value && f.repeatEnd.value < date) { f.error.textContent = '終了日は、この予定の日付より後にしてください'; return; }
    await store.addSlot(values, f.repeatEnd.value || null, f.repeat.value);
  } else {
    await store.saveLesson(values);
  }
  if (sharedMemo && memoText !== studentMemoOf(values.student)) {
    const current = studentMemos.find(s => s.name === values.student);
    await store.saveStudent({ id: current?.id, name: values.student, memo: memoText });
  }
  // 次に入れるときの初期値(長い予定は30分に戻す)
  store.setLastInput({ typeId, duration: durations.includes(duration) ? duration : 30, status });
  dialog.close();
  onChanged();
});

f.del.addEventListener('click', async () => {
  if (!editing?.id) return;
  if (store.isOccurrenceId(editing.id)) {
    const scope = await askScope('固定枠の予定を消す', `${store.slotLabel(editing.slot)} の固定枠です。どうしますか?`, [
      { value: 'skip', label: 'この日だけ休みにする' },
      { value: 'end', label: 'この日以降の固定枠を終える', danger: true },
    ]);
    if (!scope) return;
    if (scope === 'skip') await store.skipOccurrence(editing.id);
    else await store.endSlotFrom(editing.id);
    dialog.close();
    onChanged();
    return;
  }
  if (!confirm(`「${editing.student || '(名前なし)'}」の予定を削除しますか?\n(ゴミ箱に入ります。30日間は元に戻せます)`)) return;
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

// Mac:⌘S または ⌘return で保存
for (const [d, frm] of [[dialog, form], [noteDialog, noteForm]]) {
  d.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 's' || e.key === 'Enter')) {
      e.preventDefault();
      frm.requestSubmit();
    }
  });
}

// 保存・削除のあとに呼ぶ関数(表を描き直す)を登録する
export function setOnChanged(fn) {
  onChanged = fn;
}
