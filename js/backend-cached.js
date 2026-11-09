// 保存先:クラウド(Supabase)+ この端末の写し(2026-11-09)
// ・ふだんはクラウドを読み書きする。書き込みが成功したら、同じ内容を写しにも反映する
// ・アプリを開いたときに、クラウドの全部を読み直して写しを作り直す(device-copy.js で端末に残す)
// ・クラウドにつながらないとき(圏外・障害・Supabase の一時停止など)は、写しを「読むだけ」で使う
//   (この間は保存できない。あとでつないだときに食い違いが起きないように)
import * as cloud from './backend-cloud.js';
import { createMemoryBackend } from './backend-memory.js';
import * as copies from './device-copy.js';
import { currentUser } from './cloud.js';

export const label = 'クラウド';

export const OFFLINE_WRITE_MESSAGE =
  'いまはクラウドにつながらないため、保存できません(この端末の写しを読むだけで表示しています)。\n'
  + 'つながってから「つなぎ直す」を押して、もう一度入力してください。';

const ALL_FROM = '1900-01-01';
const ALL_TO = '2999-12-31';

let mem = null;          // 写しを読み書きする backend-memory
let meta = null;         // { savedAt, userId, email }
let offline = false;     // 写しを読むだけで表示しているか
let offlineReason = '';
let writes = 0;          // 書き込みの回数(写しを作り直している間に書き込みがあったかを見る)
const listeners = [];

function setCopy(copy) {
  mem = createMemoryBackend(copy.data);
  meta = { savedAt: copy.savedAt, userId: copy.userId, email: copy.email };
}

// 端末に残した写しを読み込む(まだなら)。写しの情報 { savedAt, email } を返す(なければ null)
export async function loadDeviceCopy() {
  if (!mem) {
    const copy = await copies.loadLatest();
    if (copy?.data) setCopy(copy);
  }
  return meta;
}

export function isOffline() { return offline; }
export function copyInfo() { return meta; }
export function onOfflineChange(fn) { listeners.push(fn); }

// 写しを読むだけの表示に切り替える。写しがなければ false
export async function goOffline(reason = '') {
  if (offline) return true;
  if (!(await loadDeviceCopy())) return false;
  offline = true;
  offlineReason = reason?.message || String(reason || '');
  console.warn('クラウドにつながらないため、この端末の写しで表示します', offlineReason);
  for (const fn of listeners) fn(meta);
  return true;
}

// 読む:クラウド → だめなら写し
function read(name) {
  return async (...args) => {
    if (!offline) {
      try {
        return await cloud[name](...args);
      } catch (err) {
        if (!(await goOffline(err))) throw err;
      }
    }
    return mem[name](...args);
  };
}

// 書く:クラウドに書けたら写しにも反映(写しを読むだけの間は書かない)
function write(name) {
  return async (...args) => {
    if (offline) throw new Error(OFFLINE_WRITE_MESSAGE);
    await cloud[name](...args);
    writes++;
    if (mem) {
      await mem[name](...args);
      meta = { ...meta, savedAt: new Date().toISOString() };
      persistSoon();
    }
  };
}

export const listLessons = read('listLessons');
export const listTrash = read('listTrash');
export const getLessonsByIds = read('getLessonsByIds');
export const countLessonsOfType = read('countLessonsOfType');
export const studentNames = read('studentNames');
export const lessonsOfStudent = read('lessonsOfStudent');
export const listNotes = read('listNotes');
export const getNote = read('getNote');
export const getSetting = read('getSetting');
export const listSlots = read('listSlots');
export const listExceptions = read('listExceptions');
export const listStudents = read('listStudents');
export const listMonths = read('listMonths');

export const purgeTrash = write('purgeTrash');
export const writeLessons = write('writeLessons');
export const writeNotes = write('writeNotes');
export const setSetting = write('setSetting');
export const writeSlots = write('writeSlots');
export const writeExceptions = write('writeExceptions');
export const writeStudents = write('writeStudents');
export const writeMonths = write('writeMonths');

// ---- 写しを端末に残す ----
let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 1500);
}
export async function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  if (!mem || !meta) return false;
  return copies.saveCopy({ ...meta, data: mem.snapshot() });
}
// アプリを閉じる・ほかのアプリに切り替えるときは、待たずにすぐ残す
document.addEventListener('visibilitychange', () => { if (document.hidden && persistTimer) persistNow(); });

// クラウドの全部を読み直して写しを作り直す(アプリを開いたとき・しばらくぶりに戻ったとき)
// 読んでいる間に書き込みがあったら、読み直す(最大3回)
export async function refreshDeviceCopy() {
  if (offline) return false;
  const user = await currentUser();
  if (!user) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = writes;
    const [lessons, trash, dayNotes, settings, slots, exceptions, students, months] = await Promise.all([
      cloud.listLessons(ALL_FROM, ALL_TO), cloud.listTrash(), cloud.listNotes(ALL_FROM, ALL_TO), cloud.listSettings(),
      cloud.listSlots(), cloud.listExceptions(ALL_FROM, ALL_TO), cloud.listStudents(), cloud.listMonths(),
    ]);
    if (writes !== before) continue;
    setCopy({
      savedAt: new Date().toISOString(), userId: user.id, email: user.email,
      data: { lessons: lessons.concat(trash), dayNotes, settings, slots, exceptions, students, months },
    });
    return persistNow();
  }
  return false;
}

// 端末の写し(日ごと)
export const listDayCopies = copies.listDayCopies;
export async function dayCopyBackend(id) {
  const copy = await copies.loadCopy(id);
  return copy?.data ? createMemoryBackend(copy.data) : null;
}

// ログアウトするとき:この端末の写しを消す
export async function clearDeviceCopies() {
  mem = null;
  meta = null;
  await copies.clearCopies();
}
