// 保存先:Supabase(クラウドのデータベース)
// ログインした本人のデータだけを読み書きする(データベース側の RLS でも守っている)
// store.js から呼ばれる。backend-local.js と同じ名前・同じ形の関数をそろえてある。
import { supabase } from './cloud.js';

export const label = 'クラウド';

// 通信や保存に失敗したら、わかりやすい日本語のエラーにして投げる
function check({ data, error }) {
  if (error) {
    console.error(error);
    throw new Error(`クラウドとのやりとりに失敗しました。通信の状態を確認して、もう一度試してください。(${error.message || error.code || '不明なエラー'})`);
  }
  return data;
}

// データベースの1行 ⇔ アプリの予定の形
function fromRow(r) {
  return {
    id: r.id, date: r.date, start: r.start, duration: r.duration,
    student: r.student, typeId: r.type_id, status: r.status, memo: r.memo,
    deletedAt: r.deleted_at || null,
  };
}

function toRow(l) {
  return {
    id: l.id, date: l.date, start: l.start, duration: l.duration,
    student: l.student || '', type_id: l.typeId || '', status: l.status || 'tentative', memo: l.memo || '',
    deleted_at: l.deletedAt || null,
    updated_at: new Date().toISOString(),
  };
}

const LESSON_COLUMNS = 'id,date,start,duration,student,type_id,status,memo,deleted_at';

export async function listLessons(from, to) {
  const rows = check(await supabase.from('lessons').select(LESSON_COLUMNS)
    .gte('date', from).lte('date', to).is('deleted_at', null));
  return rows.map(fromRow);
}

// ゴミ箱の中の予定(ゴミ箱に入れた日時が新しい順)
export async function listTrash() {
  const rows = check(await supabase.from('lessons').select(LESSON_COLUMNS)
    .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(2000));
  return rows.map(fromRow);
}

// before(日時の文字列)より前にゴミ箱に入れた予定を、完全に消す
export async function purgeTrash(before) {
  check(await supabase.from('lessons').delete().lt('deleted_at', before));
}

export async function getLessonsByIds(ids) {
  if (!ids.length) return [];
  const rows = check(await supabase.from('lessons').select(LESSON_COLUMNS).in('id', ids));
  return rows.map(fromRow);
}

export async function countLessonsOfType(typeId) {
  const { count, error } = await supabase.from('lessons').select('id', { count: 'exact', head: true })
    .eq('type_id', typeId).is('deleted_at', null);
  check({ error });
  return count || 0;
}

export async function studentNames() {
  const rows = check(await supabase.from('lessons').select('student').is('deleted_at', null).limit(10000));
  return rows.map(r => r.student);
}

export async function writeLessons(states) {
  const upserts = states.filter(s => s.lesson).map(s => toRow(s.lesson));
  const deletes = states.filter(s => !s.lesson).map(s => s.id);
  if (upserts.length) check(await supabase.from('lessons').upsert(upserts));
  if (deletes.length) check(await supabase.from('lessons').delete().in('id', deletes));
}

export async function listNotes(from, to) {
  const rows = check(await supabase.from('day_notes').select('date,text').gte('date', from).lte('date', to));
  return Object.fromEntries(rows.map(r => [r.date, r.text]));
}

export async function getNote(date) {
  const rows = check(await supabase.from('day_notes').select('text').eq('date', date));
  return rows[0]?.text || null;
}

export async function writeNotes(states) {
  const upserts = states.filter(s => s.text).map(s => ({ date: s.date, text: s.text }));
  const deletes = states.filter(s => !s.text).map(s => s.date);
  if (upserts.length) check(await supabase.from('day_notes').upsert(upserts, { onConflict: 'user_id,date' }));
  if (deletes.length) check(await supabase.from('day_notes').delete().in('date', deletes));
}

export async function getSetting(key) {
  const rows = check(await supabase.from('user_settings').select('value').eq('key', key));
  return rows[0]?.value;
}

export async function setSetting(key, value) {
  check(await supabase.from('user_settings').upsert({ key, value }, { onConflict: 'user_id,key' }));
}

