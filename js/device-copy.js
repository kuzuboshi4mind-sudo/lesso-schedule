// この端末に残すクラウドの写し(IndexedDB=ブラウザの中の保存場所)
// ・latest:いちばん新しい写し(通信できないときに、これを読むだけで表示する)
// ・day:YYYY-MM-DD:日ごとの写し(その日の最後の状態)。KEEP_DAYS 日分だけ残して、古いものから消す
// 1件の形:{ id, savedAt, userId, email, data:{ lessons, dayNotes, settings, slots, exceptions, students, months } }
// IndexedDB が使えない端末(プライベートブラウズなど)では、何もしないで続ける

const DB_NAME = 'lesso-schedule';
const STORE = 'copies';
export const KEEP_DAYS = 14;

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB が使えません')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function pad(n) { return String(n).padStart(2, '0'); }
function dayOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 写しを保存する(latest と、その日の分)。古い日の分を消す
export async function saveCopy(copy) {
  try {
    const day = dayOf(copy.savedAt);
    await run('readwrite', st => {
      st.put({ ...copy, id: 'latest' });
      st.put({ ...copy, id: `day:${day}` });
    });
    const ids = (await run('readonly', st => st.getAllKeys())) || [];
    const days = ids.filter(id => String(id).startsWith('day:')).sort();
    const old = days.slice(0, Math.max(0, days.length - KEEP_DAYS));
    if (old.length) await run('readwrite', st => { for (const id of old) st.delete(id); });
    return true;
  } catch (err) {
    console.warn('この端末に写しを残せませんでした', err);
    return false;
  }
}

export async function loadLatest() {
  try { return (await run('readonly', st => st.get('latest'))) || null; } catch { return null; }
}

export async function loadCopy(id) {
  try { return (await run('readonly', st => st.get(id))) || null; } catch { return null; }
}

// 日ごとの写しの一覧(新しい順。中身は数だけ)
export async function listDayCopies() {
  try {
    const all = (await run('readonly', st => st.getAll())) || [];
    return all.filter(c => String(c.id).startsWith('day:'))
      .sort((a, b) => b.id.localeCompare(a.id))
      .map(c => ({
        id: c.id, day: c.id.slice(4), savedAt: c.savedAt, email: c.email,
        lessons: (c.data?.lessons || []).filter(l => !l.deletedAt).length,
      }));
  } catch {
    return [];
  }
}

// 全部消す(ログアウトするとき)
export async function clearCopies() {
  try { await run('readwrite', st => st.clear()); } catch { /* 消せなくても続ける */ }
}
