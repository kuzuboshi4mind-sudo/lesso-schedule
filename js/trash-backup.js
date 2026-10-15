// ゴミ箱とバックアップの画面
// ・ゴミ箱:削除した予定の一覧。1件ずつ「元に戻す」。30日を過ぎたものは自動で完全に消える
// ・バックアップ:この月/全部の予定をファイル(.json)に書き出す。書き出したファイルを読み込んで元に戻す
import * as store from './store.js';
import { escapeHtml } from './calendar.js';
import { buildXlsx } from './export-xlsx.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

let getMonth = () => null;   // 表示中の月 { year, month } を返す関数(main.js から受け取る)
let onChanged = () => {};

const trashDialog = document.getElementById('trash-dialog');
const trashList = document.getElementById('trash-list');
const trashCount = document.getElementById('trash-count');
const saveDialog = document.getElementById('save-dialog');
const saveLink = document.getElementById('save-link');
const saveShare = document.getElementById('save-share');
const saveName = document.getElementById('save-name');
const saveTitle = document.getElementById('save-title');
const fileInput = document.getElementById('backup-file');
const lastBackup = document.getElementById('last-backup');

let pendingFile = null;   // 書き出し用に作ったファイル(共有ボタンで使う)
let onSaved = () => {};   // 保存したあとにすること(バックアップなら書き出した日を記録)

export function initTrashBackup(opts) {
  ({ getMonth, onChanged } = opts);
  document.getElementById('open-trash').addEventListener('click', openTrash);
  trashList.addEventListener('click', onTrashClick);
  document.getElementById('export-month').addEventListener('click', () => exportBackup(true));
  document.getElementById('export-all').addEventListener('click', () => exportBackup(false));
  document.getElementById('import-backup').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', importBackup);
  document.getElementById('xlsx-month').addEventListener('click', () => exportXlsx(true));
  document.getElementById('xlsx-year').addEventListener('click', () => exportXlsx(false));
  saveShare.addEventListener('click', shareFile);
  saveLink.addEventListener('click', () => { onSaved(); setTimeout(() => saveDialog.close(), 300); });
  for (const d of [trashDialog, saveDialog]) {
    d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  }
  showLastBackup();
}

// 設定画面を開くたびに呼ぶ(前回の書き出し日を出し直す)
export function showLastBackup() {
  const at = store.lastBackupAt();
  if (!at) {
    lastBackup.textContent = 'この端末からは、まだ書き出していません。月に1回くらい書き出しておくと安心です。';
    return;
  }
  const d = new Date(at);
  const days = Math.floor((Date.now() - d) / 86400000);
  lastBackup.textContent = `前回の書き出し:${d.getMonth() + 1}月${d.getDate()}日(${days}日前)${days >= 30 ? ' — そろそろ書き出しておきましょう' : ''}`;
}

function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

// ---------------------------------------------------------
// ゴミ箱
// ---------------------------------------------------------
async function openTrash() {
  await renderTrash();
  trashDialog.showModal();
  trashDialog.querySelector('h2').focus();
}

async function renderTrash() {
  const [items, types] = await Promise.all([store.getTrash(), store.getTypes()]);
  const typeName = Object.fromEntries(types.map(t => [t.id, t.name]));
  trashCount.textContent = items.length ? `${items.length}件` : '';
  if (!items.length) {
    trashList.innerHTML = '<li class="trash-empty">ゴミ箱は空です</li>';
    return;
  }
  trashList.innerHTML = items.map(l => {
    const left = store.TRASH_DAYS - Math.floor((Date.now() - new Date(l.deletedAt)) / 86400000);
    return `<li class="trash-row">
      <div class="trash-main">
        <strong>${escapeHtml(l.student || '(名前なし)')}</strong>
        <span>${dateLabel(l.date)} ${l.start}〜 ${l.duration}分 ${escapeHtml(typeName[l.typeId] || '')}</span>
        <small>あと${Math.max(0, left)}日で完全に消えます</small>
      </div>
      <button type="button" class="btn" data-restore="${escapeHtml(l.id)}">元に戻す</button>
    </li>`;
  }).join('');
}

