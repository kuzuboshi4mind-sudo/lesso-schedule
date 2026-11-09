// 保存先:メモリの中の写し(この端末に残したクラウドの写しを読むときに使う)
// backend-cloud.js・backend-local.js と同じ名前・同じ形の関数をそろえてある。
// 写しの形:{ lessons:[...ゴミ箱の中も含む], dayNotes:{日付:文字}, settings:{キー:値},
//            slots:[...], exceptions:[...], students:[...], months:{'2026-11':true} }
// 読んだものは必ず複製して返す(呼んだ側が書き換えても写しが変わらないように)

const clone = v => (v === undefined ? undefined : structuredClone(v));

export function emptySnapshot() {
  return { lessons: [], dayNotes: {}, settings: {}, slots: [], exceptions: [], students: [], months: {} };
}

export function createMemoryBackend(snap) {
  const s = { ...emptySnapshot(), ...snap };
  const alive = () => s.lessons.filter(l => !l.deletedAt);
  const upsertById = (list, states, field) => {
    const byId = new Map(list.map(x => [x.id, x]));
    for (const st of states) {
      if (st[field]) byId.set(st.id, clone(st[field])); else byId.delete(st.id);
    }
    return [...byId.values()];
  };

  return {
    label: 'この端末の写し',
    snapshot: () => s,

    async listLessons(from, to) { return clone(alive().filter(l => l.date >= from && l.date <= to)); },
    async listTrash() {
      return clone(s.lessons.filter(l => l.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)));
    },
    async purgeTrash(before) { s.lessons = s.lessons.filter(l => !l.deletedAt || l.deletedAt >= before); },
    async getLessonsByIds(ids) { const set = new Set(ids); return clone(s.lessons.filter(l => set.has(l.id))); },
    async countLessonsOfType(typeId) { return alive().filter(l => l.typeId === typeId).length; },
    async studentNames() { return alive().map(l => l.student); },
    async writeLessons(states) { s.lessons = upsertById(s.lessons, states, 'lesson'); },
    async lessonsOfStudent(name) { return clone(alive().filter(l => l.student === name)); },

    async listNotes(from, to) {
      return Object.fromEntries(Object.entries(s.dayNotes).filter(([d]) => d >= from && d <= to));
    },
    async getNote(date) { return s.dayNotes[date] || null; },
    async writeNotes(states) {
      for (const { date, text } of states) {
        if (text) s.dayNotes[date] = text; else delete s.dayNotes[date];
      }
    },

    async getSetting(key) { return clone(s.settings[key]); },
    async setSetting(key, value) {
      if (value === undefined || value === null) delete s.settings[key]; else s.settings[key] = clone(value);
    },

    async listSlots() { return clone(s.slots); },
    async writeSlots(states) { s.slots = upsertById(s.slots, states, 'slot'); },
    async listExceptions(from, to) { return clone(s.exceptions.filter(x => x.date >= from && x.date <= to)); },
    async writeExceptions(states) {
      // クラウドと同じく、同じ固定枠・同じ日の例外は1つだけ(新しいほうで置き換える)
      const ups = states.filter(st => st.exception).map(st => st.exception);
      s.exceptions = s.exceptions.filter(x => !ups.some(u => u.slotId === x.slotId && u.date === x.date && u.id !== x.id));
      s.exceptions = upsertById(s.exceptions, states, 'exception');
    },

    async listStudents() { return clone(s.students); },
    async writeStudents(states) { s.students = upsertById(s.students, states, 'student'); },

    async listMonths() { return { ...s.months }; },
    async writeMonths(states) {
      for (const { ym, tentative } of states) {
        if (tentative) s.months[ym] = true; else delete s.months[ym];
      }
    },
  };
}
