// Portfel — aplikacja w przeglądarce. Wszystkie dane są odszyfrowywane wyłącznie tutaj, w pamięci telefonu.
import * as V from './vault.js';

// ============================================================== pomocnicze

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const WORKFLOW = 'aktualizacja.yml';

const S = {
  meta: null, config: {}, key: null, doc: null, data: null, remembered: false,
  view: 'portfolio', acct: 'all', sort: 'value', chartMode: 'value', range: 'all',
  openFirm: new Set(), showAllFirms: new Set(), hide: false,
  newSince: 0, recsVisited: false, sheet: null, hiddenAt: 0,
  pcRange: '5y', openCo: new Set(), bench: '^NDX',
};

const LS = {
  get(k) { try { return localStorage.getItem('pf.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('pf.' + k, v); } catch { /* prywatny tryb */ } },
  del(k) { try { localStorage.removeItem('pf.' + k); } catch { /* */ } },
};

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('portfel', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
const idbGet = (k) => idbOp('readonly', (s) => s.get(k)).catch(() => null);
const idbSet = (k, v) => idbOp('readwrite', (s) => s.put(v, k)).catch(() => null);
const idbDel = (k) => idbOp('readwrite', (s) => s.delete(k)).catch(() => null);

// ---------- formatowanie (polskie)
const CUR = { PLN: 'zł', USD: 'USD', EUR: 'EUR', GBP: 'GBP', KRW: 'KRW' };
const nfCache = {};
function nf(d) { return (nfCache[d] ||= new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d })); }
const MINUS = '−';
function money(v, cur = 'PLN', digits) {
  if (v == null || !isFinite(v)) return '—';
  if (S.hide) return '•••• ' + (CUR[cur] || cur);
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return (v < 0 ? MINUS : '') + nf(d).format(Math.abs(v)) + ' ' + (CUR[cur] || cur);
}
function signedMoney(v, cur = 'PLN', digits) {
  if (v == null || !isFinite(v)) return '—';
  if (S.hide) return '•••';
  return (v > 0 ? '+' : '') + money(v, cur, digits);
}
function price(v, cur) {
  if (v == null || !isFinite(v)) return '—';
  const d = Math.abs(v) >= 1000 ? 0 : 2;
  return nf(d).format(v) + ' ' + (CUR[cur] || cur || '');
}
// cena docelowa: bez groszy od 100, waluta raz na końcu („970 → 890 USD”)
const tnum = (v) => (v == null ? '—' : nf(Math.abs(v) >= 100 ? 0 : 2).format(v));
const target = (v, cur) => (v == null ? '—' : `${tnum(v)}\u00a0${CUR[cur] || cur || ''}`);
const targetMove = (from, to, cur) => (from && from !== to ? `${tnum(from)} → ${target(to, cur)}` : target(to, cur));
function pct(f, digits = 1) {
  if (f == null || !isFinite(f)) return '—';
  const v = f * 100;
  const s = nf(digits).format(Math.abs(v)) + '%';
  if (Math.abs(v) < 0.05) return s;
  return (v > 0 ? '+' : MINUS) + s;
}
function qtyFmt(q) {
  if (q == null) return '—';
  if (S.hide) return '•••';
  const d = Math.abs(q - Math.round(q)) < 1e-9 ? 0 : 4;
  return nf(d).format(q);
}
const cls = (v) => (v == null || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'gain' : 'loss');
const dateFmt = (ms) => new Date(ms).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = (ms) => new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
const dtFmt = (ms) => new Date(ms).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function compact(v) {
  if (S.hide) return '•••';
  return new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 }).format(v).replace('-', MINUS);
}

// ---------- ikony
const ICON = {
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4.5V9h-4.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.7 3.4M6.4 7.6A15.6 15.6 0 0 0 2.5 12S6 18 12 18c1.6 0 3-.4 4.2-1"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M15.5 15h2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  pie: '<path d="M12 3.5v8.5h8.5"/><path d="M20.4 14.5A8.5 8.5 0 1 1 9.5 3.9"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4.5a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5H10"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const DIAL = `<svg class="dial" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36" fill="#151d2b" stroke="#c9a45c" stroke-width="2"/>${
  Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; const r1 = i % 6 ? 31 : 28; return `<line x1="${40 + Math.sin(a) * r1}" y1="${40 - Math.cos(a) * r1}" x2="${40 + Math.sin(a) * 34}" y2="${40 - Math.cos(a) * 34}" stroke="#c9a45c" stroke-width="${i % 6 ? 1 : 2}"/>`; }).join('')
}<circle cx="40" cy="40" r="17" fill="#1c2636" stroke="#263247"/><polyline points="30,46 37,40 42,43 51,33" fill="none" stroke="#2fa98a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- oceny analityków (ta sama logika co engine/ratings.py)
function bucket(g) {
  g = String(g || '').trim();
  if (!g) return 'na';
  if (/sell|underperform|underweight|reduce|negative|cautious|below average/i.test(g)) return 'sell';
  if (/buy|outperform|overweight|positive|accumulate|\badd\b|top pick|conviction|above average/i.test(g)) return 'buy';
  return 'hold';
}
const BUCKET_PL = { buy: 'Kupuj', hold: 'Trzymaj', sell: 'Sprzedaj', na: 'Brak' };
const ACT_PL = { up: 'podwyższenie', down: 'obniżenie', main: 'podtrzymanie', reit: 'potwierdzenie', init: 'nowa rekomendacja' };
const pill = (b, text) => `<span class="pill"><i class="b-${b}"></i>${esc(text || BUCKET_PL[b])}</span>`;

// ============================================================== obliczenia (te same wzory co engine/portfolio.py)

function ratesFromFx(fx, which) {
  const o = { PLN: 1 };
  for (const [c, v] of Object.entries(fx || {})) { const x = v[which] ?? v.r; if (x) o[c] = +x; }
  return o;
}
function rate(r, a, b) { if (a === b) return 1; return r[a] && r[b] ? r[a] / r[b] : null; }
const quotes = () => S.data?.quotes || {};
const accounts = () => S.doc?.accounts || [];
const accById = (id) => accounts().find((a) => a.id === id);
const openPositions = () => (S.doc?.positions || []).filter((p) => !p.closed);

// prowizja za przewalutowanie przy sprzedaży (ta sama logika co engine/portfolio.py: fx_fee)
function feePct(acc) {
  if (!acc) return 0;
  const v = acc.fxFeePct ?? (acc.id === 'xtb' ? 0.5 : 0);
  return Math.max(0, +v || 0);
}
function fxFee(p, qc, cc) { return qc === cc ? 0 : feePct(accById(p.account)) / 100; }
// dopasowanie do wyceny brokera: mnożnik ustawiony z wartości podanej przez użytkownika (zastępuje prowizję)
const validAdj = (v) => (v != null && isFinite(v) && v > 0.9 && v < 1.1 ? +v : null);

function qtyOf(p) {
  if (p.qty != null && p.qty !== '') return [+p.qty, false];
  const c = S.data?.calib?.[p.id];
  return c?.qty ? [+c.qty, true] : [null, true];
}

// położenie kursu w zakresie 52 tygodni: 'low' = do 3% nad minimum, 'high' = do 3% pod maksimum
const RANGE_NEAR = 0.03;
function range52(q) {
  if (!q?.low52 || !q?.high52 || !q.price) return null;
  if (q.price <= q.low52 * (1 + RANGE_NEAR)) return 'low';
  if (q.price >= q.high52 * (1 - RANGE_NEAR)) return 'high';
  return null;
}
const RANGE_PILL = { low: '<span class="r52 low">dołek 52 tyg.</span>', high: '<span class="r52 high">szczyt 52 tyg.</span>' };

function metrics(p) {
  const q = quotes()[p.symbol];
  const [qty, est] = qtyOf(p);
  if (!q || q.price == null || qty == null) return null;
  const now = ratesFromFx(S.data?.fx, 'r');
  const qc = q.currency || 'USD';
  const cc = p.costCurrency || qc;
  const rNow = rate(now, qc, cc); const toPln = rate(now, cc, 'PLN');
  if (rNow == null || toPln == null) return null;
  const fee = fxFee(p, qc, cc);
  const adj = validAdj(p.adj);
  const keep = adj ?? 1 - fee; // wartość jak u brokera: dopasowanie albo „na rękę” po przewalutowaniu
  const rawCC = qty * q.price * rNow;
  const valueCC = rawCC * keep;
  const costCC = +p.cost || 0;
  const pnlCC = valueCC - costCC;
  // zmiana na ostatniej sesji: ruch ceny akcji wyceniony po bieżącym kursie (jak engine/portfolio.py)
  const dayCC = q.prevClose ? qty * (q.price - q.prevClose) * rNow * keep : null;
  const prevValue = dayCC != null ? valueCC - dayCC : null;
  return {
    qty, est, fee, adj, keep, rawCC, price: q.price, prevClose: q.prevClose, qc, cc, stale: !!q.stale,
    valueCC, costCC, pnlCC, pnlPct: costCC ? pnlCC / costCC : null,
    dayCC, dayPct: dayCC != null && prevValue ? dayCC / prevValue : null,
    valuePLN: valueCC * toPln, costPLN: costCC * toPln, pnlPLN: pnlCC * toPln, dayPLN: dayCC != null ? dayCC * toPln : null,
    priceDayPct: q.prevClose ? q.price / q.prevClose - 1 : null,
    low52: q.low52 || null, high52: q.high52 || null,
    range52: range52(q),
  };
}

// sumy dla widoku: 'all' -> PLN, rachunek -> waluta rachunku (+PLN)
function totals(acct) {
  const now = ratesFromFx(S.data?.fx, 'r');
  const cur = acct === 'all' ? 'PLN' : accById(acct)?.currency || 'PLN';
  const t = { cur, v: 0, c: 0, d: 0, vPLN: 0, n: 0, missing: 0 };
  for (const p of openPositions()) {
    if (acct !== 'all' && p.account !== acct) continue;
    const m = metrics(p);
    if (!m) { t.missing++; continue; }
    const r = rate(now, m.cc, cur) || 0;
    t.v += m.valueCC * r; t.c += m.costCC * r; t.d += (m.dayCC || 0) * r; t.vPLN += m.valuePLN; t.n++;
  }
  return t;
}

// ============================================================== ładowanie danych

async function fetchJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function boot() {
  S.pcRange = PC_RANGES.some(([k]) => k === LS.get('pcRange')) ? LS.get('pcRange') : '5y';
  { const b = LS.get('bench'); S.bench = b === 'none' ? '' : BENCH[b] ? b : '^NDX'; }
  S.config = (await fetchJSON('config.json').catch(() => null)) || {};
  const siteMeta = await fetchJSON('vault/meta.json').catch(() => null);
  let localMeta = null;
  try { localMeta = JSON.parse(LS.get('meta') || 'null'); } catch { /* */ }
  S.meta = siteMeta || localMeta;
  if (!S.meta) return renderSetup();
  const rem = await idbGet('key');
  if (rem && rem.exp > Date.now() && rem.salt === S.meta.salt && rem.key) {
    S.key = rem.key; S.remembered = true;
    if ((await loadAll()) === 'ok') return;
    S.key = null; S.remembered = false;
  }
  renderLock();
}

async function loadAll() {
  try {
    const [posEnv, dataEnv] = await Promise.all([
      fetchJSON('vault/positions.enc').catch(() => null),
      fetchJSON('data.enc').catch(() => null),
    ]);
    let doc = null;
    if (posEnv) doc = await V.decryptObj(S.key, posEnv, 'positions');
    const localEnv = LS.get('doc');
    if (localEnv) {
      try {
        const ld = await V.decryptObj(S.key, JSON.parse(localEnv), 'positions');
        if (!doc || (ld.rev || 0) > (doc.rev || 0)) doc = ld;
      } catch { /* kopia z innego sejfu */ }
    }
    if (!doc) return posEnv ? 'badpw' : 'nodoc';
    S.doc = doc;
    // token udostępniony przez inne Twoje urządzenie (zaszyfrowany w sejfie)
    if (doc.sharedPat && !LS.get('pat')) { await storeToken(doc.sharedPat); S.tokenFromVault = true; }
    S.data = null;
    if (dataEnv) { try { S.data = await V.decryptObj(S.key, dataEnv, 'data'); } catch { S.data = null; } }
    const seen = +LS.get('recsSeen') || 0;
    S.newSince = seen || Date.now() - 7 * DAY;
    render();
    return 'ok';
  } catch {
    return 'badpw';
  }
}

async function reloadData(quiet) {
  const btn = $('[data-act="reload"]');
  btn?.classList.add('spin');
  try {
    const env = await fetchJSON('data.enc');
    if (env) S.data = await V.decryptObj(S.key, env, 'data');
    if (!quiet) toast(S.data ? `Dane z ${dtFmt(Date.parse(S.data.generatedAt))}` : 'Brak danych — automat jeszcze nie działał.');
  } catch { toast('Nie udało się wczytać danych.'); }
  btn?.classList.remove('spin');
  render();
}

// ============================================================== GitHub (zapis zmian, uruchamianie automatu)

function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return '';
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first ? `${m[1]}/${first}` : `${m[1]}/${m[1]}.github.io`;
}
const ghRepo = () => LS.get('repo') || S.config.privateRepo || guessRepo();

async function ghToken() {
  const env = LS.get('pat');
  if (!env || !S.key) return null;
  try { return (await V.decryptObj(S.key, JSON.parse(env), 'pat')).t; } catch { return null; }
}
async function storeToken(t) {
  if (!t) { LS.del('pat'); return; }
  LS.set('pat', JSON.stringify(await V.encryptObj(S.key, { t: t.trim() }, 'pat')));
}

class GhError extends Error {}
function ghMessage(status) {
  if (status === 401) return 'Token GitHub jest nieprawidłowy albo wygasł.';
  if (status === 403) return 'Token nie ma uprawnień. Potrzebne: Contents i Actions z prawem zapisu.';
  if (status === 404) return `Nie znaleziono repozytorium „${ghRepo()}” albo token nie ma do niego dostępu.`;
  if (status === 409 || status === 422) return 'Konflikt zapisu. Spróbuj jeszcze raz.';
  return `GitHub odpowiedział błędem ${status}.`;
}
async function gh(method, path, body, token) {
  const t = token || (await ghToken());
  if (!t) throw new GhError('Brak tokenu GitHub — dodaj go w Ustawieniach.');
  const r = await fetch('https://api.github.com' + path, {
    method,
    headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404 && method === 'GET') return null;
  if (!r.ok) throw new GhError(ghMessage(r.status));
  return r.status === 204 ? {} : r.json();
}
async function ghPut(path, text, message, token) {
  const repo = ghRepo();
  const cur = await gh('GET', `/repos/${repo}/contents/${path}?ref=main`, null, token);
  return gh('PUT', `/repos/${repo}/contents/${path}`, {
    message, branch: 'main', content: V.b64e(new TextEncoder().encode(text)), ...(cur?.sha ? { sha: cur.sha } : {}),
  }, token);
}
const ghDispatch = (token) => gh('POST', `/repos/${ghRepo()}/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main' }, token);
async function ghLastRun() {
  const r = await gh('GET', `/repos/${ghRepo()}/actions/workflows/${WORKFLOW}/runs?per_page=1`);
  return r?.workflow_runs?.[0] || null;
}

async function saveDoc() {
  S.doc.rev = Date.now();
  const env = await V.encryptObj(S.key, S.doc, 'positions');
  LS.set('doc', JSON.stringify(env));
  if (await ghToken()) {
    try {
      await ghPut('vault/positions.enc', JSON.stringify(env), 'Aktualizacja sejfu');
      toast('Zapisano. Automat przeliczy dane w ciągu ok. 2 minut.');
    } catch (e) {
      toast('Zapisano na tym urządzeniu, ale nie w GitHub: ' + e.message);
    }
  } else {
    toast('Zapisano na tym urządzeniu. Dodaj token GitHub w Ustawieniach, żeby automat widział zmianę.');
  }
}

// ============================================================== ekran blokady

function renderLock(error) {
  closeSheet();
  $('#app').innerHTML = `
  <main class="lock">
    ${DIAL}
    <h1>Portfel</h1>
    <p>Dane są zaszyfrowane. Podaj hasło, żeby je otworzyć na tym urządzeniu.</p>
    <form id="unlock" autocomplete="off">
      <input id="pw" type="password" autocomplete="current-password" placeholder="Hasło do sejfu" aria-label="Hasło do sejfu" required>
      <label class="check"><input id="remember" type="checkbox"> Zapamiętaj na tym urządzeniu przez 30 dni</label>
      <div class="btns"><button class="btn primary block" type="submit">Odblokuj</button></div>
      <div class="err" id="lockErr" role="alert">${error ? esc(error) : ''}</div>
    </form>
  </main>`;
  $('#unlock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Odszyfrowuję…';
    try {
      S.key = await V.deriveKey($('#pw').value, S.meta);
      const remember = $('#remember').checked;
      const res = await loadAll();
      if (res === 'ok') {
        if (remember) { await idbSet('key', { key: S.key, salt: S.meta.salt, exp: Date.now() + 30 * DAY }); S.remembered = true; }
        return;
      }
      S.key = null;
      renderLock(res === 'nodoc' ? 'Sejf jest jeszcze zapisywany przez automat. Spróbuj za minutę.' : 'Nieprawidłowe hasło.');
    } catch {
      renderLock('Nie udało się odszyfrować danych.');
    }
  });
  setTimeout(() => $('#pw')?.focus(), 50);
}

async function lockNow() {
  await idbDel('key');
  location.reload();
}

// ============================================================== szkielet

function render() {
  const d = S.data;
  const gen = d?.generatedAt ? Date.parse(d.generatedAt) : null;
  const ageH = gen ? (Date.now() - gen) / 3600000 : null;
  const stamp = gen ? (ageH > 2.5 ? `dane sprzed ${Math.round(ageH)} godz.` : `aktualizacja ${timeFmt(gen)}`) : 'brak danych';
  if (S.view === 'recs') S.recsVisited = true;
  const hasNew = !S.recsVisited && newRecs().length > 0;
  $('#app').innerHTML = `
  <header class="top">
    <h1>Portfel</h1><span class="stamp ${ageH > 2.5 ? 'old' : ''}">${esc(stamp)}</span>
    <span class="spacer"></span>
    <button class="icon-btn" data-act="hide" aria-label="${S.hide ? 'Pokaż kwoty' : 'Ukryj kwoty'}">${icon(S.hide ? 'eyeOff' : 'eye')}</button>
    <button class="icon-btn" data-act="reload" aria-label="Wczytaj najnowsze dane">${icon('refresh')}</button>
    <button class="icon-btn" data-act="lock" aria-label="Zablokuj">${icon('lock')}</button>
  </header>
  <main id="view">${S.view === 'portfolio' ? viewPortfolio() : S.view === 'analysis' ? viewAnalysis() : S.view === 'recs' ? viewRecs() : viewSettings()}</main>
  <nav class="nav" aria-label="Sekcje"><div class="nav-in">
    <button data-act="view" data-arg="portfolio" ${S.view === 'portfolio' ? 'aria-current="page"' : ''}>${icon('wallet')}Portfel</button>
    <button data-act="view" data-arg="analysis" ${S.view === 'analysis' ? 'aria-current="page"' : ''}>${icon('pie')}Analiza</button>
    <button data-act="view" data-arg="recs" ${S.view === 'recs' ? 'aria-current="page"' : ''}>${icon('target')}Rekomendacje${hasNew ? '<span class="dot" aria-label="nowe"></span>' : ''}</button>
    <button data-act="view" data-arg="settings" ${S.view === 'settings' ? 'aria-current="page"' : ''}>${icon('sliders')}Ustawienia</button>
  </div></nav>`;
  if (S.view === 'portfolio') drawMainChart();
  if (S.view === 'recs') { LS.set('recsSeen', String(Date.now())); drawPriceCharts($('#view')); }
  if (S.view === 'settings') refreshRunStatus();
}

