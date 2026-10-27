import { monthIndex, bench, equivMonths, livePx, valuate, monthlySeries } from './calc.js';

const $ = (s, el = document) => el.querySelector(s);
const S = { enc: null, data: null, prices: null, tab: 'invest', person: 'all', chart: 'month', pick: null, open: new Set() };

/* ---------- format ---------- */
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
function money(n, sign = false) {
  const s = n < 0 ? '-' : sign && n > 0 ? '+' : '';
  const a = Math.abs(n);
  let body;
  if (a >= 1e8) {
    let eok = Math.floor(a / 1e8), man = Math.round((a - eok * 1e8) / 1e4);
    if (man >= 10000) { eok += 1; man = 0; }
    body = man ? `${eok}억 ${fmt(man)}만원` : `${eok}억원`;
  } else if (a >= 1e4) body = `${fmt(a / 1e4)}만원`;
  else body = `${fmt(a)}원`;
  return s + body;
}
const won = (n, sign = false) => (n < 0 ? '-' : sign && n > 0 ? '+' : '') + fmt(Math.abs(n)) + '원';
const pct = (n, d = 2) => (n > 0 ? '+' : '') + n.toFixed(d) + '%';
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const md = (d) => { if (!d) return '-'; const [, m, dd] = d.split('-'); return dd ? `${+m}/${+dd}` : `${+m}월`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dur = (mo) => { const t = Math.round(Math.abs(mo)); const y = Math.floor(t / 12), m = t % 12; return [y ? `${y}년` : '', m ? `${m}개월` : ''].filter(Boolean).join(' ') || '0개월'; };
const short = (n) => (n >= 1e8 ? `${+(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}억` : n >= 1e4 ? `${fmt(n / 1e4)}만` : n ? fmt(n) : '0');
const kstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const thisMonth = () => kstToday().slice(0, 7);
const COLORS = { '나스닥100': '#3182F6', 'S&P500': '#56C1F5', '배당다우존스': '#FFB020', '구글': '#2FC573', '반도체 커버드콜': '#A78BFA', 'MMF': '#C3CAD3', '예수금': '#DDE2E7' };
const FALLBACK = ['#F472B6', '#2DD4BF', '#FB923C', '#818CF8', '#94A3B8'];
const colorOf = (k, i) => COLORS[k] || FALLBACK[i % FALLBACK.length];
const person = (id) => S.data.people.find((p) => p.id === id);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2200);
}

