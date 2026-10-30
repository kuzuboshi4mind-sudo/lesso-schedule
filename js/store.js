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
  { id: 'home',     name: '自宅',     color: '#bce98a', countInTotal: true },   // 2026-10-16 に少し薄く(元は #ade467。#c9eda0 は薄すぎたので中間)
  { id: 'oki-kawaguchi', name: 'OKI川口', color: '#f0bc00', countInTotal: true },
  { id: 'oki-kamo', name: 'OKI加茂',  color: '#fe8468', countInTotal: true },
  { id: 'sunpal',   name: 'サンパル', color: '#3fe8e9', countInTotal: true },
  { id: 'visit',    name: '訪問',     color: '#5c70f4', countInTotal: true },
  { id: 'online',   name: 'オンライン', color: '#2bb8ba', countInTotal: true },
  // JINIS は Numbers と同じく曜日で色を変える(月=薄い黄・火=薄いピンク・木=薄い水色。ほかの曜日は color)
  { id: 'jinis',    name: 'JINIS',    color: '#ffdbd8', countInTotal: true, weekdayColors: { 1: '#ffe37f', 2: '#ffdbd8', 4: '#9fdcf7' } },   // 木の水色は 2026-10-16 に少し濃く(元は #cbf0ff)
  { id: 'sauna',    name: 'サウナ',   color: '#d7bfae', countInTotal: false },
  { id: 'practice', name: '練習',     color: '#9edbd2', countInTotal: false },
  { id: 'live',     name: 'ライブ',   color: '#d9c2f0', countInTotal: false },
  { id: 'fishing',  name: '釣り',     color: '#a9c8ee', countInTotal: false },   // 2026-10-16 に追加
  { id: 'other',    name: 'その他',   color: '#c4e8f8', countInTotal: false },   // 2026-10-16 に灰色(#d9d9d9)から水色に。表では半透明(60%)で塗るので、JINIS より薄く見える
];

// Numbers で使っていた色(2026-10-16 から初期値。設定画面の「Numbers と同じ色にする」でも使う)
export const NUMBERS_COLORS = Object.fromEntries(DEFAULT_TYPES.map(t => [t.id, t.color]));

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
  const saved = await db.getSetting('types');
  if (!saved) return DEFAULT_TYPES;
  return addNewDefaultTypes(saved);
}

// あとから増えた種類(2026-10-16 の「ライブ」)を、保存済みの種類にも1回だけ足す
// (一度足したら記録するので、本人が設定で削除したらもう足さない)
const TYPE_MIGRATIONS = ['live', 'home-softer', 'home-soft2', 'fishing', 'other-lightblue', 'jinis-thu-deeper', 'other-translucent', 'private-uncounted'];
// 色を変える引き継ぎ:保存済みの色がこれまでの初期の色のままなら、新しい色にする(自分で選んだ色は変えない)
const COLOR_MIGRATIONS = {
  'home-softer': { id: 'home', from: ['#ade467', '#4caf50'], to: '#c9eda0' },
  'home-soft2': { id: 'home', from: ['#c9eda0', '#ade467', '#4caf50'], to: '#bce98a' },
  'other-lightblue': { id: 'other', from: ['#d9d9d9', '#9e9e9e'], to: '#e2f4fc' },
  // weekday があるときは、その曜日の色(weekdayColors)を変える
  'jinis-thu-deeper': { id: 'jinis', weekday: 4, from: ['#cbf0ff'], to: '#9fdcf7' },
  'other-translucent': { id: 'other', from: ['#e2f4fc', '#d9d9d9', '#9e9e9e'], to: '#c4e8f8' },
};
// プライベートの種類は、保存済みの設定で「集計に入れる」になっていても1回だけ「入れない」に戻す
// (2026-10-16:サウナ・練習がレッスンの合計に入っていたため。あとで設定から入れ直すことはできる)
const UNCOUNT_MIGRATIONS = { 'private-uncounted': ['sauna', 'practice', 'live', 'fishing', 'other'] };
async function addNewDefaultTypes(saved) {
  const done = (await db.getSetting('typeMigrations')) || [];
  const todo = TYPE_MIGRATIONS.filter(id => !done.includes(id));
  if (!todo.length) return saved;
  const types = [...saved];
  for (const id of todo) {
    if (UNCOUNT_MIGRATIONS[id]) {
      types.forEach((t, i) => { if (UNCOUNT_MIGRATIONS[id].includes(t.id) && t.countInTotal) types[i] = { ...t, countInTotal: false }; });
      continue;
    }
    const recolor = COLOR_MIGRATIONS[id];
    if (recolor) {
      const t = types.find(x => x.id === recolor.id);
      if (t && recolor.weekday != null) {
        const now = t.weekdayColors?.[recolor.weekday];
        if (now && recolor.from.includes(String(now).toLowerCase())) {
          types[types.indexOf(t)] = { ...t, weekdayColors: { ...t.weekdayColors, [recolor.weekday]: recolor.to } };
        }
      } else if (t && recolor.from.includes(String(t.color).toLowerCase())) types[types.indexOf(t)] = { ...t, color: recolor.to };
      continue;
    }
    if (types.some(t => t.id === id)) continue;
    const def = DEFAULT_TYPES.find(t => t.id === id);
    const other = types.findIndex(t => t.id === 'other');
    types.splice(other >= 0 ? other : types.length, 0, { ...def });   // 「その他」の前に入れる
  }
  await db.setSetting('types', types);
  await db.setSetting('typeMigrations', [...done, ...todo]);
  return types;
}

