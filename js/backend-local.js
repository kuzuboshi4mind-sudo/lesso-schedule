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

// from〜to(どちらも '2026-10-01' の形、両端を含む)の予定
export async function listLessons(from, to) {
  return load(KEYS.lessons, []).filter(l => l.date >= from && l.date <= to);
}

export async function getLessonsByIds(ids) {
  const set = new Set(ids);
  return load(KEYS.lessons, []).filter(l => set.has(l.id));
}

export async function countLessonsOfType(typeId) {
  return load(KEYS.lessons, []).filter(l => l.typeId === typeId).length;
}

export async function studentNames() {
  return load(KEYS.lessons, []).map(l => l.student);
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
