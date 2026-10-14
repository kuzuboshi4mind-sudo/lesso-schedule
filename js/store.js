// データの読み書きの窓口
// 今(手順2〜4)は、この端末のブラウザの中に保存する(localStorage)。
// 手順5で、この中身だけを Supabase(クラウド)向けに書き換える。
// 画面側のコードは「await store.〇〇()」で呼ぶので、書き換えても影響しない。

const KEYS = {
  lessons: 'lesso.lessons',
  dayNotes: 'lesso.dayNotes',
  types: 'lesso.types',
  lastInput: 'lesso.lastInput',
};

// 種類(場所)の初期値。手順4の設定画面で追加・変更できるようにする
// countInTotal:集計に入れるかどうか
const DEFAULT_TYPES = [
  { id: 'home',     name: '自宅',     color: '#4caf50', countInTotal: true },
  { id: 'oki-kawaguchi', name: 'OKI川口', color: '#f2c94c', countInTotal: true },
  { id: 'oki-kamo', name: 'OKI加茂',  color: '#f2994a', countInTotal: true },
  { id: 'sunpal',   name: 'サンパル', color: '#56ccf2', countInTotal: true },
  { id: 'visit',    name: '訪問',     color: '#9b51e0', countInTotal: true },
  { id: 'online',   name: 'オンライン', color: '#2f5fd0', countInTotal: true },
  { id: 'jinis',    name: 'JINIS',    color: '#f48fb1', countInTotal: true },
  { id: 'sauna',    name: 'サウナ',   color: '#a1887f', countInTotal: false },
  { id: 'practice', name: '練習',     color: '#26a69a', countInTotal: false },
  { id: 'other',    name: 'その他',   color: '#9e9e9e', countInTotal: false },
];

// 予定の状態。仮=まだ確定していない、確約=確定(○)、キャンセル(×)、
// なし=レッスン以外の自分の予定(仮・確約の区別がないもの)
export const STATUSES = [
  { id: 'tentative', label: '仮' },
  { id: 'confirmed', label: '確約 ○' },
  { id: 'cancelled', label: 'キャンセル ×' },
  { id: 'none', label: 'なし(自分の予定)' },
];

// レッスンの長さの選択肢(分)。手順4で換算表と合わせて設定できるようにする
// これより長い予定は、入力画面の「終了時刻で指定」を使う
export const DURATIONS = [15, 20, 30, 45, 60, 90, 120];

function load(key, fallback) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    alert('保存できませんでした。プライベートブラウズを使っていないか確認してください。');
    throw e;
  }
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---- 種類 ----
export async function getTypes() {
  return load(KEYS.types, DEFAULT_TYPES);
}

// ---- レッスン ----
// 1件の形:{ id, date:'2026-10-05', start:'13:15', duration:30, student:'山田', typeId:'home', status:'confirmed', memo:'' }
// status がないもの(手順2で入れた予定)は「仮」として扱う

// その月のレッスンをすべて返す(month は 1〜12)
export async function getLessons(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return load(KEYS.lessons, []).filter(l => l.date.startsWith(prefix));
}

export async function getLesson(id) {
  return load(KEYS.lessons, []).find(l => l.id === id) || null;
}

// ---- 書き込みの共通部分と「元に戻す / やり直す」----
// 変更はすべて「変更前 → 変更後」の組で記録する(新規は変更前が null、削除は変更後が null)。
// 元に戻すときは変更前の状態を、やり直すときは変更後の状態を書き戻す。
// 記録はこの画面を開いている間だけ(読み込み直すと消える)。最大50回分。
const HISTORY_LIMIT = 50;
const undoStack = [];
const redoStack = [];

// レッスンの状態を書き込む:states は [{ id, lesson|null }](null は削除)
function writeLessonStates(states) {
  const all = load(KEYS.lessons, []);
  const byId = new Map(all.map(l => [l.id, l]));
  for (const { id, lesson } of states) {
    if (lesson) byId.set(id, lesson); else byId.delete(id);
  }
  save(KEYS.lessons, [...byId.values()]);
}

