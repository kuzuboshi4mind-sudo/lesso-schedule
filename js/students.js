// 生徒メモ
// ・上の「👤 生徒」から一覧を開く。予定に入れた名前は自動で並ぶ
// ・タップすると、その生徒のメモ(希望の曜日・時間、注文など)を書ける。固定枠とこれからの予定も見える
// ・名前を変えると、その生徒の予定・固定枠の名前もまとめて変わる
// ・「この生徒を削除」で一覧と名前の候補から外す(予定は残る)。一覧の下の「削除した生徒」から戻せる
// ・「なし(自分の予定)」や集計に入れない種類の予定の名前は、生徒として並べない
// ・予定の入力画面では、名前の下にその生徒のメモが出る
// ・「LINE で予定を送る」で、その生徒の予定の文面を作って LINE を開く(js/line-share.js)
// ・一覧は「連絡が必要(仮の予定をまだ送っていない)」「返事待ち(送った)」「確定済み」「これからの予定なし」に分ける
import * as store from './store.js';
import { escapeHtml } from './calendar.js';
import { openLineShare } from './line-share.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const listDialog = document.getElementById('students-dialog');
const list = document.getElementById('students-list');
const search = document.getElementById('students-search');
const hiddenBox = document.getElementById('hidden-students');
const hiddenTitle = document.getElementById('hidden-students-title');
const hiddenList = document.getElementById('hidden-students-list');
const dialog = document.getElementById('student-dialog');
const form = document.getElementById('student-form');
const f = {
  title: document.getElementById('student-title'),
  error: document.getElementById('student-error'),
  name: document.getElementById('student-name'),
  nameHelp: document.getElementById('student-name-help'),
  memo: document.getElementById('student-memo'),
  lineName: document.getElementById('student-line-name'),
  sent: document.getElementById('student-sent'),
  info: document.getElementById('student-info'),
  del: document.getElementById('student-delete'),
  line: document.getElementById('student-line'),
};

let onChanged = () => {};
let overview = [];     // 一覧の中身(store.getStudentOverview の結果)
let types = [];
let hidden = [];       // 削除した生徒の名前
let editing = null;    // 開いている生徒 { name, id, memo, ... }(新しく追加するときは name が空)

export function initStudents(opts) {
  onChanged = opts.onChanged;
  document.getElementById('open-students').addEventListener('click', openList);
  document.getElementById('students-add').addEventListener('click', () => openStudent(null));
  search.addEventListener('input', renderList);
  list.addEventListener('click', e => {
    const row = e.target.closest('[data-name]');
    if (row) openStudent(overview.find(s => s.name === row.dataset.name));
  });
  hiddenList.addEventListener('click', async e => {
    const btn = e.target.closest('[data-restore]');
    if (!btn) return;
    await store.restoreStudent(btn.dataset.restore);
    await loadList();
    showToast(`${btn.dataset.restore}さんを一覧に戻しました`);
  });
  for (const d of [listDialog, dialog]) {
    d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  }
  form.addEventListener('submit', onSave);
  f.del.addEventListener('click', onDelete);
  f.line.addEventListener('click', () => openLineShare(editing.name, { onSent: refreshAfterSend }));
  f.sent.addEventListener('click', async e => {
    if (!e.target.closest('[data-clear-sent]')) return;
    await store.clearLineSent(editing.name);
    await refreshAfterSend();
  });
  // Mac:⌘S / ⌘return で保存
  form.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); form.requestSubmit(); }
  });
}

function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

// ---------------------------------------------------------
// 一覧
// ---------------------------------------------------------
async function openList() {
  search.value = '';
  await loadList();
  listDialog.showModal();
  listDialog.querySelector('h2').focus();
}

async function loadList() {
  [overview, types, hidden] = await Promise.all([store.getStudentOverview(), store.getTypes(), store.getHiddenStudents()]);
  renderList();
  renderHidden();
}

function renderList() {
  const text = search.value.trim();
  const hits = overview.filter(s => !text || s.name.includes(text));
  if (!hits.length) {
    list.innerHTML = `<li class="students-empty">${overview.length ? '見つかりません' : 'まだ生徒がいません。予定に名前を入れるか、「＋ 生徒を追加」から追加できます。'}</li>`;
    return;
  }
  const typeById = Object.fromEntries(types.map(t => [t.id, t]));
  const row = s => {
    const type = typeById[s.typeId];
    const slots = s.slots.map(sl => `↻ ${escapeHtml(store.slotLabel(sl))}`).join('　');
    const next = s.next ? `次:${dateLabel(s.next.date)} ${s.next.start}` : '';
    const badge = s.group === 'todo'
      ? `<span class="student-badge">未送信 ${s.unsent.length}件</span>`
      : s.group === 'waiting'
        ? `<span class="student-badge waiting">送信済み ${sentLabel(s.sentAt)}・仮 ${s.tentative.length}件</span>`
        : '';
    return `<li>
      <button type="button" class="student-row ${s.group}" data-name="${escapeHtml(s.name)}">
        <span class="slot-swatch" style="background:${type?.color || 'transparent'}"></span>
        <span class="student-main">
          <strong>${escapeHtml(s.name)}${badge}</strong>
          <small>${[type ? escapeHtml(type.name) : '', next, slots].filter(Boolean).join('・')}</small>
          ${s.memo ? `<span class="student-memo-preview">${escapeHtml(s.memo)}</span>` : ''}
        </span>
        <span class="student-arrow" aria-hidden="true">›</span>
      </button>
    </li>`;
  };
  list.innerHTML = GROUPS.map(g => {
    const members = hits.filter(s => s.group === g.id);
    if (!members.length) return '';
    return `<li class="student-group"><h3 class="student-group-head ${g.id}">${g.label}(${members.length}人)</h3></li>${members.map(row).join('')}`;
  }).join('');
}

