// Numbers への書き出し(Excel 形式 .xlsx)
// ・1か月を1枚のシート(Numbers ではタブ)にする。仮の月はシート名が「10月仮」
// ・表の形は今の Numbers と同じ:縦=30分刻みの時刻、横=日付。上に「曜日」「予定」の行
// ・予定は種類の色で塗る(確約=濃い色(○は付けない。2026-10-31)、仮=薄い色+点線の枠、キャンセル=灰色+×、なし=左に太い線)
// ・60分以上の予定は、たてにマスをつなげる(重なりがないとき)
// ・表の下に集計、右に生徒の一覧(名前の色=種類、メモ)
// ・種類をしぼって書き出せる(OKI川口・OKI加茂だけ など。2026-10-31)。しぼったときは、その種類の予定・集計・生徒だけを出し、
//   「予定」の行のメモとマスの色は出さない(自分の予定が入らないように)
// Excel 形式のファイルを作る部品(ExcelJS)は、書き出すときだけ読み込む
import * as store from './store.js';
import { monthDays, timeSlots, toMinutes, fromMinutes, textColorFor, START_HOUR } from './calendar.js';
import { computeSummary } from './summary.js';

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
// 部品のファイルが途中で書き換えられていないかを確かめるための指紋(SRI)
const EXCELJS_SRI = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const HEAD_ROWS = 3;              // 日付・曜日・予定 の3行
const SLOTS = timeSlots();        // 6:00〜23:30 の36行
const COLORS = {
  head: 'FFE3F1EE',       // 見出しのマス
  off: 'FFDCF0FA',        // 土日・祝日の列(水色)
  offHead: 'FFC4E6F6',
  note: 'FFFCE3C8',       // 「予定」の行(Numbers と同じオレンジ系)
  line: 'FFD3E2DF',       // 罫線
  lineHour: 'FFA9C4BF',   // 1時間ごとの罫線
  text: 'FF1C2B2A',
  muted: 'FF6B7F7C',
  sun: 'FFD0473C',
  sat: 'FF2F6FD0',
  cancelled: 'FFE6E6E6',
  tentativeMonth: 'FFE07B1A',
};

let loading = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.integrity = EXCELJS_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { loading = null; reject(new Error('書き出し用の部品を読み込めませんでした。ネットにつながっているか確かめてください')); };
    document.head.append(s);
  });
  return loading;
}

// '#4caf50' → 'FF4CAF50'(Excel の色の書き方)
const argb = hex => 'FF' + hex.replace('#', '').toUpperCase();
// 白に少しだけ色を混ぜた薄い色(仮の予定用)
function tint(hex, ratio = 0.3) {
  const n = parseInt(hex.slice(1), 16);
  const mix = c => Math.round(255 - (255 - c) * ratio);
  return 'FF' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => mix(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const fill = color => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });
const side = (color, style = 'thin') => ({ style, color: { argb: color } });

// 予定1件の文字(キャンセルは「×名前」)と長さの表示
// 確約の「○」と「60分」「45分」などの長さは出さない(2026-10-31 本人の希望。長さはつなげたマスの高さでわかる)
function lessonLabel(l) {
  const name = l.student || '(名前なし)';
  return (l.status || 'tentative') === 'cancelled' ? `×${name}` : name;
}
// 120分より長い予定だけ、終わりの時刻(「〜22:00」)を添える
function durationLabel(l) {
  return l.duration > 120 ? `〜${fromMinutes(toMinutes(l.start) + l.duration)}` : '';
}

// 予定を塗るときの見た目
function lessonStyle(l, type) {
  const color = store.lessonColor(l, type);
  const status = l.status || 'tentative';
  // 種類「その他」は種類の色(薄い水色)で塗り、ふつうの文字(アプリの表と同じ)
  if (type?.id === 'other') {
    return { fill: fill(argb(color)), font: { strike: status === 'cancelled', color: { argb: COLORS.text } } };
  }
  if (status === 'confirmed') {
    return { fill: fill(argb(color)), font: { bold: true, color: { argb: argb(textColorFor(color)) } } };
  }
  if (status === 'cancelled') {
    return { fill: fill(COLORS.cancelled), font: { strike: true, color: { argb: COLORS.muted } } };
  }
  if (status === 'none') {
    return { fill: fill('FFFFFFFF'), font: { color: { argb: COLORS.text } }, leftBorder: side(argb(color), 'thick') };
  }
  return { fill: fill(tint(color)), font: { color: { argb: COLORS.text } }, dashed: side(argb(color), 'dashed') };
}