function writeNoteStates(states) {
  const all = load(KEYS.dayNotes, {});
  for (const { date, text } of states) {
    if (text) all[date] = text; else delete all[date];
  }
  save(KEYS.dayNotes, all);
}

// 変更を記録して書き込む。label は「元に戻しました:〇〇」の表示に使う
// change = { label, lessons:[{ before, after }], notes:[{ date, before, after }] }
function commit(change) {
  const lessons = change.lessons || [];
  const notes = change.notes || [];
  writeLessonStates(lessons.map(c => ({ id: (c.after || c.before).id, lesson: c.after })));
  writeNoteStates(notes.map(c => ({ date: c.date, text: c.after })));
  undoStack.push({ label: change.label, lessons, notes });
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function applyHistory(entry, useAfter) {
  writeLessonStates(entry.lessons.map(c => ({ id: (c.after || c.before).id, lesson: useAfter ? c.after : c.before })));
  writeNoteStates(entry.notes.map(c => ({ date: c.date, text: useAfter ? c.after : c.before })));
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

// 1つ前の状態に戻す。戻した操作の説明を返す(戻すものがなければ null)
export async function undo() {
  const entry = undoStack.pop();
  if (!entry) return null;
  applyHistory(entry, false);
  redoStack.push(entry);
  return entry.label;
}

// 戻した操作をもう一度行う
export async function redo() {
  const entry = redoStack.pop();
  if (!entry) return null;
  applyHistory(entry, true);
  undoStack.push(entry);
  return entry.label;
}

function nameOf(l) {
  return l.student || '(名前なし)';
}

// まとめて追加する(貼り付け・文字の直接入力で使う)
export async function addLessons(lessons, label = '追加') {
  const added = lessons.map(l => ({ ...l, id: newId() }));
  commit({ label: `${label}(${added.length}件)`, lessons: added.map(a => ({ before: null, after: a })) });
  return added;
}

// まとめて削除する
export async function deleteLessons(ids, label = '削除') {
  const set = new Set(ids);
  const targets = load(KEYS.lessons, []).filter(l => set.has(l.id));
  commit({ label: `${label}(${targets.length}件)`, lessons: targets.map(t => ({ before: t, after: null })) });
}

// 新規(id なし)なら追加、id ありなら上書き
export async function saveLesson(lesson) {
  const before = lesson.id ? load(KEYS.lessons, []).find(l => l.id === lesson.id) || null : null;
  const after = lesson.id ? lesson : { ...lesson, id: newId() };
  commit({ label: `${before ? '変更' : '追加'}:${nameOf(after)}`, lessons: [{ before, after }] });
  return after;
}

// 手順6でゴミ箱方式に変える。今はすぐ消す(元に戻すことはできる)
export async function deleteLesson(id) {
  const before = load(KEYS.lessons, []).find(l => l.id === id);
  if (before) commit({ label: `削除:${nameOf(before)}`, lessons: [{ before, after: null }] });
}

// 入力したことのある生徒名の一覧(入力欄の候補に出す)
export async function getStudentNames() {
  const names = new Set(load(KEYS.lessons, []).map(l => l.student).filter(Boolean));
  return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
}

// ---- 日ごとのメモ(「予定」の行)----
// { '2026-10-05': 'サンパル', ... }
export async function getDayNotes(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const all = load(KEYS.dayNotes, {});
  return Object.fromEntries(Object.entries(all).filter(([date]) => date.startsWith(prefix)));
}

export async function saveDayNote(date, text) {
  const before = load(KEYS.dayNotes, {})[date] || null;
  const after = text.trim() || null;
  if (before === after) return;
  commit({ label: `予定の行:${after || before}`, notes: [{ date, before, after }] });
}

// ---- 前回の入力(新しく入れるとき、種類・長さ・状態を前回と同じにする)----
export function getLastInput() {
  return { typeId: DEFAULT_TYPES[0].id, duration: 30, status: 'tentative', ...load(KEYS.lastInput, {}) };
}

export function setLastInput({ typeId, duration, status }) {
  try { localStorage.setItem(KEYS.lastInput, JSON.stringify({ typeId, duration, status })); } catch { /* 保存できなくても動作には影響しない */ }
}