// ---- 毎週の固定枠と、その例外(この日だけ休み・変更)----
function slotFromRow(r) {
  return {
    id: r.id, weekday: r.weekday, start: r.start, duration: r.duration, student: r.student,
    typeId: r.type_id, status: r.status, memo: r.memo, startDate: r.start_date, endDate: r.end_date || null,
    rule: r.rule || 'weekly', nth: r.nth ?? null, monthDay: r.month_day ?? null,
  };
}

function slotToRow(s) {
  return {
    id: s.id, weekday: s.weekday, start: s.start, duration: s.duration, student: s.student || '',
    type_id: s.typeId || '', status: s.status || 'confirmed', memo: s.memo || '',
    start_date: s.startDate, end_date: s.endDate || null,
    // 毎月のくり返しの項目(データベースに rule・nth・month_day の列を足してから使える)
    ...(s.rule && s.rule !== 'weekly' ? { rule: s.rule, nth: s.nth ?? null, month_day: s.monthDay ?? null } : {}),
  };
}

export async function listSlots() {
  // '*' で全部の列を読む(毎月のくり返しの列を足す前のデータベースでも動くように)
  const rows = check(await supabase.from('recurring_slots').select('*'));
  return rows.map(slotFromRow);
}

export async function writeSlots(states) {
  const upserts = states.filter(s => s.slot).map(s => slotToRow(s.slot));
  const deletes = states.filter(s => !s.slot).map(s => s.id);
  // 1件ずつ保存する(毎週と毎月で持っている項目がちがうため、まとめて送ると空の項目ができてしまう)
  for (const row of upserts) check(await supabase.from('recurring_slots').upsert(row));
  if (deletes.length) check(await supabase.from('recurring_slots').delete().in('id', deletes));
}

export async function listExceptions(from, to) {
  const rows = check(await supabase.from('recurring_exceptions').select('id,slot_id,date,action,lesson')
    .gte('date', from).lte('date', to));
  return rows.map(r => ({ id: r.id, slotId: r.slot_id, date: r.date, action: r.action, lessonId: r.lesson?.lessonId || null }));
}

export async function writeExceptions(states) {
  const upserts = states.filter(s => s.exception).map(({ exception: x }) => ({
    id: x.id, slot_id: x.slotId, date: x.date, action: x.action, lesson: x.lessonId ? { lessonId: x.lessonId } : null,
  }));
  const deletes = states.filter(s => !s.exception).map(s => s.id);
  if (deletes.length) check(await supabase.from('recurring_exceptions').delete().in('id', deletes));
  if (upserts.length) check(await supabase.from('recurring_exceptions').upsert(upserts, { onConflict: 'slot_id,date' }));
}

// ---- 生徒メモ ----
export async function listStudents() {
  const rows = check(await supabase.from('students').select('id,name,memo,updated_at'));
  return rows.map(r => ({ id: r.id, name: r.name, memo: r.memo, updatedAt: r.updated_at }));
}

export async function writeStudents(states) {
  const upserts = states.filter(s => s.student).map(({ student: s }) => ({
    id: s.id, name: s.name, memo: s.memo || '', updated_at: s.updatedAt || new Date().toISOString(),
  }));
  const deletes = states.filter(s => !s.student).map(s => s.id);
  if (upserts.length) check(await supabase.from('students').upsert(upserts));
  if (deletes.length) check(await supabase.from('students').delete().in('id', deletes));
}

// その生徒名の予定(ゴミ箱のものは除く)
export async function lessonsOfStudent(name) {
  const rows = check(await supabase.from('lessons').select(LESSON_COLUMNS).eq('student', name).is('deleted_at', null));
  return rows.map(fromRow);
}

// ---- 月ごとの情報(仮の月か)----
export async function listMonths() {
  const rows = check(await supabase.from('months').select('ym,tentative').eq('tentative', true));
  return Object.fromEntries(rows.map(r => [r.ym, true]));
}

export async function writeMonths(states) {
  if (states.length) check(await supabase.from('months').upsert(states.map(s => ({ ym: s.ym, tentative: !!s.tentative }))));
}