// ============================================================== widok: portfel

function viewPortfolio() {
  if (!S.data) {
    return `<div class="screen"><div class="card"><h3>Czekam na pierwsze dane</h3>
      <p>Automat pobiera notowania co godzinę. Pierwsze uruchomienie trwa około 2 minut od utworzenia sejfu.
      Jeśli to trwa dłużej, sprawdź w Ustawieniach, czy dodałeś sekret <code>VAULT_PASSWORD</code>.</p>
      <div class="btns"><button class="btn" data-act="reload">Sprawdź ponownie</button><button class="btn" data-act="run">Uruchom automat teraz</button></div></div></div>`;
  }
  const accs = accounts();
  const segs = [['all', 'Razem'], ...accs.map((a) => [a.id, a.short || a.name])];
  const t = totals(S.acct);
  const dayPct = t.v - t.d ? t.d / (t.v - t.d) : null;
  const pnl = t.v - t.c;
  const acc = accById(S.acct);
  const sub = S.acct === 'all'
    ? `${t.n} ${t.n === 1 ? 'pozycja' : t.n < 5 ? 'pozycje' : 'pozycji'} na ${accs.length} rachunkach`
    : t.cur !== 'PLN' ? `≈ ${money(t.vPLN, 'PLN')}` : esc(acc?.note || '');
  const missing = t.missing ? `<div class="note">${t.missing} ${t.missing === 1 ? 'pozycja czeka' : 'pozycje czekają'} na notowania (pojawią się po najbliższej aktualizacji).</div>` : '';

  const rows = openPositions()
    .filter((p) => S.acct === 'all' || p.account === S.acct)
    .map((p) => ({ p, m: metrics(p) }))
    .sort((a, b) => {
      const k = S.sort === 'pnl' ? 'pnlPct' : S.sort === 'day' ? 'dayPct' : 'valuePLN';
      return (b.m?.[k] ?? -Infinity) - (a.m?.[k] ?? -Infinity);
    });
  const ses = sessionSummary(rows);
  const ext = extTotals(rows, t.cur);
  const gen = S.data.generatedAt ? Date.parse(S.data.generatedAt) : null;

  return `
  <div class="seg" role="group" aria-label="Rachunek">${segs.map(([id, label]) => `<button data-act="acct" data-arg="${esc(id)}" aria-pressed="${S.acct === id}">${esc(label)}</button>`).join('')}</div>
  ${marketsBar(S.acct)}
  <section class="hero" aria-label="Podsumowanie">
    <div class="label">Wartość ${S.acct === 'all' ? 'portfela' : 'rachunku'}</div>
    <div class="value">${heroValue(t.v, t.cur)}</div>
    <div class="sub">${sub}${gen ? ` · ceny pobrane ${esc(dtFmt(gen))}` : ''}</div>
    <div class="deltas">
      <div class="delta"><div class="k">${esc(ses.title)}</div><div class="v ${cls(t.d)}">${signedMoney(t.d, t.cur)}</div><div class="p ${cls(t.d)}">${pct(dayPct)}</div></div>
      <div class="delta"><div class="k">Od zakupu</div><div class="v ${cls(pnl)}">${signedMoney(pnl, t.cur)}</div><div class="p ${cls(pnl)}">${pct(t.c ? pnl / t.c : null)}</div></div>
    </div>
    ${ses.line ? `<p class="ses-line">Skąd zmiana: ${esc(ses.line)}.</p>` : ''}
    ${ext ? `<div class="ext-line"><span>${esc(ext.label)} w USA, stan na ${esc(fmtHourPL(ext.t))}</span><b class="${cls(ext.d)}">${pct(ext.pct)} · ${signedMoney(ext.d, t.cur)}</b><span class="faint">Zmiana wobec ostatniego zamknięcia na spółkach notowanych poza sesją. Nie jest wliczona w wartość portfela.</span></div>` : ''}
  </section>
  <section class="chart-wrap" aria-label="Wykres">
    <div class="chips">
      <button class="chip" data-act="chartMode" data-arg="value" aria-pressed="${S.chartMode === 'value'}">Wartość</button>
      <button class="chip" data-act="chartMode" data-arg="pnl" aria-pressed="${S.chartMode === 'pnl'}">Wynik od zakupu</button>
    </div>
    <div class="chart" id="mainChart"></div>
    <div class="legend2" id="mainLegend"></div>
    <div class="ranges" role="group" aria-label="Zakres wykresu">${[['d', 'Doba'], ['w', '7 dni'], ['m', '30 dni'], ['all', 'Całość']].map(([k, l]) => `<button data-act="range" data-arg="${k}" aria-pressed="${S.range === k}">${l}</button>`).join('')}</div>
    ${S.chartMode === 'value' ? benchPicker() : ''}
  </section>
  ${missing}
  <div class="section-head"><h2>Pozycje</h2><span class="count">${rows.length}</span><span class="grow"></span>
    <div class="chips">${[['value', 'Wartość'], ['pnl', 'Wynik'], ['day', 'Sesja']].map(([k, l]) => `<button class="chip" data-act="sort" data-arg="${k}" aria-pressed="${S.sort === k}">${l}</button>`).join('')}</div>
  </div>
  <div class="list">
    <div class="list-head" aria-hidden="true"><span>Spółka</span><span class="lh-r"><span>${ses.main ? (ses.parts.length === 1 && ses.main === ses.parts[0].today ? 'Dziś' : 'Sesja ' + esc(fmtDM(ses.main))) : 'Sesja'}</span><span>Od zakupu</span></span></div>
    ${rows.map(({ p, m }) => positionRow(p, m, ses.main)).join('') || '<div class="row">Brak pozycji. Dodaj je w Ustawieniach.</div>'}
  </div>
  ${earningsSection()}
  ${macroSection()}`;
}

// ---------- terminy publikacji wyników (czas polski)

const TZ_PL = 'Europe/Warsaw';
const fmtDayPL = (ms) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ_PL }).format(ms);
const fmtDatePL = (ms) => new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', timeZone: TZ_PL }).format(ms);
const fmtHourPL = (ms) => new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: TZ_PL }).format(ms);
const dayKey = (ms, tz = TZ_PL) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ms);

function seasonLabel() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return q === 0 ? `Q4 ${d.getFullYear() - 1}` : `Q${q} ${d.getFullYear()}`;
}

// moment publikacji względem sesji na giełdzie, na której notowana jest spółka
function sessionOf(sym, ms) {
  const [tz, open, close] = /\.KS$/.test(sym) ? ['Asia/Seoul', 540, 930]
    : /\.(DE|F)$/.test(sym) ? ['Europe/Berlin', 540, 1050]
    : /\.L$/.test(sym) ? ['Europe/London', 480, 990]
    : /\.WA$/.test(sym) ? ['Europe/Warsaw', 540, 1020]
    : ['America/New_York', 570, 960];
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(ms).split(':').map(Number);
  const mins = h * 60 + m;
  if (mins === 0) return null; // godzina nieznana
  return mins < open ? 'przed sesją' : mins >= close ? 'po sesji' : 'w trakcie sesji';
}

function daysFromToday(ms) {
  return Math.round((Date.parse(dayKey(ms)) - Date.parse(dayKey(Date.now()))) / DAY);
}
function whenText(diff) {
  if (diff === 0) return 'dziś';
  if (diff === 1) return 'jutro';
  if (diff === -1) return 'wczoraj';
  return diff > 0 ? `za ${diff} dni` : `${-diff} dni temu`;
}

function earningsRows() {
  const out = [];
  const now = Date.now();
  for (const co of companies()) {
    const e = S.data?.earnings?.[co.key];
    if (!e) continue;
    const last = e.last?.ts ? e.last.ts * 1000 : null;
    const next = e.next?.ts ? e.next.ts * 1000 : null;
    const sym = e.sym || co.symbol;
    // bieżący sezon: świeża publikacja (do 30 dni) albo najbliższa zapowiedziana
    if (last && now - last <= 30 * DAY && (!next || next - now > 14 * DAY)) {
      out.push({ co, sym, kind: 'past', ms: last, ev: e.last });
    } else if (next) {
      out.push({ co, sym, kind: 'next', ms: next, end: e.next.tsEnd ? e.next.tsEnd * 1000 : null, est: e.next.estimate, qEnd: e.qEnd, ev: e.next });
    } else if (last) {
      out.push({ co, sym, kind: 'past', ms: last, ev: e.last });
    }
  }
  const up = out.filter((r) => r.kind === 'next').sort((a, b) => a.ms - b.ms);
  const done = out.filter((r) => r.kind === 'past').sort((a, b) => b.ms - a.ms);
  return [...up, ...done];
}

