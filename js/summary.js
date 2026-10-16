// 集計:月の合計時間と、種類ごとの時間数
// ・合計に入れるのは「確約」だけ。「仮」は参考として別に数える
// ・「キャンセル」「なし(自分の予定)」と、設定で「集計に入れない」にした種類は合計に入れない
// ・集計に入れない種類(ライブ・サウナ・釣りなど)は、レッスンとは別に種類ごとの時間を出す
//   (キャンセル以外は状態にかかわらず数える。書き込み用の「その他」は出さない)
// ・「練習」はさらに別の項目として、いつも出す(予定がなくても 0h と出す。2026-10-16)
// ・時間数は換算表(設定画面)で数える。換算表にない長さは 分÷60
import { escapeHtml } from './calendar.js';

// 予定の一覧から集計を作る(画面とは関係ない計算だけ。テストしやすいように分けてある)
// 戻り値:{ rows:[{ type, confirmed:{count,hours}, tentative:{count,hours} }], total:{...},
//          practice:{ type, count, hours }(練習), others:[{ type, count, hours }](練習以外のレッスン以外の種類), excluded:件数 }
const PRACTICE_ID = 'practice';

export function computeSummary(lessons, types, rules) {
  const hoursOf = Object.fromEntries(rules.map(r => [r.minutes, r.hours]));
  const toHours = minutes => (minutes in hoursOf ? hoursOf[minutes] : minutes / 60);
  const typeById = Object.fromEntries(types.map(t => [t.id, t]));
  const empty = () => ({ count: 0, hours: 0 });
  const byType = new Map(types.map(t => [t.id, { type: t, confirmed: empty(), tentative: empty() }]));
  const total = { confirmed: empty(), tentative: empty() };
  const otherByType = new Map();
  let excluded = 0;

  for (const l of lessons) {
    const status = l.status || 'tentative';
    const type = typeById[l.typeId];
    if (type && !type.countInTotal && type.id !== 'other' && status !== 'cancelled') {
      if (!otherByType.has(type.id)) otherByType.set(type.id, { type, count: 0, hours: 0 });
      const o = otherByType.get(type.id);
      o.count++;
      o.hours += toHours(l.duration);
    }
    if (!type || !type.countInTotal || (status !== 'confirmed' && status !== 'tentative')) {
      excluded++;
      continue;
    }
    const h = toHours(l.duration);
    for (const bucket of [byType.get(type.id)[status], total[status]]) {
      bucket.count++;
      bucket.hours += h;
    }
  }
  const rows = [...byType.values()].filter(r => r.type.countInTotal && (r.confirmed.count || r.tentative.count));
  const practiceType = types.find(t => t.id === PRACTICE_ID && !t.countInTotal);
  const practice = practiceType ? (otherByType.get(PRACTICE_ID) || { type: practiceType, count: 0, hours: 0 }) : null;
  const others = types.filter(t => t.id !== PRACTICE_ID).map(t => otherByType.get(t.id)).filter(Boolean);   // 設定の並び順
  return { rows, total, practice, others, excluded };
}

// 時間数を見やすく(0.25 → 0.25、1.5 → 1.5、2 → 2.0)
export function formatHours(h) {
  const rounded = Math.round(h * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

// ---------------------------------------------------------
// 画面
// ---------------------------------------------------------
const chip = document.getElementById('summary-chip');
const dialog = document.getElementById('summary-dialog');
const title = document.getElementById('summary-title');
const body = document.getElementById('summary-body');
let last = null;   // いま表示している月の集計

export function initSummary() {
  chip.addEventListener('click', () => {
    if (!last) return;
    dialog.showModal();
    dialog.querySelector('h2').focus();
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

// 表を描き直すたびに呼ぶ(上の帯の合計と、集計の画面の中身を作り直す)
export function updateSummary(year, month, lessons, types, rules) {
  const s = computeSummary(lessons, types, rules);
  last = s;
  const tentative = s.total.tentative.count ? `(仮 ${formatHours(s.total.tentative.hours)}h)` : '';
  chip.innerHTML = `確約 <strong>${formatHours(s.total.confirmed.hours)}h</strong>${tentative}`;
  title.textContent = `${year}年${month}月の集計`;

  const cell = b => (b.count ? `${b.count}件<br><strong>${formatHours(b.hours)}h</strong>` : '<span class="muted">—</span>');
  const rows = s.rows.map(r => `<tr>
      <th scope="row"><span class="legend-swatch" style="background:${r.type.color}"></span>${escapeHtml(r.type.name)}</th>
      <td>${cell(r.confirmed)}</td>
      <td class="tentative-col">${cell(r.tentative)}</td>
    </tr>`).join('');
  body.innerHTML = `
    <table class="summary-table">
      <caption class="summary-sub">レッスン</caption>
      <thead><tr><th scope="col">種類</th><th scope="col">確約</th><th scope="col" class="tentative-col">仮(参考)</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="muted">この月は、集計に入る予定がありません</td></tr>'}</tbody>
      <tfoot><tr>
        <th scope="row">レッスン合計</th>
        <td>${cell(s.total.confirmed)}</td>
        <td class="tentative-col">${cell(s.total.tentative)}</td>
      </tr></tfoot>
    </table>
    ${s.practice ? `
    <h3 class="summary-sub">練習(合計には入れていません)</h3>
    <table class="summary-table">
      <thead><tr><th scope="col">種類</th><th scope="col">件数</th><th scope="col">時間</th></tr></thead>
      <tbody><tr>
        <th scope="row"><span class="legend-swatch" style="background:${s.practice.type.color}"></span>${escapeHtml(s.practice.type.name)}</th>
        <td>${s.practice.count}件</td><td><strong>${formatHours(s.practice.hours)}h</strong></td>
      </tr></tbody>
    </table>` : ''}
    ${s.others.length ? `
    <h3 class="summary-sub">レッスン以外(合計には入れていません)</h3>
    <table class="summary-table">
      <thead><tr><th scope="col">種類</th><th scope="col">件数</th><th scope="col">時間</th></tr></thead>
      <tbody>${s.others.map(o => `<tr>
        <th scope="row"><span class="legend-swatch" style="background:${o.type.color}"></span>${escapeHtml(o.type.name)}</th>
        <td>${o.count}件</td><td><strong>${formatHours(o.hours)}h</strong></td>
      </tr>`).join('')}</tbody>
    </table>` : ''}
    <p class="sheet-note">
      レッスンの合計に入るのは「確約」だけです。「仮」は参考として別に数えています。<br>
      キャンセル・「なし(自分の予定)」・集計に入れない種類の予定(この月は${s.excluded}件)はレッスンの合計に入れていません。<br>
      練習と、レッスン以外の種類(ライブ・サウナ・釣りなど)は、キャンセル以外を種類ごとに数えて、別の表に出しています。<br>
      時間数は設定画面の換算表で数えます(換算表にない長さは 分÷60)。
    </p>`;
}