async function onTrashClick(e) {
  const btn = e.target.closest('[data-restore]');
  if (!btn) return;
  btn.disabled = true;
  const [restored] = await store.restoreLessons([btn.dataset.restore]);
  await renderTrash();
  onChanged();
  if (restored) showMessage(`元に戻しました:${dateLabel(restored.date)} ${restored.student || '(名前なし)'}`);
}

// ---------------------------------------------------------
// バックアップの書き出し
// ---------------------------------------------------------
async function exportBackup(thisMonthOnly) {
  const m = thisMonthOnly ? getMonth() : null;
  const data = await store.buildBackup(m?.year, m?.month);
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const name = m
    ? `lesson-backup-${m.year}-${String(m.month).padStart(2, '0')}.json`
    : `lesson-backup-all-${stamp}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
  offerFile(file, 'バックアップを保存',
    `${name}(予定${data.lessons.length}件・${data.months.length ? data.months.join('、') : '予定なし'})`,
    () => { store.markBackedUp(); showLastBackup(); });
}

// できたファイルを保存する画面を出す(「ファイルを保存」と、使える端末では「共有…」)
function offerFile(file, title, description, saved = () => {}) {
  pendingFile = file;
  onSaved = saved;
  if (saveLink.href.startsWith('blob:')) URL.revokeObjectURL(saveLink.href);
  saveLink.href = URL.createObjectURL(file);
  saveLink.download = file.name;
  saveTitle.textContent = title;
  saveName.textContent = description;
  // 共有(「ファイルに保存」「AirDrop」など)が使える端末だけ、共有ボタンを出す
  saveShare.hidden = !(navigator.canShare && navigator.canShare({ files: [pendingFile] }));
  saveDialog.showModal();
  saveTitle.focus();
}

// ---------------------------------------------------------
// Numbers への書き出し(.xlsx)
// ---------------------------------------------------------
async function exportXlsx(thisMonthOnly) {
  const m = getMonth();
  const months = thisMonthOnly ? [m] : Array.from({ length: 12 }, (_, i) => ({ year: m.year, month: i + 1 }));
  const name = thisMonthOnly
    ? `lesson-${m.year}-${String(m.month).padStart(2, '0')}.xlsx`
    : `lesson-${m.year}.xlsx`;
  const btn = document.getElementById(thisMonthOnly ? 'xlsx-month' : 'xlsx-year');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '作っています…';
  try {
    const file = await buildXlsx(months, name);
    offerFile(file, 'Numbers 用のファイルを保存',
      `${name}(${thisMonthOnly ? `${m.month}月` : `${m.year}年1〜12月`})。保存したファイルを「ファイル」アプリでタップすると Numbers で開けます。`);
  } catch (err) {
    alert(`書き出せませんでした(${err.message})`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function shareFile() {
  try {
    await navigator.share({ files: [pendingFile], title: pendingFile.name });
    onSaved();
    saveDialog.close();
  } catch (err) {
    if (err.name !== 'AbortError') alert(`共有できませんでした(${err.message})`);
  }
}

// ---------------------------------------------------------
// バックアップの読み込み
// ---------------------------------------------------------
async function importBackup() {
  const file = fileInput.files[0];
  fileInput.value = '';   // 同じファイルをもう一度選べるように
  if (!file) return;
  let data;
  try {
    data = store.checkBackup(JSON.parse(await file.text()));
  } catch (err) {
    alert(err instanceof SyntaxError ? 'このアプリのバックアップファイルではないようです' : err.message);
    return;
  }
  const when = new Date(data.exportedAt);
  const ok = confirm(
    `${when.getMonth() + 1}月${when.getDate()}日に書き出したバックアップ(予定${data.lessons.length}件)を読み込みます。\n\n`
    + `対象の月:${data.months.join('、') || 'なし'}\n`
    + 'この月の今の予定と「予定」の行は、バックアップの内容に置き換わります。\n'
    + '(今だけある予定はゴミ箱に入ります。読み込んだあと「戻す」で元に戻すこともできます)');
  if (!ok) return;
  const withSettings = !!data.settings && confirm('種類と色・換算表・毎週の固定枠も、バックアップの内容に戻しますか?\n(「キャンセル」なら今のままにします)');
  const result = await store.restoreBackup(data, { withSettings });
  onChanged();
  showMessage(`バックアップを読み込みました(予定${result.lessons}件)`);
}

function showMessage(text) {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { toast.hidden = true; }, 3000);
}