// 予定を塗る色(種類の色。JINIS のように曜日で色が変わる種類は、その曜日の色)
const JINIS_WEEKDAY_COLORS = { 1: '#ffe37f', 2: '#ffdbd8', 4: '#9fdcf7' };
export function lessonColor(lesson, type) {
  if (!type) return '#9e9e9e';
  const byWeekday = type.weekdayColors || (type.id === 'jinis' ? JINIS_WEEKDAY_COLORS : null);
  if (byWeekday && lesson?.date) {
    const [y, m, d] = lesson.date.split('-').map(Number);
    const c = byWeekday[new Date(y, m - 1, d).getDay()];
    if (c) return c;
  }
  return type.color;
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
// 毎週の固定枠から自動で入る予定(id が 'rec:' で始まる)も含む
export async function getLessons(year, month) {
  const [from, to] = monthRange(year, month);
  const [lessons, occurrences] = await Promise.all([db.listLessons(from, to), getOccurrences(from, to)]);
  return lessons.concat(occurrences);
}

export async function getLesson(id) {
  if (isOccurrenceId(id)) return getOccurrence(id);
  return (await db.getLessonsByIds([id]))[0] || null;
}

// 「すべての期間」を表す日付(データベースが受け付ける日付にする。0000年は日付として存在しないので使えない)
const ALL_FROM = '1900-01-01';
const ALL_TO = '2999-12-31';

// ---- 書き込みの共通部分と「元に戻す / やり直す」----
// 変更はすべて「変更前 → 変更後」の組で記録する(新規は変更前が null、削除は変更後が null)。
// 元に戻すときは変更前の状態を、やり直すときは変更後の状態を書き戻す。
// 記録はこの画面を開いている間だけ(読み込み直すと消える)。最大50回分。
const HISTORY_LIMIT = 50;
const undoStack = [];
const redoStack = [];

// 変更前か変更後のどちらかの状態を書き込む(useAfter=true で変更後)
// 固定枠 → 例外 → 予定 → メモ の順に書く(例外は固定枠があってから書く必要があるため)
async function applyChange(entry, useAfter) {
  const pick = c => (useAfter ? c.after : c.before);
  const slotStates = entry.slots.map(c => ({ id: (c.after || c.before).id, slot: pick(c) }));
  const excStates = entry.exceptions.map(c => ({ id: (c.after || c.before).id, exception: pick(c) }));
  const lessonStates = entry.lessons.map(c => ({ id: (c.after || c.before).id, lesson: pick(c) }));
  const noteStates = entry.notes.map(c => ({ date: c.date, text: pick(c) }));
  const studentStates = entry.students.map(c => ({ id: (c.after || c.before).id, student: pick(c) }));
  for (const c of entry.settings) await db.setSetting(c.key, pick(c));
  if (entry.months.length) await db.writeMonths(entry.months.map(c => ({ ym: c.ym, tentative: pick(c) })));
  if (slotStates.length) await db.writeSlots(slotStates);
  if (excStates.length) await db.writeExceptions(excStates);
  if (lessonStates.length) await db.writeLessons(lessonStates);
  if (noteStates.length) await db.writeNotes(noteStates);
  if (studentStates.length) await db.writeStudents(studentStates);
}

// 変更を書き込んで記録する。label は「元に戻しました:〇〇」の表示に使う
// change = { label, lessons:[{ before, after }], notes:[{ date, before, after }],
//            slots:[{ before, after }], exceptions:[{ before, after }], students:[{ before, after }],
//            settings:[{ key, before, after }], months:[{ ym, before, after }](仮の月か)}
// 書き込みに失敗したときは記録しない(エラーはそのまま呼んだ側に伝える)
async function commit(change) {
  const entry = {
    label: change.label, lessons: change.lessons || [], notes: change.notes || [],
    slots: change.slots || [], exceptions: change.exceptions || [], students: change.students || [],
    settings: change.settings || [],
    months: change.months || [],
  };
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

// まとめて削除する(ゴミ箱に入れる。30日間は「ゴミ箱」から元に戻せる)
// 固定枠から入った予定は、その日だけ「休み」にする
export async function deleteLessons(ids, label = '削除') {
  const realIds = ids.filter(id => !isOccurrenceId(id));
  const occIds = ids.filter(isOccurrenceId);
  const targets = (await db.getLessonsByIds(realIds)).filter(t => !t.deletedAt);
  const now = new Date().toISOString();
  await commit({
    label: `${label}(${targets.length + occIds.length}件)`,
    lessons: targets.map(t => ({ before: t, after: { ...t, deletedAt: now } })),
    exceptions: occIds.map(id => ({ before: null, after: newException(parseOccurrenceId(id), 'skip') })),
  });
}

// 新規(id なし)なら追加、id ありなら上書き
// 固定枠から入った予定(id が 'rec:')を保存すると、「この日だけ変更」になる
export async function saveLesson(lesson) {
  if (isOccurrenceId(lesson.id)) return changeOccurrence(lesson.id, lesson);
  const before = lesson.id ? await getLesson(lesson.id) : null;
  const after = lesson.id ? lesson : { ...lesson, id: newId() };
  await commit({ label: `${before ? '変更' : '追加'}:${nameOf(after)}`, lessons: [{ before, after }] });
  return after;
}

// 1件削除する(ゴミ箱に入れる。固定枠の予定は、その日だけ休みにする)
export async function deleteLesson(id) {
  if (isOccurrenceId(id)) return skipOccurrence(id);
  const before = await getLesson(id);
  if (before && !before.deletedAt) {
    await commit({ label: `削除:${nameOf(before)}`, lessons: [{ before, after: { ...before, deletedAt: new Date().toISOString() } }] });
  }
}

// ---- ゴミ箱 ----
export const TRASH_DAYS = 30;   // ゴミ箱に残しておく日数

// ゴミ箱の中の予定(新しく消した順)
export async function getTrash() {
  return db.listTrash();
}

// ゴミ箱から元に戻す(「戻す」でもう一度ゴミ箱へ戻せる)
export async function restoreLessons(ids) {
  const targets = (await db.getLessonsByIds(ids)).filter(t => t.deletedAt);
  await commit({
    label: targets.length === 1 ? `ゴミ箱から復元:${nameOf(targets[0])}` : `ゴミ箱から復元(${targets.length}件)`,
    lessons: targets.map(t => ({ before: t, after: { ...t, deletedAt: null } })),
  });
  return targets;
}

// 30日より前にゴミ箱に入れた予定を完全に消す(アプリを開いたときに呼ぶ)
export async function purgeOldTrash() {
  const before = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  await db.purgeTrash(before);
}

// ---- 毎週の固定枠 ----
// 固定枠:{ id, weekday(0=日曜), start, duration, student, typeId, status, memo, startDate, endDate }
// 固定枠から入る毎週の予定は、データベースには保存せず、表示するたびに作る(id は 'rec:固定枠id:日付')。
// その日だけ休み・変更にした日は「例外」{ id, slotId, date, action:'skip'|'change', lessonId } として保存する。
// 「この日だけ変更」は、その日の分をふつうの予定として保存し、固定枠のほうは例外で隠す。

const OCC_PREFIX = 'rec:';

export function isOccurrenceId(id) {
  return typeof id === 'string' && id.startsWith(OCC_PREFIX);
}

function occurrenceId(slotId, date) {
  return `${OCC_PREFIX}${slotId}:${date}`;
}

function parseOccurrenceId(id) {
  const [, slotId, date] = id.split(':');
  return { slotId, date };
}

function newException({ slotId, date }, action, lessonId = null) {
  return { id: newId(), slotId, date, action, lessonId };
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// くり返しの決まり(rule)
//  weekly       :毎週(weekday の曜日)
//  monthly_nth  :毎月 第n○曜日(nth と weekday)
//  monthly_last :毎月 最終○曜日(weekday)
//  monthly_day  :毎月 ○日(monthDay。その日がない月はお休み。例:31日は 30日までの月には入らない)
// 古い固定枠(rule がない)は毎週として扱う
export const RULES = ['weekly', 'monthly_nth', 'monthly_last', 'monthly_day'];

function dayOf(date) {
  return Number(date.slice(8, 10));
}

function daysInMonth(date) {
  const [y, m] = date.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// その日付から作れる、くり返しの決まりの候補(入力画面の選択肢に使う)
export function ruleOptions(date) {
  const wd = weekdayOf(date), day = dayOf(date), nth = Math.ceil(day / 7);
  const name = WEEKDAY_NAMES[wd];
  const options = [
    { rule: 'weekly', label: `毎週 ${name}曜日` },
    { rule: 'monthly_nth', label: `毎月 第${nth}${name}曜日` },
  ];
  if (day + 7 > daysInMonth(date)) options.push({ rule: 'monthly_last', label: `毎月 最終${name}曜日` });
  options.push({ rule: 'monthly_day', label: `毎月 ${day}日` });
  return options;
}

// 決まりと日付から、固定枠の「いつ」の部分を作る
function ruleFields(rule, date) {
  return {
    rule: rule || 'weekly',
    weekday: weekdayOf(date),
    nth: rule === 'monthly_nth' ? Math.ceil(dayOf(date) / 7) : null,
    monthDay: rule === 'monthly_day' ? dayOf(date) : null,
  };
}

function slotActiveOn(slot, date) {
  if (date < slot.startDate || (slot.endDate && date > slot.endDate)) return false;
  const day = dayOf(date);
  switch (slot.rule || 'weekly') {
    case 'monthly_day': return day === slot.monthDay;
    case 'monthly_nth': return slot.weekday === weekdayOf(date) && Math.ceil(day / 7) === slot.nth;
    case 'monthly_last': return slot.weekday === weekdayOf(date) && day + 7 > daysInMonth(date);
    default: return slot.weekday === weekdayOf(date);
  }
}

function occurrenceOf(slot, date) {
  const { id, weekday, startDate, endDate, rule, nth, monthDay, ...rest } = slot;
  return { ...rest, id: occurrenceId(slot.id, date), date, recurring: { slotId: slot.id, date } };
}

// from〜to の間に固定枠から入る予定(休み・変更にした日は除く)
async function getOccurrences(from, to) {
  const [slots, exceptions] = await Promise.all([db.listSlots(), db.listExceptions(from, to)]);
  if (!slots.length) return [];
  const hidden = new Set(exceptions.map(x => `${x.slotId}|${x.date}`));
  const out = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const slot of slots) {
      if (slotActiveOn(slot, date) && !hidden.has(`${slot.id}|${date}`)) out.push(occurrenceOf(slot, date));
    }
  }
  return out;
}

async function getOccurrence(id) {
  const { slotId, date } = parseOccurrenceId(id);
  const slot = (await db.listSlots()).find(s => s.id === slotId);
  return slot ? { ...occurrenceOf(slot, date), slot } : null;
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// 「毎週水曜 15:00」「毎月第2水曜 15:00」「毎月15日 15:00」のような説明
export function slotLabel(slot) {
  const name = WEEKDAY_NAMES[slot.weekday];
  const when = {
    monthly_nth: `毎月第${slot.nth}${name}曜`,
    monthly_last: `毎月最終${name}曜`,
    monthly_day: `毎月${slot.monthDay}日`,
  }[slot.rule] || `毎週${name}曜`;
  return `${when} ${slot.start}`;
}

// 固定枠の一覧(毎週→毎月の順、その中は曜日・日付・時刻の順)
export async function getSlots() {
  const order = s => RULES.indexOf(s.rule || 'weekly');
  return (await db.listSlots()).sort((a, b) =>
    order(a) - order(b) || (a.monthDay || 0) - (b.monthDay || 0) || a.weekday - b.weekday || toMin(a.start) - toMin(b.start));
}

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 予定の内容から固定枠を作る(rule はくり返しの決まり。endDate は省略可)
export async function addSlot(lesson, endDate = null, rule = 'weekly') {
  const slot = {
    id: newId(), ...ruleFields(rule, lesson.date), start: lesson.start, duration: lesson.duration,
    student: lesson.student || '', typeId: lesson.typeId, status: lesson.status || 'confirmed', memo: lesson.memo || '',
    startDate: lesson.date, endDate: endDate || null,
  };
  // ふつうの予定から固定枠にしたときは、元の予定はゴミ箱へ(同じ日に二重に出ないように)
  const original = lesson.id && !isOccurrenceId(lesson.id) ? await getLesson(lesson.id) : null;
  await commit({
    label: `固定枠を追加:${slotLabel(slot)} ${nameOf(slot)}`,
    slots: [{ before: null, after: slot }],
    lessons: original ? [{ before: original, after: { ...original, deletedAt: new Date().toISOString() } }] : [],
  });
  return slot;
}

// この日だけ休み
export async function skipOccurrence(id) {
  const occ = parseOccurrenceId(id);
  await commit({ label: `この日だけ休み:${occ.date}`, exceptions: [{ before: null, after: newException(occ, 'skip') }] });
}

// この日だけ変更(その日の分をふつうの予定として保存)
async function changeOccurrence(id, values) {
  const occ = parseOccurrenceId(id);
  const { recurring, slot, ...rest } = values;
  const lesson = { ...rest, id: newId(), deletedAt: null };
  await commit({
    label: `この日だけ変更:${nameOf(lesson)}`,
    lessons: [{ before: null, after: lesson }],
    exceptions: [{ before: null, after: newException(occ, 'change', lesson.id) }],
  });
  return lesson;
}

// この日以降の固定枠を、新しい内容に変える(前日までは元の内容のまま)
export async function changeSlotFrom(id, values) {
  const { slotId, date } = parseOccurrenceId(id);
  const old = (await db.listSlots()).find(s => s.id === slotId);
  if (!old) return;
  const next = {
    ...old, id: newId(), ...ruleFields(old.rule, values.date), start: values.start, duration: values.duration,
    student: values.student || '', typeId: values.typeId, status: values.status, memo: values.memo || '',
    startDate: values.date,
  };
  const slots = old.startDate >= date
    ? [{ before: old, after: { ...next, id: old.id } }]                                   // 初回から変えるなら、そのまま書き換え
    : [{ before: old, after: { ...old, endDate: addDays(date, -1) } }, { before: null, after: next }];
  await commit({ label: `固定枠を変更:${slotLabel(next)} ${nameOf(next)}`, slots });
}

// この日以降の固定枠を終わりにする(初回より前なら固定枠ごと削除)
export async function endSlotFrom(id) {
  const { slotId, date } = parseOccurrenceId(id);
  const slot = (await db.listSlots()).find(s => s.id === slotId);
  if (!slot) return;
  if (slot.startDate >= date) return deleteSlot(slotId);
  await commit({ label: `固定枠を終了:${slotLabel(slot)} ${nameOf(slot)}`, slots: [{ before: slot, after: { ...slot, endDate: addDays(date, -1) } }] });
}

// 固定枠の内容を書き換える(設定画面の一覧から。終了日の変更など)
export async function updateSlot(slot) {
  const before = (await db.listSlots()).find(s => s.id === slot.id);
  await commit({ label: `固定枠を変更:${slotLabel(slot)} ${nameOf(slot)}`, slots: [{ before, after: slot }] });
}

// 固定枠を削除(その例外も一緒に)
export async function deleteSlot(slotId) {
  const slot = (await db.listSlots()).find(s => s.id === slotId);
  if (!slot) return;
  const exceptions = (await db.listExceptions(ALL_FROM, ALL_TO)).filter(x => x.slotId === slotId);
  await commit({
    label: `固定枠を削除:${slotLabel(slot)} ${nameOf(slot)}`,
    slots: [{ before: slot, after: null }],
    exceptions: exceptions.map(x => ({ before: x, after: null })),
  });
}

// 固定枠ごとの「休みにした日」
export async function getSkips(slotId) {
  return (await db.listExceptions(ALL_FROM, ALL_TO))
    .filter(x => x.slotId === slotId && x.action === 'skip').sort((a, b) => a.date.localeCompare(b.date));
}

// 休みにした日を元に戻す(固定枠の予定がまた入る)
export async function unskip(exception) {
  await commit({ label: `休みを取り消し:${exception.date}`, exceptions: [{ before: exception, after: null }] });
}

// from〜to の期間、すべての固定枠を休みにする(夏休みなど)。休みにした件数を返す
export async function skipRange(from, to) {
  const occurrences = await getOccurrences(from, to);
  if (!occurrences.length) return 0;
  await commit({
    label: `期間を休みに:${from}〜${to}`,
    exceptions: occurrences.map(o => ({ before: null, after: newException(o.recurring, 'skip') })),
  });
  return occurrences.length;
}

// ---- バックアップ(ファイルへの書き出し・読み込み)----
const BACKUP_APP = 'lesso-schedule';
const LAST_BACKUP_KEY = 'lesso.lastBackupAt';

// 書き出すデータを作る。month を省くと全部
// 形:{ app, version, kind:'month'|'all', months:['2026-10'], exportedAt, lessons:[...], dayNotes:{...}, settings:{...} }
export async function buildBackup(year, month) {
  const [from, to] = year ? monthRange(year, month) : [ALL_FROM, ALL_TO];
  const [lessons, dayNotes, types, durationRules, slots, exceptions, students, hiddenStudents, tentativeMonths, studentExtras] = await Promise.all([
    db.listLessons(from, to), db.listNotes(from, to), getTypes(), getDurationRules(),
    db.listSlots(), db.listExceptions(ALL_FROM, ALL_TO), db.listStudents(), getHiddenStudents(), db.listMonths(), getStudentExtras(),
  ]);
  const months = year
    ? [`${year}-${String(month).padStart(2, '0')}`]
    : [...new Set([...lessons.map(l => l.date), ...Object.keys(dayNotes)].map(d => d.slice(0, 7)))].sort();
  return {
    app: BACKUP_APP, version: 1, kind: year ? 'month' : 'all', months,
    exportedAt: new Date().toISOString(),
    lessons: lessons.map(({ deletedAt, ...l }) => l),
    dayNotes,
    settings: { types, durationRules, hiddenStudents, studentExtras },
    recurring: { slots, exceptions },   // 毎週の固定枠(どの月の書き出しにも全部入れる)
    students,                           // 生徒メモ(どの月の書き出しにも全部入れる)
    tentativeMonths: months.filter(ym => tentativeMonths[ym]),   // 仮の月
  };
}

export function markBackedUp() {
  try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch { /* 記録できなくても続ける */ }
}

// 最後に書き出した日時(この端末で。なければ null)
export function lastBackupAt() {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}

// 2つの予定の中身が同じか(ゴミ箱の印は比べない)
const LESSON_FIELDS = ['date', 'start', 'duration', 'student', 'typeId', 'status', 'memo'];
function sameLesson(a, b) {
  return LESSON_FIELDS.every(k => (a[k] ?? '') === (b[k] ?? ''));
}

// 読み込んだファイルの中身を確かめる。おかしければ日本語のエラーを投げる
export function checkBackup(data) {
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.lessons) || !Array.isArray(data.months)) {
    throw new Error('このアプリのバックアップファイルではないようです');
  }
  for (const l of data.lessons) {
    if (!l.id || !/^\d{4}-\d{2}-\d{2}$/.test(l.date) || !/^\d{1,2}:\d{2}$/.test(l.start) || !(l.duration > 0)) {
      throw new Error('バックアップファイルの中身が壊れているようです');
    }
  }
  return data;
}

// バックアップを読み込む:ファイルに入っている月の予定と日ごとのメモを、ファイルの内容に置き換える
// (今あってファイルにない予定はゴミ箱へ。この操作も「戻す」で元に戻せる)
// withSettings が true なら、種類と色・換算表もファイルの内容に戻す
export async function restoreBackup(data, { withSettings = false } = {}) {
  checkBackup(data);
  const now = new Date().toISOString();
  const lessonChanges = [];
  const noteChanges = [];
  const backupIds = new Set(data.lessons.map(l => l.id));
  for (const ym of data.months) {
    const [y, m] = ym.split('-').map(Number);
    const [from, to] = monthRange(y, m);
    const [current, notes] = await Promise.all([db.listLessons(from, to), db.listNotes(from, to)]);
    for (const l of current) {
      if (!backupIds.has(l.id)) lessonChanges.push({ before: l, after: { ...l, deletedAt: now } });
    }
    const backupNotes = Object.fromEntries(Object.entries(data.dayNotes || {}).filter(([d]) => d >= from && d <= to));
    for (const date of new Set([...Object.keys(notes), ...Object.keys(backupNotes)])) {
      const before = notes[date] || null, after = backupNotes[date] || null;
      if (before !== after) noteChanges.push({ date, before, after });
    }
  }
  const existing = new Map((await db.getLessonsByIds([...backupIds])).map(l => [l.id, l]));
  for (const l of data.lessons) {
    const before = existing.get(l.id) || null;
    const after = { ...l, deletedAt: null };
    // 新しい予定・ゴミ箱に入っている予定・中身が違う予定だけを書き戻す
    if (!before || before.deletedAt || !sameLesson(before, after)) lessonChanges.push({ before, after });
  }
  // 「設定も戻す」を選んだときは、毎週の固定枠もファイルの内容にそろえる
  const slotChanges = [], excChanges = [];
  if (withSettings && data.recurring) {
    const [curSlots, curExc] = await Promise.all([db.listSlots(), db.listExceptions(ALL_FROM, ALL_TO)]);
    const sync = (current, wanted, out) => {
      const wantedIds = new Set(wanted.map(x => x.id));
      const byId = new Map(current.map(x => [x.id, x]));
      for (const x of current) if (!wantedIds.has(x.id)) out.push({ before: x, after: null });
      for (const x of wanted) out.push({ before: byId.get(x.id) || null, after: x });
    };
    sync(curSlots, data.recurring.slots || [], slotChanges);
    sync(curExc, data.recurring.exceptions || [], excChanges);
  }
  // 生徒メモも「設定も戻す」のときだけ、ファイルの内容にそろえる(生徒メモの入っていない古いファイルなら今のまま)
  const studentChanges = [];
  if (withSettings && Array.isArray(data.students)) {
    const current = await db.listStudents();
    const wantedIds = new Set(data.students.map(x => x.id));
    const byId = new Map(current.map(x => [x.id, x]));
    for (const x of current) if (!wantedIds.has(x.id)) studentChanges.push({ before: x, after: null });
    for (const x of data.students) {
      const before = byId.get(x.id) || null;
      if (!before || before.name !== x.name || before.memo !== x.memo) studentChanges.push({ before, after: x });
    }
  }
  // 仮の月かどうかも、ファイルの内容にそろえる(この情報が入っていない古いファイルなら今のまま)
  const monthChanges = [];
  if (Array.isArray(data.tentativeMonths)) {
    const current = await db.listMonths();
    for (const ym of data.months) {
      const before = !!current[ym], after = data.tentativeMonths.includes(ym);
      if (before !== after) monthChanges.push({ ym, before, after });
    }
  }
  await commit({
    months: monthChanges,
    label: `バックアップの読み込み(${data.months.join('・')})`,
    lessons: lessonChanges, notes: noteChanges, slots: slotChanges, exceptions: excChanges, students: studentChanges,
  });
  if (withSettings && data.settings) {
    if (data.settings.types) await saveTypes(data.settings.types);
    if (data.settings.durationRules) await saveDurationRules(data.settings.durationRules);
    if (data.settings.hiddenStudents) await db.setSetting('hiddenStudents', data.settings.hiddenStudents);
    if (data.settings.studentExtras) await db.setSetting('studentExtras', data.settings.studentExtras);
  }
  return { lessons: data.lessons.length, changed: lessonChanges.length + noteChanges.length };
}

// 入力したことのある生徒名の一覧(入力欄の候補に出す)
export async function getStudentNames() {
  const [fromLessons, slots, hidden] = await Promise.all([db.studentNames(), db.listSlots(), getHiddenStudents()]);
  const names = new Set([...fromLessons, ...slots.map(sl => sl.student)].filter(Boolean));
  for (const n of hidden) names.delete(n);
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

// ---- 生徒メモ ----
// 生徒:{ id, name, memo, updatedAt }。予定の「名前」と同じ文字の生徒を、同じ人として扱う
// 一覧に出すのは、メモを書いた生徒と、レッスンの予定・固定枠に名前がある生徒
// (「なし(自分の予定)」と、集計に入れない種類(サウナ・練習・その他など)の予定はレッスンではないので数えない)
// 「生徒を削除」した名前は一覧と名前の候補から外す(予定はそのまま。設定の hiddenStudents に名前を覚える)

export async function getHiddenStudents() {
  return (await db.getSetting('hiddenStudents')) || [];
}

// レッスンとして数える予定・固定枠か
function isLessonLike(l, typeById) {
  return (l.status || 'tentative') !== 'none' && !!typeById[l.typeId]?.countInTotal;
}

// 端末の時計での今日('2026-10-15')
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getStudents() {
  return (await db.listStudents()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

// 生徒の一覧(メモ・いつもの種類・次の予定・固定枠つき)
// 戻り値:[{ name, id, memo, typeId, next:{date,start}|null, slots:[固定枠], count }]
export async function getStudentOverview() {
  const today = localToday();
  const from = addDays(today, -180), to = addDays(today, 92);
  // 連絡が必要かどうか・仮の予定の一覧は、今月と来月の分だけで見る(2か月以上先の予定を送ることはまずないため。2026-10-19)
  const [ty, tm] = today.split('-').map(Number);
  const nextMonthEnd = `${tm === 12 ? ty + 1 : ty}-${String(tm === 12 ? 1 : tm + 1).padStart(2, '0')}-31`;
  const [students, allLessons, occurrences, allSlots, types, hidden, extras] = await Promise.all([
    db.listStudents(), db.listLessons(from, to), getOccurrences(today, to), db.listSlots(), getTypes(), getHiddenStudents(),
    getStudentExtras(),
  ]);
  const typeById = Object.fromEntries(types.map(t => [t.id, t]));
  const hiddenSet = new Set(hidden);
  const lessons = allLessons.filter(l => isLessonLike(l, typeById) && !hiddenSet.has(l.student));
  const slots = allSlots.filter(sl => isLessonLike(sl, typeById) && !hiddenSet.has(sl.student));
  const byName = new Map();
  const entry = name => {
    if (!byName.has(name)) {
      const x = extras[name] || {};
      byName.set(name, {
        name, id: null, memo: '', typeId: null, next: null, slots: [], count: 0, lastDate: '',
        lineName: x.lineName || '', sentAt: x.sentAt || null, tentative: [], unsent: [],
      });
    }
    return byName.get(name);
  };
  for (const s of students) if (!hiddenSet.has(s.name)) Object.assign(entry(s.name), { id: s.id, memo: s.memo || '' });
  const activeSlots = slots.filter(sl => !sl.endDate || sl.endDate >= today);
  for (const sl of activeSlots) if (sl.student) entry(sl.student).slots.push(sl);
  for (const l of lessons.concat(occurrences.filter(o => isLessonLike(o, typeById) && !hiddenSet.has(o.student)))) {
    if (!l.student) continue;
    const e = entry(l.student);
    const status = l.status || 'tentative';
    // いつもの種類:今日までで一番新しい予定の種類(なければこれからの予定)
    if (l.date <= today && l.date >= e.lastDate) { e.lastDate = l.date; e.typeId = l.typeId; }
    if (!e.typeId) e.typeId = l.typeId;
    if (l.date >= today && status !== 'cancelled'
        && (!e.next || l.date < e.next.date || (l.date === e.next.date && l.start < e.next.start))) {
      e.next = { date: l.date, start: l.start };
    }
    if (l.date >= today && status !== 'cancelled') e.count++;
    if (l.date >= today && l.date <= nextMonthEnd && status === 'tentative') e.tentative.push(l);
  }
  for (const sl of activeSlots) {
    const e = byName.get(sl.student);
    if (e && !e.typeId) e.typeId = sl.typeId;
  }
  // まとまり:todo=仮の予定があり、まだ LINE で送っていないものがある / waiting=仮の予定は全部送った(返事待ち)
  //          confirmed=これからの予定は全部確約 / none=これからの予定なし
  for (const e of byName.values()) {
    const sent = new Set((extras[e.name]?.sent || []).map(x => x.id));
    e.unsent = e.tentative.filter(l => !sent.has(l.id));
    e.group = e.tentative.length ? (e.unsent.length ? 'todo' : 'waiting') : e.count ? 'confirmed' : 'none';
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

// 「仮の予定があって、まだ LINE で送っていない」生徒の人数(上の「👤 生徒」ボタンの数字)
export async function countStudentsToContact() {
  return (await getStudentOverview()).filter(e => e.group === 'todo').length;
}

// ---- 生徒ごとの LINE の情報 ----
// { 名前: { lineName:'LINE での名前', sentAt:'送った日時', sent:[{ id:予定のid, date }] } }(設定の studentExtras)
export async function getStudentExtras() {
  return (await db.getSetting('studentExtras')) || {};
}

// 名前の分の情報を書き換える変更(commit に入れる形)。patch が null なら消す
async function extrasChange(name, patch) {
  const before = await getStudentExtras();
  const after = { ...before };
  if (patch === null) delete after[name];
  else after[name] = { ...(before[name] || {}), ...patch };
  return { key: 'studentExtras', before, after };
}

// LINE で送った予定を記録する(「LINE を開く」を押したとき)。過ぎた日の記録は消して軽くする
export async function markLineSent(name, lessons) {
  const today = localToday();
  const old = ((await getStudentExtras())[name]?.sent || []).filter(x => x.date >= today);
  const ids = new Set(old.map(x => x.id));
  const sent = old.concat(lessons.filter(l => !ids.has(l.id)).map(l => ({ id: l.id, date: l.date })));
  const change = await extrasChange(name, { sentAt: new Date().toISOString(), sent });
  await commit({ label: `${name}さんに LINE で送った印`, settings: [change] });
}

// LINE でまとめて送る人(家族など)。{ 名前: { lineWith:['一緒に送る人', ...] } } で記録する
// どの人から開いても同じ顔ぶれになるよう、まとまりの全員に記録する。外した人・前のまとまりの人からは消す
export async function saveLineGroup(oldGroup, newGroup) {
  const before = await getStudentExtras();
  const after = { ...before };
  const touched = new Set([...oldGroup, ...newGroup]);
  for (const n of newGroup) for (const m of before[n]?.lineWith || []) touched.add(m);
  for (const n of touched) {
    const lineWith = newGroup.includes(n)
      ? newGroup.filter(m => m !== n)
      : (before[n]?.lineWith || []).filter(m => !newGroup.includes(m) && !oldGroup.includes(m));
    if (!before[n] && !lineWith.length) continue;
    after[n] = { ...(before[n] || {}), lineWith };
  }
  await commit({ label: 'LINE でまとめて送る人', settings: [{ key: 'studentExtras', before, after }] });
}

// 送った印を外す
export async function clearLineSent(name) {
  const change = await extrasChange(name, { sentAt: null, sent: [] });
  await commit({ label: `${name}さんの LINE で送った印を外す`, settings: [change] });
}

// その生徒のこれからの予定(今日から3か月。固定枠から入る予定も含む)
export async function getUpcomingLessons(name) {
  const today = localToday();
  const to = addDays(today, 92);
  const [lessons, occurrences] = await Promise.all([db.listLessons(today, to), getOccurrences(today, to)]);
  return lessons.concat(occurrences)
    .filter(l => l.student === name)
    .sort((a, b) => (a.date + a.start.padStart(5, '0')).localeCompare(b.date + b.start.padStart(5, '0')));
}

// 生徒メモを保存する(id がなければ新しく作る)。同じ名前の生徒がいればその人のメモにする
export async function saveStudent({ id, name, memo, lineName }) {
  name = name.trim();
  if (!name) throw new Error('名前を入れてください');
  const current = await db.listStudents();
  const before = current.find(s => s.id === id) || current.find(s => s.name === name) || null;
  const after = { id: before?.id || newId(), name, memo: memo || '', updatedAt: new Date().toISOString() };
  const hidden = await getHiddenStudents();
  // 削除した生徒と同じ名前で追加したときは、一覧に戻す
  const settings = hidden.includes(name) ? [{ key: 'hiddenStudents', before: hidden, after: hidden.filter(n => n !== name) }] : [];
  // LINE での名前(送り先)
  if (lineName !== undefined && ((await getStudentExtras())[name]?.lineName || '') !== lineName.trim()) {
    settings.push(await extrasChange(name, { lineName: lineName.trim() }));
  }
  if (before && before.name === after.name && before.memo === after.memo && !settings.length) return after;
  await commit({ label: `${name}さんの生徒メモ`, students: [{ before, after }], settings });
  return after;
}

// 生徒を削除:一覧と名前の候補から外す。予定・固定枠はそのまま残す
// 生徒メモは消さずに残す(「削除した生徒」から一覧に戻すと、メモも戻る)
export async function deleteStudent(name) {
  const hidden = await getHiddenStudents();
  if (hidden.includes(name)) return;
  await commit({ label: `${name}さんの削除`, settings: [{ key: 'hiddenStudents', before: hidden, after: [...hidden, name] }] });
}

// 削除した生徒を一覧に戻す
export async function restoreStudent(name) {
  const hidden = await getHiddenStudents();
  if (!hidden.includes(name)) return;
  await commit({ label: `${name}さんを一覧に戻す`, settings: [{ key: 'hiddenStudents', before: hidden, after: hidden.filter(n => n !== name) }] });
}

// 名前を変える:予定・固定枠・生徒メモの名前をまとめて書き換える(「戻す」で元に戻せる)
// 新しい名前の生徒メモがもうあるときは、2人のメモをつなげて1人にする
export async function renameStudent(oldName, newName) {
  newName = newName.trim();
  if (!newName) throw new Error('新しい名前を入れてください');
  if (newName === oldName) return 0;
  const [lessons, slots, students] = await Promise.all([db.lessonsOfStudent(oldName), db.listSlots(), db.listStudents()]);
  const lessonChanges = lessons.map(l => ({ before: l, after: { ...l, student: newName } }));
  const slotChanges = slots.filter(sl => sl.student === oldName).map(sl => ({ before: sl, after: { ...sl, student: newName } }));
  const studentChanges = [];
  const from = students.find(s => s.name === oldName);
  const to = students.find(s => s.name === newName);
  const now = new Date().toISOString();
  if (from && to) {
    const memo = [to.memo, from.memo].filter(Boolean).join('\n');
    studentChanges.push({ before: to, after: { ...to, memo, updatedAt: now } }, { before: from, after: null });
  } else if (from) {
    studentChanges.push({ before: from, after: { ...from, name: newName, updatedAt: now } });
  }
  // LINE の情報も新しい名前に移す
  const settings = [];
  const extras = await getStudentExtras();
  if (extras[oldName]) {
    const after = { ...extras, [newName]: { ...extras[oldName], ...(extras[newName] || {}) } };
    delete after[oldName];
    // まとめて送る人(家族)の記録の名前も変える
    for (const [n, x] of Object.entries(after)) {
      if (x.lineWith?.includes(oldName)) after[n] = { ...x, lineWith: [...new Set(x.lineWith.map(m => m === oldName ? newName : m))].filter(m => m !== n) };
    }
    settings.push({ key: 'studentExtras', before: extras, after });
  }
  await commit({
    label: `名前の変更(${oldName} → ${newName})`,
    lessons: lessonChanges, slots: slotChanges, students: studentChanges, settings,
  });
  return lessonChanges.length + slotChanges.length;
}

// ---- 仮の月 ----
// 確定していない月は「仮」にできる(Numbers の「6月仮」のタブと同じ)
const ymOf = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

export async function isTentativeMonth(year, month) {
  return !!(await db.listMonths())[ymOf(year, month)];
}

export async function setTentativeMonth(year, month, tentative) {
  const ym = ymOf(year, month);
  const before = !!(await db.listMonths())[ym];
  if (before === tentative) return;
  await commit({ label: `${month}月を${tentative ? '仮' : '確定'}にする`, months: [{ ym, before, after: tentative }] });
}

// ---- LINE で予定を送る ----
// その生徒の、期間内の予定(固定枠から入る予定も含む。時刻の順)
export async function getStudentLessons(name, from, to) {
  const [lessons, occurrences] = await Promise.all([db.listLessons(from, to), getOccurrences(from, to)]);
  return lessons.concat(occurrences)
    .filter(l => l.student === name)
    .sort((a, b) => (a.date + a.start.padStart(5, '0')).localeCompare(b.date + b.start.padStart(5, '0')));
}

// 送る文面のひな形({名前}{期間}{予定} が自動で入る)。どの端末でも同じものを使う
export const DEFAULT_LINE_TEMPLATE = '{名前}さん\nこんにちは。{期間}のレッスンの予定です。\n\n{予定}\n\nご都合はいかがでしょうか。よろしくお願いします。';

export async function getLineTemplate() {
  return (await db.getSetting('lineTemplate')) || DEFAULT_LINE_TEMPLATE;
}

export async function saveLineTemplate(text) {
  await db.setSetting('lineTemplate', text);
}

// ひな形は3パターンまで保存できる(2026-10-30)。{ active: 選んでいる番号, list: [{ name, text } ×3] }
// 前の1つだけのひな形(lineTemplate)があれば、それをパターン1にする
export const LINE_TEMPLATE_COUNT = 3;
export async function getLineTemplates() {
  const saved = await db.getSetting('lineTemplates');
  if (saved?.list?.length === LINE_TEMPLATE_COUNT) return saved;
  const first = await getLineTemplate();
  const list = Array.from({ length: LINE_TEMPLATE_COUNT }, (_, i) => ({
    name: `パターン${i + 1}`, text: i === 0 ? first : DEFAULT_LINE_TEMPLATE,
  }));
  return { active: 0, list };
}

export async function saveLineTemplates(templates) {
  await db.setSetting('lineTemplates', templates);
}

// まとめて送る人に足した回数(よく足す人を、検索の欄の下に先に出すため)。{ 名前: 回数 }
export async function getLineAddCounts() {
  return (await db.getSetting('lineAddCounts')) || {};
}

export async function countLineAdd(name) {
  const counts = await getLineAddCounts();
  await db.setSetting('lineAddCounts', { ...counts, [name]: (counts[name] || 0) + 1 });
}

// 返事が来た仮の予定を、まとめて「確約」にする(1回の「戻す」でまとめて元に戻せる)
// 固定枠から入った予定は、その日だけ確約の予定にする(固定枠そのものは変えない)
export async function confirmLessons(lessons) {
  const lessonChanges = [], exceptions = [];
  for (const l of lessons) {
    if (isOccurrenceId(l.id)) {
      const { recurring, slot, ...rest } = l;
      const after = { ...rest, id: newId(), status: 'confirmed', deletedAt: null };
      lessonChanges.push({ before: null, after });
      exceptions.push({ before: null, after: newException(parseOccurrenceId(l.id), 'change', after.id) });
    } else {
      const before = (await db.getLessonsByIds([l.id]))[0];
      if (before && !before.deletedAt) lessonChanges.push({ before, after: { ...before, status: 'confirmed' } });
    }
  }
  if (!lessonChanges.length) return 0;
  await commit({ label: `確約にする:${nameOf(lessons[0])}(${lessonChanges.length}件)`, lessons: lessonChanges, exceptions });
  return lessonChanges.length;
}
