// Daily price update: KRX ETFs, US stocks, USD/KRW (Naver Finance). No dependencies.
import fs from 'node:fs';

const KRX = ['379810', '458730', '360750', '480040'];
const US = { GOOGL: 'GOOGL.O' };
const START = '2026-07-01';
const FILE = new URL('../prices.json', import.meta.url);
const UA = { 'User-Agent': 'Mozilla/5.0 (price-bot)' };
const YUA = { 'User-Agent': 'Mozilla/5.0' }; // Yahoo rejects full browser UAs without cookies

const num = (s) => typeof s === 'number' ? s : Number(String(s).replace(/,/g, ''));
const ymd = (d) => d.toISOString().slice(0, 10);
const compact = (s) => s.replace(/-/g, '');
const fromCompact = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

async function getJson(url, tries = 3, headers = UA) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}


// Drop today's candle while that market is still trading (scheduled runs can start hours late)
function localNow(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const o = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, mins: (+o.hour % 24) * 60 + +o.minute };
}
function settled(rows, tz, closeMins) {
  const n = localNow(tz);
  return rows.filter((r) => r.date < n.date || (r.date === n.date && n.mins >= closeMins));
}

let prev = {};
try { prev = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

const today = new Date(Date.now() + 9 * 3600e3); // KST
const from = prev.monthEnd && Object.keys(prev.monthEnd).length
  ? ymd(new Date(today.getTime() - 75 * 86400e3))
  : START;
const range = `startDateTime=${compact(from)}0000&endDateTime=${compact(ymd(today))}2359`;

const items = {};
const monthEnd = { ...(prev.monthEnd || {}) };
const setMonthEnd = (key, rows) => {
  // rows: [{date:'YYYY-MM-DD', close:Number}] ascending
  const byMonth = {};
  for (const row of rows) byMonth[row.date.slice(0, 7)] = row;
  for (const [m, row] of Object.entries(byMonth)) {
    monthEnd[m] = monthEnd[m] || {};
    monthEnd[m][key] = row.close;
    monthEnd[m]._dates = { ...(monthEnd[m]._dates || {}), [key]: row.date };
  }
};

const errors = [];
for (const code of KRX) {
  try {
    const [basic, chart] = await Promise.all([
      getJson(`https://m.stock.naver.com/api/stock/${code}/basic`),
      getJson(`https://api.stock.naver.com/chart/domestic/item/${code}/day?${range}`)
    ]);
    const rows = settled(chart.map((c) => ({ date: fromCompact(c.localDate), close: num(c.closePrice) })), 'Asia/Seoul', 15 * 60 + 40);
    const last = rows[rows.length - 1], before = rows[rows.length - 2];
    items[code] = { name: basic.stockName, price: last.close, currency: 'KRW', date: last.date,
      chgPct: before ? +(((last.close / before.close) - 1) * 100).toFixed(2) : null };
    setMonthEnd(code, rows);
  } catch (e) { errors.push(`${code}: ${e.message}`); if (prev.items?.[code]) items[code] = prev.items[code]; }
}
for (const [sym, rc] of Object.entries(US)) {
  try {
    const [basic, chart] = await Promise.all([
      getJson(`https://api.stock.naver.com/stock/${rc}/basic`),
      getJson(`https://api.stock.naver.com/chart/foreign/item/${rc}/day?${range}`)
    ]);
    const rows = settled(chart.map((c) => ({ date: fromCompact(c.localDate), close: num(c.closePrice) })), 'America/New_York', 16 * 60 + 15);
    const last = rows[rows.length - 1], before = rows[rows.length - 2];
    items[sym] = { name: basic.stockName, price: last.close, currency: 'USD', date: last.date,
      chgPct: before ? +(((last.close / before.close) - 1) * 100).toFixed(2) : null };
    setMonthEnd(sym, rows);
  } catch (e) { errors.push(`${sym}: ${e.message}`); if (prev.items?.[sym]) items[sym] = prev.items[sym]; }
}
let fx = prev.fx;
try {
  let list = [];
  for (let page = 1; page <= 8; page++) {
    const chunk = await getJson(`https://api.stock.naver.com/marketindex/exchange/FX_USDKRW/prices?page=${page}&pageSize=60`);
    list = list.concat(chunk);
    if (!chunk.length || chunk[chunk.length - 1].localTradedAt < from) break;
  }
  const rows = list.map((x) => ({ date: x.localTradedAt, close: num(x.closePrice) }))
    .filter((x) => x.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  const last = rows[rows.length - 1];
  fx = { USDKRW: { price: last.close, date: last.date } };
  setMonthEnd('USDKRW', rows);
} catch (e) { errors.push(`FX: ${e.message}`); }

// Distributions / dividends per share (Yahoo Finance chart events, last 2 years)
const YH = { ...Object.fromEntries(KRX.map((c) => [c, `${c}.KS`])), ...Object.fromEntries(Object.keys(US).map((s) => [s, s])) };
const divs = { ...(prev.divs || {}) };
for (const [sym, ys] of Object.entries(YH)) {
  try {
    const path = `/v8/finance/chart/${encodeURIComponent(ys)}?range=2y&interval=1mo&events=div`;
    const j = await getJson(`https://query1.finance.yahoo.com${path}`, 2, YUA).catch(() => getJson(`https://query2.finance.yahoo.com${path}`, 2, YUA));
    const r = j.chart?.result?.[0];
    if (!r) throw new Error('no result');
    const isKR = ys.endsWith('.KS');
    const events = Object.values(r.events?.dividends || {})
      .map((e) => ({ ex: new Date(e.date * 1000 + (isKR ? 9 * 3600e3 : 0)).toISOString().slice(0, 10), amt: e.amount }))
      .sort((a, b) => a.ex.localeCompare(b.ex));
    divs[sym] = { currency: isKR ? 'KRW' : 'USD', events, src: 'Yahoo Finance', updated: ymd(today) };
  } catch (e) { errors.push(`div ${sym}: ${e.message}`); }
}

const out = {
  updated: new Date().toISOString(),
  fx, items, divs,
  monthEnd: Object.fromEntries(Object.entries(monthEnd).sort(([a], [b]) => a.localeCompare(b))),
  errors
};
fs.writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, `${v.price} ${v.date}`])), fx, months: Object.keys(out.monthEnd), errors }, null, 1));
if (Object.keys(items).length === 0) process.exit(1);
