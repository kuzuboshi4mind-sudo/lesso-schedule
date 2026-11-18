// メモアプリ(レッスンメモ https://kuzuboshi4mind-sudo.github.io/lesson-memo/)とつなぐ
// ・メモアプリは Firebase(Firestore)に、1行ずつ users/{uid}/items/{id} = { m:'YYYY-MM', text, done, t, pos, f } で保存している
// ・ここでは、メモアプリと同じメールとパスワードでログインして、その行を「読むだけ」(書き換え・削除はしない)
// ・生徒の画面で、先頭の名前(最初のスペースまで)がその生徒の名前と完全に同じ行を「メモアプリの記録」として新しい順に出す
// ・ログインは端末ごと(Firebase がこの端末に覚える)。パスワードはこのアプリでは保存しない
// ・下の設定値はメモアプリの firebase-config.js と同じ。画面側に置く前提の公開の値で、
//   データはメモアプリの firestore.rules(本人だけ読み書きできる)で守られている
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAsaMZrZu8RuQ6Bqv1-PgsVCHA1joKIJqo',
  authDomain: 'lesson-memo-69efb.firebaseapp.com',
  projectId: 'lesson-memo-69efb',
  appId: '1:1027361639718:web:db4fcb88a22822d01005e7',
};
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const CACHE_MS = 60 * 1000;   // 1分以内なら、読み直さずに前の結果を使う

let ready = null;      // { auth, fs, authInst, db }
let items = null;      // 読んだ行(キャッシュ)
let loadedAt = 0;

