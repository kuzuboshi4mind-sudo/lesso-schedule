// LINE で予定を送る
// ・生徒メモの画面の「LINE で予定を送る」から開く
// ・その生徒の予定(仮だけ / 仮と確約)から文面を自動で作り、「LINE を開く」で LINE の「送信先を選択」画面を開く
//   (LINE の公式のしくみ https://line.me/R/share?text=文面 を使う。自動では送らない。送る相手は LINE で選ぶ)
// ・文面はひな形({名前}{期間}{予定})から作る。ひな形は変えて保存できる(どの端末でも同じ)
// ・生徒メモで「LINE での名前」を登録しておくと、「送り先」として大きく出す(LINE の画面で迷わず選べるように)
// ・「LINE を開く」を押すと、文面に入れた予定に「送った印」を付ける(生徒の一覧で「返事待ち」になる)
// ・「まとめて送る人」に家族などを足すと、全員分の予定を1つの文面にして1回で送れる(顔ぶれは覚えておく)
import * as store from './store.js';
import { toMinutes, fromMinutes, escapeHtml } from './calendar.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const dialog = document.getElementById('line-dialog');
const title = document.getElementById('line-title');
const range = document.getElementById('line-range');
const pick = document.getElementById('line-pick');
const confirmBtn = document.getElementById('line-confirm');
const text = document.getElementById('line-text');
const count = document.getElementById('line-count');
const openLink = document.getElementById('line-open');
const copyBtn = document.getElementById('line-copy');
const template = document.getElementById('line-template');
const to = document.getElementById('line-to');
const membersBox = document.getElementById('line-members');
const addSelect = document.getElementById('line-add');

let members = [];          // まとめて送る人(先頭が開いた生徒)
let extras = {};
let types = [];
let current = [];          // いまの文面に入っている予定
let shown = [];            // 期間の中の予定(チェックの一覧に出しているもの)
let checked = new Set();   // チェックした予定の id
let seen = new Set();      // 一度一覧に出した予定の id(はじめのチェックを付けたかどうか)
let focusId = null;        // 予定の入力画面から開いたときの、その予定(はじめからチェック)
let onSent = () => {};
let onConfirmed = () => {};
let onChanged = () => {};   // 表を描き直す(main.js から)

