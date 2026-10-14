// Supabase への接続とログイン
// config.js に接続先が入っているときだけ使う。空なら supabase は null(この端末に保存)
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// Supabase の公式の部品。版を固定して、クラウドを使うときだけ読み込む(勝手に新しい版に変わらないように)
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const { createClient } = cloudEnabled ? await import(SUPABASE_JS) : {};

export const supabase = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

// いまログインしている人(いなければ null)
export async function currentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user || null;
}

// メールとパスワードでログイン。失敗したら日本語のメッセージを投げる
export async function signIn(email, password) {
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
