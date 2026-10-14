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

// まとめて追加する(貼り付け・文字の直接入力で使う)
export async function addLessons(lessons) {
  const all = load(KEYS.lessons, []);
  const added = lessons.map(l => ({ ...l, id: newId() }));
  save(KEYS.lessons, all.concat(added));
  return added;
}

// まとめて削除する
export async function deleteLessons(ids) {
  const set = new Set(ids);
  save(KEYS.lessons, load(KEYS.lessons, []).filter(l => !set.has(l.id)));
}

// 新規(id なし)なら追加、id ありなら上書き
export async function saveLesson(lesson) {
  const all = load(KEYS.lessons, []);
  if (lesson.id) {
    const i = all.findIndex(l => l.id === lesson.id);
    if (i >= 0) all[i] = lesson; else all.push(lesson);
  } else {
    lesson = { ...lesson, id: newId() };
    all.push(lesson);
  }
  save(KEYS.lessons, all);
  return lesson;
}

// 手順6でゴミ箱方式に変える。今はすぐ消す
export async function deleteLesson(id) {
  save(KEYS.lessons, load(KEYS.lessons, []).filter(l => l.id !== id));
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
  const all = load(KEYS.dayNotes, {});
  if (text.trim()) all[date] = text.trim(); else delete all[date];
  save(KEYS.dayNotes, all);
}

// ---- 前回の入力(新しく入れるとき、種類・長さ・状態を前回と同じにする)----
export function getLastInput() {
  return { typeId: DEFAULT_TYPES[0].id, duration: 30, status: 'tentative', ...load(KEYS.lastInput, {}) };
}

export function setLastInput({ typeId, duration, status }) {
  try { localStorage.setItem(KEYS.lastInput, JSON.stringify({ typeId, duration, status })); } catch { /* 保存できなくても動作には影響しない */ }
}
