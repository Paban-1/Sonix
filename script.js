/* Morning Tables — shared script for dashboard.html, test.html, profile.html
   All data lives in localStorage. Page is chosen with <body data-page="..."> */
(function () {
  'use strict';

  /* ---------------- CONFIG ---------------- */
  const CONFIG = {
    startH: 8, startM: 30,      // test window opens 8:30 AM
    endH: 9, endM: 0,           // test window closes 9:00 AM
    durationSec: 600,           // time allowed once you press Start (10 min, capped by window end)
    tables: [12, 13],           // tables asked
    upTo: 10,                   // 12 x 1..10 and 13 x 1..10  => 20 questions
    correctPts: 4,              // marks for a right answer
    wrongPenalty: 1             // marks cut for a wrong answer (blank = 0)
  };

  const KEYS = {
    profile: 'mt_profile',
    results: 'mt_results',
    session: 'mt_session',
    settings: 'mt_settings'
  };

  /* ---------------- HELPERS ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function load(k, d) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function atTime(d, h, m) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0); }
  function clock(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function niceDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function fmtHMS(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }
  function fmtMS(sec) {
    sec = Math.max(0, sec);
    return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  }

  const getProfile = () => Object.assign({ name: '', dp: '' }, load(KEYS.profile, {}));
  const getResults = () => load(KEYS.results, []);
  const getSettings = () => Object.assign({ bypass: false }, load(KEYS.settings, {}));
  const getSession = () => load(KEYS.session, null);

  /* ---------------- SEEDED QUESTIONS (same set all day) ---------------- */
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeQuestions(dateStr) {
    const rng = mulberry(hashStr('tables-' + dateStr));
    const list = [];
    CONFIG.tables.forEach(t => {
      for (let n = 1; n <= CONFIG.upTo; n++) {
        list.push(rng() < 0.5 ? { a: t, b: n } : { a: n, b: t });
      }
    });
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /* ---------------- SCORING ---------------- */
  function scoreSession(s, finishedAt) {
    let correct = 0, wrong = 0, skipped = 0;
    s.questions.forEach((q, i) => {
      const a = String(s.answers[i] == null ? '' : s.answers[i]).trim();
      if (a === '') { skipped++; return; }
      if (/^-?\d+$/.test(a) && Number(a) === q.a * q.b) correct++; else wrong++;
    });
    const raw = correct * CONFIG.correctPts - wrong * CONFIG.wrongPenalty;
    return {
      date: s.date,
      score: Math.max(0, raw),
      raw: raw,
      correct: correct,
      wrong: wrong,
      skipped: skipped,
      total: s.questions.length,
      max: s.questions.length * CONFIG.correctPts,
      timeTaken: Math.max(0, Math.round((Math.min(finishedAt, s.endsAt) - s.startedAt) / 1000)),
      questions: s.questions,
      answers: s.answers.map(x => String(x == null ? '' : x).trim()),
      ts: finishedAt
    };
  }

  function finalize(session, finishedAt) {
    const res = scoreSession(session, finishedAt || Date.now());
    const list = getResults().filter(r => r.date !== res.date);
    list.push(res);
    list.sort((a, b) => a.date.localeCompare(b.date));
    save(KEYS.results, list);
    localStorage.removeItem(KEYS.session);
    return res;
  }

  // If a session was left open (tab closed) and its time is over, score it now.
  function settleStaleSession() {
    const s = getSession();
    if (s && (s.date !== dateKey() || Date.now() >= s.endsAt)) finalize(s, s.endsAt);
  }

  /* ---------------- TEST WINDOW STATUS ---------------- */
  function getStatus() {
    const now = new Date();
    const results = getResults();
    const done = results.find(r => r.date === dateKey(now)) || null;
    const start = atTime(now, CONFIG.startH, CONFIG.startM);
    const end = atTime(now, CONFIG.endH, CONFIG.endM);
    const bypass = getSettings().bypass;

    let state;
    if (bypass) state = 'open';
    else if (done) state = 'done';
    else if (now < start) state = 'before';
    else if (now >= end) state = 'closed';
    else state = 'open';

    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const next = (now < start && !done) ? start : atTime(tomorrow, CONFIG.startH, CONFIG.startM);
    return { state, now, start, end, next, done, bypass };
  }

  /* ---------------- SHARED UI ---------------- */
  let tickFn = null;
  setInterval(() => { if (tickFn) tickFn(); }, 500);

  function injectStyles() {
    const css = `
      :root{--paper:#F4F7F9;--ink:#14213D;--muted:#5B6B82;--line:#DDE5EC;--pencil:#FFC933;--ok:#1F8A5B;--bad:#C93A3A}
      html{scroll-padding-top:70px}
      body{font-family:'Karla',system-ui,sans-serif;color:var(--ink);background-color:var(--paper);
        background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
        background-size:28px 28px;min-height:100vh}
      .display{font-family:'Bricolage Grotesque','Karla',sans-serif;letter-spacing:-.02em}
      .muted{color:var(--muted)}
      .topbar{position:sticky;top:0;z-index:30;background:var(--paper);border-bottom:2px solid var(--ink)}
      .mark{background:var(--pencil);border:2px solid var(--ink);border-radius:6px;padding:1px 7px;font-weight:800}
      .navlink{padding:.35rem .6rem;font-weight:700;border-bottom:3px solid transparent}
      .navlink:hover{border-bottom-color:var(--line)}
      .navlink.active{border-bottom-color:var(--pencil)}
      .avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:9999px;background:var(--ink);color:#fff;font-weight:800;border:1.5px solid var(--ink)}
      .sheet{background:#fff;border:2px solid var(--ink);border-radius:12px;box-shadow:5px 5px 0 var(--ink)}
      .panel{background:#fff;border:1.5px solid #B9C6D3;border-radius:8px}
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;background:var(--ink);color:#fff;font-weight:700;padding:.7rem 1.15rem;border-radius:8px;border:2px solid var(--ink);cursor:pointer;transition:background .15s}
      .btn:hover{background:#22345f}
      .btn:focus-visible,.navlink:focus-visible,a:focus-visible{outline:3px solid var(--pencil);outline-offset:2px}
      .btn-pencil{background:var(--pencil);color:var(--ink)}
      .btn-pencil:hover{background:#ffd75e}
      .btn-ghost{background:transparent;color:var(--ink)}
      .btn-ghost:hover{background:#E9EFF4}
      .btn-danger{background:#fff;color:var(--bad);border-color:var(--bad)}
      .btn-danger:hover{background:#FCECEC}
      .input{border:1.5px solid var(--ink);border-radius:6px;padding:.55rem .75rem;background:#fff;width:100%;font-size:1rem}
      .input:focus{outline:3px solid var(--pencil);outline-offset:0}
      .strip{height:12px;border:2px solid var(--ink);border-radius:9999px;background:#fff;overflow:hidden}
      .strip .fill{height:100%;background:var(--pencil)}
      .qrow{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.6rem .9rem;background:#fff;border:1.5px solid #B9C6D3;border-radius:8px}
      .qtext{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:1.35rem;white-space:nowrap}
      .ans{width:6rem;text-align:center;font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:1.35rem;border:0;border-bottom:3px solid var(--ink);background:#FFFBEA;padding:.2rem;border-radius:4px 4px 0 0}
      .ans:focus{outline:none;background:#FFF1B8;border-bottom-color:var(--bad)}
      .timerbar{position:sticky;top:57px;z-index:20}
      .bar{width:100%;background:var(--ink);border-radius:4px 4px 0 0}
      .bar.latest{background:var(--pencil);border:2px solid var(--ink);border-bottom:0}
      .ok{color:var(--ok)} .bad{color:var(--bad)}
      .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:.7rem 1.1rem;border-radius:8px;font-weight:700;z-index:50}
      table.hist{width:100%;border-collapse:collapse}
      table.hist th{text-align:left;font-weight:700;color:var(--muted);font-size:.85rem;padding:.4rem .5rem;border-bottom:1.5px solid #B9C6D3}
      table.hist td{padding:.55rem .5rem;border-bottom:1px solid var(--line);white-space:nowrap}
      @media (prefers-reduced-motion:reduce){*{transition:none!important}}
    `;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function avatar(p, size) {
    const s = size || 36;
    const init = ((p.name || '').trim().charAt(0) || '?').toUpperCase();
    if (p.dp) {
      return `<img src="${esc(p.dp)}" alt="" class="rounded-full object-cover" style="width:${s}px;height:${s}px;border:1.5px solid var(--ink)">`;
    }
    return `<span class="avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.45)}px">${esc(init)}</span>`;
  }

  function renderNav(active) {
    const p = getProfile();
    const links = [['dashboard.html', 'Dashboard', 'dashboard'], ['test.html', 'Test', 'test'], ['profile.html', 'Profile', 'profile']];
    $('#nav').innerHTML = `
      <header class="topbar">
        <div class="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <a href="dashboard.html" class="display mark text-lg" aria-label="Morning Tables home">12×13</a>
          <nav class="flex items-center gap-0.5 sm:gap-2" aria-label="Main">
            ${links.map(l => `<a href="${l[0]}" class="navlink ${l[2] === active ? 'active' : ''}" ${l[2] === active ? 'aria-current="page"' : ''}>${l[1]}</a>`).join('')}
          </nav>
          <a href="profile.html" class="flex items-center gap-2" aria-label="Your profile">
            ${avatar(p, 34)}
            <span class="hidden sm:inline font-bold max-w-[8rem] truncate">${esc(p.name || 'Set name')}</span>
          </a>
        </div>
      </header>`;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function windowStrip(st) {
    const pct = Math.min(100, Math.max(0, (st.now - st.start) / (st.end - st.start) * 100));
    return `<div class="strip" role="img" aria-label="Test window progress"><div class="fill" id="stripFill" style="width:${pct}%"></div></div>
      <div class="flex justify-between text-sm muted mt-1"><span>${clock(st.start)}</span><span>${clock(st.end)}</span></div>`;
  }

  function feedback(res) {
    const pct = res.max ? res.score / res.max : 0;
    if (pct >= 0.9) return 'Excellent. Nearly every answer was right.';
    if (pct >= 0.7) return 'Good work. A little more practice on the ones you missed.';
    if (pct >= 0.4) return 'Getting there. Review the wrong answers below.';
    return 'Tough one today. Go through the answers below and try again tomorrow.';
  }

  /* ---------------- DASHBOARD PAGE ---------------- */
  function calcStreak(results) {
    const days = new Set(results.map(r => r.date));
    const d = new Date();
    if (!days.has(dateKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(dateKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function initDashboard() {
    renderNav('dashboard');
    settleStaleSession();
    const root = $('#root');
    let shownKey = '';

    function draw() {
      const st = getStatus();
      const sess = getSession();
      const running = sess && sess.date === dateKey() && Date.now() < sess.endsAt;
      const p = getProfile();
      const results = getResults();
      const h = new Date().getHours();
      const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      shownKey = running ? 'running' : st.state + (st.done ? 'd' : '');

      let today = '';
      if (running) {
        today = `<h2 class="display text-2xl font-extrabold">Your test is in progress</h2>
          <p class="muted mt-1">Time left: <b id="cd">--:--</b></p>
          <a href="test.html" class="btn btn-pencil mt-4">Continue test</a>`;
      } else if (st.state === 'open') {
        today = `<h2 class="display text-2xl font-extrabold">Today's test is open</h2>
          <p class="muted mt-1">Closes in <b id="cd">--:--:--</b>${st.bypass ? ' (practice mode is on)' : ''}</p>
          <div class="mt-4">${windowStrip(st)}</div>
          <a href="test.html" class="btn btn-pencil mt-4">Start test</a>`;
      } else if (st.state === 'before') {
        today = `<h2 class="display text-2xl font-extrabold">Test opens at ${clock(st.start)}</h2>
          <p class="muted mt-1">Starts in <b id="cd">--:--:--</b></p>
          <div class="mt-4">${windowStrip(st)}</div>`;
      } else if (st.state === 'closed') {
        today = `<h2 class="display text-2xl font-extrabold">Today's test window is closed</h2>
          <p class="muted mt-1">Next test at ${clock(st.next)} tomorrow, in <b id="cd">--:--:--</b></p>
          <div class="mt-4">${windowStrip(st)}</div>`;
      } else {
        const d = st.done;
        today = `<h2 class="display text-2xl font-extrabold">Today's score: ${d.score} / ${d.max}</h2>
          <p class="muted mt-1">${d.correct} right, ${d.wrong} wrong, ${d.skipped} blank. Next test in <b id="cd">--:--:--</b></p>
          <a href="test.html" class="btn btn-ghost mt-4">Review answers</a>`;
      }

      const scores = results.map(r => r.score);
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const best = scores.length ? Math.max.apply(null, scores) : 0;
      const streak = calcStreak(results);
      const maxScore = CONFIG.tables.length * CONFIG.upTo * CONFIG.correctPts;

      const last = results.slice(-14);
      const chart = last.length
        ? `<div class="flex items-end gap-1.5 overflow-x-auto pb-1" style="height:180px">
            ${last.map((r, i) => {
              const hpx = Math.max(3, Math.round(r.score / (r.max || maxScore) * 130));
              return `<div class="flex flex-col items-center justify-end flex-1" style="min-width:26px" title="${niceDate(r.date)}: ${r.score}/${r.max}">
                <span class="text-xs font-bold mb-1">${r.score}</span>
                <div class="bar ${i === last.length - 1 ? 'latest' : ''}" style="height:${hpx}px"></div>
                <span class="text-[11px] muted mt-1">${niceDate(r.date)}</span></div>`;
            }).join('')}
          </div>`
        : `<p class="muted">No scores yet. Your first test appears here after you finish it.</p>`;

      const rows = results.slice().reverse().slice(0, 10).map(r => `
        <tr><td>${niceDate(r.date)}</td><td class="font-bold">${r.score} / ${r.max}</td>
        <td class="ok">${r.correct}</td><td class="bad">${r.wrong}</td><td>${r.skipped}</td><td>${fmtMS(r.timeTaken)}</td></tr>`).join('');

      root.innerHTML = `
        <div class="flex items-center gap-3 mb-5">
          ${avatar(p, 52)}
          <div>
            <h1 class="display text-3xl font-extrabold leading-tight">${hello}${p.name ? ', ' + esc(p.name) : ''}</h1>
            ${p.name ? '' : '<a class="underline muted" href="profile.html">Add your name in Profile</a>'}
          </div>
        </div>

        <section class="sheet p-5 mb-6" aria-live="polite">${today}</section>

        <section class="panel grid grid-cols-2 sm:grid-cols-4 mb-6" aria-label="Your stats">
          ${[['Tests taken', results.length], ['Average', avg + ' / ' + maxScore], ['Best', best + ' / ' + maxScore], ['Day streak', streak]].map((s, i) => `
            <div class="p-4 ${i > 0 ? 'sm:border-l' : ''} ${i > 1 ? 'border-t sm:border-t-0' : ''} ${i % 2 === 1 ? 'border-l' : ''}" style="border-color:#B9C6D3">
              <div class="muted text-sm">${s[0]}</div>
              <div class="display text-2xl font-extrabold">${s[1]}</div>
            </div>`).join('')}
        </section>

        <section class="panel p-4 mb-6">
          <h2 class="display text-xl font-extrabold mb-3">Score progress</h2>
          ${chart}
        </section>

        <section class="panel p-4">
          <h2 class="display text-xl font-extrabold mb-3">Recent tests</h2>
          ${rows
            ? `<div class="overflow-x-auto"><table class="hist"><thead><tr><th>Date</th><th>Score</th><th>Right</th><th>Wrong</th><th>Blank</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<p class="muted">Nothing here yet. Tests open daily from ${clock(atTime(new Date(), CONFIG.startH, CONFIG.startM))} to ${clock(atTime(new Date(), CONFIG.endH, CONFIG.endM))}.</p>`}
        </section>`;
    }

    draw();
    tickFn = function () {
      const st = getStatus();
      const sess = getSession();
      const running = sess && sess.date === dateKey() && Date.now() < sess.endsAt;
      const key = running ? 'running' : st.state + (st.done ? 'd' : '');
      if (sess && !running) { settleStaleSession(); draw(); return; }
      if (key !== shownKey) { draw(); return; }
      const cd = $('#cd');
      if (cd) {
        if (running) cd.textContent = fmtMS(Math.ceil((sess.endsAt - Date.now()) / 1000));
        else if (st.state === 'open') cd.textContent = fmtHMS(st.end - st.now);
        else cd.textContent = fmtHMS(st.next - st.now);
      }
      const f = $('#stripFill');
      if (f) f.style.width = Math.min(100, Math.max(0, (st.now - st.start) / (st.end - st.start) * 100)) + '%';
    };
  }

  /* ---------------- TEST PAGE ---------------- */
  function initTest() {
    renderNav('test');
    settleStaleSession();
    const root = $('#root');

    function renderTest(opts) {
      opts = opts || {};
      tickFn = null;
      const st = getStatus();
      const sess = getSession();
      if (sess && sess.date === dateKey() && Date.now() < sess.endsAt) return renderRunning(sess);
      if (st.state === 'done') return renderDone(st.done, opts);
      if (st.state === 'open') return renderStart(st);
      return renderLocked(st);
    }

    function renderLocked(st) {
      const before = st.state === 'before';
      root.innerHTML = `
        <section class="sheet p-6">
          <h1 class="display text-3xl font-extrabold">${before ? 'Test opens at ' + clock(st.start) : "Today's test window has closed"}</h1>
          <p class="muted mt-2">${before
            ? 'The test is available every day from ' + clock(st.start) + ' to ' + clock(st.end) + '.'
            : 'The test was open from ' + clock(st.start) + ' to ' + clock(st.end) + '. The next one opens tomorrow at ' + clock(st.next) + '.'}</p>
          <div class="display text-5xl font-extrabold my-6" id="cd" aria-live="off">--:--:--</div>
          ${windowStrip(st)}
          <a href="dashboard.html" class="btn btn-ghost mt-6">Back to dashboard</a>
        </section>`;
      tickFn = function () {
        const s = getStatus();
        if (s.state !== st.state) return renderTest();
        $('#cd').textContent = fmtHMS(s.next - s.now);
        const f = $('#stripFill');
        if (f) f.style.width = Math.min(100, Math.max(0, (s.now - s.start) / (s.end - s.start) * 100)) + '%';
      };
      tickFn();
    }

    function renderStart(st) {
      const dur = st.bypass ? CONFIG.durationSec * 1000 : Math.min(CONFIG.durationSec * 1000, st.end - st.now);
      const total = CONFIG.tables.length * CONFIG.upTo;
      const had = getResults().find(r => r.date === dateKey());
      root.innerHTML = `
        <section class="sheet p-6">
          <h1 class="display text-3xl font-extrabold">Tables of ${CONFIG.tables.join(' and ')}</h1>
          <ul class="mt-4 space-y-2">
            <li>${total} questions. Type each answer yourself.</li>
            <li>You have <b>${fmtMS(Math.floor(dur / 1000))}</b> once you press Start${st.bypass ? '' : ' (the window closes at ' + clock(st.end) + ')'}.</li>
            <li><b>+${CONFIG.correctPts}</b> for a right answer, <b>−${CONFIG.wrongPenalty}</b> for a wrong one, 0 for a blank.</li>
            <li>The test submits itself when the timer ends.</li>
            ${st.bypass ? '<li class="muted">Practice mode is on, so the time window is ignored.' + (had ? ' Your score for today will be replaced.' : '') + '</li>' : ''}
          </ul>
          <button id="startBtn" class="btn btn-pencil mt-6 text-lg">Start test</button>
        </section>`;
      $('#startBtn').addEventListener('click', () => {
        const now = Date.now();
        const s = {
          date: dateKey(),
          startedAt: now,
          endsAt: now + dur,
          questions: makeQuestions(dateKey()),
          answers: Array(total).fill('')
        };
        save(KEYS.session, s);
        renderRunning(s);
      });
      tickFn = function () {
        const s = getStatus();
        if (!s.bypass && s.state !== 'open') renderTest();
      };
    }

    function renderRunning(sess) {
      tickFn = null;
      root.innerHTML = `
        <div class="timerbar sheet p-3 mb-4 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm muted">Time left</div>
            <div class="display text-3xl font-extrabold" id="timeLeft">--:--</div>
          </div>
          <div class="text-right">
            <div class="text-sm muted">Answered</div>
            <div class="display text-xl font-extrabold" id="answered">0 / ${sess.questions.length}</div>
          </div>
          <button id="submitBtn" class="btn btn-pencil">Submit</button>
        </div>
        <div id="qs" class="grid sm:grid-cols-2 gap-3">
          ${sess.questions.map((q, i) => `
            <label class="qrow" for="q${i}">
              <span class="qtext">${q.a} × ${q.b} =</span>
              <input id="q${i}" class="ans" data-i="${i}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="${q.a} times ${q.b}" value="${esc(sess.answers[i] || '')}">
            </label>`).join('')}
        </div>`;

      const inputs = Array.from(document.querySelectorAll('.ans'));
      const countAnswered = () => sess.answers.filter(a => String(a).trim() !== '').length;
      const refreshCount = () => { $('#answered').textContent = countAnswered() + ' / ' + sess.questions.length; };
      refreshCount();
      const firstEmpty = inputs.find(i => !i.value) || inputs[0];
      if (firstEmpty) firstEmpty.focus();

      $('#qs').addEventListener('input', e => {
        if (!e.target.classList.contains('ans')) return;
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
        sess.answers[+e.target.dataset.i] = e.target.value;
        save(KEYS.session, sess);
        refreshCount();
      });
      $('#qs').addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !e.target.classList.contains('ans')) return;
        e.preventDefault();
        const i = +e.target.dataset.i;
        if (inputs[i + 1]) inputs[i + 1].focus(); else $('#submitBtn').focus();
      });

      let finished = false;
      function finish(auto) {
        if (finished) return;
        finished = true;
        tickFn = null;
        const res = finalize(sess, auto ? sess.endsAt : Date.now());
        window.scrollTo(0, 0);
        renderDone(res, { timeUp: auto, just: true });
      }
      $('#submitBtn').addEventListener('click', () => {
        const blank = sess.questions.length - countAnswered();
        const msg = blank > 0 ? blank + ' question(s) are blank. Submit anyway?' : 'Submit your test?';
        if (window.confirm(msg)) finish(false);
      });

      tickFn = function () {
        const left = Math.ceil((sess.endsAt - Date.now()) / 1000);
        const el = $('#timeLeft');
        if (el) {
          el.textContent = fmtMS(left);
          el.classList.toggle('bad', left <= 60);
        }
        if (left <= 0) finish(true);
      };
      tickFn();
    }

    function renderDone(res, opts) {
      tickFn = null;
      const st = getStatus();
      const review = res.questions.map((q, i) => {
        const a = res.answers[i];
        const right = q.a * q.b;
        let mark, cls, note = '';
        if (a === '') { mark = '–'; cls = 'muted'; note = 'Blank. Answer: ' + right; }
        else if (/^-?\d+$/.test(a) && Number(a) === right) { mark = '✓'; cls = 'ok'; note = 'Your answer: ' + esc(a); }
        else { mark = '✗'; cls = 'bad'; note = 'Your answer: ' + esc(a) + '. Right answer: ' + right; }
        return `<div class="qrow"><span class="qtext">${q.a} × ${q.b}</span>
          <span class="text-sm text-right ${cls}"><b class="text-lg">${mark}</b> ${note}</span></div>`;
      }).join('');

      root.innerHTML = `
        <section class="sheet p-6 mb-6">
          ${opts.timeUp ? '<p class="bad font-bold mb-2">Time is up. Your test was submitted automatically.</p>' : ''}
          <h1 class="display text-3xl font-extrabold">Your score: ${res.score} / ${res.max}</h1>
          <p class="muted mt-1">${feedback(res)}</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            ${[['Right', res.correct, 'ok'], ['Wrong', res.wrong, 'bad'], ['Blank', res.skipped, ''], ['Time', fmtMS(res.timeTaken), '']].map(s => `
              <div class="panel p-3"><div class="text-sm muted">${s[0]}</div><div class="display text-2xl font-extrabold ${s[2]}">${s[1]}</div></div>`).join('')}
          </div>
          ${res.wrong > 0 ? `<p class="text-sm muted mt-3">${res.wrong} wrong × −${CONFIG.wrongPenalty} = −${res.wrong * CONFIG.wrongPenalty} marks.</p>` : ''}
          <p class="mt-5">Next test opens at ${clock(st.next)} tomorrow, in <b id="cd">--:--:--</b>.</p>
          <a href="dashboard.html" class="btn mt-4">Go to dashboard</a>
        </section>
        <h2 class="display text-xl font-extrabold mb-3">Answer review</h2>
        <div class="grid sm:grid-cols-2 gap-3">${review}</div>`;
      tickFn = function () {
        const s = getStatus();
        const cd = $('#cd');
        if (cd) cd.textContent = fmtHMS(s.next - s.now);
      };
      tickFn();
    }

    renderTest();
  }

  /* ---------------- PROFILE PAGE ---------------- */
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image file.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That image could not be opened.'));
        img.onload = () => {
          const size = 256;
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          const ctx = c.getContext('2d');
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function initProfile() {
    renderNav('profile');
    const root = $('#root');
    const p = getProfile();
    let pendingDp = p.dp;
    const settings = getSettings();

    root.innerHTML = `
      <h1 class="display text-3xl font-extrabold mb-5">Profile</h1>
      <section class="sheet p-6 mb-6">
        <div class="flex items-center gap-4 flex-wrap">
          <div id="dpPreview"></div>
          <div class="flex flex-col gap-2">
            <label class="btn btn-ghost cursor-pointer" for="dpFile">Choose photo</label>
            <input id="dpFile" type="file" accept="image/*" class="sr-only">
            <button id="dpRemove" type="button" class="btn btn-ghost">Remove photo</button>
          </div>
        </div>
        <div class="mt-6">
          <label for="nameInput" class="font-bold block mb-1">Your name</label>
          <input id="nameInput" class="input" type="text" maxlength="40" autocomplete="name" placeholder="Enter your name" value="${esc(p.name)}">
        </div>
        <p id="msg" class="bad text-sm mt-3" role="alert"></p>
        <button id="saveBtn" class="btn btn-pencil mt-4">Save profile</button>
      </section>

      <section class="panel p-5 mb-6">
        <h2 class="display text-xl font-extrabold mb-2">Practice mode</h2>
        <label class="flex items-start gap-3 cursor-pointer">
          <input id="bypass" type="checkbox" class="mt-1 w-5 h-5" ${settings.bypass ? 'checked' : ''}>
          <span>Ignore the ${clock(atTime(new Date(), CONFIG.startH, CONFIG.startM))} to ${clock(atTime(new Date(), CONFIG.endH, CONFIG.endM))} window and the one-test-per-day limit, so you can try the app any time. Turn it off for the real routine.</span>
        </label>
      </section>

      <section class="panel p-5">
        <h2 class="display text-xl font-extrabold mb-2">Your data</h2>
        <p class="muted mb-3">Everything is stored in this browser only. Clearing it removes your name, photo, scores and settings.</p>
        <button id="wipeBtn" class="btn btn-danger">Erase all data</button>
      </section>`;

    function paintDp() {
      $('#dpPreview').innerHTML = avatar({ name: $('#nameInput').value || p.name, dp: pendingDp }, 96);
    }
    paintDp();
    $('#nameInput').addEventListener('input', paintDp);

    $('#dpFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      $('#msg').textContent = '';
      if (!f) return;
      try {
        pendingDp = await resizeImage(f);
        paintDp();
      } catch (err) {
        $('#msg').textContent = err.message;
      }
      e.target.value = '';
    });
    $('#dpRemove').addEventListener('click', () => { pendingDp = ''; paintDp(); });

    $('#saveBtn').addEventListener('click', () => {
      const name = $('#nameInput').value.trim();
      const ok = save(KEYS.profile, { name: name, dp: pendingDp });
      if (!ok) { $('#msg').textContent = 'Could not save. Browser storage is full or blocked.'; return; }
      $('#msg').textContent = '';
      renderNav('profile');
      toast('Profile saved');
    });

    $('#bypass').addEventListener('change', e => {
      save(KEYS.settings, Object.assign(getSettings(), { bypass: e.target.checked }));
      toast(e.target.checked ? 'Practice mode on' : 'Practice mode off');
    });

    $('#wipeBtn').addEventListener('click', () => {
      if (window.confirm('Erase your profile, scores and settings? This cannot be undone.')) {
        Object.values(KEYS).forEach(k => localStorage.removeItem(k));
        location.reload();
      }
    });
  }

  /* ---------------- BOOT ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    const page = document.body.dataset.page;
    if (page === 'dashboard') initDashboard();
    else if (page === 'test') initTest();
    else if (page === 'profile') initProfile();
  });
})();
