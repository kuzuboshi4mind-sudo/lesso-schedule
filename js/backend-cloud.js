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
  };
}

function toRow(l) {
  return {
    id: l.id, date: l.date, start: l.start, duration: l.duration,
    student: l.student || '', type_id: l.typeId || '', status: l.status || 'tentative', memo: l.memo || '',
    updated_at: new Date().toISOString(),
  };
}

const LESSON_COLUMNS = 'id,date,start,duration,student,type_id,status,memo';

export async function listLessons(from, to) {
  const rows = check(await supabase.from('lessons').select(LESSON_COLUMNS)
    .gte('date', from).lte('date', to).is('deleted_at', null));
  return rows.map(fromRow);
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
