// 設定画面の「毎週の固定枠」:固定枠の一覧・終了日の変更・削除・休みにした日の取り消し・期間をまとめて休みに
// 固定枠を作るのは、予定の入力画面の「毎週この曜日・この時間にくり返す」から
import * as store from './store.js';
import { escapeHtml, toMinutes, fromMinutes } from './calendar.js';

const list = document.getElementById('slot-list');
const skipFrom = document.getElementById('skip-from');
const skipTo = document.getElementById('skip-to');
let onChanged = () => {};
let types = [];

const STATUS_NAME = { tentative: '仮', confirmed: '確約', cancelled: 'キャンセル', none: 'なし' };

export function initRecurring(opts) {
  onChanged = opts.onChanged;
  document.getElementById('open-settings').addEventListener('click', renderSlots);
  list.addEventListener('click', onClick);
  list.addEventListener('change', onEndDateChange);
  document.getElementById('skip-range-btn').addEventListener('click', skipRange);
}

function shortDate(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

export async function renderSlots() {
  const [slots, t] = await Promise.all([store.getSlots(), store.getTypes()]);
  types = t;
  if (!slots.length) {
    list.innerHTML = '<li class="slot-empty">まだありません。予定の入力画面の「くり返し」で「毎週」「毎月」を選ぶと登録できます。</li>';
    return;
  }
  const skipsBySlot = await Promise.all(slots.map(s => store.getSkips(s.id)));
  const today = new Date().toISOString().slice(0, 10);
  list.innerHTML = slots.map((s, i) => {
    const type = types.find(x => x.id === s.typeId);
    const end = fromMinutes(toMinutes(s.start) + s.duration);
    // 休みにした日は、これからの日と最近(30日以内)の日だけ見せる
    const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const skips = skipsBySlot[i].filter(x => x.date >= recent);
    return `<li class="slot-row" data-id="${escapeHtml(s.id)}">
      <div class="slot-main">
        <span class="slot-swatch" style="background:${type?.color || '#9e9e9e'}"></span>
        <strong>${escapeHtml(store.slotLabel(s))}〜${end}</strong>
        <span>${escapeHtml(s.student || '(名前なし)')}(${escapeHtml(type?.name || '種類なし')}・${STATUS_NAME[s.status] || ''})</span>
      </div>
      <div class="slot-dates">
        <span>${shortDate(s.startDate)}から</span>
        <label>終了日 <input type="date" class="slot-end" value="${s.endDate || ''}" min="${s.startDate}"></label>
        ${s.endDate && s.endDate < today ? '<span class="slot-ended">(終了済み)</span>' : ''}
        <button type="button" class="btn btn-small btn-danger" data-act="delete">削除</button>
      </div>
      ${skips.length ? `<div class="slot-skips">休み:${skips.map(x =>
        `<button type="button" class="skip-chip" data-act="unskip" data-exc='${escapeHtml(JSON.stringify(x))}' title="休みを取り消す">${shortDate(x.date)} ×</button>`).join('')}</div>` : ''}
    </li>`;
  }).join('');
}

async function onClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.slot-row').dataset.id;
  if (btn.dataset.act === 'delete') {
    if (!confirm('この固定枠を削除しますか?\n(過去の分も含めて、この固定枠から入った予定がすべて表から消えます。「戻す」で元に戻せます)')) return;
    await store.deleteSlot(id);
  } else if (btn.dataset.act === 'unskip') {
    await store.unskip(JSON.parse(btn.dataset.exc));
  }
  await renderSlots();
  onChanged();
}

async function onEndDateChange(e) {
  if (!e.target.classList.contains('slot-end')) return;
  const id = e.target.closest('.slot-row').dataset.id;
  const slot = (await store.getSlots()).find(s => s.id === id);
  if (!slot) return;
  const endDate = e.target.value || null;
  if (endDate && endDate < slot.startDate) { alert('終了日は、始まりの日より後にしてください'); return renderSlots(); }
  await store.updateSlot({ ...slot, endDate });
  await renderSlots();
  onChanged();
}

async function skipRange() {
  const from = skipFrom.value, to = skipTo.value;
  if (!from || !to) return alert('休みにする期間の、はじめと終わりの日を選んでください');
  if (to < from) return alert('終わりの日は、はじめの日より後にしてください');
  if (!confirm(`${shortDate(from)}〜${shortDate(to)} の固定枠を、すべて休みにしますか?\n(ふつうの予定はそのまま残ります。「戻す」で元に戻せます)`)) return;
  const count = await store.skipRange(from, to);
  alert(count ? `${count}件の固定枠を休みにしました` : 'この期間に固定枠の予定はありませんでした');
  await renderSlots();
  onChanged();
}
