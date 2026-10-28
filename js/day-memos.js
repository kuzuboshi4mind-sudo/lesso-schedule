// 1日表示の「📝 メモ」:その日にレッスンがある生徒全員の、生徒メモと
// メモアプリ(レッスンメモ)の直近3回分、それに自分の予定のメモを、時間の順に1つの画面で読む(読むだけ)
import * as store from './store.js';
import * as memoLink from './memo-link.js';
import { escapeHtml, toMinutes, fromMinutes } from './calendar.js';

const RECENT = 3;   // メモアプリから出す件数(新しい順)
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const dialog = document.getElementById('day-memos-dialog');
const title = document.getElementById('day-memos-title');
const body = document.getElementById('day-memos-body');
let openedFor = null;   // 読み込み中に閉じたり別の日を開いたりしたときのため

export function initDayMemos() {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

// date:'2026-10-27'、lessons:その月の予定(固定枠の予定も入ったもの)
export async function openDayMemos(date, lessons) {
  openedFor = date;
  const [y, m, d] = date.split('-').map(Number);
  title.textContent = `${m}月${d}日(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})のメモ`;
  const [types, students] = await Promise.all([store.getTypes(), store.getStudents()]);
  const counted = new Set(types.filter(t => t.countInTotal).map(t => t.id));
  // その日の予定を時間の順に(キャンセルは除く)
  // ・レッスン(集計に入れる種類で、自分の予定でないもの):生徒メモ+メモアプリ。同じ生徒は最初の1回だけ
  // ・自分の予定(なし・集計しない種類):その予定のメモがあるものだけ(2026-10-28)
  const isLesson = l => counted.has(l.typeId) && l.status !== 'none';
  const seen = new Set();
  const list = lessons
    .filter(l => l.date === date && l.student && l.status !== 'cancelled')
    .filter(l => isLesson(l) ? (!seen.has(l.student) && seen.add(l.student)) : (l.memo || '').trim())
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const typeName = Object.fromEntries(types.map(t => [t.id, t.name]));
  const linked = memoLink.wasConnected();
  body.innerHTML = list.length ? list.map((l, i) => {
    const head = `<h3><span class="day-memo-time">${l.start}〜${fromMinutes(toMinutes(l.start) + l.duration)}</span>${escapeHtml(l.student)}<small>${escapeHtml(typeName[l.typeId] || '')}${(l.status || 'tentative') === 'tentative' ? '・仮' : ''}</small></h3>`;
    if (!isLesson(l)) {
      return `<section class="day-memo-card is-private">${head}
      <p class="day-memo-label">メモ(この予定だけ)</p>
      <p class="day-memo-text">${escapeHtml(l.memo.trim())}</p>
    </section>`;
    }
    const memo = students.find(s => s.name === l.student)?.memo || '';
    return `<section class="day-memo-card">${head}
      <p class="day-memo-label">生徒メモ</p>
      <p class="day-memo-text">${memo ? escapeHtml(memo) : '<span class="muted">なし</span>'}</p>
      ${linked ? `<p class="day-memo-label">メモアプリ(直近${RECENT}回)</p><div class="day-memo-app" data-i="${i}"><p class="muted">読み込み中…</p></div>` : ''}
    </section>`;
  }).join('') + (linked ? '' : '<p class="sheet-note">「⚙ 設定」→「メモアプリとつなぐ」でつなぐと、メモアプリの直近3回分もここに出ます。</p>')
    : '<p class="muted">この日のレッスン・メモのある予定はありません</p>';
  dialog.showModal();
  body.scrollTop = 0;
  dialog.scrollTop = 0;
  if (!linked) return;
  // メモアプリの記録は、画面を開いてから読み込む
  await Promise.all(list.map(async (l, i) => {
    const box = body.querySelector(`.day-memo-app[data-i="${i}"]`);
    if (!box) return;   // 自分の予定はメモアプリを読まない
    let html;
    try {
      const memos = await memoLink.memosFor(l.student);
      html = !memos ? '<p class="muted">メモアプリにログインしていません</p>'
        : memos.length ? `<ul class="memoapp-list">${memos.slice(0, RECENT).map(it => {
          const t = new Date(it.t || 0);
          return `<li class="${it.done ? 'is-done' : ''}"><span class="memoapp-date">${it.t ? `${t.getMonth() + 1}/${t.getDate()}(${WEEKDAYS[t.getDay()]})` : ''}</span><span class="memoapp-text">${it.done ? '✓ ' : ''}${escapeHtml(it.text)}</span></li>`;
        }).join('')}</ul>`
        : '<p class="muted">なし</p>';
    } catch (e) {
      html = `<p class="muted">${escapeHtml(memoLink.errorText(e))}</p>`;
    }
    if (openedFor === date && box?.isConnected) box.innerHTML = html;
  }));
}
