// 設定画面:種類と色、換算表
// 変更はその場で保存し、後ろの表にもすぐ反映する
import * as store from './store.js';
import { escapeHtml } from './calendar.js';

// 色を選ぶときの見本(タップで選べる)。ここにない色は「ほかの色…」で自由に選べる
const PALETTE = [
  '#4caf50', '#8bc34a', '#26a69a', '#56ccf2', '#2f80ed', '#2f5fd0',
  '#9b51e0', '#f48fb1', '#eb5757', '#f2994a', '#f2c94c', '#a1887f',
  '#795548', '#9e9e9e', '#607d8b', '#212121',
];

const dialog = document.getElementById('settings-dialog');
const typeList = document.getElementById('type-list');
const ruleList = document.getElementById('rule-list');
let onChanged = () => {};
let types = [];
let rules = [];

export function initSettings(opts) {
  onChanged = opts.onChanged;
  document.getElementById('open-settings').addEventListener('click', openSettings);
  dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
  document.getElementById('add-type').addEventListener('click', addType);
  document.getElementById('numbers-colors').addEventListener('click', useNumbersColors);
  document.getElementById('add-rule').addEventListener('click', addRule);
  typeList.addEventListener('click', onTypeClick);
  typeList.addEventListener('input', onTypeInput);
  typeList.addEventListener('change', onTypeInput);
  ruleList.addEventListener('change', onRuleChange);
  ruleList.addEventListener('click', onRuleClick);
}

async function openSettings() {
  [types, rules] = await Promise.all([store.getTypes(), store.getDurationRules()]);
  types = structuredClone(types);
  rules = structuredClone(rules);
  renderTypes();
  renderRules();
  dialog.showModal();
  dialog.querySelector('h2').focus();
  dialog.scrollTop = 0;
}

// ---------------------------------------------------------
// 種類と色
// ---------------------------------------------------------
// 今まで使っていた Numbers と同じ色にする(名前・集計に入れるか・自分で足した種類はそのまま)
async function useNumbersColors() {
  if (!confirm('種類の色を、Numbers で使っていた色にそろえますか?\n(自宅=黄緑、OKI川口=山吹、OKI加茂=サーモン、サンパル=水色、訪問=青、オンライン=青緑、JINIS=薄いピンク。自分で足した種類の色は変えません)')) return;
  types = types.map(t => (store.NUMBERS_COLORS[t.id] ? { ...t, color: store.NUMBERS_COLORS[t.id] } : t));
  await saveTypes(-1);
}

