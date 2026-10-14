// 保存先:この端末のブラウザの中(localStorage)
// config.js に Supabase の接続先が入っていないときに使う(手順2〜4の動き)
// store.js から呼ばれる。backend-cloud.js と同じ名前・同じ形の関数をそろえてある。

const KEYS = {
  lessons: 'lesso.lessons',
  dayNotes: 'lesso.dayNotes',
  settings: { types: 'lesso.types', durationRules: 'lesso.durationRules' },
};

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
    throw new Error('この端末に保存できませんでした。プライベートブラウズを使っていないか確認してください。');
  }
}

export const label = 'この端末';

// ゴミ箱に入っていない予定だけ
function alive() {
  return load(KEYS.lessons, []).filter(l => !l.deletedAt);
}

// from〜to(どちらも '2026-10-01' の形、両端を含む)の予定(ゴミ箱の中は除く)
export async function listLessons(from, to) {
  return alive().filter(l => l.date >= from && l.date <= to);
}

// ゴミ箱の中の予定(deletedAt が新しい順)
export async function listTrash() {
  return load(KEYS.lessons, []).filter(l => l.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// before(日時の文字列)より前にゴミ箱に入れた予定を、完全に消す
export async function purgeTrash(before) {
  save(KEYS.lessons, load(KEYS.lessons, []).filter(l => !l.deletedAt || l.deletedAt >= before));
}

export async function getLessonsByIds(ids) {
  const set = new Set(ids);
  return load(KEYS.lessons, []).filter(l => set.has(l.id));
}

export async function countLessonsOfType(typeId) {
  return alive().filter(l => l.typeId === typeId).length;
}

export async function studentNames() {
  return alive().map(l => l.student);
}

// states:[{ id, lesson }](lesson が null なら削除、あれば追加か上書き)
export async function writeLessons(states) {
  const byId = new Map(load(KEYS.lessons, []).map(l => [l.id, l]));
  for (const { id, lesson } of states) {
    if (lesson) byId.set(id, lesson); else byId.delete(id);
  }
  save(KEYS.lessons, [...byId.values()]);
}

// { '2026-10-05': 'サンパル', ... }
export async function listNotes(from, to) {
  return Object.fromEntries(Object.entries(load(KEYS.dayNotes, {})).filter(([d]) => d >= from && d <= to));
}

export async function getNote(date) {
  return load(KEYS.dayNotes, {})[date] || null;
}

// states:[{ date, text }](text が null なら消す)
export async function writeNotes(states) {
  const all = load(KEYS.dayNotes, {});
  for (const { date, text } of states) {
    if (text) all[date] = text; else delete all[date];
  }
  save(KEYS.dayNotes, all);
}

export async function getSetting(key) {
  return load(KEYS.settings[key] || `lesso.${key}`, undefined);
}

export async function setSetting(key, value) {
  save(KEYS.settings[key] || `lesso.${key}`, value);
}

// ---- 毎週の固定枠と、その例外(この日だけ休み・変更)----
// 固定枠:{ id, weekday, start, duration, student, typeId, status, memo, startDate, endDate }
// 例外:  { id, slotId, date, action:'skip'|'change', lessonId }
const SLOT_KEY = 'lesso.recurringSlots';
const EXC_KEY = 'lesso.recurringExceptions';

export async function listSlots() {
  return load(SLOT_KEY, []);
}

export async function writeSlots(states) {
  const byId = new Map(load(SLOT_KEY, []).map(s => [s.id, s]));
  for (const { id, slot } of states) {
    if (slot) byId.set(id, slot); else byId.delete(id);
  }
  save(SLOT_KEY, [...byId.values()]);
}

export async function listExceptions(from, to) {
  return load(EXC_KEY, []).filter(x => x.date >= from && x.date <= to);
}

export async function writeExceptions(states) {
  const byId = new Map(load(EXC_KEY, []).map(x => [x.id, x]));
  for (const { id, exception } of states) {
    if (exception) byId.set(id, exception); else byId.delete(id);
  }
  save(EXC_KEY, [...byId.values()]);
}

// ---- 生徒メモ ----
// { id, name, memo, updatedAt }
const STUDENT_KEY = 'lesso.students';

export async function listStudents() {
  return load(STUDENT_KEY, []);
}

// states:[{ id, student }](student が null なら削除)
export async function writeStudents(states) {
  const byId = new Map(load(STUDENT_KEY, []).map(s => [s.id, s]));
  for (const { id, student } of states) {
    if (student) byId.set(id, student); else byId.delete(id);
  }
  save(STUDENT_KEY, [...byId.values()]);
}

// その生徒名の予定(ゴミ箱のものは除く)
export async function lessonsOfStudent(name) {
  return alive().filter(l => l.student === name);
}

// ---- 月ごとの情報(仮の月か)----
// { '2026-11': true, ... }(仮の月だけを覚える)
const MONTH_KEY = 'lesso.months';

export async function listMonths() {
  return load(MONTH_KEY, {});
}

// states:[{ ym:'2026-11', tentative:true }]
export async function writeMonths(states) {
  const all = load(MONTH_KEY, {});
  for (const { ym, tentative } of states) {
    if (tentative) all[ym] = true; else delete all[ym];
  }
  save(MONTH_KEY, all);
}
