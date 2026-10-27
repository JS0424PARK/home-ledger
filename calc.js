// Shared calculations (browser + Node). Pure functions, no DOM.

export const ym = (date) => date.slice(0, 7);

export function monthIndex(month, plan) {
  const [y, m] = month.split('-').map(Number);
  const [sy, sm] = plan.start.split('-').map(Number);
  return (y - sy) * 12 + (m - sm) + 1; // start month = 1 (first month-end payment)
}

export function monthFromIndex(i, plan) {
  const [sy, sm] = plan.start.split('-').map(Number);
  const t = sy * 12 + (sm - 1) + (i - 1);
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function bench(m, plan) {
  if (m <= 0) return 0;
  const r = plan.monthlyRate;
  return plan.monthly * ((Math.pow(1 + r, m) - 1) / r);
}

// How many months of the benchmark plan this amount equals
export function equivMonths(value, plan) {
  const r = plan.monthlyRate;
  return Math.log(1 + (value * r) / plan.monthly) / Math.log(1 + r);
}

export function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

// Price source: live prices.json or a month-end snapshot
export function livePx(prices) {
  return {
    get: (sym) => prices.items?.[sym] ? { price: prices.items[sym].price, date: prices.items[sym].date } : null,
    fx: prices.fx?.USDKRW ? { price: prices.fx.USDKRW.price, date: prices.fx.USDKRW.date } : null
  };
}

export function monthEndPx(prices, month) {
  const me = prices.monthEnd?.[month];
  if (!me) return null;
  return {
    get: (sym) => me[sym] != null ? { price: me[sym], date: me._dates?.[sym] } : null,
    fx: me.USDKRW != null ? { price: me.USDKRW, date: me._dates?.USDKRW } : null
  };
}

// Undo transactions after `date` to get holdings/cash as of that date
export function stateAt(data, date) {
  const holdings = data.holdings.map((h) => ({ ...h }));
  const cash = Object.fromEntries(Object.entries(data.cash).map(([k, v]) => [k, v.amount]));
  const byId = Object.fromEntries(holdings.map((h) => [h.id, h]));
  const later = (data.transactions || []).filter((t) => date && t.date > date);
  for (const t of later) {
    const h = t.holding ? byId[t.holding] : null;
    const acct = t.account || h?.account;
    if (t.type === 'buy' && h) {
      h.qty = (h.qty || 0) - (t.qty || 0);
      h.cost -= t.amount;
      if (t.source === 'cash') cash[acct] = (cash[acct] || 0) + t.amount;
    } else if (t.type === 'sell' && h) {
      h.qty = (h.qty || 0) + (t.qty || 0);
      h.cost += t.costOut || 0;
      cash[acct] = (cash[acct] || 0) - t.amount;
    } else if (t.type === 'deposit' || t.type === 'dividend') {
      cash[acct] = (cash[acct] || 0) - t.amount;
    } else if (t.type === 'withdraw') {
      cash[acct] = (cash[acct] || 0) + t.amount;
    }
  }
  return { holdings: holdings.filter((h) => (h.qty ?? 1) > 0 || h.qty == null), cash };
}

export function valuate(data, px, state = null) {
  const st = state || { holdings: data.holdings, cash: Object.fromEntries(Object.entries(data.cash).map(([k, v]) => [k, v.amount])) };
  const acct = Object.fromEntries(data.accounts.map((a) => [a.id, a]));
  const rows = st.holdings.map((h) => {
    const a = acct[h.account];
    let price = null, priceDate = null, value, manual = false, usd = null;
    if (h.qty == null) {
      value = h.manualValue; priceDate = h.manualDate; manual = true;
    } else {
      const p = px.get(h.symbol);
      if (h.currency === 'USD') {
        usd = p?.price ?? null;
        price = p && px.fx ? p.price * px.fx.price : null;
      } else price = p?.price ?? null;
      priceDate = p?.date ?? null;
      value = price != null ? h.qty * price : null;
    }
    const pl = value != null ? value - h.cost : null;
    return { h, a, owner: a.owner, price, usd, priceDate, value, cost: h.cost, pl, plPct: pl != null && h.cost ? (pl / h.cost) * 100 : null, manual };
  });
  const cash = Object.entries(st.cash).map(([id, amount]) => ({ a: acct[id], owner: acct[id]?.owner, amount }));
  const sum = (owner) => {
    const r = rows.filter((x) => !owner || x.owner === owner);
    const c = cash.filter((x) => !owner || x.owner === owner);
    const value = r.reduce((s, x) => s + (x.value || 0), 0);
    const cost = r.reduce((s, x) => s + x.cost, 0);
    const cashSum = c.reduce((s, x) => s + x.amount, 0);
    return { value, cost, cash: cashSum, fin: value + cashSum, pl: value - cost, plPct: cost ? ((value - cost) / cost) * 100 : 0 };
  };
  const totals = { all: sum(null) };
  for (const p of data.people) totals[p.id] = sum(p.id);
  return { rows, cash, totals };
}

// Monthly series: recorded history first, then computed month-ends, then live for the current month
export function monthlySeries(data, prices, todayMonth) {
  const plan = data.plan;
  const out = [];
  const rec = Object.fromEntries((data.history || []).map((h) => [h.month, h]));
  const startIdx = 1, endIdx = monthIndex(todayMonth, plan);
  for (let i = startIdx; i <= endIdx; i++) {
    const m = monthFromIndex(i, plan);
    const b = bench(i, plan);
    if (rec[m]) {
      const r = rec[m];
      out.push({ month: m, idx: i, bench: b, kind: 'recorded', value: r.value, cost: r.cost, cash: r.cash ?? 0, people: r.people, note: r.note, footnote: r.footnote, scope: r.scope, estimated: !!(r.estimatedCost || r.estimatedPeople) });
      continue;
    }
    if (m === todayMonth) {
      const v = valuate(data, livePx(prices));
      out.push({ month: m, idx: i, bench: b, kind: 'live', value: v.totals.all.fin, cost: v.totals.all.cost, cash: v.totals.all.cash, people: Object.fromEntries(data.people.map((p) => [p.id, { value: v.totals[p.id].fin, cost: v.totals[p.id].cost, cash: v.totals[p.id].cash }])) });
      continue;
    }
    const px = monthEndPx(prices, m);
    if (!px) continue;
    const v = valuate(data, px, stateAt(data, lastDayOfMonth(m)));
    out.push({ month: m, idx: i, bench: b, kind: 'monthEnd', value: v.totals.all.fin, cost: v.totals.all.cost, cash: v.totals.all.cash, people: Object.fromEntries(data.people.map((p) => [p.id, { value: v.totals[p.id].fin, cost: v.totals[p.id].cost, cash: v.totals[p.id].cash }])) });
  }
  return out;
}