// Firebase を読み込む(はじめて使うときだけ。ふだんは読み込まない)
function load() {
  ready ||= (async () => {
    const [{ initializeApp, getApps }, auth, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = getApps().find(a => a.name === 'lesson-memo') || initializeApp(FIREBASE_CONFIG, 'lesson-memo');
    const authInst = auth.getAuth(app);
    await authInst.authStateReady();
    return { auth, fs, authInst, db: fs.getFirestore(app) };
  })().catch(e => { ready = null; throw e; });
  return ready;
}

// つないだことがあるか(端末に覚えている印。Firebase を読み込まずに分かるように)
const FLAG = 'lesso.memoLink';
export function wasConnected() {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
}

// いまログインしているメールアドレス(つないでいなければ null)
export async function currentUser() {
  if (!wasConnected()) return null;
  const { authInst } = await load();
  return authInst.currentUser?.email || null;
}

export async function connect(email, password) {
  const { auth, authInst } = await load();
  await auth.signInWithEmailAndPassword(authInst, email, password);
  try { localStorage.setItem(FLAG, '1'); } catch { /* 覚えられなくても今は使える */ }
  items = null;
}

export async function disconnect() {
  try { localStorage.removeItem(FLAG); } catch { /* なにもしない */ }
  items = null;
  if (!ready) return;
  const { auth, authInst } = await load();
  await auth.signOut(authInst);
}

// メモアプリの行を全部読む(1分以内なら前の結果)
async function allItems() {
  if (items && Date.now() - loadedAt < CACHE_MS) return items;
  const { fs, authInst, db } = await load();
  const user = authInst.currentUser;
  if (!user) return null;
  const snap = await fs.getDocs(fs.collection(db, 'users', user.uid, 'items'));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data(), text: d.data().text || '', imgs: d.data().imgs || [] }));
  // 文字のない画像だけの行は、メモアプリで見たときにすぐ上にある行(同じ月・同じフォルダ)の名前のものとする(2026-11-19)
  // 例:「平田 発表会の曲」の下の行に写真だけを付けた → 平田さんの記録として出す
  const groups = new Map();
  for (const it of all) {
    const key = `${it.m}|${it.f || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0) || (a.t || 0) - (b.t || 0));
    let last = '';
    for (const it of list) {
      if (it.text.trim()) last = headName(it.text);
      else if (it.imgs.length) it.owner = last;
    }
  }
  items = all.filter(it => it.text.trim() || it.imgs.length);
  loadedAt = Date.now();
  return items;
}

// 行の先頭の名前(最初のスペースまで。半角・全角どちらのスペースでも)
// 例:「平田 発表会の曲」→「平田」。「平田さん 発表会」→「平田さん」(平田とは別の人)
const headName = text => text.trim().split(/[\s　]/)[0];

// 先頭の名前がその生徒の名前と完全に同じ行(新しい順)。画像だけの行は、すぐ上の行の名前で見る。つないでいなければ null
export async function memosFor(name) {
  if (!name || !wasConnected()) return null;
  const list = await allItems();
  if (!list) return null;
  const want = name.trim();
  return list.filter(it => (it.text.trim() ? headName(it.text) : it.owner) === want).sort((a, b) => (b.t || 0) - (a.t || 0));
}

// ---- 画像(メモアプリで付けた写真。2026-11-19)----
// メモアプリは画像を users/{uid}/images/{id} = { data:縮めた JPEG の data URL, t } に保存し、行には id の一覧(imgs)だけを持つ。
// ここでは見えたときに1枚ずつ取ってくる(読むだけ)。一度取った画像はこの画面を開いている間おぼえておく
const imageCache = new Map();
function imageData(id) {
  if (!imageCache.has(id)) {
    imageCache.set(id, (async () => {
      const { fs, authInst, db } = await load();
      const user = authInst.currentUser;
      if (!user) return null;
      const snap = await fs.getDoc(fs.doc(db, 'users', user.uid, 'images', id));
      return snap.exists() ? snap.data().data || null : null;
    })().catch(e => { imageCache.delete(id); throw e; }));
  }
  return imageCache.get(id);
}

// 1行分の画像の見本(小さな四角)。入れたあとに fillImages(入れた場所) を呼ぶと画像が出る
export function imagesHtml(it) {
  if (!it.imgs?.length) return '';
  return `<span class="memoapp-imgs">${it.imgs.map(id =>
    `<button type="button" class="memoapp-img" data-img="${esc(id)}" aria-label="画像を大きく見る"><span class="memoapp-img-wait">📷</span></button>`).join('')}</span>`;
}

// 見本の画像を取ってきて出す。タップで大きく見られるようにする
export function fillImages(container) {
  for (const btn of container.querySelectorAll('.memoapp-img[data-img]:not([data-filled])')) {
    btn.dataset.filled = '1';
    imageData(btn.dataset.img).then(src => {
      if (!src) { btn.innerHTML = '<span class="memoapp-img-wait" title="画像が見つかりません">？</span>'; return; }
      const img = document.createElement('img');
      img.alt = '';
      img.src = src;
      btn.replaceChildren(img);
    }).catch(() => { btn.innerHTML = '<span class="memoapp-img-wait" title="読み込めませんでした">！</span>'; });
  }
  if (!container.dataset.imgClick) {
    container.dataset.imgClick = '1';
    container.addEventListener('click', e => {
      const btn = e.target.closest('.memoapp-img[data-img]');
      if (btn) openViewer(btn.dataset.img);
    });
  }
}

// 画像を大きく見る(入力画面などの上に出すので、dialog で出す)
let viewer = null;
async function openViewer(id) {
  if (!viewer) {
    viewer = document.createElement('dialog');
    viewer.className = 'memoapp-viewer';
    viewer.innerHTML = '<img alt=""><p>タップで閉じる・長押しで写真に保存</p>';
    viewer.addEventListener('click', () => viewer.close());
    document.body.appendChild(viewer);
  }
  const img = viewer.querySelector('img');
  img.removeAttribute('src');
  viewer.showModal();
  try { img.src = (await imageData(id)) || ''; } catch { viewer.close(); }
}

// エラーを日本語に
export function errorText(e) {
  const code = e?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'メールアドレスかパスワードがちがいます';
  if (code.includes('too-many-requests')) return '何度も失敗したため、しばらく待ってからためしてください';
  if (code.includes('network') || e instanceof TypeError) return 'インターネットにつながっていないようです';
  return `つなげませんでした(${code || e?.message || e})`;
}

// 「メモアプリの記録」の欄を作る(生徒の画面・予定の入力画面で使う)
// box:入れる場所、name:生徒の名前、stillCurrent:読み込み中に別の生徒に変わっていないか
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
// 1行分の中身(文字と画像)。画像だけの行は画像だけ
export function itemBody(it) {
  const text = it.text?.trim() ? `<span class="memoapp-line">${it.done ? '✓ ' : ''}${esc(it.text)}</span>` : '';
  return `<span class="memoapp-text">${text}${imagesHtml(it)}</span>`;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function renderInto(box, name, stillCurrent = () => true) {
  if (!name || !wasConnected()) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<h3>メモアプリの記録</h3><p class="muted">読み込み中…</p>';
  try {
    const list = await memosFor(name);
    if (!stillCurrent()) return;
    if (!list) { box.innerHTML = '<h3>メモアプリの記録</h3><p class="muted">メモアプリにログインしていません。「⚙ 設定」→「メモアプリとつなぐ」からつないでください。</p>'; return; }
    const shown = list.slice(0, 50);
    const thisYear = new Date().getFullYear();
    box.innerHTML = `<h3>メモアプリの記録(${list.length}件)</h3>` + (shown.length
      ? `<ul class="memoapp-list">${shown.map(it => {
        const d = new Date(it.t || 0);
        const date = it.t ? `${d.getFullYear() !== thisYear ? `${d.getFullYear()}/` : ''}${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})` : '';
        return `<li class="${it.done ? 'is-done' : ''}"><span class="memoapp-date">${date}</span>${itemBody(it)}</li>`;
      }).join('')}</ul>${list.length > shown.length ? `<p class="muted">ほか ${list.length - shown.length}件(古いもの)</p>` : ''}`
      : `<p class="muted">「${esc(name)}」で始まるメモはまだありません</p>`);
    fillImages(box);
  } catch (e) {
    if (!stillCurrent()) return;
    box.innerHTML = `<h3>メモアプリの記録</h3><p class="muted">${esc(errorText(e))}</p>`;
  }
}
