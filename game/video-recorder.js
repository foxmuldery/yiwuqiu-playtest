// 试玩录像（YWQ-PLAYTEST-02）：把 canvas 画面 + 玩家实际听到的声音录成 webm。
// 用 canvas.captureStream()，不是屏幕共享：只录游戏画面，不碰桌面/隐私窗口，也不需要权限弹窗。
// 音频从 sfx 的 master 总线再引一路到 MediaStreamDestination —— 录到的音量与玩家听到的完全一致（含静音/低声）。
//
// 稳健性：Chromium 里出现过「音轨 live、AudioContext running，但 muxer 一个 chunk 都不出」的情况
// （实测与打开过线索弹层有关，且只影响带音轨的录制）。音轨是锦上添花，画面是必须的：
// 开始录制后先探 1.5 s，若一个 chunk 都没有，就自动降级为「只录画面」，并把 audioDropped 告诉调用方。
const CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createVideoRecorder({ canvas, audioContext = null, masterGain = null, fps = 30 } = {}) {
  let rec = null, stream = null, chunks = [], startedAt = 0, sink = null, mime = '';
  let lastError = null;
  let lastBlob = null, lastUrl = null, lastBytes = 0;

  const supported = () => typeof MediaRecorder !== 'undefined' && !!canvas && !!canvas.captureStream;

  function pickMime() {
    for (const m of CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  // 同步开录：只在内部用（start 负责探测与降级）
  function begin({ bitrate = 3_000_000, audio = true, baseStart = null } = {}) {
    if (rec) return { ok: false, reason: 'already-recording' };
    if (!supported()) return { ok: false, reason: 'unsupported' };
    mime = pickMime();
    stream = canvas.captureStream(fps);
    let hasAudio = false;
    if (audio && audioContext && masterGain) {
      try {
        sink = audioContext.createMediaStreamDestination();
        masterGain.connect(sink);
        for (const t of sink.stream.getAudioTracks()) stream.addTrack(t);
        hasAudio = true;
      } catch { sink = null; }
    }
    chunks = [];
    lastError = null;
    rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bitrate, audioBitsPerSecond: 96_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => { lastError = (e && e.error && e.error.name) || 'error'; };
    rec.start(1000);
    // 降级重开时沿用最初的开始时间：玩家看到的计时不该因为内部重试而跳回 00:00
    startedAt = baseStart || performance.now();
    return { ok: true, mime: mime || 'default', audio: hasAudio };
  }

  async function start(opts = {}) {
    const first = begin(opts);
    if (!first.ok || !first.audio) return first;
    const t0 = startedAt;
    // 音轨探测：1.5 s 内必须见到第一个 chunk，否则重开成纯画面
    await sleep(1500);
    if (chunks.length === 0 && rec) {
      await finish();
      const second = begin({ ...opts, audio: false, baseStart: t0 });
      return { ...second, audioDropped: true, reason: second.ok ? 'audio-stalled' : second.reason };
    }
    return first;
  }

  function finish() {
    return new Promise((resolve) => {
      if (!rec) return resolve(null);
      const r = rec;
      // 兜底：个别浏览器/无头环境 stop 事件可能不来（曾在自动化里遇到），不能让「停止」永远挂住
      let done = false;
      const finishNow = () => {
        if (done) return; done = true;
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastBlob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
        lastBytes = lastBlob.size;
        lastUrl = URL.createObjectURL(lastBlob);
        resolve({ blob: lastBlob, bytes: lastBytes, url: lastUrl, seconds: +((performance.now() - startedAt) / 1000).toFixed(1) });
      };
      const guard = setTimeout(() => { try { r.requestData(); } catch { /* 已停 */ } finishNow(); }, 2000);
      r.onstop = () => { clearTimeout(guard); finishNow(); };
      try { r.stop(); } catch { finishNow(); }
      rec = null;
      if (sink && masterGain) { try { masterGain.disconnect(sink); } catch { /* 已断 */ } }
      sink = null;
      for (const t of (stream?.getTracks() || [])) t.stop();
      stream = null;
    });
  }

  // 下载到本地：录完先给一个可点按钮，也支持直接下（内测者不一定知道去哪找临时 URL）
  function download(name = 'ywq-playtest.webm') {
    if (!lastUrl) return false;
    const a = document.createElement('a');
    a.href = lastUrl; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  }

  return {
    supported, start, stop: finish, download,
    get recording() { return !!rec; },
    get state() { return rec ? rec.state : 'inactive'; },
    get seconds() { return rec ? (performance.now() - startedAt) / 1000 : 0; },
    get bytes() { return lastBytes; },
    get lastError() { return lastError; },
    get chunkCount() { return chunks.length; },
    // 诊断：音轨状态（ended/muted 会直接导致 muxer 收不到数据）
    get tracks() { return (stream?.getTracks() || []).map((t) => ({ kind: t.kind, state: t.readyState, muted: t.muted, enabled: t.enabled })); },
    get lastUrl() { return lastUrl; },
  };
}
