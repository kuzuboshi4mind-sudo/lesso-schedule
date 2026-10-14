// データの読み書きの窓口
// 画面側のコードは「await store.〇〇()」でここを呼ぶ。保存先の違いはここで吸収する。
// ・config.js に Supabase の接続先があれば:クラウド(backend-cloud.js)
// ・なければ:この端末の中(backend-local.js)
// 「前回の入力」だけは、端末ごとの使い勝手なので、いつも端末の中に保存する。
import { cloudEnabled } from './cloud.js';
import * as local from './backend-local.js';
import * as cloud from './backend-cloud.js';

const db = cloudEnabled ? cloud : local;

// 保存先の名前(「クラウド」か「この端末」)
export const storageLabel = db.label;

const KEYS = {
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

// 換算表の初期値:レッスンの長さ(分)→ 集計での時間数(h)
// この表にある長さが、入力画面の「長さ」の選択肢になる(設定画面で変更できる)
// 表にない長さ(「終了時刻で指定」の長い予定など)は、分÷60 で数える
const DEFAULT_DURATION_RULES = [
  { minutes: 15, hours: 0.25 },
  { minutes: 20, hours: 0.5 },
  { minutes: 30, hours: 0.5 },
  { minutes: 45, hours: 0.75 },
  { minutes: 60, hours: 1.0 },
  { minutes: 90, hours: 1.5 },
  { minutes: 120, hours: 2.0 },
];

function load(key, fallback) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---- 種類 ----
export async function getTypes() {
  return (await db.getSetting('types')) || DEFAULT_TYPES;
}

// 種類の一覧をまるごと保存する(設定画面から)
export async function saveTypes(types) {
  await db.setSetting('types', types);
}

export function newTypeId() {
  return `type-${newId()}`;
}

// その種類の予定が何件あるか(削除するときの確認に使う)
export async function countLessonsOfType(typeId) {
  return db.countLessonsOfType(typeId);
}

// ---- 換算表 ----
export async function getDurationRules() {
  return (await db.getSetting('durationRules')) || DEFAULT_DURATION_RULES;
}

export async function saveDurationRules(rules) {
  await db.setSetting('durationRules', [...rules].sort((a, b) => a.minutes - b.minutes));
}

// 入力画面の「長さ」の選択肢(分の一覧)
export async function getDurations() {
  return (await getDurationRules()).map(r => r.minutes);
}

// ---- レッスン ----
// 1件の形:{ id, date:'2026-10-05', start:'13:15', duration:30, student:'山田', typeId:'home', status:'confirmed', memo:'' }
// status がないもの(手順2で入れた予定)は「仮」として扱う

// その月の最初の日と最後の日('2026-10-01', '2026-10-31')
function monthRange(year, month) {
  const mm = String(month).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(last).padStart(2, '0')}`];
}

// その月のレッスンをすべて返す(month は 1〜12)
export async function getLessons(year, month) {
  return db.listLessons(...monthRange(year, month));
}

export async function getLesson(id) {
  return (await db.getLessonsByIds([id]))[0] || null;
}

// ---- 書き込みの共通部分と「元に戻す / やり直す」----
// 変更はすべて「変更前 → 変更後」の組で記録する(新規は変更前が null、削除は変更後が null)。
// 元に戻すときは変更前の状態を、やり直すときは変更後の状態を書き戻す。
// 記録はこの画面を開いている間だけ(読み込み直すと消える)。最大50回分。
const HISTORY_LIMIT = 50;
const undoStack = [];
const redoStack = [];

// 変更前か変更後のどちらかの状態を書き込む(useAfter=true で変更後)
async function applyChange(entry, useAfter) {
  const lessonStates = entry.lessons.map(c => ({ id: (c.after || c.before).id, lesson: useAfter ? c.after : c.before }));
  const noteStates = entry.notes.map(c => ({ date: c.date, text: useAfter ? c.after : c.before }));
  if (lessonStates.length) await db.writeLessons(lessonStates);
  if (noteStates.length) await db.writeNotes(noteStates);
}

// 変更を書き込んで記録する。label は「元に戻しました:〇〇」の表示に使う
// change = { label, lessons:[{ before, after }], notes:[{ date, before, after }] }
// 書き込みに失敗したときは記録しない(エラーはそのまま呼んだ側に伝える)
async function commit(change) {
  const entry = { label: change.label, lessons: change.lessons || [], notes: change.notes || [] };
  await applyChange(entry, true);
  undoStack.push(entry);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

// 1つ前の状態に戻す。戻した操作の説明を返す(戻すものがなければ null)
export async function undo() {
  const entry = undoStack.at(-1);
  if (!entry) return null;
  await applyChange(entry, false);
  redoStack.push(undoStack.pop());
  return entry.label;
}

// 戻した操作をもう一度行う
export async function redo() {
  const entry = redoStack.at(-1);
  if (!entry) return null;
  await applyChange(entry, true);
  undoStack.push(redoStack.pop());
  return entry.label;
}

function nameOf(l) {
  return l.student || '(名前なし)';
}

// まとめて追加する(貼り付け・文字の直接入力で使う)
export async function addLessons(lessons, label = '追加') {
  const added = lessons.map(l => ({ ...l, id: newId() }));
  await commit({ label: `${label}(${added.length}件)`, lessons: added.map(a => ({ before: null, after: a })) });
  return added;
}

// まとめて削除する
export async function deleteLessons(ids, label = '削除') {
  const targets = await db.getLessonsByIds(ids);
  await commit({ label: `${label}(${targets.length}件)`, lessons: targets.map(t => ({ before: t, after: null })) });
}

// 新規(id なし)なら追加、id ありなら上書き
export async function saveLesson(lesson) {
  const before = lesson.id ? await getLesson(lesson.id) : null;
  const after = lesson.id ? lesson : { ...lesson, id: newId() };
  await commit({ label: `${before ? '変更' : '追加'}:${nameOf(after)}`, lessons: [{ before, after }] });
  return after;
}

// 手順6でゴミ箱方式に変える。今はすぐ消す(元に戻すことはできる)
export async function deleteLesson(id) {
  const before = await getLesson(id);
  if (before) await commit({ label: `削除:${nameOf(before)}`, lessons: [{ before, after: null }] });
}

// 入力したことのある生徒名の一覧(入力欄の候補に出す)
export async function getStudentNames() {
  const names = new Set((await db.studentNames()).filter(Boolean));
  return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
}

// ---- 日ごとのメモ(「予定」の行)----
// { '2026-10-05': 'サンパル', ... }
export async function getDayNotes(year, month) {
  return db.listNotes(...monthRange(year, month));
}

export async function saveDayNote(date, text) {
  const before = await db.getNote(date);
  const after = text.trim() || null;
  if (before === after) return;
  await commit({ label: `予定の行:${after || before}`, notes: [{ date, before, after }] });
}

// ---- 前回の入力(新しく入れるとき、種類・長さ・状態を前回と同じにする)----
export function getLastInput() {
  return { typeId: DEFAULT_TYPES[0].id, duration: 30, status: 'tentative', ...load(KEYS.lastInput, {}) };
}

export function setLastInput({ typeId, duration, status }) {
  try { localStorage.setItem(KEYS.lastInput, JSON.stringify({ typeId, duration, status })); } catch { /* 保存できなくても動作には影響しない */ }
}
