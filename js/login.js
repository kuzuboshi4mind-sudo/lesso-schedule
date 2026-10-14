// ログイン画面
// クラウド保存(config.js に接続先あり)のときだけ使う。ログインするまで表は見せない。
import { cloudEnabled, currentUser, signIn, signOut, onSignedOut } from './cloud.js';

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
  const user = await currentUser();
  if (user) return user;
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
  if (!confirm('ログアウトしますか?')) return;
  await signOut();
  location.reload();
}
