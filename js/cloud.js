// Supabase への接続とログイン
// config.js に接続先が入っているときだけ使う。空なら supabase は null(この端末に保存)
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// Supabase の公式の部品。版を固定して、クラウドを使うときだけ読み込む(勝手に新しい版に変わらないように)
// 圏外などで読み込めなくても、アプリ全体は止めない(この端末の写しを読むだけで開けるように。2026-11-09)
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
let createClient = null;
if (cloudEnabled) {
  try {
    ({ createClient } = await import(SUPABASE_JS));
  } catch (err) {
    console.warn('Supabase の部品を読み込めませんでした', err);
  }
}

// 電波が弱いときに待ち続けないよう、クラウドとのやりとりは20秒で打ち切る
const FETCH_TIMEOUT_MS = 20000;
function fetchWithTimeout(input, init = {}) {
  if (init.signal || typeof AbortController === 'undefined') return fetch(input, init);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: fetchWithTimeout },
    })
  : null;

// クラウドにつながるか(圏外・Supabase の一時停止中などは false)
export async function cloudReachable() {
  if (!supabase) return false;
  if (navigator.onLine === false) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, signal: ctl.signal, cache: 'no-store',
    });
    return res.status < 500;   // 返事があればつながっている(5xx は止まっている)
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// いまログインしている人(いなければ null)
export async function currentUser() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user || null;
  } catch {
    return null;
  }
}

// メールとパスワードでログイン。失敗したら日本語のメッセージを投げる
export async function signIn(email, password) {
  if (!supabase) throw new Error('クラウドの部品を読み込めませんでした。通信の状態を確認して、アプリを開き直してください。');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = /invalid login credentials/i.test(error.message)
      ? 'メールアドレスかパスワードが違います'
      : /email not confirmed/i.test(error.message)
        ? 'メールアドレスの確認が終わっていません(Supabase の管理画面でユーザーを確認済みにしてください)'
        : `ログインできませんでした(${error.message})`;
    throw new Error(msg);
  }
  return data.user;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

// ログイン状態が変わったとき(ログアウト・期限切れなど)に呼ぶ関数を登録する
export function onSignedOut(fn) {
  if (!supabase) return;
  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') fn();
  });
}
