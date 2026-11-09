// ログイン画面
// クラウド保存(config.js に接続先あり)のときだけ使う。ログインするまで表は見せない。
import { cloudEnabled, currentUser, signIn, signOut, onSignedOut, cloudReachable } from './cloud.js';
import * as store from './store.js';

const screen = document.getElementById('login-screen');
const form = document.getElementById('login-form');
const email = document.getElementById('login-email');
const password = document.getElementById('login-password');
const error = document.getElementById('login-error');
const submit = form.querySelector('button[type="submit"]');

// ログインが済んでいれば、ログインした人を返す。済んでいなければログイン画面を出し、ログインできるまで待つ
// クラウドを使わないとき(この端末に保存)は、すぐに null を返す
export async function requireLogin() {
  if (!cloudEnabled) return null;
  // 機内モード・圏外がはっきりしているときは、待たずにこの端末の写しで開く
  if (navigator.onLine === false && await store.goOffline('通信できません(圏外・機内モード)')) {
    return { email: store.deviceCopyInfo().email, offline: true };
  }
  // ログインの確認(期限切れのときは通信が要る)。電波が弱くて返事が来ないときは6秒で見切る
  const user = await Promise.race([currentUser(), new Promise(r => setTimeout(() => r(undefined), 6000))]);
  if (user) return user;
  const reachable = await cloudReachable();
  if (user === undefined && reachable) {
    const u = await currentUser();   // つながってはいるので、返事を待つ
    if (u) return u;
  }
  // ログインの確認ができないとき、クラウドにつながらないせいなら、この端末の写しを読むだけで開く
  // (ログインの期限が切れたまま圏外で開いたときなど。写しはこの端末で前にログインしたときに作ったもの)
  if (!reachable) {
    if (await store.goOffline('クラウドにつながらないため、ログインを確かめられません')) {
      const info = store.deviceCopyInfo();
      return { email: info.email, offline: true };
    }
    error.textContent = 'クラウドにつながりません。通信の状態を確認してください(この端末にはまだ写しがないため、表示できません)。';
  }
  document.body.classList.add('locked');
  screen.hidden = false;
  email.focus();
  return new Promise(resolve => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = 'ログイン中…';
      try {
        const u = await signIn(email.value.trim(), password.value);
        password.value = '';
        screen.hidden = true;
        document.body.classList.remove('locked');
        resolve(u);
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = 'ログイン';
      }
    });
  });
}

// ログアウトしたら(ほかの端末からのログアウトや期限切れを含む)、画面を読み込み直してログイン画面に戻す
export function watchLogout() {
  onSignedOut(() => location.reload());
}

export async function logout() {
  if (!confirm('ログアウトしますか?\n(この端末に残している予定の写しも消します。クラウドのデータはそのまま残ります)')) return;
  await store.clearDeviceCopies();
  await signOut();
  location.reload();
}