// 一覧のまとまり(上から順に並べる)
const GROUPS = [
  { id: 'todo', label: '連絡が必要:仮の予定をまだ LINE で送っていない' },
  { id: 'waiting', label: '返事待ち:仮の予定を LINE で送った' },
  { id: 'confirmed', label: '確定済み:これからの予定は全部確約' },
  { id: 'none', label: 'これからの予定なし' },
];

function sentLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// LINE で送ったあと・印を外したあと:一覧と、開いている生徒の画面を新しくする
async function refreshAfterSend() {
  await loadList();
  const fresh = overview.find(s => s.name === editing?.name);
  if (fresh && dialog.open) { editing = { ...fresh, memo: editing.memo }; renderSent(); }
  onChanged();
}

// 生徒の画面の「LINE で送った印」
function renderSent() {
  const s = editing;
  if (!s?.name || !s.tentative?.length) { f.sent.hidden = true; return; }
  f.sent.hidden = false;
  f.sent.innerHTML = s.unsent.length
    ? `<span>仮の予定 ${s.tentative.length}件のうち、<strong>${s.unsent.length}件をまだ LINE で送っていません</strong></span>`
    : `<span>仮の予定 ${s.tentative.length}件を LINE で送りました(${sentLabel(s.sentAt)})。返事待ち</span>
       <button type="button" class="btn btn-small" data-clear-sent>送った印を外す</button>`;
}

function renderHidden() {
  hiddenBox.hidden = !hidden.length;
  hiddenTitle.textContent = `削除した生徒(${hidden.length}人)`;
  hiddenList.innerHTML = [...hidden].sort((a, b) => a.localeCompare(b, 'ja')).map(name => `<li class="hidden-student">
      <span>${escapeHtml(name)}</span>
      <button type="button" class="btn btn-small" data-restore="${escapeHtml(name)}">一覧に戻す</button>
    </li>`).join('');
}

function showToast(text) {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3000);
}

// ---------------------------------------------------------
// 1人分
// ---------------------------------------------------------
async function openStudent(student) {
  editing = student || { name: '', id: null, memo: '', slots: [] };
  const isNew = !editing.name;
  f.title.textContent = isNew ? '生徒を追加' : `${editing.name}さん`;
  f.name.value = editing.name;
  f.nameHelp.hidden = isNew;
  f.memo.value = editing.memo;
  f.lineName.value = editing.lineName || '';
  renderSent();
  f.error.textContent = '';
  f.del.hidden = isNew;
  f.line.hidden = isNew;
  f.info.innerHTML = isNew ? '' : await infoHtml(editing);
  dialog.showModal();
  if (isNew) f.name.focus(); else f.title.focus();
}

// 固定枠とこれからの予定
async function infoHtml(student) {
  const upcoming = await store.getUpcomingLessons(student.name);
  const typeName = Object.fromEntries(types.map(t => [t.id, t.name]));
  const status = { confirmed: '確約', tentative: '仮', cancelled: 'キャンセル', none: '' };
  const slots = student.slots.length
    ? `<ul class="student-lessons">${student.slots.map(sl => `<li>↻ ${escapeHtml(store.slotLabel(sl))}(${sl.duration}分・${escapeHtml(typeName[sl.typeId] || '')})</li>`).join('')}</ul>`
    : '<p class="muted">なし</p>';
  const shown = upcoming.slice(0, 12);
  const lessons = shown.length
    ? `<ul class="student-lessons">${shown.map(l => `<li class="${l.status === 'cancelled' ? 'is-cancelled' : ''}">${dateLabel(l.date)} ${l.start}〜 ${l.duration}分 ${escapeHtml(typeName[l.typeId] || '')} ${status[l.status || 'tentative']}${l.recurring ? ' ↻' : ''}</li>`).join('')}</ul>${upcoming.length > shown.length ? `<p class="muted">ほか ${upcoming.length - shown.length}件</p>` : ''}`
    : '<p class="muted">なし</p>';
  return `<h3>くり返しの固定枠</h3>${slots}<h3>これからの予定(3か月)</h3>${lessons}`;
}

async function onSave(e) {
  e.preventDefault();
  const name = f.name.value.trim();
  const memo = f.memo.value.trim();
  const lineName = f.lineName.value.trim();
  if (!name) { f.error.textContent = '名前を入れてください'; return; }
  try {
    if (editing.name && name !== editing.name) {
      if (!confirm(`「${editing.name}」を「${name}」に変えます。この生徒の予定・固定枠の名前もまとめて変わります。よろしいですか?\n(「戻す」で元に戻せます)`)) return;
      await store.renameStudent(editing.name, name);
    }
    // メモも LINE での名前も空で、まだ生徒メモがない人は、何も作らない(予定に名前があれば一覧には出る)
    if (memo || editing.id || !editing.name || lineName !== (editing.lineName || '')) {
      await store.saveStudent({ id: editing.id, name, memo, lineName });
    }
  } catch (err) {
    f.error.textContent = `保存できませんでした(${err.message})`;
    return;
  }
  dialog.close();
  await loadList();
  onChanged();
}

async function onDelete() {
  if (!confirm(`${editing.name}さんを生徒の一覧から削除しますか?\n・入っている予定はそのまま残ります\n・名前の候補にも出なくなります\n・一覧の下の「削除した生徒」から戻せます`)) return;
  await store.deleteStudent(editing.name);
  dialog.close();
  await loadList();
  onChanged();
  showToast(`${editing.name}さんを削除しました`);
}