export function initLineShare(opts = {}) {
  onChanged = opts.onChanged || (() => {});
  // 返事が来たら:チェックした仮の予定を確約にする(1回の「戻す」で全部元に戻せる)
  confirmBtn.addEventListener('click', confirmChecked);
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  range.addEventListener('change', () => build());
  // まとめて送る人を足す・外す(顔ぶれはどの端末でも覚えておく)
  addSelect.addEventListener('change', async () => {
    const name = addSelect.value;
    addSelect.value = '';
    if (!name || members.includes(name)) return;
    await changeMembers([...members, name]);
  });
  membersBox.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-name]');
    if (btn) await changeMembers(members.filter(n => n !== btn.dataset.name));
  });
  pick.addEventListener('change', e => {
    const box = e.target.closest('input[type=checkbox]');
    if (!box) return;
    if (box.checked) checked.add(box.value); else checked.delete(box.value);
    writeText();
  });
  const setAll = test => { checked = new Set(shown.filter(test).map(l => l.id)); renderPick(); writeText(); };
  document.getElementById('line-pick-tentative').addEventListener('click', () => setAll(l => (l.status || 'tentative') === 'tentative'));
  document.getElementById('line-pick-all').addEventListener('click', () => setAll(() => true));
  document.getElementById('line-pick-none').addEventListener('click', () => setAll(() => false));
  text.addEventListener('input', updateLink);
  copyBtn.addEventListener('click', copyText);
  // LINE を開いたら、送った印を付ける(リンクはそのまま LINE を開く)
  openLink.addEventListener('click', async () => {
    if (openLink.getAttribute('aria-disabled') === 'true' || !current.length) return;
    for (const name of members) {
      const mine = current.filter(l => l.student === name);
      if (mine.length) await store.markLineSent(name, mine);
    }
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

// 期間の選択肢:今月と来月(今日から来月末まで)・今月(今日から月末まで)・来月
// (2か月以上先の予定を送ることはまずないので、来月まで。2026-10-19)
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
  const m0 = month(0), m1 = month(1);
  return [
    { value: 'both', label: `今月と来月(${m0.label}・${m1.label})`, from: today, to: m1.to, periodText: `${m0.label}・${m1.label}` },
    { ...m0, label: `今月(${m0.label}・今日から)` },
    { ...m1, label: `来月(${m1.label})` },
  ];
}

// その生徒の画面から開く
export async function openLineShare(name, opts = {}) {
  onSent = opts.onSent || (() => {});
  onConfirmed = opts.onConfirmed || onSent;
  focusId = opts.lessonId || null;
  checked = new Set();
  seen = new Set();
  const [t, x, overview] = await Promise.all([store.getTypes(), store.getStudentExtras(), store.getStudentOverview()]);
  types = t;
  extras = x;
  members = [name, ...(extras[name]?.lineWith || []).filter(n => n !== name)];
  renderMembers(overview.map(e => e.name));
  const options = rangeOptions();
  range.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  template.value = await store.getLineTemplate();
  // はじめに選ぶ期間:来月(入力画面から今月の予定を開いたときは、その予定が見えるよう「今月と来月」)
  const m1 = options.find(o => o.value === 'm1');
  const focus = focusId && (await lessonsIn(options[0])).find(l => l.id === focusId);
  range.value = focus && focus.date < m1.from ? 'both' : 'm1';
  await build();
  dialog.showModal();
  title.focus();
}

// 題名・送り先・まとめて送る人の欄
function renderMembers(allNames) {
  title.textContent = `${members.join('さん・')}さんに LINE で送る`;
  // 送り先:開いた生徒の LINE での名前(なければ、まとめて送る人のだれかの)
  const lineName = members.map(n => extras[n]?.lineName).find(Boolean);
  to.classList.toggle('unset', !lineName);
  to.innerHTML = lineName
    ? `送り先:<strong>${escapeHtml(lineName)}</strong>(LINE の画面でこの人を選んでください)`
    : '送り先の LINE での名前が未登録です。生徒の画面の「LINE での名前」に入れておくと、ここに出ます。';
  membersBox.innerHTML = members.map((n, i) => i === 0
    ? `<span class="line-member is-main">${escapeHtml(n)}さん</span>`
    : `<button type="button" class="line-member" data-name="${escapeHtml(n)}" aria-label="${escapeHtml(n)}さんを外す">${escapeHtml(n)}さん <span class="x">✕</span></button>`).join('');
  const rest = allNames.filter(n => !members.includes(n));
  addSelect.innerHTML = `<option value="">＋ 一緒に送る人を追加(家族など)…</option>`
    + rest.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

async function changeMembers(next) {
  await store.saveLineGroup(members, next);
  members = next;
  extras = await store.getStudentExtras();
  renderMembers((await store.getStudentOverview()).map(e => e.name));
  await build();
}

// 期間の中の、仮と確約の予定(キャンセル・自分の予定は出さない)。まとめて送る人の順、その中は時刻の順
async function lessonsIn(option) {
  const lists = await Promise.all(members.map(n => store.getStudentLessons(n, option.from, option.to)));
  return lists.flat().filter(l => ['tentative', 'confirmed'].includes(l.status || 'tentative'));
}

// 期間を変えたとき:予定の一覧を作り直す(はじめて出す予定は、仮と、入力画面から開いた予定にチェック)
async function build(keepKeys = null) {
  const option = rangeOptions().find(o => o.value === range.value);
  shown = await lessonsIn(option);
  for (const l of shown) {
    // 確定にしたあとは、チェックしていた予定(固定枠の予定は id が変わるので日付と時刻で見分ける)をチェックのままにする
    if (keepKeys?.has(`${l.student} ${l.date} ${l.start}`)) { seen.add(l.id); checked.add(l.id); continue; }
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    if ((l.status || 'tentative') === 'tentative' || l.id === focusId) checked.add(l.id);
  }
  renderPick();
  writeText();
}

async function confirmChecked() {
  const targets = shown.filter(l => checked.has(l.id) && (l.status || 'tentative') === 'tentative');
  if (!targets.length) { alert('確定にする仮の予定にチェックをつけてください'); return; }
  const keep = new Set(shown.filter(l => checked.has(l.id)).map(l => `${l.student} ${l.date} ${l.start}`));
  const n = await store.confirmLessons(targets);
  const text0 = text.value;
  await build(keep);
  text.value = text0;   // 直した文面はそのまま
  updateLink();
  count.textContent = `${n}件の予定を確定にしました(「戻す」で元に戻せます)。`;
  onChanged();
  await onConfirmed();
}

function renderPick() {
  const typeName = Object.fromEntries(types.map(t => [t.id, t.name]));
  const many = members.length > 1;
  pick.innerHTML = shown.length ? shown.map((l, i) => `${many && l.student !== shown[i - 1]?.student
      ? `<li class="pick-head">${escapeHtml(l.student)}さん</li>` : ''}<li><label>
      <input type="checkbox" value="${escapeHtml(l.id)}" ${checked.has(l.id) ? 'checked' : ''}>
      ${dateLabel(l.date)} ${l.start}〜 ${l.duration}分 ${escapeHtml(typeName[l.typeId] || '')}${l.recurring ? ' ↻' : ''}
      <span class="sent-mark">${(l.status || 'tentative') === 'confirmed' ? '確約' : '仮'}</span>
    </label></li>`).join('') : '<li class="muted">この期間の予定はありません</li>';
  confirmBtn.hidden = !shown.some(l => (l.status || 'tentative') === 'tentative');
}

// チェックした予定から文面を作る
function writeText() {
  const option = rangeOptions().find(o => o.value === range.value);
  const lessons = shown.filter(l => checked.has(l.id));
  current = lessons;
  // 仮・確約の印は付けない(相手に「確定」と出ると不自然なため。2026-10-22)
  // 場所(自宅・訪問・OKI など)は文面に入れない(2026-10-27)
  const line = l => `・${dateLabel(l.date)} ${l.start}〜${fromMinutes(toMinutes(l.start) + l.duration)}`;
  // まとめて送るときは、人ごとに「【名前さん】」の見出しを付ける
  const blocks = members.length > 1
    ? members.map(n => lessons.filter(l => l.student === n))
      .filter(list => list.length).map(list => `【${list[0].student}さん】\n${list.map(line).join('\n')}`)
    : [lessons.map(line).join('\n')].filter(Boolean);
  text.value = (template.value || store.DEFAULT_LINE_TEMPLATE)
    .replaceAll('{名前}', members.join('・'))
    .replaceAll('{期間}', option.periodText)
    .replaceAll('{予定}', blocks.length ? blocks.join('\n\n') : '(この期間の予定はありません)');
  count.textContent = lessons.length
    ? `${lessons.length}件の予定を入れました。`
    : '送る予定にチェックを付けてください。';
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