function renderTypes(openIndex = -1) {
  typeList.innerHTML = types.map((t, i) => `
    <li class="type-row${i === openIndex ? ' open' : ''}" data-index="${i}">
      <div class="type-row-main">
        <button type="button" class="swatch" data-act="palette" style="background:${t.color}" aria-label="${escapeHtml(t.name)}の色を変える"></button>
        <input type="text" class="type-name" value="${escapeHtml(t.name)}" aria-label="種類の名前" autocomplete="off" autocorrect="off" spellcheck="false">
        <label class="toggle">
          <input type="checkbox" class="type-count" ${t.countInTotal ? 'checked' : ''}>
          <span>集計に入れる</span>
        </label>
        <span class="row-buttons">
          <button type="button" class="btn btn-small" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
          <button type="button" class="btn btn-small" data-act="down" ${i === types.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
          <button type="button" class="btn btn-small btn-danger" data-act="delete">削除</button>
        </span>
      </div>
      <div class="palette">
        ${PALETTE.map(c => `<button type="button" class="palette-dot${c === t.color ? ' current' : ''}" data-act="color" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
        <label class="palette-custom">ほかの色…<input type="color" class="type-color" value="${t.color}"></label>
      </div>
    </li>`).join('');
}

async function saveTypes(rerenderOpen) {
  await store.saveTypes(types);
  if (rerenderOpen !== undefined) renderTypes(rerenderOpen);
  onChanged();
}

function rowIndex(el) {
  return Number(el.closest('[data-index]').dataset.index);
}

async function onTypeClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = rowIndex(btn);
  const act = btn.dataset.act;
  if (act === 'palette') {
    const open = btn.closest('.type-row').classList.contains('open');
    renderTypes(open ? -1 : i);
  } else if (act === 'color') {
    types[i].color = btn.dataset.color;
    await saveTypes(-1);
  } else if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    [types[i], types[j]] = [types[j], types[i]];
    await saveTypes(-1);
  } else if (act === 'delete') {
    if (types.length <= 1) return alert('種類は1つ以上必要です');
    const count = await store.countLessonsOfType(types[i].id);
    const msg = count
      ? `「${types[i].name}」を削除しますか?\nこの種類の予定が${count}件あります。削除すると、それらは灰色で表示されます。`
      : `「${types[i].name}」を削除しますか?`;
    if (!confirm(msg)) return;
    types.splice(i, 1);
    await saveTypes(-1);
  }
}

// 名前・集計・自由な色の変更
async function onTypeInput(e) {
  const i = rowIndex(e.target);
  if (e.target.classList.contains('type-name')) {
    // 名前は入力が終わったとき(change)に保存。空なら元に戻す
    if (e.type !== 'change') return;
    const name = e.target.value.trim();
    if (!name) { e.target.value = types[i].name; return; }
    types[i].name = name;
    await saveTypes();
  } else if (e.target.classList.contains('type-count')) {
    types[i].countInTotal = e.target.checked;
    await saveTypes();
  } else if (e.target.classList.contains('type-color')) {
    types[i].color = e.target.value;
    e.target.closest('.type-row').querySelector('.swatch').style.background = e.target.value;
    if (e.type === 'change') await saveTypes(); else onChangedLater();
  }
}

// 色を自由に選んでいる最中は、少し間をおいて保存する
let laterTimer = null;
function onChangedLater() {
  clearTimeout(laterTimer);
  laterTimer = setTimeout(() => saveTypes(), 250);
}

async function addType() {
  const used = new Set(types.map(t => t.color));
  const color = PALETTE.find(c => !used.has(c)) || PALETTE[0];
  types.push({ id: store.newTypeId(), name: '新しい種類', color, countInTotal: true });
  await saveTypes(types.length - 1);
  const input = typeList.querySelector('.type-row:last-child .type-name');
  input.focus();
  input.select();
}

// ---------------------------------------------------------
// 換算表(長さ → 時間数)
// ---------------------------------------------------------
function renderRules() {
  ruleList.innerHTML = rules.map((r, i) => `
    <tr data-index="${i}">
      <td><input type="number" class="rule-min" inputmode="numeric" min="5" max="600" step="5" value="${r.minutes}" aria-label="長さ(分)"> 分</td>
      <td>→</td>
      <td><input type="number" class="rule-hours" inputmode="decimal" min="0" step="0.05" value="${r.hours}" aria-label="時間数"> h</td>
      <td><button type="button" class="btn btn-small btn-danger" data-act="delete-rule">削除</button></td>
    </tr>`).join('');
}

async function saveRules() {
  await store.saveDurationRules(rules);
  rules = await store.getDurationRules();   // 分の順に並べ直したもの
  renderRules();
  onChanged();
}

async function onRuleChange(e) {
  const i = rowIndex(e.target);
  if (e.target.classList.contains('rule-min')) {
    const min = Math.round(Number(e.target.value));
    if (!(min >= 5 && min <= 600)) { alert('長さは 5〜600 分で入れてください'); return renderRules(); }
    if (rules.some((r, j) => j !== i && r.minutes === min)) { alert(`${min}分はすでにあります`); return renderRules(); }
    rules[i].minutes = min;
  } else if (e.target.classList.contains('rule-hours')) {
    const h = Number(e.target.value);
    if (!(h >= 0 && h <= 24)) { alert('時間数は 0〜24 で入れてください'); return renderRules(); }
    rules[i].hours = h;
  }
  await saveRules();
}

async function onRuleClick(e) {
  const btn = e.target.closest('[data-act="delete-rule"]');
  if (!btn) return;
  if (rules.length <= 1) return alert('長さは1つ以上必要です');
  const i = rowIndex(btn);
  if (!confirm(`${rules[i].minutes}分 を削除しますか?\n(入力画面の長さの選択肢からも消えます)`)) return;
  rules.splice(i, 1);
  await saveRules();
}

async function addRule() {
  // まだない長さで、いちばん長いもの+30分を初期値にする
  let min = Math.max(...rules.map(r => r.minutes)) + 30;
  while (rules.some(r => r.minutes === min)) min += 5;
  rules.push({ minutes: min, hours: Math.round(min / 60 * 100) / 100 });
  await saveRules();
}