function earningsSection() {
  if (!S.data || !companies().length) return '';
  const rows = earningsRows();
  const head = `<div class="section-head"><h2>Wyniki finansowe</h2><span class="count">sezon ${seasonLabel()}</span></div>`;
  if (!rows.length) return `${head}<p class="note flush-x">Terminy publikacji pojawią się po najbliższej aktualizacji automatu.</p>`;
  return `${head}
  <table class="earn">
    <thead><tr><th scope="col">Spółka</th><th scope="col">Kiedy (czas polski)</th><th scope="col"><span class="sr">Za ile</span></th></tr></thead>
    <tbody>${rows.map((r) => {
      const diff = daysFromToday(r.ms);
      const fiscal = r.kind === 'next' && r.qEnd && !/-(03-31|06-30|09-30|12-31)$/.test(r.qEnd)
        ? `<span class="fq">kwartał do ${esc(fmtDatePL(Date.parse(r.qEnd + 'T12:00:00Z')))}</span>` : '';
      let when, detail;
      if (r.kind === 'past') {
        when = fmtDayPL(r.ms);
        const ses = sessionOf(r.sym, r.ms);
        detail = `opublikowane${ses ? ', ' + ses : ''}`;
      } else if (r.est) {
        when = r.end ? `${fmtDatePL(r.ms)}–${fmtDatePL(r.end)}` : fmtDayPL(r.ms);
        detail = 'termin szacowany';
      } else {
        when = fmtDayPL(r.ms);
        const ses = sessionOf(r.sym, r.ms);
        detail = ses ? `${fmtHourPL(r.ms)}, ${ses}` : 'godzina nieznana';
      }
      const soon = r.kind === 'next' && diff >= 0 && diff <= 7;
      const exp = earningsLine(r);
      return `<tr class="${r.kind === 'past' ? 'past' : ''}">
        <td><span class="nm">${esc(r.co.name)}</span><span class="sub"><span class="tick">${esc(displaySymbol(r.co.symbol))}</span>${fiscal}</span></td>
        <td><span class="d">${esc(when)}</span><span class="sub">${esc(detail)}</span>${exp ? `<span class="sub ev">${exp}</span>` : ''}</td>
        <td class="cd${soon ? ' soon' : ''}">${esc(r.kind === 'past' ? whenText(diff) : whenText(diff))}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  <p class="note">Źródło: Yahoo Finance. Termin szacowany to przewidywanie, zanim spółka go ogłosi. EPS to zysk na akcję; reakcja kursu to zmiana na pierwszej sesji po publikacji.</p>`;
}

// prognoza przed publikacją albo wynik i reakcja kursu po publikacji
function bigMoney(v, cur) {
  const a = Math.abs(v);
  return a >= 1e9 ? `${nf(1).format(v / 1e9)} mld ${cur}` : a >= 1e6 ? `${nf(0).format(v / 1e6)} mln ${cur}` : price(v, cur);
}
function earningsReaction(sym, ms) {
  const mk = MARKETS[marketKey(sym)];
  const d = S.data?.charts?.[sym]?.d;
  if (!mk || !d?.length) return null;
  const pub = zoneParts(ms, mk.tz).date;
  const pubDay = Math.round(Date.parse(pub + 'T00:00:00Z') / DAY);
  const ses = sessionOf(sym, ms);
  const after = ses === 'przed sesją' || ses === 'w trakcie sesji' ? d.find(([x]) => x >= pubDay) : d.find(([x]) => x > pubDay);
  if (!after) {
    const q = quotes()[sym];
    const prev = [...d].reverse().find(([x]) => x <= pubDay);
    const sesNow = quoteSession(sym);
    return q?.price && prev && sesNow?.live ? { chg: q.price / prev[1] - 1, live: true } : null;
  }
  const before = [...d].reverse().find(([x]) => x < after[0]);
  return before ? { chg: after[1] / before[1] - 1, live: false } : null;
}
function earningsLine(r) {
  const cur = quotes()[r.sym]?.currency || 'USD';
  const ev = r.ev || {};
  if (r.kind === 'next') {
    const parts = [];
    if (ev.epsEst != null) parts.push(`prognoza EPS ${price(ev.epsEst, cur)}`);
    if (ev.revEst) parts.push(`przychody ${bigMoney(ev.revEst, cur)}`);
    return parts.length ? esc(parts.join(' · ')) : '';
  }
  const parts = [];
  if (ev.epsAct != null) {
    const sur = ev.surprise;
    parts.push(`EPS ${esc(price(ev.epsAct, cur))}${ev.epsEst != null ? ` vs ${esc(nf(2).format(ev.epsEst))}` : ''}${sur != null ? ` <span class="${cls(sur)}">${pct(sur / 100)}</span>` : ''}`);
  }
  const re = earningsReaction(r.sym, r.ms);
  if (re) parts.push(`reakcja kursu <span class="${cls(re.chg)}">${pct(re.chg)}</span>${re.live ? ' (sesja trwa)' : ''}`);
  return parts.join(' · ');
}

function heroValue(v, cur) {
  if (S.hide) return `••••<span class="cur">${esc(CUR[cur] || cur)}</span>`;
  const d = Math.abs(v) >= 10000 ? 0 : 2;
  return `${(v < 0 ? MINUS : '') + nf(d).format(Math.abs(v))}<span class="cur">${esc(CUR[cur] || cur)}</span>`;
}

function positionRow(p, m, mainDate) {
  const acc = accById(p.account);
  const showAcc = S.acct === 'all';
  const viewCur = S.acct === 'all' ? 'PLN' : m?.cc;
  const val = m ? (S.acct === 'all' ? m.valuePLN : m.valueCC) : null;
  const s = m && quoteSession(p.symbol);
  const e = m && extQuote(p.symbol);
  const dayLabel = s && (s.live ? '<span class="k live-k">dziś</span>' : s.date !== mainDate ? `<span class="k">${esc(fmtDM(s.date))}</span>` : '');
  return `<button class="row" data-act="pos" data-arg="${esc(p.id)}">
    <span class="name">${esc(p.name)}</span>
    <span class="val num">${m ? money(val, viewCur) : '<span class="faint">czekam</span>'}</span>
    <span class="meta"><span class="tick">${esc(displaySymbol(p.symbol))}</span>${showAcc ? `<span class="acct">${esc(acc?.short || acc?.name || p.account)}</span>` : ''}${m?.range52 ? RANGE_PILL[m.range52] : ''}${m?.stale ? '<span class="est">stara cena</span>' : ''}</span>
    <span class="moves num">${m ? `<span class="mv">${dayLabel || ''}<span class="${cls(m.dayPct)}">${pct(m.dayPct)}</span></span><span class="mv ${cls(m.pnlPct)}">${pct(m.pnlPct)}</span>` : ''}</span>
    ${e ? `<span class="ext num">${esc(e.label)} ${esc(fmtHourPL(e.t))}: ${esc(price(e.p, m.qc))} <span class="${cls(e.chg)}">${pct(e.chg)}</span></span>` : ''}
    ${reviewDue(coKey(p)) ? '<span class="ext rev-line">Po wynikach: przejrzyj swoją tezę</span>' : ''}
  </button>`;
}
const displaySymbol = (s) => String(s || '').replace(/=X$/, '');

// ============================================================== giełdy: godziny sesji i stan rynku
// Godziny w czasie lokalnym giełdy (minuty od północy). Dni wolne: NYSE (ogłoszenie NYSE Group z 23.12.2025)
// i Xetra (kalendarz Deutsche Börse). Pozostałe giełdy: tylko dni robocze.
const MARKETS = {
  US: {
    name: 'USA', tz: 'America/New_York', pre: 240, open: 570, close: 960, post: 1200, earlyClose: 780,
    holidays: new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
      '2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
      '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24']),
    early: new Set(['2026-11-27', '2026-12-24', '2027-11-26']),
  },
  XETRA: {
    name: 'Xetra', tz: 'Europe/Berlin', open: 540, close: 1050,
    holidays: new Set(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-24', '2026-12-25', '2026-12-31',
      '2027-01-01', '2027-03-26', '2027-03-29', '2027-12-24', '2027-12-31']),
  },
  LSE: { name: 'Londyn', tz: 'Europe/London', open: 480, close: 990 },
  GPW: { name: 'GPW', tz: 'Europe/Warsaw', open: 540, close: 1020 },
  KRX: { name: 'Seul', tz: 'Asia/Seoul', open: 540, close: 930 },
};

function marketKey(sym) {
  if (/=X$/.test(sym)) return null;
  if (/\.(DE|F)$/.test(sym)) return 'XETRA';
  if (/\.L$/.test(sym)) return 'LSE';
  if (/\.WA$/.test(sym)) return 'GPW';
  if (/\.(KS|KQ)$/.test(sym)) return 'KRX';
  return 'US';
}

const zpCache = {};
function zoneParts(ms, tz) {
  const f = (zpCache[tz] ||= new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const o = {};
  for (const x of f.formatToParts(ms)) o[x.type] = x.value;
  return { date: `${o.year}-${o.month}-${o.day}`, mins: (+o.hour % 24) * 60 + +o.minute };
}
// chwila (ms) odpowiadająca dacie i godzinie w strefie giełdy
function zonedToMs(date, mins, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const want = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(t, tz);
    const [py, pm, pd] = p.date.split('-').map(Number);
    t += want - Date.UTC(py, pm - 1, pd, Math.floor(p.mins / 60), p.mins % 60);
  }
  return t;
}
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const isTradingDay = (mk, date) => { const w = new Date(date + 'T12:00:00Z').getUTCDay(); return w > 0 && w < 6 && !mk.holidays?.has(date); };
const fmtDM = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

function marketStatus(key, now = Date.now()) {
  const mk = MARKETS[key];
  if (!mk) return null;
  const p = zoneParts(now, mk.tz);
  const trading = isTradingDay(mk, p.date);
  const early = mk.early?.has(p.date);
  const close = early ? mk.earlyClose : mk.close;
  let state = 'closed';
  if (trading) {
    if (p.mins >= mk.open && p.mins < close) state = 'open';
    else if (mk.pre != null && p.mins >= mk.pre && p.mins < mk.open) state = 'pre';
    else if (mk.post != null && p.mins >= close && p.mins < (early ? close + 240 : mk.post)) state = 'post';
  }
  let d = p.date;
  if (!(trading && p.mins < mk.open)) { d = addDays(d, 1); while (!isTradingDay(mk, d)) d = addDays(d, 1); }
  return {
    key, name: mk.name, state, today: p.date,
    opensAt: zonedToMs(d, mk.open, mk.tz),
    closesAt: state === 'open' ? zonedToMs(p.date, close, mk.tz) : null,
  };
}

function relDayPL(ms) {
  const diff = daysFromToday(ms);
  if (diff === 0) return 'dziś';
  if (diff === 1) return 'jutro';
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'short', timeZone: TZ_PL }).format(ms);
}
function statusText(st) {
  if (st.state === 'open') return `sesja trwa do ${fmtHourPL(st.closesAt)}`;
  if (st.state === 'pre') return `przed sesją, otwarcie o ${fmtHourPL(st.opensAt)}`;
  const nxt = `${relDayPL(st.opensAt)} ${fmtHourPL(st.opensAt)}`;
  return st.state === 'post' ? `po sesji, następna ${nxt}` : `zamknięte, otwarcie ${nxt}`;
}

// sesja, z której pochodzi cena danej spółki
function quoteSession(sym) {
  const q = quotes()[sym];
  const key = marketKey(sym);
  const mk = MARKETS[key];
  if (!q?.time || !mk) return null;
  const st = marketStatus(key);
  const t = Date.parse(q.time);
  const date = zoneParts(t, mk.tz).date;
  const live = st.state === 'open' && date === st.today && Date.now() - t < 3 * 3600000;
  return { key, date, live, time: t, st };
}

// cena przed sesją / po sesji (tylko gdy rynek nie jest w trakcie sesji)
function extQuote(sym) {
  const q = quotes()[sym];
  if (!q?.price) return null;
  const st = marketStatus(marketKey(sym));
  if (!st || st.state === 'open') return null;
  const reg = Date.parse(q.time);
  const c = [q.pre && { kind: 'pre', ...q.pre }, q.post && { kind: 'post', ...q.post }]
    .filter((e) => e && Date.parse(e.t) > reg && Date.now() - Date.parse(e.t) < 20 * 3600000)
    .sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  if (!c.length) return null;
  const e = c[0];
  return { kind: e.kind, p: e.p, t: Date.parse(e.t), chg: e.p / q.price - 1, label: e.kind === 'pre' ? 'Przed sesją' : 'Po sesji' };
}

function portfolioMarkets(acct) {
  const keys = [];
  for (const p of openPositions()) {
    if (acct !== 'all' && p.account !== acct) continue;
    const k = marketKey(p.symbol);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys.sort((a, b) => (a === 'US' ? -1 : b === 'US' ? 1 : 0));
}

function marketsBar(acct) {
  const keys = portfolioMarkets(acct);
  if (!keys.length) return '';
  return `<div class="mkts" role="status">${keys.map((k) => {
    const st = marketStatus(k);
    return `<span class="mkt ${st.state}"><i aria-hidden="true"></i><b>${esc(st.name)}</b> ${esc(statusText(st))}</span>`;
  }).join('')}</div>`;
}

// opis „z kiedy” jest zmiana dzienna: sesja (data) na każdej giełdzie w portfelu
function sessionSummary(rows) {
  const groups = new Map();
  for (const { p, m } of rows) {
    if (!m) continue;
    const s = quoteSession(p.symbol);
    if (!s) continue;
    const g = groups.get(s.key) || { dates: new Map(), live: false, st: s.st, time: 0 };
    g.dates.set(s.date, (g.dates.get(s.date) || 0) + 1);
    g.live ||= s.live;
    g.time = Math.max(g.time, s.time);
    groups.set(s.key, g);
  }
  const parts = [...groups].map(([key, g]) => {
    const date = [...g.dates].sort((a, b) => b[1] - a[1])[0][0];
    return { key, name: MARKETS[key].name, date, live: g.live, today: g.st.today, time: g.time };
  });
  let title = 'Ostatnie sesje';
  if (parts.length === 1) title = parts[0].date === parts[0].today ? 'Dzisiejsza sesja' : `Sesja ${fmtDM(parts[0].date)}`;
  const line = parts.map((x) => `${x.name} ${fmtDM(x.date)} ${x.live ? `(trwa, ceny z ${fmtHourPL(x.time)})` : '(zamknięta)'}`).join(' · ');
  const main = parts.length ? parts[0].date : null;
  return { title, line, main, parts };
}

// suma ruchu przed/po sesji (informacyjnie — nie zmienia wartości portfela)
function extTotals(rows, cur) {
  const nowR = ratesFromFx(S.data?.fx, 'r');
  let d = 0, base = 0, t = 0;
  const kinds = new Set();
  for (const { p, m } of rows) {
    const e = m && extQuote(p.symbol);
    if (!e) continue;
    const r = rate(nowR, m.cc, cur) || 0;
    d += m.qty * (e.p - m.price) * (rate(nowR, m.qc, m.cc) || 0) * m.keep * r;
    base += m.valueCC * r;
    kinds.add(e.kind);
    t = Math.max(t, e.t);
  }
  if (!base) return null;
  return { d, pct: d / base, t, label: kinds.has('pre') ? 'Przed sesją' : 'Po sesji' };
}

// ---------- wykres liniowy (SVG, bez bibliotek)

function seriesFor(acct, mode) {
  const out = [];
  for (const pt of S.data?.history || []) {
    let v = 0, c = 0, ok = false;
    if (acct === 'all') { for (const a of Object.values(pt.a)) { v += a[3]; c += a[4]; ok = true; } }
    else if (pt.a[acct]) { v = pt.a[acct][0]; c = pt.a[acct][1]; ok = true; }
    if (ok) out.push({ t: Date.parse(pt.t), y: mode === 'pnl' ? v - c : v });
  }
  const span = { d: DAY, w: 7 * DAY, m: 30 * DAY }[S.range];
  if (span && out.length) { const end = out[out.length - 1].t; return out.filter((p) => p.t >= end - span); }
  return out;
}

function niceTicks(min, max, n = 3) {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / n; const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= step0) || mag * 10;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function drawMainChart() {
  const el = $('#mainChart');
  if (!el) return;
  const cur = S.acct === 'all' ? 'PLN' : accById(S.acct)?.currency || 'PLN';
  const pts = seriesFor(S.acct, S.chartMode);
  if (pts.length < 2) {
    el.innerHTML = `<div class="empty-chart">Wykres zbiera dane od dziś — pierwsze punkty pojawią się po kolejnych godzinnych aktualizacjach.</div>`;
    return;
  }
  let s2 = null;
  if (S.bench && S.chartMode === 'value') {
    const b0 = benchAt(S.bench, pts[0].t);
    if (b0) {
      const bp = pts.map((p) => ({ t: p.t, v: benchAt(S.bench, p.t) })).filter((p) => p.v).map((p) => ({ t: p.t, y: (p.v / b0) * pts[0].y }));
      s2 = { pts: bp, base: pts[0].y, label: BENCH[S.bench] };
    }
  }
  lineChart(el, pts, (v) => money(v, cur), S.chartMode === 'pnl', dtFmt, { label: S.chartMode === 'pnl' ? 'Wynik portfela' : 'Wartość portfela', s2 });
  const lg = $('#mainLegend');
  if (lg) {
    const last = pts[pts.length - 1].y, l2 = s2?.pts.length ? s2.pts[s2.pts.length - 1].y : null;
    lg.innerHTML = s2 && l2 ? `<span><i class="sw brass"></i>Portfel ${pct(last / pts[0].y - 1)}</span><span><i class="sw idx"></i>${esc(s2.label)} (ta sama kwota) <span class="${cls(l2 / pts[0].y - 1)}">${pct(l2 / pts[0].y - 1)}</span></span><span class="faint">Zakupy i sprzedaże w tym okresie zaburzają porównanie.</span>` : '';
  }
}

function lineChart(el, pts, fmt, zeroLine, tFmt = dtFmt, opts = {}) {
  const W = el.clientWidth || 340, H = el.clientHeight || 168, top = 26, bottom = 22, gutter = 48;
  const color = opts.color || '#c9a45c';
  let lo = Math.min(...pts.map((p) => p.y)), hi = Math.max(...pts.map((p) => p.y));
  if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (opts.ref != null) { lo = Math.min(lo, opts.ref); hi = Math.max(hi, opts.ref); }
  const s2 = (opts.s2?.pts || []).filter((p) => p.t >= pts[0].t && p.t <= pts[pts.length - 1].t);
  for (const p of s2) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  if (hi - lo < Math.abs(hi) * 0.002 || hi === lo) { const pad = Math.abs(hi) * 0.01 || 1; lo -= pad; hi += pad; }
  const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = (t) => ((t - t0) / (t1 - t0 || 1)) * (W - gutter - 8) + 4;
  const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${X(t1).toFixed(1)},${H - bottom}L${X(t0).toFixed(1)},${H - bottom}Z`;
  const ticks = niceTicks(lo, hi, 3);
  const last = pts[pts.length - 1];
  el.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Wykres')} od ${esc(tFmt(t0))} do ${esc(tFmt(t1))}, ostatnio ${esc(fmt(last.y))}">
    ${ticks.map((v) => `<line x1="0" x2="${W - gutter + 6}" y1="${Y(v)}" y2="${Y(v)}" stroke="#263247" stroke-width="1"/><text x="${W}" y="${Y(v) + 4}" text-anchor="end" fill="#8590a3" font-size="11">${esc(compact(v))}</text>`).join('')}
    ${zeroLine ? `<line x1="0" x2="${W - gutter + 6}" y1="${Y(0)}" y2="${Y(0)}" stroke="#7c8698" stroke-width="1"/>` : ''}
    ${opts.ref != null ? `<line x1="0" x2="${W - gutter + 6}" y1="${Y(opts.ref)}" y2="${Y(opts.ref)}" stroke="#7c8698" stroke-width="1"/>` : ''}
    <path d="${area}" fill="${color}" fill-opacity="0.1"/>
    ${s2.length > 1 ? `<path d="${s2.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('')}" fill="none" stroke="#9aa6b8" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(last.t)}" cy="${Y(last.y)}" r="4" fill="${color}" stroke="#0e1420" stroke-width="2"/>
    <text x="0" y="${H - 5}" fill="#8590a3" font-size="11">${esc(tFmt(t0))}</text>
    <text x="${W - gutter + 4}" y="${H - 5}" text-anchor="end" fill="#8590a3" font-size="11">${esc(tFmt(t1))}</text>
    <g class="xh" visibility="hidden"><line y1="${top - 4}" y2="${H - bottom}" stroke="#9aa6b8" stroke-width="1"/><circle r="4.5" fill="${color}" stroke="#0e1420" stroke-width="2"/></g>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
  </svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), xh = svg.querySelector('.xh'), tip = el.querySelector('.tip');
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(X(p.t) - x) < Math.abs(X(best.t) - x)) best = p;
    const cx = X(best.t), cy = Y(best.y);
    xh.setAttribute('visibility', 'visible');
    xh.querySelector('line').setAttribute('x1', cx); xh.querySelector('line').setAttribute('x2', cx);
    xh.querySelector('circle').setAttribute('cx', cx); xh.querySelector('circle').setAttribute('cy', cy);
    tip.hidden = false;
    const rel = opts.ref ? ` (${pct(best.y / opts.ref - 1)})` : '';
    let idx = '';
    if (s2.length) {
      let b2 = null;
      for (const p of s2) if (p.t <= best.t + 60000) b2 = p;
      if (b2) idx = `<span class="tip-idx">${esc(opts.s2.label)}: ${esc(pct(b2.y / opts.s2.base - 1))}</span>`;
    }
    tip.innerHTML = `<b>${esc(fmt(best.y))}${esc(rel)}</b>${idx}${esc(tFmt(best.t))}`;
    const px = (cx / W) * r.width;
    tip.style.left = Math.min(Math.max(px, 70), r.width - 70) + 'px';
    tip.style.top = '-6px';
  };
  const hide = () => { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

// ---------- wykres ceny spółki: zakresy od 1 dnia do 5 lat
const PC_RANGES = [['1d', '1D', 'ostatnia sesja'], ['1w', '1T', 'tydzień'], ['1m', '1M', 'miesiąc'], ['6m', '6M', '6 miesięcy'],
  ['1y', '1R', 'rok'], ['3y', '3L', '3 lata'], ['5y', '5L', '5 lat']];
const PC_DAYS = { '1w': 7, '1m': 30, '6m': 182, '1y': 365, '3y': 1095, '5y': 1826 };
const dayMs = (d) => d * DAY + 12 * 3600000;

function withLast(pts, t, y, sameBucket) {
  const last = pts[pts.length - 1];
  if (sameBucket(last.t, t)) last.y = y; else if (t > last.t) pts.push({ t, y });
  return pts;
}

function priceSeries(sym, rk) {
  const c = S.data?.charts?.[sym];
  const q = quotes()[sym];
  if (!c || !q?.price) return null;
  const qt = Date.parse(q.time);
  if (rk === '1d') {
    const pts = (c.i || []).map(([m, v]) => ({ t: m * 60000, y: v }));
    if (pts.length < 2 || !q.prevClose) return null;
    withLast(pts, qt, q.price, (a, b) => Math.abs(a - b) < 6 * 60000);
    return { pts, ref: q.prevClose, chg: q.price / q.prevClose - 1, tFmt: timeFmt, cap: 'zmiana od zamknięcia poprzedniej sesji' };
  }
  const daily = (c.d || []).map(([d, y]) => ({ day: d, y }));
  let src = daily;
  if (rk === '3y' || rk === '5y' || !daily.length) {
    const first = daily.length ? daily[0].day : Infinity;
    src = [...(c.w || []).map(([d, y]) => ({ day: d, y })).filter((x) => x.day < first), ...daily];
  }
  if (src.length < 2) return null;
  const from = src[src.length - 1].day - PC_DAYS[rk];
  let i0 = -1;
  for (let i = 0; i < src.length; i++) if (src[i].day <= from) i0 = i;
  const partial = i0 < 0 && src[0].day - from > 14; // brak danych z początku zakresu (np. świeży debiut)
  if (i0 < 0) i0 = 0;
  const ref = src[i0].y;
  const sameDay = (a, b) => Math.floor(a / DAY) === Math.floor(b / DAY);
  let pts;
  if (rk === '1w' && (c.h || []).length > 1) {
    pts = c.h.map(([m, y]) => ({ t: m * 60000, y }));
    withLast(pts, qt, q.price, (a, b) => Math.abs(a - b) < 31 * 60000);
  } else {
    pts = src.slice(i0).map((x) => ({ t: dayMs(x.day), y: x.y }));
    withLast(pts, qt, q.price, sameDay);
  }
  const lab = PC_RANGES.find((r) => r[0] === rk)[2];
  const cap = partial ? `notowania dostępne od ${dateFmt(dayMs(src[0].day))}, krócej niż ${lab}` : `zmiana od zamknięcia ${dateFmt(dayMs(src[i0].day))}`;
  return { pts, ref, chg: q.price / ref - 1, tFmt: rk === '1w' ? dtFmt : dateFmt, cap, partial };
}

function pcHTML(sym) {
  const rk = S.pcRange;
  const all = Object.fromEntries(PC_RANGES.map(([k]) => [k, priceSeries(sym, k)]));
  if (!Object.values(all).some(Boolean)) return '<div class="empty-chart">Wykres ceny pojawi się po najbliższej aktualizacji automatu.</div>';
  const sel = all[rk];
  const short = (x) => pct(x.chg, Math.abs(x.chg) >= 0.1 ? 0 : 1);
  const bs = sel && benchSeries(rk, sel.ref);
  return `<div class="pc-top"><span class="pc-chg ${cls(sel?.chg)}">${sel ? pct(sel.chg) : '—'}</span><span class="pc-cap">${esc(sel ? sel.cap : 'brak danych dla tego zakresu')}</span></div>
    <div class="chart pc-chart"></div>
    ${bs ? `<div class="legend2"><span><i class="sw ${sel.chg >= 0 ? 'gain-bg' : 'loss-bg'}"></i>${esc(displaySymbol(sym))} ${pct(sel.chg)}</span><span><i class="sw idx"></i>${esc(bs.label)} <span class="${cls(bs.chg)}">${pct(bs.chg)}</span></span></div>` : ''}
    <div class="pc-ranges" role="group" aria-label="Zakres wykresu ceny">${PC_RANGES.map(([k, l, long]) => {
      const x = all[k];
      return `<button data-act="pcRange" data-arg="${k}" aria-pressed="${k === rk}" aria-label="${esc(long)}"${x ? '' : ' disabled'}><span>${l}</span><span class="${cls(x?.chg)}${x?.partial ? ' part' : ''}">${x ? short(x) : '—'}</span></button>`;
    }).join('')}</div>
    ${benchPicker()}`;
}

function benchSeries(rk, ref) {
  if (!S.bench) return null;
  const b = priceSeries(S.bench, rk);
  if (!b) return null;
  return { pts: b.pts.map((p) => ({ t: p.t, y: (p.y / b.ref) * ref })), base: ref, label: BENCH[S.bench], chg: b.chg };
}

function pcDraw(box) {
  const sym = box.dataset.sym;
  const el = box.querySelector('.pc-chart');
  if (!el) return;
  const sel = priceSeries(sym, S.pcRange);
  if (!sel || sel.pts.length < 2) { el.innerHTML = '<div class="empty-chart">Brak danych dla tego zakresu.</div>'; return; }
  const cur = quotes()[sym]?.currency;
  lineChart(el, sel.pts, (v) => price(v, cur), false, sel.tFmt, {
    color: sel.chg >= 0 ? '#2fa98a' : '#e2674f', ref: sel.ref, label: `Kurs ${displaySymbol(sym)}`, s2: benchSeries(S.pcRange, sel.ref),
  });
}

function benchPicker() {
  return `<div class="bench" role="group" aria-label="Porównaj z indeksem"><span class="faint">Porównaj z:</span>${[['', 'brak'], ...Object.entries(BENCH)].map(([k, l]) => `<button data-act="bench" data-arg="${esc(k)}" aria-pressed="${S.bench === k}">${esc(l)}</button>`).join('')}</div>`;
}
const priceChart = (sym) => `<div class="pc" data-sym="${esc(sym)}">${pcHTML(sym)}</div>`;
const drawPriceCharts = (root = document) => root.querySelectorAll('.pc').forEach(pcDraw);

// ============================================================== analiza: branże, próg zera, waluty, indeksy
const BENCH = { '^NDX': 'Nasdaq 100', '^GSPC': 'S&P 500' };
const IND_PL = {
  'Semiconductors': 'Półprzewodniki', 'Semiconductor Equipment & Materials': 'Sprzęt do produkcji chipów',
  'Software - Application': 'Oprogramowanie', 'Software - Infrastructure': 'Oprogramowanie infrastrukturalne',
  'Computer Hardware': 'Sprzęt komputerowy i pamięci', 'Information Technology Services': 'Usługi IT i chmura',
  'Utilities - Regulated Electric': 'Energetyka', 'Utilities - Diversified': 'Energetyka', 'Internet Content & Information': 'Internet',
  'Consumer Electronics': 'Elektronika użytkowa', 'Communication Equipment': 'Sprzęt telekomunikacyjny',
  'Electronic Components': 'Komponenty elektroniczne', 'Scientific & Technical Instruments': 'Instrumenty naukowe',
  'Banks - Diversified': 'Banki', 'Banks - Regional': 'Banki', 'Oil & Gas Integrated': 'Ropa i gaz',
  'Drug Manufacturers - General': 'Farmacja', 'Internet Retail': 'Handel internetowy', 'Auto Manufacturers': 'Motoryzacja',
  'Aerospace & Defense': 'Lotnictwo i zbrojenia', 'Insurance - Diversified': 'Ubezpieczenia',
};
const SECTOR_PL = {
  Technology: 'Technologia', Utilities: 'Energetyka i media', 'Communication Services': 'Komunikacja', 'Consumer Cyclical': 'Dobra cykliczne',
  'Financial Services': 'Finanse', Healthcare: 'Ochrona zdrowia', Industrials: 'Przemysł', Energy: 'Energia',
  'Basic Materials': 'Surowce', 'Real Estate': 'Nieruchomości', 'Consumer Defensive': 'Dobra podstawowe',
};
const coKey = (p) => (p.type === 'etf' ? p.symbol : (p.recSymbols?.[0] || p.symbol));
function industryOf(p) {
  if (p.sector) return p.sector;
  const pr = S.data?.profiles?.[p.symbol] || {};
  if (p.type === 'etf') {
    if (/semicon|chip/i.test(`${p.name} ${pr.name || ''} ${pr.category || ''}`)) return 'ETF: półprzewodniki';
    return /world|global|msci|s&p|all.?country/i.test(`${p.name} ${pr.name || ''}`) ? 'ETF: rynek globalny' : (pr.category ? `ETF: ${pr.category}` : 'ETF');
  }
  const ind = String(pr.industry || '').replace(/\s*—\s*/g, ' - ');
  return ind ? IND_PL[ind] || ind : 'Brak danych o branży';
}
function sectorOf(p) {
  const pr = S.data?.profiles?.[p.symbol] || {};
  if (p.type === 'etf') return /półprzewodniki/.test(industryOf(p)) ? 'Technologia' : 'Szeroki rynek (ETF)';
  return SECTOR_PL[pr.sector] || pr.sector || 'Brak danych';
}

// średnia cena docelowa analityków dla spółki (z Yahoo albo z rekomendacji firm)
function companyTarget(p) {
  if (p.type === 'etf') return null;
  const key = coKey(p);
  const q = quotes()[key] || quotes()[p.symbol];
  let mean = S.data?.recs?.[key]?.targets?.mean;
  if (!mean) {
    const co = companies().find((c) => c.key === key);
    const pts = co ? firmGroups(co).filter((g) => g.sym === key).map((g) => g.pt).filter(Boolean) : [];
    mean = pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null;
  }
  return mean && q?.price ? { mean, up: mean / q.price - 1, cur: q.currency } : null;
}

// próg zera: kurs, przy którym wartość pozycji (po prowizji/dopasowaniu) równa się kosztowi
function breakEven(m) {
  if (!m || !m.valueCC || !m.costCC) return null;
  const need = m.costCC / m.valueCC - 1;
  return { need, price: m.price * (1 + need) };
}

// ---------- wiadomości (nagłówki z Yahoo Finance, zwykle po angielsku)
const httpsUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null);
function newsOf(key) { return (S.data?.news?.[key]?.v || []).filter((n) => n?.t && n.ts && httpsUrl(n.u)); }
function agoPL(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${Math.max(min, 1)} min temu`;
  const d = daysFromToday(ms);
  if (d === 0) return `dziś ${fmtHourPL(ms)}`;
  if (d === -1) return `wczoraj ${fmtHourPL(ms)}`;
  return `${fmtDayPL(ms)} ${fmtHourPL(ms)}`;
}
function newsList(key, max = 5) {
  const items = newsOf(key).slice(0, max);
  if (!items.length) return '';
  return `<ul class="news">${items.map((n) => {
    const fresh = Date.now() - n.ts * 1000 < DAY;
    return `<li><a href="${esc(httpsUrl(n.u))}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(n.t)}</a>
      <span class="news-meta">${fresh ? '<span class="fresh">ostatnia doba</span>' : ''}${esc([n.p, agoPL(n.ts * 1000)].filter(Boolean).join(' · '))}</span></li>`;
  }).join('')}</ul>`;
}
function newsCard(key, sym) {
  const list = newsList(key, 5);
  const ysym = S.data?.news?.[key]?.sym || sym;
  return `<div class="card"><h3>Wiadomości</h3>${list || '<p>Brak wiadomości z ostatnich 7 dni.</p>'}
    <p class="small-note">Nagłówki z Yahoo Finance (zwykle po angielsku) z ostatnich 7 dni, otwierają się na stronie wydawcy. Najświeższy dołączam też do alertów o dużym ruchu kursu w Telegramie. <a href="https://finance.yahoo.com/quote/${encodeURIComponent(ysym)}/news" target="_blank" rel="noopener noreferrer">Więcej w Yahoo</a></p></div>`;
}

// ---------- wycena: C/Z, prognozowany C/Z, C/S (wskaźniki z Yahoo przeliczone na bieżący kurs)
function valuationOf(key) {
  const r = S.data?.valuation?.[key];
  const v = r?.v;
  if (!v || !Object.keys(v).length) return null;
  const q = quotes()[r.sym];
  const f = q?.price && v.ref && (!v.cur || v.cur === q.currency) ? q.price / v.ref : 1;
  const loss = v.epsT != null && v.epsT <= 0;
  const floss = v.epsF != null && v.epsF <= 0;
  return {
    sym: r.sym, at: r.at, loss, floss,
    pe: !loss && v.pe > 0 ? v.pe * f : null,
    fpe: !floss && v.fpe > 0 ? v.fpe * f : null,
    ps: v.ps > 0 ? v.ps * f : null,
    g0: v.g0 ?? null, g1: v.g1 ?? null, r0: v.r0 ?? null, r1: v.r1 ?? null, gE: v.gE ?? null, gR: v.gR ?? null,
    margin: v.margin ?? null, fy0: v.fy0 || null,
  };
}
const ratio = (x) => (x == null ? '—' : nf(x >= 100 ? 0 : 1).format(x));
const gpct = (g) => (g == null ? '—' : pct(g, Math.abs(g) < 0.1 ? 1 : 0));
function valuationHint(v) {
  if (v.loss) return v.fpe ? `W ostatnich 12 miesiącach spółka miała stratę, więc zwykłego C/Z nie da się policzyć. Analitycy prognozują już zysk (C/Z prognozowany ${ratio(v.fpe)}).` : 'Spółka ma stratę, więc C/Z nie da się policzyć — patrz na C/S i prognozy wzrostu przychodów.';
  if (v.pe && v.fpe) {
    if (v.fpe < v.pe * 0.85) return `Prognozowany C/Z (${ratio(v.fpe)}) jest niższy od bieżącego (${ratio(v.pe)}) — analitycy oczekują wyraźnego wzrostu zysków.`;
    if (v.fpe > v.pe * 1.15) return `Prognozowany C/Z (${ratio(v.fpe)}) jest wyższy od bieżącego (${ratio(v.pe)}) — analitycy oczekują spadku zysków.`;
    return 'Bieżący i prognozowany C/Z są zbliżone — analitycy nie oczekują dużej zmiany zysków.';
  }
  return '';
}
function valuationCard(key) {
  const v = valuationOf(key);
  if (!v) return '';
  const fy = v.fy0 ? ` (kończy się ${v.fy0.slice(5, 7)}.${v.fy0.slice(0, 4)})` : '';
  return `<div class="card"><h3>Wycena</h3>
    <div class="target-sum val">
      <div><div class="k">C/Z</div><div class="v num">${v.loss ? 'strata' : ratio(v.pe)}</div><div class="k">12 mies.</div></div>
      <div><div class="k">C/Z prog.</div><div class="v num">${v.floss ? 'strata' : ratio(v.fpe)}</div><div class="k">kolejny rok</div></div>
      <div><div class="k">C/S</div><div class="v num">${ratio(v.ps)}</div><div class="k">sprzedaż</div></div>
    </div>
    ${[v.gE, v.gR, v.g0, v.g1, v.r0, v.r1].some((x) => x != null) ? `<table class="tbl growth">
      <thead><tr><th scope="col">Wzrost r/r</th><th scope="col">ost. kwartał</th><th scope="col">ten rok</th><th scope="col">nast. rok</th></tr></thead>
      <tbody>${[['Zysk na akcję', v.gE, v.g0, v.g1], ['Przychody', v.gR, v.r0, v.r1]].map(([l, a, b, c]) => `<tr><td>${l}</td>${[a, b, c].map((x) => `<td class="num ${cls(x)}">${gpct(x)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>` : ''}
    ${v.margin != null ? `<dl class="kv"><dt>Marża netto (12 mies.)</dt><dd class="num">${esc(nf(0).format(v.margin * 100))}%</dd></dl>` : ''}
    <p class="small-note">${esc(valuationHint(v))} C/Z (cena do zysku) mówi, ile lat obecnych zysków płacisz za akcję; C/S to cena do rocznej sprzedaży — przydaje się, gdy spółka nie ma zysku. Ostatni kwartał to wynik rzeczywisty, „ten rok” i „nast. rok” to prognozy analityków dla roku obrotowego spółki${esc(fy)}. Dane Yahoo Finance przeliczone na bieżący kurs.</p>
  </div>`;
}

// ---------- moja teza i plan (zapisane w sejfie: doc.notes[klucz spółki])
const noteOf = (key) => S.doc?.notes?.[key] || null;
function planFired(key, kind, lvl) {
  for (const [k, at] of Object.entries(S.data?.state?.planFired || {})) {
    const [kk, kd, lv] = k.split('|');
    if (kk === key && kd === kind && Math.abs(parseFloat(lv) - lvl) <= 1e-9 * Math.max(1, lvl)) return at;
  }
  return null;
}
// po publikacji wyników (do 3 tygodni) teza zapisana wcześniej czeka na przegląd
function reviewDue(key) {
  const n = noteOf(key);
  const last = S.data?.earnings?.[key]?.last?.ts;
  if (!n?.review || !n.thesis || !last) return null;
  const ms = last * 1000;
  if (ms > Date.now() || Date.now() - ms > 21 * DAY) return null;
  return (n.updated || 0) < ms ? ms : null;
}
function planCard(p) {
  const key = coKey(p);
  const n = noteOf(key);
  const q = quotes()[n?.sym || p.symbol];
  const cur = q?.currency || n?.cur || '';
  const due = reviewDue(key);
  const lvlRow = (label, lvl, kind) => {
    if (!(lvl > 0)) return '';
    const d = q?.price ? lvl / q.price - 1 : null;
    const fired = planFired(key, kind, lvl);
    return `<dt>${label}</dt><dd class="num">${esc(price(lvl, cur))}${d != null ? ` <span class="${cls(d)}">${pct(d)}</span>` : ''}${fired ? `<span class="sub-r">powiadomienie wysłane ${esc(dtFmt(Date.parse(fired)))}</span>` : ''}</dd>`;
  };
  return `<div class="card" id="plan-card"><h3>Moja teza i plan</h3>
    ${due ? `<div class="review-due"><b>Wyniki z ${esc(fmtDatePL(due))}</b> — czy Twoja teza jest nadal aktualna?
      <div class="btns"><button class="btn" data-act="thesisOk" data-arg="${esc(p.id)}">Tak, aktualna</button><button class="btn" data-act="editPlan" data-arg="${esc(p.id)}">Zmień</button></div></div>` : ''}
    ${n ? `${n.thesis ? `<p class="thesis">${esc(n.thesis)}</p>` : ''}
      <dl class="kv">${lvlRow('Mój cel', n.target, 'target')}${lvlRow('Poziom ostrzegawczy', n.warn, 'warn')}
        ${p.type === 'etf' ? '' : `<dt>Przegląd po wynikach</dt><dd>${n.review ? 'przypomnę w Telegramie' : 'wyłączony'}</dd>`}</dl>
      <p class="small-note">Zapisane ${esc(dateFmt(n.updated || Date.now()))}.${n.target || n.warn ? ' Procent to odległość od obecnego kursu. Telegram powiadomi raz, gdy kurs przekroczy cel albo spadnie poniżej poziomu ostrzegawczego.' : ''}</p>`
      : '<p>Zapisz, dlaczego masz tę spółkę, przy jakim kursie chcesz realizować zysk i kiedy zapala się lampka ostrzegawcza. Telegram przypomni o tym w odpowiednim momencie, a po wynikach finansowych poprosi o przegląd tezy.</p>'}
    ${due ? '' : `<div class="btns"><button class="btn" data-act="editPlan" data-arg="${esc(p.id)}">${n ? 'Edytuj' : 'Dodaj tezę i plan'}</button></div>`}
  </div>`;
}
function editPlan(id) {
  const p = S.doc.positions.find((x) => x.id === id);
  if (!p) return;
  const key = coKey(p);
  const n = noteOf(key) || { review: p.type !== 'etf' };
  const q = quotes()[p.symbol];
  const cur = q?.currency || '';
  const body = `
    <div class="field"><label for="pl-thesis">Dlaczego mam tę spółkę (teza)</label><textarea id="pl-thesis" rows="6" maxlength="2000" placeholder="Np. lider w akceleratorach AI, marże rosną. Sprzedam, jeśli wzrost przychodów spadnie poniżej 20% rok do roku.">${esc(n.thesis || '')}</textarea></div>
    <div class="two">
      <div class="field"><label for="pl-target">Mój cel (${esc(cur)})</label><input id="pl-target" type="number" step="any" inputmode="decimal" value="${n.target ?? ''}"></div>
      <div class="field"><label for="pl-warn">Poziom ostrzegawczy (${esc(cur)})</label><input id="pl-warn" type="number" step="any" inputmode="decimal" value="${n.warn ?? ''}"></div>
    </div>
    <p class="small-note">Obecny kurs: ${q ? esc(price(q.price, cur)) : '—'}. Oba poziomy są opcjonalne. Powiadomienie w Telegramie przychodzi raz dla danego poziomu.</p>
    ${p.type === 'etf' ? '' : `<label class="check"><input type="checkbox" id="pl-review" ${n.review ? 'checked' : ''}> Po publikacji wyników przypomnij mi w Telegramie, żeby przejrzeć tezę</label>`}
    <div class="err" id="pl-err"></div>
    <div class="btns"><button class="btn primary" data-act="savePlan" data-arg="${esc(p.id)}">Zapisz</button><button class="btn" data-act="pos" data-arg="${esc(p.id)}">Anuluj</button>${noteOf(key) ? `<button class="btn danger" data-act="delPlan" data-arg="${esc(p.id)}">Usuń</button>` : ''}</div>`;
  openSheet(`Teza i plan: ${p.name}`, body);
}
async function savePlan(id) {
  const p = S.doc.positions.find((x) => x.id === id);
  if (!p) return;
  const key = coKey(p);
  const thesis = $('#pl-thesis').value.trim().slice(0, 2000);
  const tgt = numIn('#pl-target'), warn = numIn('#pl-warn');
  const err = (m) => { $('#pl-err').textContent = m; };
  if ((tgt != null && !(tgt > 0)) || (warn != null && !(warn > 0))) return err('Poziomy muszą być liczbami większymi od zera.');
  if (tgt && warn && warn >= tgt) return err('Poziom ostrzegawczy powinien być niższy od celu.');
  if (!thesis && !tgt && !warn) return err('Wpisz tezę albo przynajmniej jeden poziom.');
  const q = quotes()[p.symbol];
  S.doc.notes = { ...(S.doc.notes || {}), [key]: { thesis: thesis || undefined, target: tgt || undefined, warn: warn || undefined, review: p.type !== 'etf' && !!$('#pl-review')?.checked, sym: p.symbol, cur: q?.currency, updated: Date.now() } };
  render();
  showPosition(p.id);
  await saveDoc();
  if (q?.price && ((warn && q.price < warn) || (tgt && q.price > tgt))) toast('Kurs już przekroczył jeden z poziomów — powiadomienie przyjdzie przy najbliższej aktualizacji.');
}

// ---------- wydarzenia makro w USA (kalendarz z silnika, czas polski)
const MACRO = {
  fomc: ['Decyzja Fed (FOMC)', (e) => (e.sep ? 'stopy procentowe i prognozy Fed' : 'stopy procentowe'), 'w trakcie sesji'],
  cpi: ['Inflacja CPI', (e) => `dane za ${e.ref || ''}`, 'przed sesją'],
  jobs: ['Rynek pracy (payrolls)', (e) => `dane za ${e.ref || ''}`, 'przed sesją'],
};
function macroSection() {
  if (!S.data?.macro) return '';
  const now = Date.now();
  const list = S.data.macro.filter((e) => MACRO[e.k] && e.ts * 1000 > now).sort((a, b) => a.ts - b.ts).slice(0, 6);
  const until = S.data.macroUntil ? Date.parse(S.data.macroUntil + 'T12:00:00Z') : null;
  const stale = until && until < now + 60 * DAY;
  const on = ({ ...NOTIFY_DEFAULTS, ...(S.doc?.notify || {}) }).macro;
  const head = '<div class="section-head"><h2>Wydarzenia makro w USA</h2><span class="count">czas polski</span></div>';
  if (!list.length) return `${head}<p class="note flush-x">Brak wydarzeń w najbliższych tygodniach${stale ? ' — kalendarz wymaga uzupełnienia' : ''}.</p>`;
  return `${head}
  <table class="earn macro">
    <thead><tr><th scope="col">Wydarzenie</th><th scope="col">Kiedy</th><th scope="col"><span class="sr">Za ile</span></th></tr></thead>
    <tbody>${list.map((e) => {
      const ms = e.ts * 1000;
      const diff = daysFromToday(ms);
      const [name, sub, ses] = MACRO[e.k];
      return `<tr class="mk-${esc(e.k)}"><td><span class="nm">${esc(name)}</span><span class="sub">${esc(sub(e))}</span></td>
        <td><span class="d">${esc(fmtDayPL(ms))}</span><span class="sub">${esc(fmtHourPL(ms))}, ${esc(ses)}</span></td>
        <td class="cd${diff <= 1 ? ' soon' : ''}">${esc(whenText(diff))}</td></tr>`;
    }).join('')}</tbody>
  </table>
  <p class="note">Fed decyduje o stopach procentowych (konferencja prezesa 30 min po decyzji), CPI to inflacja konsumencka, a raport z rynku pracy pokazuje zatrudnienie i bezrobocie. Te publikacje często poruszają całym rynkiem, zwłaszcza spółkami technologicznymi.${on ? ' Przypomnienie przyjdzie w Telegramie dzień wcześniej.' : ''} Źródło: harmonogramy Fed i BLS${stale ? `; kalendarz sięga do ${esc(dateFmt(until))} — potrzebna aktualizacja` : ''}.</p>`;
}

// wartość indeksu w chwili t (z wykresu 30-min z ostatnich dni albo zamknięć dziennych)
function benchAt(sym, t) {
  const c = S.data?.charts?.[sym];
  if (!c) return null;
  let v = null;
  for (const [d, y] of c.d || []) if (d * DAY + 20 * 3600000 <= t) v = y;
  for (const [m, y] of c.h || []) if (m * 60000 <= t) v = y;
  return v;
}

// zwrot obecnego składu (te same liczby akcji) w zakresie — bez zmian kursów walut
function holdingsReturn(rk, acct = 'all') {
  let now = 0, start = 0;
  const missing = [];
  for (const p of openPositions()) {
    if (acct !== 'all' && p.account !== acct) continue;
    const m = metrics(p);
    if (!m) continue;
    const ps = priceSeries(p.symbol, rk);
    if (!ps || ps.partial) { if (!missing.includes(p.name)) missing.push(p.name); continue; }
    now += m.valuePLN;
    start += m.valuePLN / (1 + ps.chg);
  }
  return start ? { chg: now / start - 1, missing } : null;
}

const share = (f) => `${nf(1).format(f * 100)}%`;
function barList(items, total, extra) {
  if (!items.length || !total) return '';
  const max = Math.max(...items.map((x) => x.value));
  return `<div class="bars">${items.map((x) => {
    const w = Math.max((x.value / max) * 100, 0.8).toFixed(2);
    return `<div class="bl">
      <div class="bl-top"><span class="bl-name">${esc(x.label)}${x.sub ? `<span class="faint"> ${esc(x.sub)}</span>` : ''}</span><span class="bl-val num">${share(x.value / total)}<span class="faint"> · ${money(x.value, 'PLN', 0)}</span></span></div>
      <svg class="bl-svg" width="100%" height="8" aria-hidden="true"><rect width="100%" height="8" rx="4" fill="#1c2636"/><rect width="${w}%" height="8" rx="4" fill="#c9a45c"/></svg>
    </div>`;
  }).join('')}</div>${extra || ''}`;
}

function viewAnalysis() {
  if (!S.data) return '<div class="screen"><div class="card"><h3>Brak danych</h3><p>Analiza pojawi się po pierwszej aktualizacji automatu.</p></div></div>';
  const accs = accounts();
  const segs = [['all', 'Razem'], ...accs.map((a) => [a.id, a.short || a.name])];
  const rows = openPositions().filter((p) => S.acct === 'all' || p.account === S.acct).map((p) => ({ p, m: metrics(p) })).filter((r) => r.m);
  const total = rows.reduce((a, r) => a + r.m.valuePLN, 0);
  const accShort = (id) => accById(id)?.short || id;

  // --- do wyjścia na zero
  const losers = rows.filter((r) => r.m.pnlCC < 0).map((r) => ({ ...r, be: breakEven(r.m), tg: companyTarget(r.p) })).sort((a, b) => a.be.need - b.be.need);
  const winners = rows.filter((r) => r.m.pnlCC >= 0);
  const beTable = losers.length ? `<table class="tbl be">
    <thead><tr><th scope="col">Pozycja na minusie</th><th scope="col">Do zera</th><th scope="col">Śr. cel</th></tr></thead>
    <tbody>${losers.map(({ p, m, be, tg }) => {
      const ok = tg && tg.up >= be.need;
      return `<tr><td><span class="nm">${esc(p.name)}</span><span class="sub"><span class="tick">${esc(displaySymbol(p.symbol))}</span> ${esc(accShort(p.account))}</span></td>
        <td class="num"><b>${pct(be.need, be.need >= 0.1 ? 0 : 1)}</b><span class="sub">${esc(price(be.price, m.qc))}</span></td>
        <td class="num">${tg ? `<b class="${ok ? 'gain' : ''}">${pct(tg.up, 0)}</b><span class="sub">${ok ? 'powyżej progu' : 'poniżej progu'}</span>` : `<span class="faint">${p.type === 'etf' ? 'ETF' : 'brak'}</span>`}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="ok">Wszystkie pozycje są na plusie.</p>';
  const beNote = `<p class="small-note">„Do zera”: o ile musi wzrosnąć kurs, żeby wartość pozycji zrównała się z kosztem zakupu${accs.some((a) => feePct(a)) ? ' (w XTB po prowizji za przewalutowanie i przy dzisiejszym kursie walut)' : ''}. „Śr. cel”: potencjał do średniej ceny docelowej analityków.${winners.length ? ` Na plusie: ${esc([...new Set(winners.map((r) => (winners.filter((w) => w.p.name === r.p.name).length > 1 ? `${r.p.name} (${accShort(r.p.account)})` : r.p.name)))].join(', '))}.` : ''}</p>`;

  // --- struktura: spółki (łącznie z obu rachunków)
  const byCo = new Map();
  for (const { p, m } of rows) {
    const k = coKey(p);
    const x = byCo.get(k) || { label: p.name, value: 0, accs: new Set() };
    x.value += m.valuePLN; x.accs.add(accShort(p.account));
    byCo.set(k, x);
  }
  const cos = [...byCo.values()].map((x) => ({ ...x, sub: S.acct === 'all' && x.accs.size > 1 ? [...x.accs].join(' + ') : '' })).sort((a, b) => b.value - a.value);
  const top3 = cos.slice(0, 3).reduce((a, x) => a + x.value, 0);
  const coSummary = cos.length ? `<p class="small-note">Największa pozycja: ${esc(cos[0].label)} (${share(cos[0].value / total)}). Trzy największe: ${share(top3 / total)} portfela. Spółek i funduszy: ${cos.length}.</p>` : '';

  // --- branże i sektory
  const group = (fn) => {
    const g = new Map();
    for (const { p, m } of rows) { const k = fn(p); g.set(k, (g.get(k) || 0) + m.valuePLN); }
    return [...g].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const inds = group(industryOf);
  const secs = group(sectorOf);
  const secLine = secs.length ? `<p class="small-note">Sektory: ${esc(secs.map((x) => `${x.label} ${share(x.value / total)}`).join(' · '))}.</p>` : '';

  // --- waluty
  const curs = group((p) => quotes()[p.symbol]?.currency || 'USD').map((x) => ({ ...x, label: x.label === 'PLN' ? 'PLN (złoty)' : x.label }));
  const fxRows = curs.filter((x) => !x.label.startsWith('PLN')).map((x) => {
    const f = S.data.fx?.[x.label];
    const day = f?.r && f?.p ? f.r / f.p - 1 : null;
    return `<tr><td><b>${esc(x.label)}/PLN</b><span class="sub">${f?.r ? esc(nf(4).format(f.r)) : '—'}${day != null ? ` <span class="${cls(day)}">${pct(day, 2)}</span> dziś` : ''}</span></td>
      <td class="num"><b>±${money(x.value * 0.01, 'PLN', 0)}</b><span class="sub">przy zmianie kursu o 1%</span></td></tr>`;
  }).join('');

  // --- wycena spółek
  const vrows = companies().filter((co) => S.acct === 'all' || co.accounts.has(S.acct)).map((co) => ({ co, v: valuationOf(co.key) })).filter((r) => r.v);
  const valTable = vrows.length ? `<table class="tbl val">
    <thead><tr><th scope="col">Spółka</th><th scope="col">C/Z</th><th scope="col">C/Z prog.</th><th scope="col">Wzrost zysku</th></tr></thead>
    <tbody>${vrows.map(({ co, v }) => {
      const g = v.g1 ?? v.g0;
      return `<tr><td><span class="nm">${esc(co.name)}</span><span class="sub"><span class="tick">${esc(displaySymbol(co.symbol))}</span>${v.ps ? ` · C/S ${esc(ratio(v.ps))}` : ''}</span></td>
        <td class="num">${v.loss ? '<span class="faint">strata</span>' : `<b>${esc(ratio(v.pe))}</b>`}</td>
        <td class="num">${v.floss ? '<span class="faint">strata</span>' : `<b>${esc(ratio(v.fpe))}</b>`}</td>
        <td class="num"><b class="${cls(g)}">${gpct(g)}</b><span class="sub">${v.g1 != null ? 'następny rok' : v.g0 != null ? 'ten rok' : ''}</span></td></tr>`;
    }).join('')}</tbody></table>
    <p class="small-note">C/Z: cena do zysku z ostatnich 12 miesięcy (ile lat zysków płacisz za akcję). C/Z prog.: to samo dla prognozowanego zysku. Wzrost zysku: prognoza analityków dla zysku na akcję w następnym roku obrotowym. C/S: cena do sprzedaży. Szczegóły w karcie spółki.</p>` : '';

  // --- porównanie z indeksami
  const RANGES_CMP = [['1w', 'Tydzień'], ['1m', 'Miesiąc'], ['6m', '6 miesięcy'], ['1y', 'Rok'], ['3y', '3 lata']];
  const notes = [];
  const cmpRows = RANGES_CMP.map(([rk, label]) => {
    const pf = holdingsReturn(rk, S.acct);
    if (pf?.missing.length) notes.push(`${label.toLowerCase()} bez: ${pf.missing.join(', ')}`);
    const cells = Object.keys(BENCH).map((b) => { const x = priceSeries(b, rk); return x ? `<td class="num ${cls(x.chg)}">${pct(x.chg)}</td>` : '<td class="num faint">—</td>'; }).join('');
    return `<tr><td>${label}</td><td class="num ${cls(pf?.chg)}"><b>${pf ? pct(pf.chg) : '—'}</b></td>${cells}</tr>`;
  }).join('');

  return `
  <div class="seg" role="group" aria-label="Rachunek">${segs.map(([id, label]) => `<button data-act="acct" data-arg="${esc(id)}" aria-pressed="${S.acct === id}">${esc(label)}</button>`).join('')}</div>
  <section class="an"><h2>Do wyjścia na zero</h2>${beTable}${beNote}</section>
  <section class="an"><h2>Porównanie z indeksami</h2>
    <p class="small-note top">Jak zachowywał się Twój obecny skład (te same liczby akcji), w walutach notowań.</p>
    <table class="tbl cmp"><thead><tr><th scope="col">Okres</th><th scope="col">Portfel</th>${Object.values(BENCH).map((b) => `<th scope="col">${esc(b)}</th>`).join('')}</tr></thead><tbody>${cmpRows}</tbody></table>
    ${notes.length ? `<p class="small-note">Krótsza historia notowań — ${esc(notes.join('; '))}.</p>` : ''}
  </section>
  ${valTable ? `<section class="an"><h2>Wycena spółek</h2>${valTable}</section>` : ''}
  <section class="an"><h2>Udział spółek</h2>${barList(cos, total)}${coSummary}</section>
  <section class="an"><h2>Branże</h2>${barList(inds, total)}${secLine}<p class="small-note">Branże wg Yahoo Finance. Własną nazwę branży ustawisz w edycji pozycji.</p></section>
  <section class="an"><h2>Waluty</h2>${barList(curs, total)}
    ${fxRows ? `<table class="tbl fxs"><tbody>${fxRows}</tbody></table>
    <p class="small-note">Wartość akcji zagranicznych w złotych zmienia się też z kursem walut — w XTB wpływa to na wynik od zakupu, w IBKR na wartość rachunku po przeliczeniu na złote.</p>` : ''}
  </section>`;
}

// ============================================================== rekomendacje

function companies() {
  const map = new Map();
  for (const p of openPositions()) {
    if (p.type === 'etf') continue;
    const syms = p.recSymbols?.length ? p.recSymbols : [p.symbol];
    const key = syms[0];
    if (!map.has(key)) map.set(key, { key, name: p.name, symbol: p.symbol, syms, accounts: new Set(), value: 0 });
    const c = map.get(key);
    c.accounts.add(p.account);
    c.value += metrics(p)?.valuePLN || 0;
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

function firmGroups(co) {
  const cutoff = Date.now() / 1000 - 365 * 86400;
  const items = [];
  for (const s of co.syms) for (const it of S.data?.recs?.[s]?.items || []) if (it.ts >= cutoff) items.push({ ...it, sym: s });
  items.sort((a, b) => b.ts - a.ts);
  const groups = new Map();
  for (const it of items) {
    const k = (it.firm || '?').toLowerCase() + '|' + it.sym;
    if (!groups.has(k)) groups.set(k, { key: co.key + '|' + k, firm: it.firm || '—', sym: it.sym, hist: [] });
    groups.get(k).hist.push(it);
  }
  for (const g of groups.values()) {
    const latest = g.hist[0];
    const withPt = g.hist.filter((h) => h.pt);
    g.latest = latest;
    g.pt = latest.pt || withPt[0]?.pt || null;
    g.ptp = latest.ptp || (latest.pt ? withPt.find((h) => h !== latest && h.pt)?.pt : withPt[1]?.pt) || null;
    if (g.ptp === g.pt && !latest.ptp) g.ptp = null;
    g.b = bucket(latest.to);
  }
  return [...groups.values()];
}

function newRecs() {
  if (!S.data?.recs || !S.doc) return [];
  const out = [];
  for (const co of companies()) {
    for (const g of firmGroups(co)) for (const it of g.hist) if (it.ts * 1000 > S.newSince) out.push({ co, g, it });
  }
  return out.sort((a, b) => b.it.ts - a.it.ts);
}

function consensusOf(co, groups) {
  const trend = S.data?.recs?.[co.syms[0]]?.trend || [];
  const t0 = trend.find((t) => t.period === '0m');
  const t3 = trend.find((t) => t.period === '-3m');
  const fromTrend = (t) => t && { buy: t.strongBuy + t.buy, hold: t.hold, sell: t.sell + t.strongSell };
  if (t0 && t0.strongBuy + t0.buy + t0.hold + t0.sell + t0.strongSell > 0) return { now: fromTrend(t0), before: fromTrend(t3), src: 'yahoo' };
  const c = { buy: 0, hold: 0, sell: 0 };
  for (const g of groups) if (g.b in c) c[g.b]++;
  return { now: c, before: null, src: 'firms' };
}

let barId = 0;
function consensusBar(c, mini) {
  const total = c.buy + c.hold + c.sell;
  if (!total) return '';
  const id = 'cb' + ++barId;
  let x = 0;
  const segs = [['buy', c.buy], ['hold', c.hold], ['sell', c.sell]].filter(([, n]) => n > 0);
  const rects = [], gaps = [];
  segs.forEach(([b, n], i) => {
    const w = (n / total) * 100;
    rects.push(`<rect x="${x.toFixed(3)}%" y="0" width="${w.toFixed(3)}%" height="10" fill="${b === 'buy' ? '#2fa98a' : b === 'hold' ? '#7c8698' : '#e2674f'}"/>`);
    x += w;
    if (i < segs.length - 1) gaps.push(`<line x1="${x.toFixed(3)}%" x2="${x.toFixed(3)}%" y1="0" y2="10" stroke="#151d2b" stroke-width="2"/>`);
  });
  return `<svg class="bar${mini ? ' mini' : ''}" width="100%" height="10" role="img" aria-label="Kupuj ${c.buy}, trzymaj ${c.hold}, sprzedaj ${c.sell}"><defs><clipPath id="${id}"><rect width="100%" height="10" rx="4"/></clipPath></defs><g clip-path="url(#${id})">${rects.join('')}${gaps.join('')}</g></svg>`;
}

function viewRecs() {
  if (!S.data) return `<div class="screen"><div class="card"><h3>Brak danych</h3><p>Rekomendacje pojawią się po pierwszej aktualizacji automatu.</p></div></div>`;
  const cos = companies();
  const fresh = newRecs();
  const etfs = openPositions().filter((p) => p.type === 'etf').map((p) => p.name);
  const newBox = fresh.length ? `<section class="newbox" aria-label="Nowe rekomendacje">
    <h3>Nowe od ostatniej wizyty: ${fresh.length}</h3>
    <ul>${fresh.slice(0, 8).map(({ co, g, it }) => `<li><button class="nr" data-act="gotoCo" data-arg="${esc(co.key)}">
      <span class="nr-top"><b>${esc(co.name)}</b><span class="faint">${esc(g.firm)}</span><span class="when">${dateFmt(it.ts * 1000)}</span></span>
      <span class="nr-mid">${pill(bucket(it.to))}<span class="muted">${esc(it.to || '')}</span>${it.pt ? `<span class="num nr-pt">${targetMove(it.ptp, it.pt, curOf(g.sym))}</span>` : ''}</span>
    </button></li>`).join('')}</ul>${fresh.length > 8 ? `<div class="faint nr-more">i ${fresh.length - 8} wcześniejszych — w kartach spółek poniżej</div>` : ''}
  </section>` : '';
  return `${newBox}
  <p class="note hint-top">Dotknij spółki, żeby zobaczyć wykres ceny i rekomendacje wszystkich firm (od najnowszych).</p>
  ${cos.map((co) => companyCard(co)).join('')}
  ${etfs.length ? `<p class="note">${esc(etfs.join(', '))} to fundusze ETF — analitycy nie wydają dla nich rekomendacji.</p>` : ''}
  <p class="note">Źródło: Yahoo Finance. Rekomendacje z ostatnich 12 miesięcy, odświeżane co 3 godziny. To informacje, nie porada inwestycyjna.</p>`;
}

const curOf = (sym) => quotes()[sym]?.currency || 'USD';

function companyCard(co) {
  const open = S.openCo.has(co.key);
  const groups = firmGroups(co); // od najnowszej rekomendacji
  const q = quotes()[co.syms[0]] || quotes()[co.symbol];
  const qc = q?.currency || 'USD';
  const sesq = quoteSession(co.symbol);
  const dayPct = q?.prevClose ? q.price / q.prevClose - 1 : null;
  const cons = consensusOf(co, groups);
  const tg = S.data?.recs?.[co.syms[0]]?.targets;
  const mainGroups = groups.filter((g) => g.sym === co.syms[0]);
  const pts = mainGroups.map((g) => g.pt).filter(Boolean);
  const mean = tg?.mean || (pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null);
  const low = tg?.low || (pts.length ? Math.min(...pts) : null);
  const high = tg?.high || (pts.length ? Math.max(...pts) : null);
  const up = mean && q?.price ? mean / q.price - 1 : null;
  const total = cons.now.buy + cons.now.hold + cons.now.sell;
  const latest = groups[0];
  const nNew = groups.reduce((n, g) => n + g.hist.filter((h) => h.ts * 1000 > S.newSince).length, 0);
  const head = `<button class="co-toggle" data-act="co" data-arg="${esc(co.key)}" aria-expanded="${open}">
      <span class="co-l1"><span class="co-name">${esc(co.name)}</span><span class="price num">${q ? price(q.price, qc) : '—'}</span></span>
      <span class="co-l2"><span class="tick">${esc(co.syms.map(displaySymbol).join(' / '))}</span>${nNew ? `<span class="newb">nowe: ${nNew}</span>` : ''}<span class="grow"></span><span class="${cls(dayPct)}">${dayPct != null ? `${sesq ? (sesq.live ? 'dziś' : 'sesja ' + esc(fmtDM(sesq.date))) : ''} ${pct(dayPct)}` : ''}</span></span>
      ${total ? `<span class="co-l3">${consensusBar(cons.now, true)}<span class="co-cnt">Kupuj ${cons.now.buy} · Trzymaj ${cons.now.hold} · Sprzedaj ${cons.now.sell}</span></span>` : ''}
      <span class="co-l4"><span>${latest ? `Ostatnia: ${esc(dateFmt(latest.latest.ts * 1000))}, ${esc(latest.firm)}` : 'Brak rekomendacji z 12 miesięcy'}</span>${mean ? `<span class="num">śr. cel <span class="${cls(up)}">${pct(up)}</span></span>` : ''}<span class="chev" aria-hidden="true"></span></span>
    </button>`;
  if (!open) return `<article class="co" id="co-${esc(co.key)}">${head}</article>`;
  const showAll = S.showAllFirms.has(co.key);
  const shown = showAll ? groups : groups.slice(0, 10);
  const domains = {};
  for (const g of groups) {
    const d = (domains[g.sym] ||= { lo: Infinity, hi: -Infinity });
    for (const v of [g.pt, g.ptp, quotes()[g.sym]?.price]) if (v) { d.lo = Math.min(d.lo, v); d.hi = Math.max(d.hi, v); }
  }
  const before = cons.before && cons.before.buy + cons.before.hold + cons.before.sell ? cons.before : null;
  return `<article class="co open" id="co-${esc(co.key)}">${head}
    <div class="co-body">
      <div class="pc-wrap">${priceChart(co.symbol)}</div>
      ${total ? `<div class="consensus">
        <div class="src-line">${cons.src === 'yahoo' ? 'Konsensus: wszyscy analitycy wg Yahoo.' : 'Konsensus: ostatnie rekomendacje firm z 12 miesięcy.'}${before ? ` Trzy miesiące temu: kupuj ${before.buy}, trzymaj ${before.hold}, sprzedaj ${before.sell}.` : ''}</div>
        ${mean ? `<div class="target-sum">
          <div><div class="k">Średni cel</div><div class="v num">${target(mean, qc)}</div><div class="k ${cls(up)}">${pct(up)}</div></div>
          <div><div class="k">Najniższy</div><div class="v num">${target(low, qc)}</div><div class="k ${cls(low && q ? low / q.price - 1 : null)}">${low && q ? pct(low / q.price - 1) : ''}</div></div>
          <div><div class="k">Najwyższy</div><div class="v num">${target(high, qc)}</div><div class="k ${cls(high && q ? high / q.price - 1 : null)}">${high && q ? pct(high / q.price - 1) : ''}</div></div>
        </div>` : ''}
      </div>` : ''}
      ${(() => {
        const n = noteOf(co.key);
        if (!n || !(n.target || n.warn)) return '';
        const c = n.cur || qc;
        return `<div class="own-plan">Twój plan: ${[n.target ? `cel ${esc(target(n.target, c))}${q?.price && (n.cur || qc) === qc ? ` <span class="${cls(n.target / q.price - 1)}">${pct(n.target / q.price - 1)}</span>` : ''}` : '', n.warn ? `ostrzeżenie poniżej ${esc(target(n.warn, c))}` : ''].filter(Boolean).join(' · ')}</div>`;
      })()}
      ${newsOf(co.key).length ? `<div class="co-news"><div class="src-line">Wiadomości</div>${newsList(co.key, 3)}</div>` : ''}
      ${groups.length ? `<div class="firms">
        <div class="firm legend-line">Od najnowszych. Każda firma: ostatnia rekomendacja, cel poprzedni → obecny i potencjał względem kursu. Pasek: ○ poprzedni cel, ● obecny, złota kreska to kurs.</div>
        ${shown.map((g) => firmRow(g, domains[g.sym])).join('')}
      </div>
      ${groups.length > 10 ? `<button class="more" data-act="allFirms" data-arg="${esc(co.key)}">${showAll ? 'Pokaż mniej' : `Pokaż wszystkie firmy (${groups.length})`}</button>` : ''}`
      : '<div class="co-foot"><span>Brak rekomendacji z ostatnich 12 miesięcy w Yahoo Finance.</span></div>'}
      <div class="co-foot"><span>${co.syms.length > 1 ? 'Rekomendacje z kilku notowań' : ''}</span><a href="https://finance.yahoo.com/quote/${encodeURIComponent(co.syms[0])}/analysis" target="_blank" rel="noopener noreferrer">Yahoo Finance</a></div>
    </div>
  </article>`;
}

function firmRow(g, dom) {
  const it = g.latest;
  const cur = curOf(g.sym);
  const px = quotes()[g.sym]?.price;
  const up = g.pt && px ? g.pt / px - 1 : null;
  const arrow = it.act === 'up' ? '<span class="gain" aria-label="podwyższenie">▲</span>' : it.act === 'down' ? '<span class="loss" aria-label="obniżenie">▼</span>' : '';
  const grade = it.from && it.from !== it.to ? `${esc(it.from)} → ${esc(it.to)}` : esc(it.to || '—');
  const open = S.openFirm.has(g.key);
  return `<div class="firm">
    <button class="firm-btn" data-act="firm" data-arg="${esc(g.key)}" aria-expanded="${open}">
      <span class="firm-top"><span class="who">${esc(g.firm)}</span><span class="when">${dateFmt(it.ts * 1000)}</span></span>
      <span class="firm-mid">${pill(g.b, BUCKET_PL[g.b])}${arrow}<span class="grade">${grade}</span>
        <span class="pt num">${g.pt ? `${targetMove(g.ptp, g.pt, cur)}<span class="up ${cls(up)}">${pct(up, 0)}</span>` : '<span class="faint">bez ceny docelowej</span>'}</span>
      </span>
      ${g.pt && dom && isFinite(dom.lo) ? track(g, dom, px) : ''}
    </button>
    ${open ? `<div class="firm-hist">${g.hist.map((h) => `<div><span>${dateFmt(h.ts * 1000)}</span><span>${esc(ACT_PL[h.act] || h.act || '')}: ${esc(h.to || '—')}${h.pt ? `, cel ${targetMove(h.ptp, h.pt, cur)}` : ''}</span></div>`).join('')}</div>` : ''}
  </div>`;
}

// pasek: poprzedni cel (○) → obecny cel (●), kreska = obecny kurs; wspólna skala w obrębie spółki
function track(g, dom, px) {
  const pad = (dom.hi - dom.lo) * 0.06 || dom.hi * 0.05 || 1;
  const lo = dom.lo - pad, hi = dom.hi + pad;
  const X = (v) => (((v - lo) / (hi - lo)) * 96 + 2).toFixed(2) + '%';
  const col = g.b === 'buy' ? '#2fa98a' : g.b === 'sell' ? '#e2674f' : '#7c8698';
  const moveCol = g.ptp && g.pt > g.ptp ? '#2fa98a' : g.ptp && g.pt < g.ptp ? '#e2674f' : '#7c8698';
  return `<span class="track"><svg role="img" aria-label="Cel ${target(g.pt, curOf(g.sym))}${g.ptp ? ', wcześniej ' + target(g.ptp, curOf(g.sym)) : ''}${px ? ', kurs ' + price(px, curOf(g.sym)) : ''}">
    <line x1="2%" x2="98%" y1="11" y2="11" stroke="#263247" stroke-width="1"/>
    ${px ? `<line x1="${X(px)}" x2="${X(px)}" y1="2" y2="20" stroke="#c9a45c" stroke-width="2"/>` : ''}
    ${g.ptp ? `<line x1="${X(g.ptp)}" x2="${X(g.pt)}" y1="11" y2="11" stroke="${moveCol}" stroke-width="2"/><circle cx="${X(g.ptp)}" cy="11" r="4" fill="#151d2b" stroke="#9aa6b8" stroke-width="1.5"/>` : ''}
    <circle cx="${X(g.pt)}" cy="11" r="5" fill="${col}" stroke="#151d2b" stroke-width="2"/>
  </svg></span>`;
}

// ============================================================== ustawienia

function viewSettings() {
  const d = S.data;
  const st = d?.status || {};
  const repo = ghRepo();
  return `<div class="screen">
    <div class="card"><h3>Dane</h3>
      <dl class="kv">
        <dt>Ostatnia aktualizacja</dt><dd>${d?.generatedAt ? dtFmt(Date.parse(d.generatedAt)) : 'jeszcze nie było'}</dd>
        <dt>Notowania</dt><dd>${st.quotes ? `${st.quotes[0]} z ${st.quotes[1]}` : '—'}</dd>
        <dt>Wiadomości / wycena</dt><dd>${d?.news ? `${Object.values(d.news).filter((x) => x?.v?.length).length} / ${Object.values(d.valuation || {}).filter((x) => x?.v && Object.keys(x.v).length).length} spółek` : '—'}</dd>
        <dt>Powiadomienia Telegram</dt><dd>${esc(st.telegram || '—')}</dd>
        <dt>Automat w GitHub</dt><dd id="runStatus" class="faint">—</dd>
        <dt>Zużycie minut automatu</dt><dd id="minutes" class="faint"><button class="linkish" data-act="minutes">Sprawdź</button></dd>
      </dl>
      <div class="btns"><button class="btn" data-act="run">Pobierz notowania teraz</button><button class="btn" data-act="reload">Wczytaj ponownie</button></div>
    </div>

    <div class="card"><h3>Pozycje</h3>
      <p>Dokupienie, sprzedaż i poprawki. Liczba akcji oznaczona „szac.” została wyliczona z wartości pozycji.</p>
      <div class="list flush">${(S.doc.positions || []).filter((p) => !p.closed).map((p) => {
        const [q, est] = qtyOf(p);
        return `<button class="row" data-act="edit" data-arg="${esc(p.id)}"><span class="name">${esc(p.name)}</span><span class="val num">${qtyFmt(q)} szt.${est && q != null ? ' <span class="est">szac.</span>' : ''}</span><span class="meta"><span class="tick">${esc(displaySymbol(p.symbol))}</span><span class="acct">${esc(accById(p.account)?.short || p.account)}</span></span><span class="moves faint">${money(+p.cost, p.costCurrency)}</span></button>`;
      }).join('')}</div>
      <div class="btns"><button class="btn" data-act="new">${icon('plus')}Dodaj pozycję</button></div>
    </div>

    <div class="card"><h3>Rachunki</h3>
      <p>Prowizja za przewalutowanie przy sprzedaży pomniejsza wartość pozycji w obcej walucie, tak jak liczy ją broker.</p>
      ${accounts().map((a) => `<div class="field"><label for="fee-${esc(a.id)}">${esc(a.name)}: prowizja za przewalutowanie (%)</label>
        <input id="fee-${esc(a.id)}" type="number" step="0.01" min="0" inputmode="decimal" value="${feePct(a)}"></div>`).join('')}
      <div class="btns"><button class="btn" data-act="saveFees">Zapisz prowizje</button></div>
    </div>

    ${notifyCard()}
    ${alertsCard()}

    <div class="card"><h3>Dopasuj do brokera</h3>
      <p>Broker wycenia pozycje po swojej cenie sprzedaży i swoim kursie walut. Wpisz łączną wartość pozycji (bez wolnej gotówki), którą teraz pokazuje broker, a Portfel ustawi wycenę tak, żeby się zgadzała. Poprawka zostaje przy kolejnych aktualizacjach.</p>
      <p class="small-note">Ceny w Portfelu: ${S.data?.generatedAt ? dtFmt(Date.parse(S.data.generatedAt)) : '—'}. Najdokładniej wychodzi po zamknięciu sesji w USA (po 22:00) albo w weekend. Pojedynczą spółkę dopasujesz w jej edycji.</p>
      ${accounts().map((a) => {
        const adjusted = openPositions().filter((p) => p.account === a.id && validAdj(p.adj)).length;
        return `<div class="field"><label for="match-${esc(a.id)}">${esc(a.name)}: wartość pozycji teraz (${esc(a.currency)})</label>
        <input id="match-${esc(a.id)}" type="number" step="any" inputmode="decimal" placeholder="obecnie w Portfelu: ${esc(nf(2).format(totals(a.id).v))}">
        ${adjusted ? `<span class="hint">Dopasowane pozycje: ${adjusted}. <button class="linkish" data-act="clearAccAdj" data-arg="${esc(a.id)}">Usuń dopasowanie</button></span>` : ''}</div>
        <div class="btns"><button class="btn" data-act="matchAcc" data-arg="${esc(a.id)}">Dopasuj ${esc(a.short || a.name)}</button></div>`;
      }).join('')}
      <div id="matchMsg"></div>
    </div>

    <div class="card" id="ghCard"><h3>Połączenie z GitHub</h3>
      <p>Automat pobiera notowania co godzinę sam, bez tokenu. Token jest potrzebny tylko, żeby z tego urządzenia zapisywać zmiany pozycji i używać przycisku „Pobierz notowania teraz”.</p>
      ${LS.get('pat') ? `<p class="ok">Ten ${esc(deviceName())} ma token${S.tokenFromVault ? ' (pobrany z sejfu)' : ''}.</p>` : `<p class="warn">Ten ${esc(deviceName())} nie ma tokenu. Wklej go poniżej albo na urządzeniu, które go ma, użyj „Udostępnij token moim urządzeniom”.</p>`}
      <div class="field"><label for="repo">Repozytorium z danymi</label><input id="repo" type="text" value="${esc(repo)}" placeholder="login/portfel" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label for="pat">Token (fine-grained)</label><input id="pat" type="password" placeholder="${LS.get('pat') ? 'zapisany — wpisz nowy, aby zmienić' : 'github_pat_…'}" autocomplete="off"></div>
      <div class="btns"><button class="btn primary" data-act="saveGh">Zapisz</button>${LS.get('pat') ? '<button class="btn danger" data-act="delPat">Usuń token z urządzenia</button>' : ''}</div>
      <div id="ghMsg"></div>
      ${LS.get('pat') ? `<div class="sharebox">
        <h4>Udostępnij token moim urządzeniom</h4>
        <p>Token trafi do sejfu, zaszyfrowany Twoim hasłem jak pozycje. Telefon lub komputer pobierze go sam po odblokowaniu. Kto zna hasło do sejfu, będzie mógł też zmieniać pliki w repozytoriach portfela.</p>
        <div class="btns">${S.doc.sharedPat ? '<button class="btn" data-act="unshareTok">Usuń token z sejfu</button>' : '<button class="btn" data-act="shareTok">Udostępnij token</button>'}</div>
      </div>` : ''}
    </div>

    <div class="card"><h3>To urządzenie</h3>
      <label class="check"><input type="checkbox" data-act="remember" ${S.remembered ? 'checked' : ''}> Pamiętaj odblokowanie przez 30 dni</label>
      <p class="mt10">Bez tej opcji aplikacja blokuje się po 10 minutach w tle.</p>
      <div class="btns"><button class="btn" data-act="lock">${icon('lock')}Zablokuj teraz</button><button class="btn" data-act="backup">Pobierz kopię pozycji</button></div>
    </div>
  </div>`;
}

// powiadomienia (te same domyślne wartości co engine/notify.py: NOTIFY_DEFAULTS)
const NOTIFY_DEFAULTS = { recs: true, sellDown: true, earnings: true, r52: true, target: true, weekly: true, macro: true };
const NOTIFY_LABELS = [
  ['recs', 'Każda nowa rekomendacja analityka'],
  ['sellDown', 'Obniżenie rekomendacji do „sprzedaj” (wyróżnione; przychodzi nawet przy wyłączonej opcji wyżej)'],
  ['earnings', 'Wyniki finansowe: przypomnienie dzień wcześniej i wiadomość po publikacji (zysk vs prognoza)'],
  ['r52', 'Nowe 52-tygodniowe minimum lub maksimum spółki'],
  ['target', 'Kurs osiągnął średnią cenę docelową analityków'],
  ['weekly', 'Podsumowanie tygodnia w piątek po zamknięciu sesji w USA'],
  ['macro', 'Wydarzenia makro w USA (Fed, inflacja CPI, rynek pracy) — przypomnienie dzień wcześniej'],
];
function notifyCard() {
  const c = { ...NOTIFY_DEFAULTS, ...(S.doc?.notify || {}) };
  const pa = (S.doc?.priceAlerts || []);
  const fired = S.data?.state?.customFired || {};
  const names = Object.fromEntries(openPositions().map((p) => [p.symbol, p.name]));
  return `<div class="card"><h3>Powiadomienia w Telegramie</h3>
    ${NOTIFY_LABELS.map(([k, l]) => `<label class="check"><input type="checkbox" id="nt-${k}" ${c[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
    <div class="btns"><button class="btn" data-act="saveNotify">Zapisz powiadomienia</button><button class="btn" data-act="sendSummary">Wyślij podsumowanie teraz</button></div>
    <p class="small-note">Własne progi cenowe (np. „NVIDIA poniżej 150 USD”) oraz tezę z celem i poziomem ostrzegawczym ustawisz w szczegółach spółki. Przy alertach o dużym ruchu kursu dołączam najświeższy nagłówek z ostatniej doby. ${pa.length ? `Aktywne: ${esc(pa.filter((a) => !fired[a.id]).map((a) => `${names[a.sym] || a.sym} ${a.op === 'lt' ? '<' : '>'} ${nf(2).format(a.price)}`).join(', ') || 'brak')}.` : ''}</p>
  </div>`;
}

async function checkMinutes() {
  const el = $('#minutes');
  if (!el) return;
  if (!(await ghToken())) { el.textContent = 'potrzebny token GitHub na tym urządzeniu'; return; }
  el.textContent = 'liczę…';
  try {
    const now = new Date();
    const first = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    let total = 0, runs = 0;
    for (let page = 1; page <= 15; page++) {
      const r = await gh('GET', `/repos/${ghRepo()}/actions/runs?created=%3E%3D${first}&per_page=100&page=${page}`);
      const list = r?.workflow_runs || [];
      for (const w of list) {
        const a = Date.parse(w.run_started_at || w.created_at), b = Date.parse(w.updated_at);
        if (a && b && b > a) { total += Math.max(1, Math.ceil((b - a) / 60000)); runs++; }
      }
      if (list.length < 100) break;
    }
    const day = now.getUTCDate() - 1 + (now.getUTCHours() + now.getUTCMinutes() / 60) / 24;
    const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const forecast = day > 0.5 ? Math.round((total / day) * days) : null;
    el.textContent = `ok. ${total} min z 2000 w tym miesiącu (${runs} uruchomień)${forecast ? `, prognoza na cały miesiąc ~${forecast} min` : ''}`;
    el.className = forecast && forecast > 1800 ? 'loss' : 'faint';
  } catch (e) { el.textContent = e.message; }
}

// alerty cenowe (te same domyślne wartości co engine/update.py: ALERT_DEFAULTS)
const ALERT_DEFAULTS = { on: true, up: 5, upStep: 5, down: 3, downStep: 3, everyH: 4 };
const alertCfg = () => ({ ...ALERT_DEFAULTS, ...(S.doc?.alerts || {}) });

function alertsCard() {
  const c = alertCfg();
  const f1 = (v) => esc(new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(v));
  const st = S.data?.status || {};
  const tgOff = !st.telegram || st.telegram === 'brak';
  const field = (id, label, v) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" step="0.5" min="0.5" inputmode="decimal" value="${esc(v)}"></div>`;
  return `<div class="card"><h3>Alerty cenowe w Telegramie</h3>
    <p>Wiadomość, gdy spółka mocno zmieni się w ciągu dnia (od wczorajszego zamknięcia). Po kliknięciu „Widziałem” kolejny alert przyjdzie dopiero przy następnym progu. Bez kliknięcia alert zostanie przypomniany przy następnym sprawdzeniu, jeśli kurs nadal jest za progiem. Następnego dnia progi liczą się od nowa.</p>
    ${tgOff ? '<p class="small-note">Telegram nie jest jeszcze podłączony — instrukcja w README, punkt 8.</p>' : ''}
    <label class="check"><input id="al-on" type="checkbox" ${c.on ? 'checked' : ''}> Alerty włączone</label>
    <div class="two">${field('al-up', 'Wzrost od (%)', c.up)}${field('al-upStep', 'potem co (%)', c.upStep)}</div>
    <div class="two">${field('al-down', 'Spadek od (%)', c.down)}${field('al-downStep', 'potem co (%)', c.downStep)}</div>
    ${field('al-every', 'Sprawdzaj ceny co (godz.)', c.everyH)}
    <p class="small-note">Teraz: wzrost +${f1(c.up)}%, +${f1(c.up + c.upStep)}%, +${f1(c.up + 2 * c.upStep)}%… i spadek −${f1(c.down)}%, −${f1(c.down + c.downStep)}%, −${f1(c.down + 2 * c.downStep)}%…${st.alertCheckAt ? ` Ostatnie sprawdzenie: ${esc(dtFmt(Date.parse(st.alertCheckAt)))}.` : ''}</p>
    <div class="btns"><button class="btn" data-act="saveAlerts">Zapisz alerty</button></div>
  </div>`;
}

function deviceName() { return /iPhone|Android.+Mobile/.test(navigator.userAgent) ? 'telefon' : /iPad|Android/.test(navigator.userAgent) ? 'tablet' : 'komputer'; }

async function refreshRunStatus() {
  const el = $('#runStatus');
  if (!el) return;
  if (!(await ghToken())) {
    const gen = S.data?.generatedAt ? Date.parse(S.data.generatedAt) : null;
    el.textContent = gen ? `działa co godzinę (ostatnio ${dtFmt(gen)})` : 'działa co godzinę';
    el.className = 'faint';
    return;
  }
  try {
    const r = await ghLastRun();
    if (!r) { el.textContent = 'jeszcze nie uruchomiony'; return; }
    const when = dtFmt(Date.parse(r.updated_at || r.created_at));
    const txt = r.status !== 'completed' ? `w toku (${when})` : r.conclusion === 'success' ? `OK (${when})` : `błąd (${when})`;
    el.textContent = txt;
    el.className = r.status === 'completed' && r.conclusion !== 'success' ? 'loss' : 'faint';
  } catch (e) { el.textContent = e.message; }
}

// ============================================================== arkusze: szczegóły pozycji, edycja, kupno/sprzedaż

function openSheet(title, body) {
  closeSheet();
  const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.dataset.act = 'closeSheet';
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Zamknij">${icon('close')}</button></div><div class="screen">${body}</div>`;
  document.body.append(bg, sh);
  S.sheet = sh;
  document.body.style.overflow = 'hidden';
  return sh;
}
function closeSheet() {
  document.querySelectorAll('.sheet, .sheet-bg').forEach((e) => e.remove());
  S.sheet = null;
  document.body.style.overflow = '';
}

function showPosition(id) {
  const p = S.doc.positions.find((x) => x.id === id);
  if (!p) return;
  const m = metrics(p);
  const acc = accById(p.account);
  const q = quotes()[p.symbol];
  let recBlock = '';
  if (p.type === 'etf') recBlock = '<p class="note flush">Fundusz ETF — analitycy nie wydają rekomendacji dla funduszy.</p>';
  else {
    const co = companies().find((c) => c.syms.includes(p.symbol) || c.symbol === p.symbol);
    if (co) {
      const groups = firmGroups(co);
      const cons = consensusOf(co, groups);
      const tg = S.data?.recs?.[co.syms[0]]?.targets;
      const total = cons.now.buy + cons.now.hold + cons.now.sell;
      recBlock = `<div class="card"><h3>Rekomendacje</h3>${total ? `${consensusBar(cons.now)}<div class="legend"><span><i class="b-buy"></i>Kupuj ${cons.now.buy}</span><span><i class="b-hold"></i>Trzymaj ${cons.now.hold}</span><span><i class="b-sell"></i>Sprzedaj ${cons.now.sell}</span></div>` : '<p>Brak danych.</p>'}
        ${tg?.mean && q ? `<dl class="kv"><dt>Średnia cena docelowa</dt><dd class="num">${target(tg.mean, q.currency)} <span class="${cls(tg.mean / q.price - 1)}">${pct(tg.mean / q.price - 1)}</span></dd></dl>` : ''}
        <div class="btns"><button class="btn" data-act="gotoCo" data-arg="${esc(co.key)}">Zobacz wszystkie firmy (${groups.length})</button></div></div>`;
    }
  }
  const daily = Object.entries(S.data?.daily || {}).filter(([, row]) => row[p.id]).map(([day, row]) => ({ t: Date.parse(day + 'T12:00:00'), y: row[p.id][1] }));
  const avg = m && m.qty ? m.costCC / m.qty : null;
  const ses = quoteSession(p.symbol);
  const st = ses?.st || marketStatus(marketKey(p.symbol));
  const ext = extQuote(p.symbol);
  const be = breakEven(m);
  const tg = companyTarget(p);
  const evn = S.data?.earnings?.[coKey(p)]?.next;
  const nextE = evn?.ts && evn.ts * 1000 > Date.now() ? `${fmtDayPL(evn.ts * 1000)}${evn.estimate ? ' (termin szacowany)' : `, ${fmtHourPL(evn.ts * 1000)}${sessionOf(p.symbol, evn.ts * 1000) ? ' ' + sessionOf(p.symbol, evn.ts * 1000) : ''}`}${evn.epsEst != null ? ` · prognoza EPS ${price(evn.epsEst, q?.currency)}` : ''}` : '';
  const body = `
    <div class="hero tight">
      <div class="label"><span class="tick">${esc(displaySymbol(p.symbol))}</span> ${esc(q?.exchange || '')}</div>
      ${st ? `<div class="mkts flush"><span class="mkt ${st.state}"><i aria-hidden="true"></i><b>${esc(st.name)}</b> ${esc(statusText(st))}</span></div>` : ''}
      <div class="value md">${q ? price(q.price, q.currency) : '—'}</div>
      <div class="sub">${ses ? `${ses.live ? `Dzisiejsza sesja (trwa, cena z ${esc(fmtHourPL(ses.time))})` : `Sesja ${esc(fmtDM(ses.date))} (zamknięcie)`}: ` : ''}<span class="${cls(m?.priceDayPct)}">${m?.priceDayPct != null ? pct(m.priceDayPct) : ''}</span>${q?.stale ? ' · stara cena' : ''}</div>
      ${ext ? `<div class="sub">${esc(ext.label)} ${esc(fmtHourPL(ext.t))}: ${esc(price(ext.p, q.currency))} <span class="${cls(ext.chg)}">${pct(ext.chg)}</span></div>` : ''}
    </div>
    <div class="card pc-card">${priceChart(p.symbol)}</div>
    <div class="card"><dl class="kv">
      <dt>Rachunek</dt><dd>${esc(acc?.name || p.account)}</dd>
      <dt>Liczba</dt><dd class="num">${qtyFmt(m?.qty ?? qtyOf(p)[0])} szt.${m?.est ? ' <span class="est">szac.</span>' : ''}</dd>
      <dt>Średni koszt 1 szt.</dt><dd class="num">${money(avg, p.costCurrency, 2)}</dd>
      <dt>Koszt zakupu</dt><dd class="num">${money(+p.cost, p.costCurrency)}</dd>
      <dt>Wartość</dt><dd class="num">${m ? money(m.valueCC, m.cc) : '—'}${m && m.cc !== 'PLN' ? `<br><span class="faint">≈ ${money(m.valuePLN, 'PLN')}</span>` : ''}</dd>
      <dt>Wynik od zakupu</dt><dd class="num ${cls(m?.pnlCC)}">${m ? `${signedMoney(m.pnlCC, m.cc)} (${pct(m.pnlPct)})` : '—'}</dd>
      ${be ? `<dt>Próg zera</dt><dd class="num">${esc(price(be.price, m.qc))} <span class="${be.need > 0 ? 'loss' : 'gain'}">${be.need > 0 ? `wymaga ${pct(be.need)}` : `zapas ${pct(-be.need).replace('+', '')}`}</span></dd>` : ''}
      ${tg ? `<dt>Średni cel analityków</dt><dd class="num">${esc(target(tg.mean, tg.cur))} <span class="${cls(tg.up)}">${pct(tg.up)}</span></dd>` : ''}
      ${nextE ? `<dt>Wyniki finansowe</dt><dd>${esc(nextE)}</dd>` : ''}
      <dt>${ses ? (ses.live ? 'Dzisiejsza sesja' : `Sesja ${esc(fmtDM(ses.date))}`) : 'Ostatnia sesja'}</dt><dd class="num ${cls(m?.dayCC)}">${m?.dayCC != null ? `${signedMoney(m.dayCC, m.cc)} (${pct(m.dayPct)})` : '—'}</dd>
      ${p.realized ? `<dt>Zrealizowany wynik</dt><dd class="num ${cls(p.realized)}">${signedMoney(p.realized, p.costCurrency)}</dd>` : ''}
    </dl>
    ${m?.adj ? `<p class="small-note">Wycena dopasowana do brokera (${pct(m.adj - 1, 2)} względem ceny z Yahoo).</p>`
      : m && m.cc !== m.qc ? `<p class="small-note">Wynik w ${esc(CUR[m.cc] || m.cc)} obejmuje zmianę kursu ${esc(m.qc)}/${esc(m.cc)}${m.fee ? ` i jest pomniejszony o ${nf(2).format(m.fee * 100)}% prowizji za przewalutowanie przy sprzedaży` : ''}.</p>` : ''}
    </div>
    ${planCard(p)}
    ${p.type === 'etf' ? '' : newsCard(coKey(p), p.symbol)}
    ${p.type === 'etf' ? '' : valuationCard(coKey(p))}
    ${m?.low52 && m?.high52 ? rangeCard(m) : ''}
    ${priceAlertsCard(p.symbol)}
    <div class="card"><h3>Wynik dzień po dniu</h3><div class="chart sm" id="posChart"></div></div>
    ${recBlock}
    <div class="btns"><button class="btn" data-act="trade" data-arg="buy|${esc(p.id)}">Dokup</button><button class="btn" data-act="trade" data-arg="sell|${esc(p.id)}">Sprzedaj</button><button class="btn" data-act="edit" data-arg="${esc(p.id)}">Edytuj</button></div>`;
  const sh = openSheet(p.name, body);
  drawPriceCharts(sh);
  const el = sh.querySelector('#posChart');
  if (daily.length >= 2) lineChart(el, daily, (v) => money(v, 'PLN'), true, dateFmt, { label: 'Wynik pozycji' });
  else el.innerHTML = '<div class="empty-chart">Wykres pojawi się po drugim dniu zbierania danych.</div>';
}

// ---------- własne progi cenowe (jednorazowe powiadomienie w Telegramie)
function priceAlertsCard(sym) {
  const q = quotes()[sym];
  const cur = q?.currency || '';
  const list = (S.doc.priceAlerts || []).filter((a) => a.sym === sym);
  const fired = S.data?.state?.customFired || {};
  return `<div class="card" id="pa-${esc(sym)}"><h3>Powiadom mnie, gdy kurs…</h3>
    ${list.length ? `<ul class="pa-list">${list.map((a) => `<li><span>${a.op === 'lt' ? 'spadnie poniżej' : 'wzrośnie powyżej'} <b class="num">${esc(price(a.price, cur))}</b>${a.note ? `<span class="faint"> · ${esc(a.note)}</span>` : ''}</span>
      <span class="${fired[a.id] ? 'ok' : 'faint'}">${fired[a.id] ? `spełniony ${esc(dtFmt(Date.parse(fired[a.id])))}` : 'aktywny'}</span>
      <button class="linkish" data-act="delPA" data-arg="${esc(a.id)}">Usuń</button></li>`).join('')}</ul>` : '<p>Brak progów. Powiadomienie przyjdzie w Telegramie, gdy warunek się spełni (sprawdzane przy każdej aktualizacji).</p>'}
    <div class="pa-form">
      <select id="pa-op" aria-label="Warunek"><option value="lt">poniżej</option><option value="gt">powyżej</option></select>
      <input id="pa-price" type="number" step="any" inputmode="decimal" placeholder="${q?.price ? esc(nf(2).format(q.price)) : 'cena'}" aria-label="Cena (${esc(cur)})">
      <button class="btn" data-act="addPA" data-arg="${esc(sym)}">Dodaj</button>
    </div>
    <input id="pa-note" type="text" maxlength="80" placeholder="Notatka (opcjonalnie), np. dokupić" aria-label="Notatka">
    <div class="err" id="pa-err"></div>
  </div>`;
}

function rangeCard(m) {
  const lo = m.low52, hi = m.high52, px = m.price;
  const pos = hi > lo ? Math.min(Math.max((px - lo) / (hi - lo), 0), 1) : 0.5;
  const x = (2 + pos * 96).toFixed(2) + '%';
  const fromLow = px / lo - 1, fromHigh = px / hi - 1;
  return `<div class="card"><h3>Zakres 52 tygodni</h3>
    <div class="range52" role="img" aria-label="Kurs ${esc(price(px, m.qc))}, minimum ${esc(price(lo, m.qc))}, maksimum ${esc(price(hi, m.qc))}">
      <svg width="100%" height="22"><line x1="2%" x2="98%" y1="11" y2="11" stroke="#263247" stroke-width="4" stroke-linecap="round"/>
        <line x1="2%" x2="${x}" y1="11" y2="11" stroke="#7c8698" stroke-width="4" stroke-linecap="round"/>
        <circle cx="${x}" cy="11" r="6" fill="#c9a45c" stroke="#151d2b" stroke-width="2"/></svg>
    </div>
    <div class="range-labels num"><span>${esc(price(lo, m.qc))}<br><span class="faint">minimum</span></span><span class="r">${esc(price(hi, m.qc))}<br><span class="faint">maksimum</span></span></div>
    <p class="small-note">Kurs jest ${esc(pct(fromLow))} nad rocznym minimum i ${esc(pct(fromHigh))} od rocznego maksimum.</p>
  </div>`;
}

function editPosition(id) {
  const isNew = !id;
  const p = isNew ? { id: '', account: accounts()[0]?.id, symbol: '', name: '', type: 'stock', qty: null, cost: null, costCurrency: accounts()[0]?.currency || 'PLN', recSymbols: [] } : S.doc.positions.find((x) => x.id === id);
  const calQ = S.data?.calib?.[p.id]?.qty;
  const body = `
    <div class="field"><label for="f-name">Nazwa</label><input id="f-name" type="text" value="${esc(p.name)}"></div>
    <div class="two">
      <div class="field"><label for="f-sym">Symbol w Yahoo</label><input id="f-sym" type="text" value="${esc(p.symbol)}" autocapitalize="characters" spellcheck="false" placeholder="np. NVDA"></div>
      <div class="field"><label for="f-type">Rodzaj</label><select id="f-type"><option value="stock" ${p.type !== 'etf' ? 'selected' : ''}>Akcje</option><option value="etf" ${p.type === 'etf' ? 'selected' : ''}>ETF</option></select></div>
    </div>
    <div class="field"><label for="f-acc">Rachunek</label><select id="f-acc">${accounts().map((a) => `<option value="${esc(a.id)}" ${a.id === p.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="f-qty">Liczba akcji</label><input id="f-qty" type="number" step="any" inputmode="decimal" value="${p.qty ?? ''}" placeholder="${calQ ? 'wyliczona: ' + nf(4).format(calQ) : ''}">
      <span class="hint">${calQ && p.qty == null ? 'Puste pole = liczba wyliczona z wartości pozycji. Wpisz dokładną, jeśli ją znasz.' : 'Akcje ułamkowe wpisuj z przecinkiem lub kropką.'}</span></div>
    <div class="two">
      <div class="field"><label for="f-cost">Koszt zakupu łącznie</label><input id="f-cost" type="number" step="any" inputmode="decimal" value="${p.cost ?? ''}"></div>
      <div class="field"><label for="f-cc">Waluta kosztu</label><select id="f-cc">${['PLN', 'USD', 'EUR', 'GBP'].map((c) => `<option ${c === p.costCurrency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>
    ${isNew ? '' : (() => {
      const m = metrics(p); const acc = accById(p.account);
      return `<div class="field"><label for="f-match">Wartość tej pozycji w ${esc(acc?.short || acc?.name || 'u brokera')} teraz (${esc(p.costCurrency)}), opcjonalnie</label>
      <input id="f-match" type="number" step="any" inputmode="decimal" placeholder="${m ? 'obecnie w Portfelu: ' + esc(nf(2).format(m.valueCC)) : ''}">
      <span class="hint">${validAdj(p.adj) ? `Wycena dopasowana do brokera (${pct(p.adj - 1, 2)} względem Yahoo). <button class="linkish" data-act="clearAdj" data-arg="${esc(p.id)}">Usuń dopasowanie</button>` : 'Wpisz wartość z aplikacji brokera, a Portfel dopasuje do niej wycenę tej spółki.'}</span></div>`;
    })()}
    <div class="field"><label for="f-sector">Branża (opcjonalnie)</label><input id="f-sector" type="text" maxlength="40" value="${esc(p.sector || '')}" placeholder="${esc(industryOf({ ...p, sector: '' }))}" list="sector-list">
      <datalist id="sector-list">${[...new Set(Object.values(IND_PL))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <span class="hint">Puste pole = branża z Yahoo Finance. Używana w zakładce Analiza.</span></div>
    <div class="field"><label for="f-rec">Symbole do rekomendacji</label><input id="f-rec" type="text" value="${esc((p.recSymbols || []).join(', '))}" autocapitalize="characters" spellcheck="false" placeholder="domyślnie jak symbol">
      <span class="hint">Opcjonalnie, np. „SKHY, 000660.KS”, żeby zebrać rekomendacje z kilku giełd.</span></div>
    <div class="err" id="f-err"></div>
    <div class="btns"><button class="btn primary" data-act="savePos" data-arg="${esc(p.id)}">${isNew ? 'Dodaj pozycję' : 'Zapisz zmiany'}</button>${isNew ? '' : `<button class="btn danger" data-act="delPos" data-arg="${esc(p.id)}">Usuń pozycję</button>`}</div>`;
  openSheet(isNew ? 'Nowa pozycja' : 'Edycja: ' + p.name, body);
}

const numIn = (id) => { const v = String($(id)?.value ?? '').replace(',', '.').trim(); return v === '' ? null : Number(v); };

async function savePosition(id) {
  const name = $('#f-name').value.trim(); const symbol = $('#f-sym').value.trim().toUpperCase();
  const qty = numIn('#f-qty'); const cost = numIn('#f-cost');
  const err = $('#f-err');
  if (!name || !symbol) { err.textContent = 'Podaj nazwę i symbol.'; return; }
  if (cost == null || !(cost >= 0)) { err.textContent = 'Podaj koszt zakupu (łącznie, w walucie kosztu).'; return; }
  if (qty != null && !(qty > 0)) { err.textContent = 'Liczba akcji musi być większa od zera.'; return; }
  const recs = $('#f-rec').value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  let p = S.doc.positions.find((x) => x.id === id);
  if (!p) {
    const acc = $('#f-acc').value;
    let nid = `${acc}-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
    while (S.doc.positions.some((x) => x.id === nid)) nid += 'x';
    if (qty == null) { err.textContent = 'Dla nowej pozycji podaj liczbę akcji.'; return; }
    p = { id: nid, txns: [] };
    S.doc.positions.push(p);
  }
  const sector = $('#f-sector')?.value.trim();
  if (sector) p.sector = sector; else delete p.sector;
  Object.assign(p, {
    name, symbol, type: $('#f-type').value, account: $('#f-acc').value,
    qty: qty ?? null, cost, costCurrency: $('#f-cc').value, recSymbols: recs.length ? recs : [symbol],
  });
  if (qty != null) delete p.calib;
  const target = $('#f-match') ? numIn('#f-match') : null;
  if (target != null) {
    const m = metrics(p);
    if (!m) { err.textContent = 'Brak notowań dla tej pozycji — dopasowanie będzie możliwe po aktualizacji.'; return; }
    const k = target / m.rawCC;
    if (!validAdj(k)) { err.textContent = 'Wartość różni się o ponad 10% od wyceny — sprawdź liczbę akcji.'; return; }
    p.adj = +k.toFixed(6); p.adjAt = Date.now();
  }
  closeSheet();
  render();
  await saveDoc();
}

async function deletePosition(id) {
  if (!confirm('Usunąć tę pozycję? Historia portfela zostanie, ale pozycja zniknie z listy.')) return;
  S.doc.positions = S.doc.positions.filter((x) => x.id !== id);
  closeSheet(); render();
  await saveDoc();
}

function tradeSheet(kind, id) {
  const p = S.doc.positions.find((x) => x.id === id);
  const [q] = qtyOf(p);
  const body = `
    <p>${kind === 'buy' ? 'Dopisz dokupione akcje. Średni koszt przeliczy się sam.' : 'Zapisz sprzedaż. Koszt pozostałych akcji liczony jest średnią ceną zakupu.'}</p>
    <div class="two">
      <div class="field"><label for="t-qty">Liczba akcji</label><input id="t-qty" type="number" step="any" inputmode="decimal" ${kind === 'sell' && q ? `placeholder="max ${nf(4).format(q)}"` : ''}></div>
      <div class="field"><label for="t-amt">${kind === 'buy' ? 'Zapłacono łącznie' : 'Otrzymano łącznie'} (${esc(p.costCurrency)})</label><input id="t-amt" type="number" step="any" inputmode="decimal"></div>
    </div>
    <div class="err" id="t-err"></div>
    <div class="btns"><button class="btn primary" data-act="doTrade" data-arg="${kind}|${esc(p.id)}">${kind === 'buy' ? 'Zapisz zakup' : 'Zapisz sprzedaż'}</button></div>`;
  openSheet(`${kind === 'buy' ? 'Dokup' : 'Sprzedaj'}: ${p.name}`, body);
}

async function doTrade(kind, id) {
  const p = S.doc.positions.find((x) => x.id === id);
  const q = numIn('#t-qty'); const amt = numIn('#t-amt');
  const err = $('#t-err');
  const [cur] = qtyOf(p);
  if (!(q > 0) || !(amt >= 0) || amt == null) { err.textContent = 'Podaj liczbę akcji i kwotę.'; return; }
  if (cur == null) { err.textContent = 'Najpierw wpisz aktualną liczbę akcji w edycji pozycji.'; return; }
  if (kind === 'sell' && q > cur + 1e-9) { err.textContent = 'Nie możesz sprzedać więcej, niż masz.'; return; }
  p.qty = cur; delete p.calib;
  p.txns = p.txns || [];
  if (kind === 'buy') { p.qty += q; p.cost = (+p.cost || 0) + amt; }
  else {
    const avg = (+p.cost || 0) / cur;
    p.realized = (p.realized || 0) + amt - avg * q;
    p.cost = (+p.cost || 0) - avg * q; p.qty = cur - q;
    if (p.qty <= 1e-9) { p.qty = 0; p.cost = 0; p.closed = true; }
  }
  p.txns.push({ d: new Date().toISOString().slice(0, 10), type: kind, qty: q, amount: amt });
  closeSheet(); render();
  await saveDoc();
}

// ============================================================== pierwsze uruchomienie

const WORDS = 'rower okno lampa kawa most rzeka sowa jabłko las chmura deszcz kamień brzoza lis zegar piasek sanki fala łódka dach kompas burza wydma kret ogień miód pióro gitara pociąg tunel latarnia kotwica wiatr szron mapa kret bocian iskra kubek dywan młyn wieża pszczoła groch sad pole kreda koral żagiel sarna cebula śliwka rakieta planeta kometa lustro drabina trąbka bęben skrzypce ogórek fasola bursztyn morze plaża jodła sosna szyszka grzyb borsuk wilk orzeł jeż żaba karp pstrąg tygrys słoń zebra kangur koala lama pingwin foka wieloryb mewa kruk gil dzięcioł sikorka czapla łabędź kaczka gęś kogut owca koza kucyk osioł wózek kajak namiot plecak lina hamak ognisko latawiec piłka bramka sieć zamek klucz skrzynia sejf moneta waga'.split(' ');

function genPassphrase() {
  const r = crypto.getRandomValues(new Uint32Array(7));
  const w = Array.from(r.slice(0, 6), (x) => WORDS[x % WORDS.length]);
  return `${w.join('-')}-${10 + (r[6] % 90)}`;
}

function strength(pw) {
  pw = V.normalizePassword(pw);
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  return Math.min(1, (pw.length * Math.log2(pool || 1)) / 80);
}

function renderSetup() {
  const repo = S.config.privateRepo || guessRepo();
  $('#app').innerHTML = `<main class="screen setup">
    ${DIAL}
    <h2 class="big">Utwórz sejf portfela</h2>
    <p>Dane portfela będą zaszyfrowane hasłem, które znasz tylko Ty. Bez niego nikt ich nie odczyta — także GitHub. Hasła nie da się odzyskać, więc zapisz je w menedżerze haseł.</p>

    <div class="card"><h3>1. Hasło</h3>
      <div class="field"><label for="s-pw">Hasło do sejfu (min. 12 znaków)</label><input id="s-pw" type="password" autocomplete="new-password">
        <div class="strength"><span id="s-str"></span></div><span class="hint" id="s-hint">Najlepiej kilka przypadkowych słów.</span></div>
      <div class="field"><label for="s-pw2">Powtórz hasło</label><input id="s-pw2" type="password" autocomplete="new-password"></div>
      <div class="btns"><button class="btn" data-act="genPw">Wygeneruj hasło</button><button class="btn" data-act="showPw">Pokaż</button><button class="btn" data-act="copyPw">Kopiuj</button></div>
    </div>

    <div class="card"><h3>2. To samo hasło w GitHub</h3>
      <p>Automat potrzebuje hasła, żeby co godzinę dopisywać notowania. Dodaj je jako sekret repozytorium:</p>
      <ol class="steps">
        <li>Otwórz <a id="s-secret-link" href="https://github.com/${esc(repo)}/settings/secrets/actions/new" target="_blank" rel="noopener noreferrer">ustawienia sekretów repozytorium</a>.</li>
        <li>Name: <code>VAULT_PASSWORD</code>, Secret: hasło z kroku 1, potem „Add secret”.</li>
      </ol>
      <label class="check"><input id="s-secret" type="checkbox"> Dodałem sekret VAULT_PASSWORD</label>
    </div>

    <div class="card"><h3>3. Pozycje</h3>
      <p>Wczytaj plik startowy (pozycje-start.json) albo zacznij od pustego portfela i dodaj pozycje później.</p>
      <div class="btns"><label class="btn" for="s-file">Wczytaj plik</label><input id="s-file" type="file" accept=".json,application/json" hidden></div>
      <div id="s-filemsg" class="filemsg">Nie wczytano — powstanie pusty portfel z rachunkami XTB i IBKR.</div>
    </div>

    <div class="card"><h3>4. Połączenie z GitHub</h3>
      <div class="field"><label for="s-repo">Prywatne repozytorium z danymi</label><input id="s-repo" type="text" value="${esc(repo)}" placeholder="login/portfel" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label for="s-pat">Token (fine-grained)</label><input id="s-pat" type="password" placeholder="github_pat_…" autocomplete="off">
        <span class="hint">Uprawnienia tylko do tego repozytorium: Contents i Actions — Read and write.</span></div>
    </div>

    <div class="err" id="s-err" role="alert"></div>
    <div class="btns"><button class="btn primary block" data-act="create">Utwórz sejf</button></div>
  </main>`;
  const pw = $('#s-pw');
  pw.addEventListener('input', () => {
    const s = strength(pw.value);
    const bar = $('#s-str');
    bar.style.width = Math.round(s * 100) + '%';
    bar.style.background = s < 0.5 ? 'var(--loss)' : s < 0.75 ? 'var(--brass)' : 'var(--gain)';
    $('#s-hint').textContent = s < 0.5 ? 'Za słabe — dodaj kolejne słowa.' : s < 0.75 ? 'Średnie.' : 'Mocne.';
  });
  $('#s-repo').addEventListener('input', (e) => { $('#s-secret-link').href = `https://github.com/${e.target.value.trim()}/settings/secrets/actions/new`; });
  $('#s-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (!Array.isArray(doc.positions) || !Array.isArray(doc.accounts)) throw new Error();
      S.setupDoc = doc;
      $('#s-filemsg').textContent = `Wczytano ${doc.positions.length} pozycji: ${doc.accounts.map((a) => `${a.short || a.name} ${doc.positions.filter((p) => p.account === a.id).length}`).join(', ')}. Po utworzeniu sejfu usuń ten plik z telefonu.`;
      $('#s-filemsg').className = 'ok';
    } catch { $('#s-filemsg').textContent = 'To nie jest plik pozycji portfela.'; $('#s-filemsg').className = 'err'; }
  });
}

const EMPTY_DOC = () => ({
  v: 1, rev: Date.now(),
  accounts: [
    { id: 'xtb', name: 'XTB (IKE)', short: 'XTB', currency: 'PLN', note: 'IKE — bez podatku od zysków' },
    { id: 'ibkr', name: 'Interactive Brokers', short: 'IBKR', currency: 'USD' },
  ],
  positions: [],
});

async function createVault() {
  const err = $('#s-err'); err.textContent = '';
  const pw = $('#s-pw').value, pw2 = $('#s-pw2').value;
  const repo = $('#s-repo').value.trim(), token = $('#s-pat').value.trim();
  if (V.normalizePassword(pw).length < 12) { err.textContent = 'Hasło musi mieć co najmniej 12 znaków.'; return; }
  if (pw !== pw2) { err.textContent = 'Hasła się różnią.'; return; }
  if (!$('#s-secret').checked) { err.textContent = 'Najpierw dodaj sekret VAULT_PASSWORD w GitHub (krok 2).'; return; }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { err.textContent = 'Podaj repozytorium w formie login/nazwa.'; return; }
  if (!token) { err.textContent = 'Wklej token GitHub (krok 4).'; return; }
  const btn = $('[data-act="create"]'); btn.disabled = true; btn.textContent = 'Szyfruję i zapisuję…';
  try {
    LS.set('repo', repo);
    await gh('GET', `/repos/${repo}`, null, token).then((r) => { if (!r) throw new GhError(ghMessage(404)); });
    const meta = V.newMeta();
    S.meta = meta;
    S.key = await V.deriveKey(pw, meta);
    S.doc = S.setupDoc || EMPTY_DOC();
    S.doc.rev = Date.now();
    const env = await V.encryptObj(S.key, S.doc, 'positions');
    await storeToken(token);
    await ghPut('vault/meta.json', JSON.stringify(meta, null, 2) + '\n', 'Utworzenie sejfu', token);
    await ghPut('vault/positions.enc', JSON.stringify(env), 'Utworzenie sejfu', token);
    LS.set('meta', JSON.stringify(meta));
    LS.set('doc', JSON.stringify(env));
    S.setupDoc = null;
    S.data = null;
    S.newSince = Date.now() - 7 * DAY;
    render();
    toast('Sejf utworzony. Pierwsze dane pojawią się za ok. 2–3 minuty.');
  } catch (e) {
    err.textContent = e instanceof GhError ? e.message : 'Nie udało się utworzyć sejfu: ' + (e.message || e);
    btn.disabled = false; btn.textContent = 'Utwórz sejf';
  }
}

// ============================================================== zdarzenia

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 4200);
}

async function waitForFreshData(since) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 25000));
    try {
      const env = await fetchJSON('data.enc');
      if (!env) continue;
      const d = await V.decryptObj(S.key, env, 'data');
      if (Date.parse(d.generatedAt) > since) { S.data = d; render(); toast('Nowe dane wczytane.'); return; }
    } catch { /* spróbuj ponownie */ }
  }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const act = el.dataset.act, arg = el.dataset.arg;
  switch (act) {
    case 'view': S.view = arg; closeSheet(); render(); window.scrollTo(0, 0); break;
    case 'acct': S.acct = arg; render(); break;
    case 'sort': S.sort = arg; render(); break;
    case 'chartMode': S.chartMode = arg; render(); break;
    case 'range': S.range = arg; render(); break;
    case 'hide': S.hide = !S.hide; render(); break;
    case 'reload': reloadData(); break;
    case 'lock': lockNow(); break;
    case 'pos': showPosition(arg); break;
    case 'closeSheet': closeSheet(); break;
    case 'firm': S.openFirm.has(arg) ? S.openFirm.delete(arg) : S.openFirm.add(arg); render(); break;
    case 'allFirms': S.showAllFirms.has(arg) ? S.showAllFirms.delete(arg) : S.showAllFirms.add(arg); render(); break;
    case 'gotoCo': closeSheet(); S.view = 'recs'; S.openCo.add(arg); render(); document.getElementById('co-' + arg)?.scrollIntoView(); break;
    case 'co': {
      if (S.openCo.has(arg)) S.openCo.delete(arg); else S.openCo.add(arg);
      render();
      if (S.openCo.has(arg)) document.getElementById('co-' + arg)?.scrollIntoView({ block: 'start' });
      break;
    }
    case 'bench': {
      S.bench = arg;
      LS.set('bench', arg || 'none');
      if (S.view === 'portfolio' && !S.sheet) { render(); break; }
      document.querySelectorAll('.pc').forEach((box) => { box.innerHTML = pcHTML(box.dataset.sym); pcDraw(box); });
      if (!S.sheet) drawMainChart();
      break;
    }
    case 'pcRange': {
      S.pcRange = arg;
      LS.set('pcRange', arg);
      document.querySelectorAll('.pc').forEach((box) => { box.innerHTML = pcHTML(box.dataset.sym); pcDraw(box); });
      break;
    }
    case 'edit': editPosition(arg); break;
    case 'new': editPosition(null); break;
    case 'savePos': savePosition(arg); break;
    case 'delPos': deletePosition(arg); break;
    case 'trade': { const [k, id] = arg.split('|'); tradeSheet(k, id); break; }
    case 'doTrade': { const [k, id] = arg.split('|'); doTrade(k, id); break; }
    case 'run': {
      if (!(await ghToken())) {
        if (S.view !== 'settings') { S.view = 'settings'; render(); }
        $('#ghCard')?.scrollIntoView({ block: 'start' });
        toast(`Ten ${deviceName()} nie ma tokenu GitHub — dodaj go w tej karcie.`);
        break;
      }
      try { await ghDispatch(); toast('Automat uruchomiony. Nowe dane za ok. 2 minuty — wczytam je sam.'); waitForFreshData(Date.parse(S.data?.generatedAt || 0) || 0); }
      catch (er) { toast(er.message); }
      break;
    }
    case 'saveGh': {
      const repo = $('#repo').value.trim(), pat = $('#pat').value.trim();
      const msg = $('#ghMsg');
      if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) { msg.className = 'err'; msg.textContent = 'Repozytorium w formie login/nazwa.'; break; }
      if (repo) LS.set('repo', repo);
      try {
        if (pat) { const r = await gh('GET', `/repos/${ghRepo()}`, null, pat); if (!r) throw new GhError(ghMessage(404)); await storeToken(pat); }
        msg.className = 'ok'; msg.textContent = 'Zapisano.'; $('#pat').value = '';
        refreshRunStatus();
      } catch (er) { msg.className = 'err'; msg.textContent = er.message; }
      break;
    }
    case 'delPat': LS.del('pat'); S.tokenFromVault = false; render(); toast('Token usunięty z tego urządzenia.'); break;
    case 'shareTok': {
      const t = await ghToken();
      if (!t) break;
      S.doc.sharedPat = t;
      render();
      await saveDoc();
      break;
    }
    case 'unshareTok': delete S.doc.sharedPat; render(); await saveDoc(); break;
    case 'matchAcc': {
      const msg = $('#matchMsg');
      const target = numIn('#match-' + arg);
      const acc = accById(arg);
      if (target == null || !(target > 0)) { msg.className = 'err'; msg.textContent = 'Wpisz wartość pozycji z aplikacji brokera.'; break; }
      const nowR = ratesFromFx(S.data?.fx, 'r');
      let raw = 0;
      const ps = openPositions().filter((p) => p.account === arg);
      const ms = ps.map((p) => metrics(p));
      if (ms.some((m) => !m)) { msg.className = 'err'; msg.textContent = 'Część pozycji nie ma jeszcze notowań — spróbuj po aktualizacji.'; break; }
      ms.forEach((m) => { raw += m.rawCC * (rate(nowR, m.cc, acc.currency) || 0); });
      const k = target / raw;
      if (!validAdj(k)) { msg.className = 'err'; msg.textContent = 'Wartość różni się o ponad 10% od wyceny — sprawdź liczby akcji.'; break; }
      ps.forEach((p) => { p.adj = +k.toFixed(6); p.adjAt = Date.now(); });
      render();
      await saveDoc();
      toast(`Dopasowano ${acc.short || acc.name}: wycena ${pct(k - 1, 2)} względem cen z Yahoo.`);
      break;
    }
    case 'clearAccAdj': openPositions().filter((p) => p.account === arg).forEach((p) => { delete p.adj; delete p.adjAt; }); render(); await saveDoc(); break;
    case 'clearAdj': { const p = S.doc.positions.find((x) => x.id === arg); if (p) { delete p.adj; delete p.adjAt; } closeSheet(); render(); await saveDoc(); break; }
    case 'saveAlerts': {
      const v = (id, d) => { const x = numIn(id); return x != null && x >= 0.5 && x <= 100 ? x : d; };
      S.doc.alerts = {
        on: $('#al-on').checked,
        up: v('#al-up', 5), upStep: v('#al-upStep', 5),
        down: v('#al-down', 3), downStep: v('#al-downStep', 3),
        everyH: Math.min(v('#al-every', 4), 24),
      };
      render();
      await saveDoc();
      break;
    }
    case 'addPA': {
      const sym = arg, lvl = numIn('#pa-price'), op = $('#pa-op').value, note = $('#pa-note').value.trim();
      const q = quotes()[sym];
      if (!(lvl > 0)) { $('#pa-err').textContent = 'Podaj cenę progu.'; break; }
      S.doc.priceAlerts = [...(S.doc.priceAlerts || []), { id: Math.random().toString(36).slice(2, 10), sym, op, price: lvl, note: note || undefined, created: Date.now() }];
      const box = $('#pa-' + CSS.escape(sym));
      if (box) box.outerHTML = priceAlertsCard(sym);
      const now = q?.price && (op === 'lt' ? q.price < lvl : q.price > lvl);
      await saveDoc();
      if (now) toast('Kurs już spełnia ten warunek — powiadomienie przyjdzie przy najbliższej aktualizacji.');
      break;
    }
    case 'delPA': {
      const a = (S.doc.priceAlerts || []).find((x) => x.id === arg);
      S.doc.priceAlerts = (S.doc.priceAlerts || []).filter((x) => x.id !== arg);
      const box = a && $('#pa-' + CSS.escape(a.sym));
      if (box) box.outerHTML = priceAlertsCard(a.sym);
      await saveDoc();
      break;
    }
    case 'editPlan': editPlan(arg); break;
    case 'savePlan': await savePlan(arg); break;
    case 'delPlan': {
      const p = S.doc.positions.find((x) => x.id === arg);
      if (p && S.doc.notes) delete S.doc.notes[coKey(p)];
      render();
      showPosition(arg);
      await saveDoc();
      break;
    }
    case 'thesisOk': {
      const p = S.doc.positions.find((x) => x.id === arg);
      const n = p && noteOf(coKey(p));
      if (n) { n.updated = Date.now(); n.reviewed = Date.now(); }
      const box = $('#plan-card');
      if (box && p) box.outerHTML = planCard(p);
      render();
      await saveDoc();
      toast('Zapisane — teza potwierdzona po wynikach.');
      break;
    }
    case 'saveNotify': {
      S.doc.notify = Object.fromEntries(NOTIFY_LABELS.map(([k]) => [k, $('#nt-' + k).checked]));
      render();
      await saveDoc();
      break;
    }
    case 'sendSummary': {
      if (!(await ghToken())) { toast(`Ten ${deviceName()} nie ma tokenu GitHub — dodaj go niżej.`); $('#ghCard')?.scrollIntoView(); break; }
      S.doc.summaryReq = Date.now();
      await saveDoc();
      toast('Podsumowanie przyjdzie w Telegramie za ok. 2 minuty.');
      break;
    }
    case 'minutes': checkMinutes(); break;
    case 'saveFees': {
      for (const a of accounts()) {
        const v = numIn('#fee-' + a.id);
        a.fxFeePct = v == null || !(v >= 0) ? 0 : Math.min(v, 10);
      }
      render();
      await saveDoc();
      break;
    }
    case 'backup': {
      if (!confirm('Kopia będzie NIEZASZYFROWANA. Zapisz ją w bezpiecznym miejscu i nie wysyłaj nikomu. Kontynuować?')) break;
      const a = document.createElement('a');
      const { sharedPat, ...plain } = S.doc; // token nigdy nie trafia do niezaszyfrowanej kopii
      a.href = URL.createObjectURL(new Blob([JSON.stringify(plain, null, 2)], { type: 'application/json' }));
      a.download = `portfel-kopia-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'genPw': { const p = genPassphrase(); $('#s-pw').value = p; $('#s-pw2').value = p; $('#s-pw').type = 'text'; $('#s-pw').dispatchEvent(new Event('input')); break; }
    case 'showPw': { const t = $('#s-pw').type === 'password' ? 'text' : 'password'; $('#s-pw').type = t; $('#s-pw2').type = t; break; }
    case 'copyPw': { try { await navigator.clipboard.writeText($('#s-pw').value); toast('Skopiowano hasło. Wklej je w GitHub jako sekret.'); } catch { toast('Nie udało się skopiować — przepisz hasło ręcznie.'); } break; }
    case 'create': createVault(); break;
    default: break;
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset?.act === 'remember') {
    if (e.target.checked) { await idbSet('key', { key: S.key, salt: S.meta.salt, exp: Date.now() + 30 * DAY }); S.remembered = true; toast('To urządzenie będzie pamiętać odblokowanie przez 30 dni.'); }
    else { await idbDel('key'); S.remembered = false; toast('Wyłączone. Następnym razem aplikacja zapyta o hasło.'); }
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

// blokada po 10 minutach w tle (gdy urządzenie nie jest zapamiętane)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { S.hiddenAt = Date.now(); return; }
  if (S.key && !S.remembered && S.hiddenAt && Date.now() - S.hiddenAt > 10 * 60000) location.reload();
  else if (S.key && S.data && Date.now() - Date.parse(S.data.generatedAt) > 70 * 60000) reloadData(true);
});

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.view === 'portfolio' && S.key) drawMainChart(); }, 150); });

boot();
