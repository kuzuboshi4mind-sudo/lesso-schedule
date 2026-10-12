// 日本の祝日と、独自のお休み(年末3日間)を計算で求める(祝日は2022年以降の法律に合わせたルール)
// 祝日一覧をネットから取らずに済むので、オフラインでも動く

// 指定した月の「第n月曜日」の日付(1〜31)を返す
function nthMonday(year, month, n) {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=日曜
  const firstMonday = 1 + ((8 - firstDay) % 7);
  return firstMonday + (n - 1) * 7;
}

// 春分の日・秋分の日(1980〜2099年に使える計算式)
function equinoxDay(year, base) {
  const y = year - 1980;
  return Math.floor(base + 0.242194 * y - Math.floor(y / 4));
}

function key(month, day) {
  return `${month}-${day}`;
}

// その年の祝日を { "月-日": "祝日名" } の形で返す
function calcHolidays(year) {
  const h = {};
  h[key(1, 1)] = '元日';
  h[key(1, nthMonday(year, 1, 2))] = '成人の日';
  h[key(2, 11)] = '建国記念の日';
  h[key(2, 23)] = '天皇誕生日';
  h[key(3, equinoxDay(year, 20.8431))] = '春分の日';
  h[key(4, 29)] = '昭和の日';
  h[key(5, 3)] = '憲法記念日';
  h[key(5, 4)] = 'みどりの日';
  h[key(5, 5)] = 'こどもの日';
  h[key(7, nthMonday(year, 7, 3))] = '海の日';
  h[key(8, 11)] = '山の日';
  h[key(9, nthMonday(year, 9, 3))] = '敬老の日';
  h[key(9, equinoxDay(year, 23.2488))] = '秋分の日';
  h[key(10, nthMonday(year, 10, 2))] = 'スポーツの日';
  h[key(11, 3)] = '文化の日';
  h[key(11, 23)] = '勤労感謝の日';

  // 国民の休日:祝日にはさまれた平日(例:敬老の日と秋分の日の間)
  for (let d = new Date(year, 0, 2); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const k = key(d.getMonth() + 1, d.getDate());
    if (h[k]) continue;
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    if (h[key(prev.getMonth() + 1, prev.getDate())] && h[key(next.getMonth() + 1, next.getDate())]
        && next.getFullYear() === year) {
      h[k] = '国民の休日';
    }
  }

  // 振替休日:祝日が日曜なら、その後の最初の平日が休み
  for (const k of Object.keys(h)) {
    const [m, day] = k.split('-').map(Number);
    const d = new Date(year, m - 1, day);
    if (d.getDay() !== 0) continue;
    do { d.setDate(d.getDate() + 1); } while (h[key(d.getMonth() + 1, d.getDate())]);
    if (d.getFullYear() === year) h[key(d.getMonth() + 1, d.getDate())] = '振替休日';
  }

  // 年末の3日間(12/29〜31)はお休み
  for (const day of [29, 30, 31]) h[key(12, day)] = '年末休み';
  return h;
}

const cache = {};

// 祝日なら祝日名を、そうでなければ null を返す(month は 1〜12)
export function holidayName(year, month, day) {
  if (!cache[year]) cache[year] = calcHolidays(year);
  return cache[year][key(month, day)] || null;
}