/* ---------- unlock ---------- */
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(pin) {
  const e = S.enc;
  let pass = pin;
  if (e.mode === 'link') {
    const k = localStorage.getItem('ak');
    if (!k) throw new Error('nolink');
    pass = `${k}:${pin}`;
  }
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(e.kdf.salt), iterations: e.kdf.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(e.iv) }, key, b64d(e.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

async function loadPrices() {
  S.prices = await fetch(`prices.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());
}

function initLock() {
  const hm = location.hash.match(/k=([A-Za-z0-9_-]+)/);
  if (hm) { localStorage.setItem('ak', hm[1]); history.replaceState(null, '', location.pathname + location.search); }
  let pin = '';
  const dots = $('#dots'), msg = $('#lockMsg'), lock = $('#lock');
  const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const fail = (text) => {
    msg.textContent = text; msg.classList.add('err');
    dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    pin = ''; paint();
  };
  const submit = async () => {
    lock.classList.add('busy'); msg.classList.remove('err'); msg.textContent = '여는 중이에요';
    try {
      const [data] = await Promise.all([decrypt(pin), loadPrices()]);
      S.data = data; sessionStorage.setItem('pin', pin);
      lock.hidden = true; $('#app').hidden = false; render();
    } catch (e) {
      sessionStorage.removeItem('pin');
      fail(e.message === 'nolink' ? '처음에는 가족 링크로 열어 주세요' : '비밀번호가 맞지 않아요');
    } finally { lock.classList.remove('busy'); }
  };
  const press = (k) => {
    if (k === 'del') { pin = pin.slice(0, -1); paint(); return; }
    if (pin.length >= 4) return;
    pin += k; paint();
    if (pin.length === 4) setTimeout(submit, 120);
  };
  $('#pad').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', (e) => {
    if (lock.hidden) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  });
  const saved = sessionStorage.getItem('pin');
  if (saved) { pin = saved; paint(); submit(); }
}

/* ---------- views ---------- */
function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#view').innerHTML = S.tab === 'invest' ? viewInvest() : viewTotal();
  drawChart();
  $('#foot').innerHTML = footer();
}

function chips() {
  const opts = [['all', '부부 합산'], ...S.data.people.map((p) => [p.id, p.name])];
  return `<div class="chips">${opts.map(([id, n]) => `<button class="chip ${S.person === id ? 'on' : ''}" data-person="${id}">${n}</button>`).join('')}</div>`;
}

function latestPriceDate() {
  const ds = Object.values(S.prices.items || {}).filter((x) => x.currency === 'KRW').map((x) => x.date).sort();
  return ds[ds.length - 1];
}

function viewInvest() {
  const d = S.data, p = S.person;
  const v = valuate(d, livePx(S.prices));
  const t = v.totals[p];
  const title = p === 'all' ? '부부 금융자산' : `${person(p).name} 금융자산`;
  let h = chips();
  h += `<div class="grid ${p === 'all' ? 'two' : ''}">`;
  h += `<section class="card">
    <div class="card-h" style="margin-bottom:0"><span class="label">${title}</span><span class="card-s">${md(latestPriceDate())} 종가 기준</span></div>
    <div class="big">${money(t.fin)}</div>
    <div class="pl ${cls(t.pl)}">${money(t.pl, true)} <span>(${pct(t.plPct)})</span></div>
    <div class="kv">
      <div><span>투자원금</span><b>${money(t.cost)}</b></div>
      <div><span>주식·펀드</span><b>${money(t.value)}</b></div>
      <div><span>예수금</span><b>${money(t.cash)}</b></div>
    </div>
  </section>`;
  if (p === 'all') h += planCard(v.totals.all.fin);
  h += `</div>`;
  h += `<div class="stack" style="margin-top:12px">`;
  h += chartCard();
  h += weightsCard(v);
  h += `</div>`;
  h += accountsBlock(v);
  h += `<div class="stack" style="margin-top:12px">${recordsCard()}${checksCard()}</div>`;
  return h;
}

function planCard(fin) {
  const plan = S.data.plan;
  const mi = monthIndex(thisMonth(), plan);
  const b = bench(mi, plan);
  const lead = equivMonths(fin, plan) - mi;
  const rate = (fin / plan.target) * 100;
  const left = plan.months - mi;
  const leadText = lead >= 0 ? `계획보다 <em>${dur(lead)}</em> 앞서 있어요` : `계획보다 <em>${dur(lead)}</em> 늦어요`;
  return `<section class="card">
    <div class="card-h" style="margin-bottom:6px"><span class="label">노후 계획</span><span class="card-s">목표 ${(plan.target / 1e8).toFixed(2)}억 · ${plan.endLabel}</span></div>
    <div class="lead">${leadText}</div>
    <div class="bar"><i style="width:${Math.min(100, rate).toFixed(2)}%"></i></div>
    <div class="row-2" style="margin:0"><span>달성률 <b class="sub">${rate.toFixed(1)}%</b></span><span>남은 기간 ${dur(left)}</span></div>
    <div class="kv">
      <div><span>이번 달 계획 금액</span><b>${money(b)}</b></div>
      <div><span>계획 대비</span><b class="${cls(fin - b)}">${money(fin - b, true)}</b></div>
    </div>
    <p class="note">계획은 2026년 8월부터 0원에서 매달 100만원씩, 월 1.2% 복리(연 14.4% ÷ 12)로 쌓는 비교선이에요. 미래 수익률 예상이 아니에요.</p>
  </section>`;
}

function chartCard() {
  const all = S.person === 'all';
  const seg = all ? `<div class="seg"><button data-chart="month" class="${S.chart === 'month' ? 'on' : ''}">월별</button><button data-chart="plan" class="${S.chart === 'plan' ? 'on' : ''}">20년</button></div>` : '';
  const mode = all ? S.chart : 'month';
  if (mode === 'plan') {
    return `<section class="card">
      <div class="card-h"><span class="card-t">자산 흐름</span>${seg}</div>
      <div class="legend"><span><i class="line" style="background:#3182F6"></i>우리 자산</span><span><i class="line" style="background:var(--plan)"></i>계획 (0원·월 100만원)</span></div>
      <div class="chart" id="chart"></div>
      <div id="pick"></div>
    </section>`;
  }
  return `<section class="card">
    <div class="card-h" style="margin-bottom:10px"><span class="card-t">자산 흐름</span>${seg}</div>
    <div id="flowHead"></div>
    <div class="chart" id="chart"></div>
    <div id="flowTiles"></div>
    <div id="flowTable"></div>
  </section>`;
}

function series() {
  return monthlySeries(S.data, S.prices, thisMonth());
}

function drawChart() {
  const el = $('#chart');
  if (!el) return;
  const all = S.person === 'all';
  const mode = all ? S.chart : 'month';
  const W = Math.max(280, el.clientWidth);
  if (mode === 'month') drawFlow(el, W);
  else drawPlan(el, series(), W, 230);
}

function niceMax(v) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * e >= v) return s * e;
  return 10 * e;
}

const FL = { cost: '#C5CCD4', costLine: '#9AA3AE', line: '#3182F6', pl: '#8CBBFA', loss: '#F7B3BB', cash: '#CFE2FD' };
const manS = (n) => (Math.abs(n) < 1e4 ? `${fmt(Math.abs(n))}원` : `${fmt(Math.abs(n) / 1e4)}만`);
const smanS = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + manS(n);
function monthName(m) {
  const [yy, mm] = m.split('-');
  return yy === thisMonth().slice(0, 4) ? `${+mm}월` : `${yy.slice(2)}년 ${+mm}월`;
}
function flowKind(p) {
  if (p.kind === 'live') return '오늘 기준';
  if (p.kind === 'monthEnd') return '월말 종가 기준';
  return p.scope === 'stocks' ? '주식만 · 일부 추정' : '계좌 점검 기록';
}

function flowPoints() {
  const who = S.person;
  return series().map((s) => {
    const src = who === 'all' ? s : (s.people?.[who] || { value: 0, cost: 0, cash: 0 });
    const v = src.value || 0, c = src.cost || 0, cash = src.cash || 0;
    return { ...s, v, c, cash, pl: v - cash - c };
  });
}

function drawFlow(el, W) {
  const allPts = flowPoints();
  if (!allPts.length) { el.innerHTML = '<p class="empty">아직 기록이 없어요</p>'; return; }
  if (!S.pick || !allPts.find((x) => x.month === S.pick)) S.pick = allPts[allPts.length - 1].month;
  let pts = allPts.slice(-12);
  const single = pts.length === 1;
  if (single) pts = [pts[0], pts[0]];
  const n = pts.length, H = 220, L = 4, R = 4, T = 30, B = 26;
  const yMax = niceMax(Math.max(...pts.map((p) => Math.max(p.v, p.c))) * 1.12);
  const inner = W - L - R - 56;
  const x = (i) => L + 28 + inner * (i / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - Math.max(0, v) / yMax);
  const base = y(0);
  const band = (top, bot) => pts.map((p, i) => `${x(i).toFixed(1)},${y(top(p)).toFixed(1)}`)
    .concat(pts.map((p, i) => `${x(i).toFixed(1)},${y(bot(p)).toFixed(1)}`).reverse()).join(' ');
  const hasLoss = pts.some((p) => p.pl < 0);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 자산 흐름">`;
  for (const t of [0, yMax / 2, yMax]) s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#F2F4F6"/>`;
  s += `<polygon points="${band((p) => Math.min(p.c, p.c + p.pl), () => 0)}" fill="${FL.cost}" opacity=".55"/>`;
  s += `<polygon points="${band((p) => p.c + Math.max(p.pl, 0), (p) => p.c)}" fill="${FL.pl}" opacity=".85"/>`;
  if (hasLoss) s += `<polygon points="${band((p) => p.c, (p) => p.c + Math.min(p.pl, 0))}" fill="${FL.loss}" opacity=".8"/>`;
  s += `<polygon points="${band((p) => p.v, (p) => p.c + p.pl)}" fill="${FL.cash}"/>`;
  s += `<polyline points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ')}" fill="none" stroke="${FL.costLine}" stroke-width="1.5"/>`;
  s += `<polyline points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${FL.line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  // band labels at the latest month
  const last = pts[n - 1], lx = x(n - 1) - 10;
  const plTop = y(last.c + Math.max(last.pl, 0)), plBot = y(last.c + Math.min(last.pl, 0));
  if (Math.abs(plBot - plTop) >= 17) {
    s += `<text x="${lx}" y="${(plTop + plBot) / 2 + 4.5}" text-anchor="end" font-size="12.5" font-weight="700" fill="${last.pl >= 0 ? '#1B64DA' : '#D22030'}">${last.pl >= 0 ? '손익' : '손실'} ${smanS(last.pl)}</text>`;
  }
  const costTop = y(Math.min(last.c, last.c + last.pl));
  if (base - costTop >= 20) s += `<text x="${lx}" y="${(costTop + base) / 2 + 4.5}" text-anchor="end" font-size="12.5" font-weight="700" fill="#4E5968">원금 ${manS(last.c)}</text>`;
  // points, labels, hit areas
  const selIdx = single ? 1 : pts.findIndex((p) => p.month === S.pick);
  if (selIdx >= 0) s += `<line x1="${x(selIdx)}" x2="${x(selIdx)}" y1="${T - 6}" y2="${base}" stroke="#191F28" stroke-opacity=".18" stroke-dasharray="3 3"/>`;
  const step = Math.ceil(n / 6);
  pts.forEach((p, i) => {
    if (single && i === 0) return;
    const on = i === selIdx, isLast = i === n - 1;
    s += `<circle cx="${x(i)}" cy="${y(p.v)}" r="${on ? 5.5 : 4}" fill="${on ? FL.line : '#fff'}" stroke="${FL.line}" stroke-width="2"/>`;
    if (n <= 6 || on || isLast) s += `<text x="${x(i)}" y="${y(p.v) - 11}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${on ? FL.line : '#4E5968'}">${manS(p.v)}</text>`;
    if ((n - 1 - i) % step === 0 || on) s += `<text x="${x(i)}" y="${H - 5}" text-anchor="middle" font-size="12.5" font-weight="${on ? 700 : 500}" fill="${on ? '#191F28' : '#8B95A1'}">${monthName(p.month)}</text>`;
    const hw = single ? inner : inner / (n - 1);
    s += `<rect x="${x(i) - hw / 2}" y="0" width="${hw}" height="${H}" fill="transparent" data-m="${p.month}" style="cursor:pointer"/>`;
  });
  el.innerHTML = s + '</svg>';

  // head: selected month value + change
  const si = allPts.findIndex((p) => p.month === S.pick);
  const sel = allPts[si], prev = si > 0 ? allPts[si - 1] : null;
  const d = prev ? sel.v - prev.v : null;
  $('#flowHead').innerHTML = `<div class="fl-label">${monthName(sel.month)} · ${flowKind(sel)}</div>
    <div class="fl-big">${money(sel.v)}</div>
    <div class="fl-delta ${d == null ? 'muted' : cls(d)}">${d == null ? '기록을 시작한 달이에요' : `${monthName(prev.month)}보다 ${money(d, true)} (${pct((d / prev.v) * 100, 1)})`}</div>`;

  // tiles = legend for the selected month
  $('#flowTiles').innerHTML = `<div class="tiles">
    <div class="tile"><span><i style="background:${FL.cost}"></i>투자원금</span><b>${manS(sel.c)}</b><small class="muted">넣은 돈</small></div>
    <div class="tile"><span><i style="background:${sel.pl >= 0 ? FL.pl : FL.loss}"></i>평가손익</span><b class="${cls(sel.pl)}">${smanS(sel.pl)}</b><small class="${cls(sel.pl)}">${sel.c ? pct((sel.pl / sel.c) * 100, 1) : '-'}</small></div>
    <div class="tile"><span><i style="background:${FL.cash}"></i>예수금</span><b>${manS(sel.cash)}</b><small class="muted">투자 대기</small></div>
  </div>`;

  // monthly table (latest first)
  const rows = allPts.map((p, i) => ({ p, prev: i > 0 ? allPts[i - 1] : null })).reverse();
  const shown = S.moreMonths ? rows : rows.slice(0, 6);
  const notes = [...new Set(allPts.map((p) => p.footnote).filter(Boolean))];
  $('#flowTable').innerHTML = `<table class="ftable">
    <tr><th>월</th><th>평가액</th><th>평가손익</th><th>지난달 대비</th></tr>
    ${shown.map(({ p, prev: pv }) => {
      const dd = pv ? p.v - pv.v : null;
      return `<tr data-m="${p.month}" class="${p.month === S.pick ? 'sel' : ''} ${p.kind === 'live' ? 'now' : ''}">
        <td>${monthName(p.month)}${p.kind === 'live' ? '<small class="muted">오늘</small>' : ''}</td>
        <td>${manS(p.v)}</td>
        <td class="${cls(p.pl)}">${smanS(p.pl)}<small>${p.c ? pct((p.pl / p.c) * 100, 1) : '-'}</small></td>
        <td class="${dd == null ? 'muted' : cls(dd)}">${dd == null ? '-' : `${smanS(dd)}<small>${pct((dd / pv.v) * 100, 1)}</small>`}</td>
      </tr>`;
    }).join('')}
  </table>
  ${rows.length > 6 ? `<button class="more" data-more="1">${S.moreMonths ? '접기' : `지난 기록 더보기 (${rows.length - 6}개월)`}</button>` : ''}
  ${notes.length ? `<p class="note">${notes.map(esc).join(' ')}</p>` : ''}`;
}

function drawPlan(el, ser, W, H) {
  const plan = S.data.plan;
  const L = 44, R = 10, T = 14, B = 26;
  const max = plan.target * 1.08;
  const x = (i) => L + (W - L - R) * (i / plan.months);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="20년 계획 그래프">`;
  for (const val of [0, 5e8, 1e9]) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(val)}" y2="${y(val)}" stroke="#EEF0F3"/>`;
    s += `<text x="${L - 8}" y="${y(val) + 4}" text-anchor="end" font-size="11" fill="#8B95A1">${short(val)}</text>`;
  }
  s += `<line x1="${L}" x2="${W - R}" y1="${y(plan.target)}" y2="${y(plan.target)}" stroke="#FF9F43" stroke-dasharray="3 4" opacity=".7"/>`;
  s += `<text x="${L + 4}" y="${y(plan.target) - 6}" font-size="11.5" fill="#E8590C" font-weight="600">목표 ${(plan.target / 1e8).toFixed(2)}억</text>`;
  let d = `M${x(0)},${y(0)}`;
  for (let i = 1; i <= plan.months; i++) d += ` L${x(i).toFixed(1)},${y(bench(i, plan)).toFixed(1)}`;
  s += `<path d="${d} L${x(plan.months)},${y(0)} Z" fill="#FFF3E6"/>`;
  s += `<path d="${d}" fill="none" stroke="#FF9F43" stroke-width="2"/>`;
  for (const [i, yr] of [[0, 2026], [60, 2031], [120, 2036], [180, 2041], [240, 2046]]) {
    s += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 240 ? 'end' : 'middle'}" font-size="11.5" fill="#8B95A1">${yr}</text>`;
  }
  const pts = ser.map((p) => [x(p.idx), y(p.value)]);
  if (pts.length) {
    s += `<polyline points="${pts.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#3182F6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    const [lx, ly] = pts[pts.length - 1];
    s += `<circle cx="${lx}" cy="${ly}" r="5" fill="#3182F6" stroke="#fff" stroke-width="2"/>`;
  }
  s += '</svg>';
  el.innerHTML = s;
  const last = ser[ser.length - 1];
  const finalBench = bench(plan.months, plan);
  $('#pick').innerHTML = `<div class="pick">
    <div class="pick-row"><span>지금 우리 자산</span><b>${money(last.value)}</b></div>
    <div class="pick-row"><span>계획대로면 2046년</span><b>${money(finalBench)}</b></div>
    <div class="pick-row"><span>지금 자산은 계획의</span><b>${Math.round(equivMonths(last.value, plan))}개월차 수준</b></div>
  </div>`;
}

function weightsOf(v, owner) {
  const g = new Map();
  for (const r of v.rows.filter((x) => x.owner === owner)) g.set(r.h.short, (g.get(r.h.short) || 0) + (r.value || 0));
  const cash = v.cash.filter((c) => c.owner === owner).reduce((s, c) => s + c.amount, 0);
  const list = [...g.entries()].map(([k, val]) => ({ k, val })).sort((a, b) => (a.k === 'MMF') - (b.k === 'MMF') || b.val - a.val);
  if (cash > 0) list.push({ k: '예수금', val: cash });
  const total = list.reduce((s, x) => s + x.val, 0);
  return { list, total };
}

function weightsCard(v) {
  const ids = S.person === 'all' ? S.data.people.map((p) => p.id) : [S.person];
  const blocks = ids.map((id) => {
    const { list, total } = weightsOf(v, id);
    const bar = list.map((x, i) => `<i style="width:${(x.val / total) * 100}%;background:${colorOf(x.k, i)}"></i>`).join('');
    const rows = list.map((x, i) => `<div class="wrow"><i style="background:${colorOf(x.k, i)}"></i><span>${esc(x.k)}</span><span class="amt">${money(x.val)}</span><span class="p">${((x.val / total) * 100).toFixed(1)}%</span></div>`).join('');
    return `<div><div class="who"><b>${person(id).name}</b><span>${money(total)}</span></div><div class="stackbar">${bar}</div><div class="wlist">${rows}</div></div>`;
  }).join('');
  return `<section class="card"><div class="card-h"><span class="card-t">투자 비중</span><span class="card-s">평가액 기준 · 같은 종목은 합쳐서</span></div><div class="people ${ids.length > 1 ? 'two' : ''}">${blocks}</div></section>`;
}

function accountsBlock(v) {
  const ids = S.person === 'all' ? S.data.people.map((p) => p.id) : [S.person];
  let h = '';
  for (const id of ids) {
    const accts = S.data.accounts.filter((a) => a.owner === id);
    h += `<div class="owner-h"><b>${person(id).name}의 계좌</b><span>${money(v.totals[id].fin)}</span></div><div class="stack">`;
    for (const a of accts) h += accountCard(a, v);
    h += '</div>';
  }
  return h;
}

function accountCard(a, v) {
  const rows = v.rows.filter((r) => r.a.id === a.id);
  const cash = v.cash.find((c) => c.a.id === a.id)?.amount || 0;
  const val = rows.reduce((s, r) => s + (r.value || 0), 0) + cash;
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const pl = rows.reduce((s, r) => s + (r.value || 0), 0) - cost;
  const fx = S.prices.fx?.USDKRW?.price;
  let h = `<section class="card acct"><div class="acct-h"><div class="acct-n">${esc(a.broker)} · ${esc(a.label)}</div>
    <div class="acct-v"><b>${won(val)}</b>${cost ? `<span class="${cls(pl)}">${pct((pl / cost) * 100)}</span>` : ''}</div></div>`;
  for (const r of rows) {
    const h0 = r.h, open = S.open.has(h0.id);
    const tag = h0.estimated ? '<span class="tag est">수량 추정</span>' : r.manual ? '<span class="tag man">직접 점검</span>' : '';
    const qty = h0.qty != null
      ? `${fmt(h0.qty)}주 · 평균 ${h0.currency === 'USD' && h0.avgUsd ? '$' + h0.avgUsd.toFixed(2) : won(h0.cost / h0.qty)}`
      : `${md(h0.manualDate)} 평가액`;
    const price = r.manual ? '계좌 화면 값' : h0.currency === 'USD' ? `$${r.usd?.toFixed(2)} (${won(r.price)})` : won(r.price);
    h += `<button class="row ${open ? 'open' : ''}" data-row="${h0.id}">
      <div class="row-1"><b>${esc(h0.name)}</b><span class="v">${r.value != null ? won(r.value) : '-'}</span></div>
      <div class="row-2"><span>${qty}${tag}</span><span class="${cls(r.pl)}">${r.pl != null ? `${won(r.pl, true)} (${pct(r.plPct)})` : ''}</span></div>
      <div class="row-d">
        <div><span>투자원금</span><b>${won(r.cost)}</b></div>
        <div><span>현재가</span><b>${price}</b></div>
        <div><span>가격 기준일</span><b>${md(r.priceDate)}</b></div>
        ${h0.currency === 'USD' && fx ? `<div><span>환율</span><b>${fx.toLocaleString('ko-KR')}원 (${md(S.prices.fx.USDKRW.date)})</b></div>` : ''}
        ${h0.note ? `<p>${esc(h0.note)}</p>` : ''}
      </div>
    </button>`;
  }
  if (cash > 0 || !rows.length) h += `<div class="cashrow"><span>예수금</span><b class="num">${won(cash)}</b></div>`;
  if (a.info?.length) h += `<details class="info"><summary>계좌 정보</summary><ul>${a.info.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
  return h + '</section>';
}

const TX = { buy: '매수', sell: '매도', deposit: '입금', withdraw: '출금', dividend: '배당', check: '계좌 점검' };
function recordsCard() {
  const tx = [...(S.data.transactions || [])].filter((t) => S.person === 'all' || ownerOfTx(t) === S.person).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const hs = Object.fromEntries(S.data.holdings.map((h) => [h.id, h]));
  const body = tx.length
    ? tx.map((t) => {
      const h = hs[t.holding];
      const what = h ? `${h.short}${t.qty ? ` ${fmt(t.qty)}주` : ''}` : '';
      return `<div class="list-row"><div><b>${TX[t.type] || t.type}${what ? ` · ${esc(what)}` : ''}</b><div class="card-s">${md(t.date)} · ${person(ownerOfTx(t))?.short || ''}${t.memo ? ` · ${esc(t.memo)}` : ''}</div></div><b class="num">${t.amount != null ? won(t.amount) : ''}</b></div>`;
    }).join('')
    : '<p class="empty">아직 기록이 없어요. 매수·매도·입금은 채팅으로 알려주시면 반영할게요.</p>';
  return `<section class="card"><div class="card-h"><span class="card-t">최근 기록</span></div>${body}</section>`;
}
function ownerOfTx(t) {
  const h = S.data.holdings.find((x) => x.id === t.holding);
  const acct = t.account || h?.account;
  return S.data.accounts.find((a) => a.id === acct)?.owner;
}

function checksCard() {
  const c = S.data.checks || [];
  if (!c.length) return '';
  return `<section class="card"><details class="checks"><summary><span class="card-t">확인이 필요한 숫자</span><span class="cnt">${c.length}개</span></summary><ol>${c.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details></section>`;
}

function viewTotal() {
  const d = S.data;
  const v = valuate(d, livePx(S.prices));
  const fin = v.totals.all.fin, prop = d.property.value;
  const debt = d.debts.reduce((s, x) => s + x.amount, 0);
  const total = fin + prop, net = total - debt;
  const pp = (prop / total) * 100;
  const year = kstToday().slice(0, 4);
  const rows = [...(d.annual || [])].filter((a) => a.year !== year).sort((a, b) => a.year.localeCompare(b.year));
  let h = `<div class="grid two">`;
  h += `<section class="card">
    <span class="label">우리 집 순자산</span>
    <div class="big">${money(net)}</div>
    <div class="card-s" style="margin-top:4px">총자산 ${money(total)} − 부채 ${money(debt)}</div>
    <div class="comp"><i style="width:${pp}%;background:#3182F6"></i><i style="width:${100 - pp}%;background:#56C1F5"></i></div>
    <div class="stat"><span><i style="background:#3182F6"></i>부동산</span><b>${money(prop)} <span class="muted" style="font-weight:500">${pp.toFixed(1)}%</span></b></div>
    <div class="stat"><span><i style="background:#56C1F5"></i>금융자산</span><b>${money(fin)} <span class="muted" style="font-weight:500">${(100 - pp).toFixed(1)}%</span></b></div>
    <div class="stat"><span><i style="background:#F04452"></i>부채</span><b>-${money(debt)}</b></div>
    <div class="stat sum"><span>순자산</span><b>${money(net)}</b></div>
  </section>`;
  h += `<div class="stack" style="margin-top:0">`;
  h += `<section class="card">
    <div class="card-h"><span class="card-t">우리 집</span><span class="card-s">${esc(d.property.name)}</span></div>
    <div class="stat"><span>매입 금액</span><b>${money(d.property.cost)}</b></div>
    <div class="stat"><span>현재 평가액</span><b>${money(prop)}</b></div>
    <div class="stat sum"><span>매입 대비</span><b class="${cls(prop - d.property.cost)}">${money(prop - d.property.cost, true)}</b></div>
    <p class="note">${esc(d.property.valueNote)}</p>
  </section>`;
  h += `<section class="card"><div class="card-h"><span class="card-t">부채</span></div>
    ${d.debts.map((x) => `<div class="stat"><span>${esc(x.name)}</span><b>${money(x.amount)}</b></div><p class="note" style="margin-top:0">${esc(x.note || '')} · ${md(x.date)} 기준</p>`).join('')}
  </section>`;
  h += `</div></div>`;
  h += `<section class="card" style="margin-top:12px"><div class="card-h"><span class="card-t">연도별 기록</span><span class="card-s">해마다 연말 기준으로 저장</span></div>
    <table class="yr"><thead><tr><th>연도</th><th>총자산</th><th>부채</th><th>순자산</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td>${a.year}</td><td>${short(a.total)}</td><td>${short(a.debt)}</td><td><b>${short(a.net)}</b></td></tr>`).join('')}
    <tr><td>${year} <span class="muted">지금</span></td><td>${(total / 1e8).toFixed(2)}억</td><td>${(debt / 1e8).toFixed(2)}억</td><td><b>${(net / 1e8).toFixed(2)}억</b></td></tr>
    </tbody></table></section>`;
  return h;
}

function footer() {
  const it = S.prices.items || {};
  const krDate = latestPriceDate();
  const us = it.GOOGL?.date;
  const fx = S.prices.fx?.USDKRW;
  const up = S.prices.updated ? (() => { const k = new Date(new Date(S.prices.updated).getTime() + 9 * 3600e3).toISOString(); return `${+k.slice(5, 7)}/${+k.slice(8, 10)} ${k.slice(11, 16)}`; })() : '-';
  return `가격 · 국내 ETF ${md(krDate)} 종가 · 구글 ${md(us)} 종가(미국)${fx ? ` · 환율 ${fx.price.toLocaleString('ko-KR')}원 (${md(fx.date)})` : ''}<br>
  가격 자동 갱신 매일 오후 4시 30분 · 마지막 갱신 ${up}<br>
  계좌 점검 ${S.data.checked?.replace(/-/g, '.')} · 자료 수정 ${S.data.updated?.replace(/-/g, '.')}`;
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-person],[data-chart],[data-m],[data-row],[data-more],#refreshBtn');
  if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; render(); window.scrollTo({ top: 0 }); }
  else if (t.dataset.person) { S.person = t.dataset.person; S.pick = null; render(); }
  else if (t.dataset.chart) { S.chart = t.dataset.chart; render(); }
  else if (t.dataset.m) { S.pick = t.dataset.m; drawChart(); }
  else if (t.dataset.more) { S.moreMonths = !S.moreMonths; drawChart(); }
  else if (t.dataset.row) { const id = t.dataset.row; S.open.has(id) ? S.open.delete(id) : S.open.add(id); t.classList.toggle('open'); }
  else if (t.id === 'refreshBtn') {
    t.classList.add('spin');
    try { await loadPrices(); render(); toast('최신 가격을 불러왔어요'); } catch { toast('가격을 불러오지 못했어요'); }
    t.classList.remove('spin');
  }
});
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('#chart [data-m]');
  if (t && t.dataset.m !== S.pick) { S.pick = t.dataset.m; drawChart(); }
});
let lastW = 0;
window.addEventListener('resize', () => {
  const w = $('#chart')?.clientWidth || 0;
  if (Math.abs(w - lastW) > 20) { lastW = w; drawChart(); }
});

(async function boot() {
  try {
    S.enc = await fetch(`data.enc.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());
  } catch {
    $('#lockMsg').textContent = '자료를 불러오지 못했어요. 잠시 후 다시 열어 주세요.';
    return;
  }
  initLock();
})();
