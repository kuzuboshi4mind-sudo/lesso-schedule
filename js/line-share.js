// LINE で予定を送る
// ・生徒メモの画面の「LINE で予定を送る」から開く
// ・その生徒の予定(仮だけ / 仮と確約)から文面を自動で作り、「LINE を開く」で LINE の「送信先を選択」画面を開く
//   (LINE の公式のしくみ https://line.me/R/share?text=文面 を使う。自動では送らない。送る相手は LINE で選ぶ)
// ・文面はひな形({名前}{期間}{予定})から作る。ひな形は変えて保存できる(どの端末でも同じ)
// ・生徒メモで「LINE での名前」を登録しておくと、「送り先」として大きく出す(LINE の画面で迷わず選べるように)
// ・「LINE を開く」を押すと、文面に入れた予定に「送った印」を付ける(生徒の一覧で「返事待ち」になる)
import * as store from './store.js';
import { toMinutes, fromMinutes, escapeHtml } from './calendar.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const dialog = document.getElementById('line-dialog');
const title = document.getElementById('line-title');
const range = document.getElementById('line-range');
const statusSel = document.getElementById('line-status');
const text = document.getElementById('line-text');
const count = document.getElementById('line-count');
const openLink = document.getElementById('line-open');
const copyBtn = document.getElementById('line-copy');
const template = document.getElementById('line-template');
const to = document.getElementById('line-to');

let student = '';
let types = [];
let current = [];          // いまの文面に入っている予定
let onSent = () => {};

export function initLineShare() {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  range.addEventListener('change', build);
  statusSel.addEventListener('change', build);
  text.addEventListener('input', updateLink);
  copyBtn.addEventListener('click', copyText);
  // LINE を開いたら、送った印を付ける(リンクはそのまま LINE を開く)
  openLink.addEventListener('click', async () => {
    if (openLink.getAttribute('aria-disabled') === 'true' || !current.length) return;
    await store.markLineSent(student, current);
    await onSent();
    count.textContent = `${current.length}件の予定に「送った印」を付けました。`;
  });
  document.getElementById('line-template-save').addEventListener('click', async () => {
    await store.saveLineTemplate(template.value);
    await build();
    flash(document.getElementById('line-template-save'), '保存しました');
  });
  document.getElementById('line-template-reset').addEventListener('click', async () => {
    template.value = store.DEFAULT_LINE_TEMPLATE;
    await store.saveLineTemplate(template.value);
    await build();
  });
}

// ---- 日付の計算(端末の時計の今日から)----
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

// 期間の選択肢:今月(今日から月末まで)・来月・再来月・今日から3か月
function rangeOptions() {
  const now = new Date();
  const today = ymd(now);
  const monthEnd = (y, m) => ymd(new Date(y, m + 1, 0));
  const month = offset => {
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return {
      value: `m${offset}`, label: `${first.getMonth() + 1}月`,
      from: offset === 0 ? today : ymd(first), to: monthEnd(first.getFullYear(), first.getMonth()),
      periodText: `${first.getMonth() + 1}月`,
    };
  };
  const three = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate() - 1);
  return [
    { ...month(0), label: `今月(${now.getMonth() + 1}月・今日から)` },
    { ...month(1), label: `来月(${month(1).label})` },
    { ...month(2), label: `再来月(${month(2).label})` },
    { value: 'next3', label: '今日から3か月', from: today, to: ymd(three), periodText: `${dateLabel(today)}〜${dateLabel(ymd(three))}` },
  ];
}

// その生徒の画面から開く
export async function openLineShare(name, opts = {}) {
  student = name;
  onSent = opts.onSent || (() => {});
  const [t, extras] = await Promise.all([store.getTypes(), store.getStudentExtras()]);
  types = t;
  title.textContent = `${name}さんに LINE で送る`;
  const lineName = extras[name]?.lineName;
  to.classList.toggle('unset', !lineName);
  to.innerHTML = lineName
    ? `送り先:<strong>${escapeHtml(lineName)}</strong>(LINE の画面でこの人を選んでください)`
    : '送り先の LINE での名前が未登録です。生徒の画面の「LINE での名前」に入れておくと、ここに出ます。';
  const options = rangeOptions();
  range.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  statusSel.value = 'tentative';
  template.value = await store.getLineTemplate();
  // はじめに選ぶ期間:仮の予定がある一番近い月(なければ来月)
  range.value = 'm1';
  for (const o of options.slice(0, 3)) {
    if ((await pickLessons(o)).length) { range.value = o.value; break; }
  }
  await build();
  dialog.showModal();
  title.focus();
}

async function pickLessons(option) {
  const lessons = await store.getStudentLessons(student, option.from, option.to);
  const wanted = statusSel.value === 'both' ? ['tentative', 'confirmed'] : ['tentative'];
  return lessons.filter(l => wanted.includes(l.status || 'tentative'));
}

// 文面を作り直す
async function build() {
  const option = rangeOptions().find(o => o.value === range.value);
  const lessons = await pickLessons(option);
  current = lessons;
  const typeName = Object.fromEntries(types.map(t => [t.id, t.name]));
  const both = statusSel.value === 'both';
  const lines = lessons.map(l => {
    const end = fromMinutes(toMinutes(l.start) + l.duration);
    const place = typeName[l.typeId] ? ` ${typeName[l.typeId]}` : '';
    const mark = both ? ((l.status || 'tentative') === 'confirmed' ? '(確定)' : '(仮)') : '';
    return `・${dateLabel(l.date)} ${l.start}〜${end}${place}${mark}`;
  });
  text.value = (template.value || store.DEFAULT_LINE_TEMPLATE)
    .replaceAll('{名前}', student)
    .replaceAll('{期間}', option.periodText)
    .replaceAll('{予定}', lines.length ? lines.join('\n') : '(この期間の予定はありません)');
  count.textContent = lessons.length
    ? `${lessons.length}件の予定を入れました。`
    : `この期間に${both ? '' : '仮の'}予定がありません。期間や「送る予定」を変えてみてください。`;
  updateLink();
}

// 「LINE を開く」のリンクを文面に合わせる(文面は UTF-8 で %エンコードする決まり)
function updateLink() {
  const body = text.value.trim();
  openLink.href = body ? `https://line.me/R/share?text=${encodeURIComponent(body)}` : '#';
  openLink.setAttribute('aria-disabled', String(!body));
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(text.value);
    flash(copyBtn, 'コピーしました');
  } catch {
    // コピーできない端末では、文面を選んだ状態にする(長押しでコピーできる)
    text.focus();
    text.select();
  }
}

function flash(btn, message) {
  const label = btn.textContent;
  btn.textContent = message;
  setTimeout(() => { btn.textContent = label; }, 1500);
}