// ---------------------------------------------------------
// 1か月分のシートを作る
// ---------------------------------------------------------
async function addMonthSheet(workbook, year, month, common) {
  const { types, rules, onlyTypes } = common;
  const [allLessons, allNotes, tentative, allColors] = await Promise.all([
    store.getLessons(year, month), store.getDayNotes(year, month), store.isTentativeMonth(year, month),
    store.getCellColors(year, month),
  ]);
  const lessons = onlyTypes ? allLessons.filter(l => onlyTypes.includes(l.typeId)) : allLessons;
  const notes = onlyTypes ? {} : allNotes;
  const cellColors = onlyTypes ? {} : allColors;
  // 種類をしぼったときは、この月にその種類の予定がある生徒だけ
  const names = new Set(lessons.map(l => l.student));
  const students = onlyTypes ? common.students.filter(st => names.has(st.name)) : common.students;
  const typeById = Object.fromEntries(types.map(t => [t.id, t]));
  const days = monthDays(year, month, new Date(0));
  const ws = workbook.addWorksheet(`${month}月${tentative ? '仮' : ''}`, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: HEAD_ROWS }],
    properties: { defaultRowHeight: 18 },
  });

  // ---- 見出し:日付・曜日・予定 ----
  const rDate = ws.getRow(1), rWeek = ws.getRow(2), rNote = ws.getRow(3);
  rDate.height = 20; rWeek.height = 18; rNote.height = 30;
  rDate.getCell(1).value = '時間';
  rWeek.getCell(1).value = '曜日';
  rNote.getCell(1).value = '予定';
  days.forEach((d, i) => {
    const col = i + 2;
    const color = (d.weekday === 0 || d.holiday) ? COLORS.sun : d.weekday === 6 ? COLORS.sat : COLORS.text;
    const head = d.isOff ? COLORS.offHead : COLORS.head;
    Object.assign(rDate.getCell(col), { value: d.day, font: { bold: true, color: { argb: color } }, fill: fill(head) });
    Object.assign(rWeek.getCell(col), { value: WEEKDAYS[d.weekday], font: { color: { argb: color } }, fill: fill(head) });
    const note = notes[d.key] || '';
    // 祝日の名前は、メモがないときだけ小さく入れる
    Object.assign(rNote.getCell(col), {
      value: note || d.holiday || null,
      font: note ? { color: { argb: COLORS.text } } : { size: 8, color: { argb: COLORS.sun } },
      fill: fill(note ? COLORS.note : d.isOff ? COLORS.off : 'FFF0F7F5'),
    });
  });
  for (const r of [rDate, rWeek, rNote]) r.getCell(1).fill = fill(COLORS.head);
  // 仮の月は、左上のマスをオレンジにする(シート名も「10月仮」)
  if (tentative) {
    rDate.getCell(1).fill = fill(COLORS.tentativeMonth);
    rDate.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }

  // ---- 時刻の行 ----
  SLOTS.forEach((time, i) => {
    const row = ws.getRow(HEAD_ROWS + 1 + i);
    row.height = 18;
    row.getCell(1).value = time;
    row.getCell(1).font = { bold: time.endsWith(':00'), color: { argb: time.endsWith(':00') ? COLORS.text : COLORS.muted } };
    row.getCell(1).fill = fill(COLORS.head);
    days.forEach((d, j) => {
      // マスの色(予定とは別に塗った色)があればその色。予定のあるマスは、あとで予定の色になる
      const paint = cellColors[`${d.key}|${time}`];
      if (paint) row.getCell(j + 2).fill = fill(argb(paint));
      else if (d.isOff) row.getCell(j + 2).fill = fill(COLORS.off);
    });
  });

  // ---- 予定 ----
  const start = START_HOUR * 60;
  const rowOf = min => Math.floor((min - start) / 30);   // 0 が 6:00 の行
  days.forEach((d, j) => {
    const col = j + 2;
    const dayLessons = lessons.filter(l => l.date === d.key)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    // マスごとに、そこで始まる予定をまとめる
    const byRow = new Map();
    for (const l of dayLessons) {
      const r = rowOf(toMinutes(l.start));
      if (r < 0 || r >= SLOTS.length) continue;
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r).push(l);
    }
    const used = new Set();   // もう塗ったマス
    for (const [r, list] of [...byRow].sort((a, b) => a[0] - b[0])) {
      const first = list[0];
      const style = lessonStyle(first, typeById[first.typeId]);
      // 1件だけで30分より長い予定は、下のマスにつなげる(途中で別の予定が始まらなければ)
      let last = r;
      if (list.length === 1) {
        const end = Math.min(SLOTS.length - 1, Math.ceil((toMinutes(first.start) + first.duration - start) / 30) - 1);
        while (last < end && !byRow.has(last + 1) && !used.has(last + 1)) last++;
      }
      const cell = ws.getRow(HEAD_ROWS + 1 + r).getCell(col);
      // つなげたマス(60分以上)は名前(長い予定は終わりの時刻も)、1マスに2件は2行
      cell.value = list.length === 1 && last > r
        ? [lessonLabel(first), durationLabel(first)].filter(Boolean).join('\n')
        : list.map(l => [lessonLabel(l), durationLabel(l)].filter(Boolean).join(' ')).join('\n');
      cell.fill = style.fill;
      cell.font = { ...style.font, size: list.length > 1 || durationLabel(first) ? 9 : 11 };
      // 1行の予定は、マスに入りきらなければ文字を小さくして収める
      cell.alignment = list.length === 1 && last === r
        ? { vertical: 'middle', horizontal: 'center', shrinkToFit: true }
        : { vertical: 'middle', horizontal: 'center', wrapText: true };
      const border = style.dashed
        ? { top: style.dashed, bottom: style.dashed, left: style.dashed, right: style.dashed }
        : { top: side(COLORS.lineHour), bottom: side(COLORS.lineHour), left: style.leftBorder || side(COLORS.lineHour), right: side(COLORS.lineHour) };
      cell.border = border;
      for (let k = r; k <= last; k++) used.add(k);
      if (last > r) ws.mergeCells(HEAD_ROWS + 1 + r, col, HEAD_ROWS + 1 + last, col);
      // 2件で1マスのときは、2件ぶん見えるように行を少し高く
      if (list.length > 1) ws.getRow(HEAD_ROWS + 1 + r).height = Math.max(ws.getRow(HEAD_ROWS + 1 + r).height || 18, 14 * list.length);
    }
  });

  // ---- 罫線(予定のないマス)----
  const lastRow = HEAD_ROWS + SLOTS.length;
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= days.length + 1; c++) {
      const cell = row.getCell(c);
      if (!cell.border) {
        const hour = r > HEAD_ROWS && SLOTS[r - HEAD_ROWS - 1].endsWith(':30');
        cell.border = { top: side(COLORS.line), left: side(COLORS.line), right: side(COLORS.line), bottom: side(hour || r <= HEAD_ROWS ? COLORS.lineHour : COLORS.line) };
      }
      if (!cell.alignment) cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
  }

  // ---- 表の下:集計 ----
  const s = computeSummary(lessons, types, rules);
  let r = lastRow + 2;
  ws.getRow(r).getCell(2).value = `${month}月の集計${onlyTypes ? '(OKI川口・OKI加茂だけ)' : ''}`;
  ws.getRow(r).getCell(2).font = { bold: true, size: 12 };
  r++;
  const headers = ['種類', '', '確約 件数', '確約 時間数(h)', 'コマ数(30分)', '仮 件数', '仮 時間数(h)'];
  headers.forEach((h, i) => {
    const cell = ws.getRow(r).getCell(i + 2);
    cell.value = h || null;
    cell.font = { bold: true, size: 9, color: { argb: COLORS.muted } };
    cell.fill = fill(COLORS.head);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.mergeCells(r, 2, r, 3);
  ws.getRow(r).height = 28;
  const round = h => Math.round(h * 100) / 100;
  const summaryRow = (label, color, b, bold) => {
    r++;
    const row = ws.getRow(r);
    row.getCell(2).value = label;
    row.getCell(2).font = { bold: true, color: { argb: color ? argb(textColorFor(color)) : COLORS.text } };
    if (color) row.getCell(2).fill = fill(argb(color));
    ws.mergeCells(r, 2, r, 3);
    const values = [b.confirmed.count, round(b.confirmed.hours), round(b.confirmed.hours * 2), b.tentative.count, round(b.tentative.hours)];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 4);
      cell.value = v;
      cell.font = { bold: bold && i < 3, color: { argb: i >= 3 ? COLORS.muted : COLORS.text } };
      cell.alignment = { horizontal: 'center' };
      if (i === 1 || i === 4) cell.numFmt = '0.0#';
    });
    for (let c = 2; c <= 8; c++) row.getCell(c).border = { bottom: side(bold ? COLORS.lineHour : COLORS.line, bold ? 'medium' : 'thin') };
  };
  for (const row of s.rows) summaryRow(row.type.name, row.type.color, row, false);
  summaryRow('レッスン合計', null, s.total, true);
  // 練習と、レッスン以外(ライブ・サウナ・釣りなど):種類ごとの件数と時間(合計には入れない)
  // (種類をしぼったときは出さない)
  const sections = onlyTypes ? [] : [
    ['練習(合計に入れない)', s.practice ? [s.practice] : []],
    ['プライベート(合計に入れない)', s.others],
  ];
  for (const [heading, list] of sections) {
    if (!list.length) continue;
    r += 2;
    ws.getRow(r).getCell(2).value = heading;
    ws.getRow(r).getCell(2).font = { bold: true, size: 10 };
    for (const o of list) {
      r++;
      const row = ws.getRow(r);
      row.getCell(2).value = o.type.name;
      row.getCell(2).font = { bold: true, color: { argb: argb(textColorFor(o.type.color)) } };
      row.getCell(2).fill = fill(argb(o.type.color));
      ws.mergeCells(r, 2, r, 3);
      row.getCell(4).value = o.count;
      row.getCell(5).value = round(o.hours);
      row.getCell(5).numFmt = '0.0#';
      for (const c of [4, 5]) row.getCell(c).alignment = { horizontal: 'center' };
      for (let c = 2; c <= 5; c++) row.getCell(c).border = { bottom: side(COLORS.line) };
    }
  }
  r += 2;
  ws.getRow(r).getCell(2).value = '合計は「確約」だけ。「仮」は参考。キャンセル・なし・集計に入れない種類は数えていません。'
    + ' 塗りの見方:濃い色=確約、薄い色+点線=仮、灰色+×=キャンセル、左に太い線=なし(自分の予定)';
  ws.getRow(r).getCell(2).font = { size: 9, color: { argb: COLORS.muted } };

  // ---- 表の右:生徒の一覧(名前の色=種類、メモ)----
  const sc = days.length + 3;   // 1列あける
  const sh = ws.getRow(HEAD_ROWS);   // 見出しは「予定」の行、名前は 6:00 の行から
  sh.getCell(sc).value = '生徒';
  sh.getCell(sc + 1).value = 'メモ(希望・注文など)';
  for (const c of [sc, sc + 1]) {
    sh.getCell(c).font = { bold: true };
    sh.getCell(c).fill = fill(COLORS.head);
    sh.getCell(c).border = { bottom: side(COLORS.lineHour) };
  }
  students.forEach((st, i) => {
    const row = ws.getRow(HEAD_ROWS + 1 + i);
    const type = typeById[st.typeId];
    const nameCell = row.getCell(sc);
    nameCell.value = st.name;
    nameCell.font = { bold: true, color: { argb: type ? argb(textColorFor(type.color)) : COLORS.text } };
    if (type) nameCell.fill = fill(argb(type.color));
    nameCell.border = { bottom: side(COLORS.line) };
    const memoCell = row.getCell(sc + 1);
    memoCell.value = st.memo ? st.memo.replace(/\n/g, ' / ') : null;
    memoCell.font = { size: 9 };
    memoCell.alignment = { vertical: 'middle', wrapText: false };
    memoCell.border = { bottom: side(COLORS.line) };
  });

  // 列の幅は最後にまとめて決める(途中で決めると、ファイルに残らないことがあるため)
  ws.getColumn(1).width = 7;
  for (let c = 2; c <= days.length + 1; c++) ws.getColumn(c).width = 9.5;
  ws.getColumn(sc).width = 14;
  ws.getColumn(sc + 1).width = 40;

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return ws;
}

// OKI川口・OKI加茂の種類(id が初期のものか、名前が「OKI」で始まるもの)
export function okiTypeIds(types) {
  return types.filter(t => ['oki-kawaguchi', 'oki-kamo'].includes(t.id) || /^OKI/i.test(t.name)).map(t => t.id);
}

// 書き出す。months:[{ year, month }]。onlyTypes:種類の id の一覧(しぼるとき)。戻り値は File
export async function buildXlsx(months, fileName, onlyTypes = null) {
  const ExcelJS = await loadExcelJS();
  const [types, rules, students] = await Promise.all([store.getTypes(), store.getDurationRules(), store.getStudentOverview()]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'レッスンスケジュール';
  workbook.created = new Date();
  for (const { year, month } of months) {
    await addMonthSheet(workbook, year, month, { types, rules, students, onlyTypes });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
