// 试玩记录器（YWQ-PLAYTEST-01）：把「一局里到底发生了什么」写成可回放的 JSON，供内测收集。
// 设计约束：
//  1) 只读：不改任何规则、不传送、不给提示；关掉记录器游戏行为完全一致。
//  2) 便宜：事件级 + 2 Hz 采样，正常一局几百条，不影响帧率（采样上限按小时算）。
//  3) 自解释：字段名直接对应规则（check/phase/duty/clock），拿到 JSON 不需要再对照代码。
const SCHEMA = 'ywq-playtest-1';
const SAMPLE_MS = 500;
const MAX_EVENTS = 4000;   // 单局事件上限（远超真实一局）
const MAX_SAMPLES = 7200;  // 2 Hz × 1 小时

function iso(ms) { return new Date(ms).toISOString(); }

function trim(arr, n) { if (arr.length > n) arr.splice(0, arr.length - n); return arr; }

export function createPlaytestLog({ ua = '', dpr = 1, size = [0, 0], touch = false, build = 'dev', settings = {}, now = () => Date.now() } = {}) {
  const startWall = now();
  const log = {
    schema: SCHEMA,
    session: {
      id: `s${startWall.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      startedAt: iso(startWall),
      build,
      ua,
      dpr,
      viewport: size,
      touch,
      settings: { ...settings },
    },
    runs: [],
    notes: [],   // 内测者自己补的话（导出的 JSON 里直接可写）
  };
  let cur = null;      // 当前 run 记录
  let curGame = null;  // 当前局对象（用来识别「换了一局」，不依赖 g.run：切章节会重置计数）
  let samples = 0;
  let lastSample = 0;

  function beginRun(g, why = 'start') {
    if (cur && cur.outcome == null) { cur.outcome = 'abandoned'; cur.endWall = now(); }
    curGame = g;
    const t = now();
    cur = {
      n: log.runs.length + 1,
      run: g.run,
      chapter: g.chapter,
      chapterName: g.chapterName || g.chapter,
      mode: g.settings && (g.settings.extendedWarn || g.settings.extendedGrace) ? 'mild' : 'standard',
      settings: g.settings ? { ...g.settings } : {},
      why,
      startWall: t,
      startedAt: iso(t),
      clockAtStart: g.clock,
      events: [],
      samples: [],
      outcome: null,
      endWall: null,
      result: null,
    };
    log.runs.push(cur);
    return cur;
  }

  // 每帧调用：换局（重开/重试/结算进下一章）就自动开一条新记录，调用方不用关心重开路径
  function sync(g) {
    if (curGame !== g) beginRun(g, log.runs.length ? 'restart' : 'start');
    return cur;
  }

  // 事件：逻辑层 emit 出来的每一条都记（checkWarn/phase/caught/escaped/...），带游戏内时间
  function event(e, g) {
    if (!cur) beginRun(g, 'auto');
    const t = now();
    const rec = { w: t, t: +g.t.toFixed(3), k: e.type };
    for (const [k, v] of Object.entries(e)) {
      if (k === 'type') continue;
      if (v == null || typeof v === 'object') continue; // 只留标量，避免把 check 对象整棵抄进来
      rec[k] = typeof v === 'number' ? +v.toFixed(3) : v;
    }
    cur.events.push(rec);
    trim(cur.events, MAX_EVENTS);
    if (e.type === 'caught') {
      cur.outcome = 'caught';
      cur.endWall = t;
      cur.result = { why: e.why || null, duty: e.duty || null, line: e.line || null, t: +g.t.toFixed(3), at: [g.player.x, g.player.z].map((v) => +v.toFixed(2)) };
    } else if (e.type === 'escaped') {
      cur.outcome = 'escaped';
      cur.endWall = t;
      cur.result = { t: +g.t.toFixed(3), windowLeft: e.windowLeft ?? null, grade: e.grade || null };
    }
    return rec;
  }

  // 低频采样：卡关/走位/帧率都能从曲线看出来，但代价只有 2 Hz
  function sample(g, extra = {}) {
    if (!cur) beginRun(g, 'auto');
    const t = now();
    if (t - lastSample < SAMPLE_MS) return;
    lastSample = t;
    const c = g.check;
    cur.samples.push({
      w: t,
      t: +g.t.toFixed(2),
      phase: g.phase,
      pos: [+g.player.x.toFixed(2), +g.player.z.toFixed(2)],
      yaw: +g.player.yaw.toFixed(2),
      modal: g.modal ? g.modal.type : null,
      check: c ? `${c.id}/${c.stage}` : null,
      clock: g.clock,
      studying: !!g.studying,
      keys: g.hasKeys ? 1 : 0,
      ...extra,
    });
    trim(cur.samples, MAX_SAMPLES);
    samples++;
  }

  // 一局结束时补齐统计与评级（由渲染层在结算/被抓时调用，取的是逻辑层算好的结果）
  function finishRun(g, info = {}) {
    if (!cur) beginRun(g, 'auto');
    if (!cur.outcome) cur.outcome = info.outcome || 'ended';
    if (cur.endWall == null) cur.endWall = now();
    cur.result = { ...(cur.result || {}), ...info.result };
    cur.summary = {
      elapsed: +g.t.toFixed(2),
      wallSeconds: +((cur.endWall - cur.startWall) / 1000).toFixed(1),
      clockWrong: g.clockWrong,
      checks: g.stats ? g.stats.checks : null,
      seen: g.stats ? g.stats.seen : null,
      clues: { ...g.clues },
      cluesRead: Object.values(g.clues).filter(Boolean).length,
      fails: { ...g.fails },
      grade: info.grade || null,
    };
    return cur;
  }

  function dump() {
    return {
      ...log,
      exportedAt: iso(now()),
      summary: summarize(),
    };
  }

  function summarize() {
    const runs = log.runs;
    const wins = runs.filter((r) => r.outcome === 'escaped');
    const deaths = runs.filter((r) => r.outcome === 'caught');
    return {
      runs: runs.length,
      wins: wins.length,
      deaths: deaths.length,
      abandoned: runs.filter((r) => r.outcome === 'abandoned').length,
      bestClearSeconds: wins.length ? +Math.min(...wins.map((r) => r.summary?.elapsed ?? 9999)).toFixed(2) : null,
      deathCauses: deaths.reduce((m, r) => { const k = r.result?.why || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {}),
      perChapter: runs.reduce((m, r) => { const k = r.chapter; m[k] = m[k] || { runs: 0, wins: 0 }; m[k].runs++; if (r.outcome === 'escaped') m[k].wins++; return m; }, {}),
      samples: samples,
    };
  }

  function json() { return JSON.stringify(dump(), null, 1); }

  function filename(ext = 'json') {
    const d = new Date(log.session.startedAt);
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    const last = log.runs[log.runs.length - 1];
    return `ywq-playtest-${stamp}-${log.session.id}${last ? `-r${last.run}-${last.outcome || 'open'}` : ''}.${ext}`;
  }

  function download() {
    const s = json();
    const url = URL.createObjectURL(new Blob([s], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { bytes: s.length, runs: log.runs.length };
  }

  return {
    get data() { return log; },
    get current() { return cur; },
    sync, beginRun, event, sample, finishRun,
    note(text) { log.notes.push({ at: iso(now()), text: String(text).slice(0, 500) }); },
    setBuild(b) { log.session.build = b; },
    dump, json, summarize, filename, download,
  };
}
