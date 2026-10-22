// 音效：优先加载 src/assets/audio/*.mp3（MiniMax Design / 后期裁剪），失败则回退 WebAudio 合成。

export const FILES = {
  ambient: 'assets/audio/ambient_loop.mp3',
  tv_loop: 'assets/audio/tv_loop.mp3',
  caught_sting: 'assets/audio/caught_sting.mp3',
  escaped: 'assets/audio/escaped.mp3',
  footstep: 'assets/audio/footstep.mp3',
  door: 'assets/audio/door.mp3',
  page: 'assets/audio/page.mp3',
  handle: 'assets/audio/handle.mp3',
  safe: 'assets/audio/safe.mp3',
  breath: 'assets/audio/breath.mp3',
  clock_tick: 'assets/audio/clock_tick.mp3',
  parent_warn: 'assets/audio/parent_warn.mp3',
  parent_study: 'assets/audio/parent_caught_study.mp3',
  parent_tv: 'assets/audio/parent_caught_tv.mp3',
  parent_escape: 'assets/audio/parent_caught_escape.mp3',
  parent_reading: 'assets/audio/parent_caught_reading.mp3',
  parent_time_ok: 'assets/audio/parent_time_ok.mp3',
  parent_time_early: 'assets/audio/parent_time_early.mp3',
  parent_clock_suspicious: 'assets/audio/parent_clock_suspicious.mp3',
  keys: 'assets/audio/keys.mp3',
  wrong_time: 'assets/audio/wrong_time.mp3',
  caught_ring: 'assets/audio/caught_ring.mp3',
};

// 2026-10-22 交付的语音变体包（27 句，同一音色）。已用 whisper 逐句听校（见 DELIVERY-20261022.md），
// 只把**语义与当下情境一致**的句子放进轮播池：被抓时不能突然说“钥匙呢”，预警时不能说“我进来了”。
export const VOICE_FILES = (() => {
  const out = {};
  for (const [fam, n] of [['warn', 6], ['study', 5], ['tv', 5], ['escape', 5], ['reading', 3], ['checkb', 3]]) {
    for (let i = 1; i <= n; i++) out[`${fam}_${String(i).padStart(2, '0')}`] = `assets/audio/voice/yq_parent_${fam}_${String(i).padStart(2, '0')}.mp3`;
  }
  return out;
})();
// 每池一句，轮播不重复；括号里是听校出的台词，改池子时对着这两列挑
export const VOICE_POOLS = {
  warn: ['warn_01', 'warn_05', 'warn_06'],       // 有人过来了 / 你在干嘛 / 听见你了
  study: ['study_01', 'study_03', 'study_04', 'study_05'], // 不是让你写作业吗 / 谁让你起来的 / 作业写完了吗 / 抬头干什么
  tv: ['tv_01', 'tv_02', 'tv_03', 'tv_05'],      // 九点前不准开电视 / 谁让你开电视的 / 节目表你没看 / 眼睛看哪儿呢
  escape: ['escape_01', 'escape_05'],            // 让你倒垃圾，你还在屋里磨蹭 / 垃圾倒了没有
  reading: ['reading_01', 'reading_02', 'reading_03'], // 我在跟你说话，你在看什么 / 把纸放下 / 谁让你翻那些的
  timeOk: ['parent_time_ok', 'checkb_03'],              // 到点了 / 到点了！
  timeEarly: ['parent_time_early', 'checkb_02'],        // 还没到时候
};

// 空间混音（纯函数，Node 可测）：把「声源相对玩家」压成 pan/增益/距离。
// pan 用与画面一致的正弦关系：声源在右手边 → pan > 0；正前/正后 → 0；身后靠增益自然变小。
export function spatialMix(dx, dz, yaw) {
  const dist = Math.hypot(dx, dz);
  const a = Math.atan2(dx, dz) - (yaw + Math.PI);
  const pan = -Math.max(-1, Math.min(1, Math.sin(a)));
  const gain = Math.max(0.08, Math.min(1, 1.15 - dist / 9)); // 9 m 外几乎听不见，近处不超过 1
  return { pan, gain, dist };
}

// 响度说明（YWQ-AUDIO-03）：素材已在 tools/audio-normalize.mjs 里统一归一
// （循环床按 mean -20/-22 dBFS，一次性音效按 max -6 ~ -14 dBFS，语音保持交付原样），
// 所以下面每个方法的 gain 只是「演出权重」，不再兼任响度补偿。
// 归一前实测：keys -28.5 / door -24.4 / footstep -27.1 / clock_tick -29.9 / ambient mean -54 dB，
// 底噪在笔记本扬声器上只剩 -41 ~ -52 dBFS（有轨但听不见）。证据与前后电平见 docs/evidence/YWQ-AUDIO-03/。

export function createSfx(ac, master, { panFor, getLowHorror, getPlayer }) {
  const here = () => getPlayer?.() || { x: 0, z: 0, yaw: 0 };
  const live = new Set();
  const buffers = {};
  let loadPromise = null;
  let ambientNode = null;
  let tvNode = null;

  const track = (src) => {
    live.add(src);
    src.onended = () => live.delete(src);
    return src;
  };

  const stopLayer = (node) => {
    if (!node) return null;
    try { node.stop(); } catch { /* */ }
    return null;
  };

  const stopAll = () => {
    for (const src of live) {
      try { src.onended = null; src.stop(); } catch { /* */ }
    }
    live.clear();
    ambientNode = stopLayer(ambientNode);
    tvNode = stopLayer(tvNode);
  };

  const loadBuffers = () => {
    if (loadPromise) return loadPromise;
    // FILES 是固定槽位；VOICE_FILES 是「一句一个 id」的变体池（缺一句不影响整包）
    const jobs = Object.entries(FILES).map(async ([id, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const ab = await res.arrayBuffer();
        buffers[id] = await ac.decodeAudioData(ab);
      } catch { /* 离线/无文件 → 合成回退 */ }
    });
    for (const [id, url] of Object.entries(VOICE_FILES)) {
      jobs.push((async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const ab = await res.arrayBuffer();
          buffers[id] = await ac.decodeAudioData(ab);
        } catch { /* 缺一句跳过 */ }
      })());
    }
    loadPromise = Promise.all(jobs);
    return loadPromise;
  };

  // 变体轮播：先洗牌再顺序播，避免同一句连着出现两次；整包加载失败时退回固定槽位。
  const shuffleBags = {};
  const pickFrom = (poolName, fallbackId) => {
    const pool = VOICE_POOLS[poolName] || [];
    let bag = shuffleBags[poolName];
    if (!bag || !bag.length) {
      bag = pool.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      shuffleBags[poolName] = bag;
    }
    for (let i = 0; i < bag.length; i++) {
      if (buffers[bag[i]]) { const id = bag[i]; bag.splice(i, 1); return id; }
    }
    return buffers[fallbackId] ? fallbackId : null;
  };

  const vol = () => (getLowHorror() ? 0.35 : 0.8);

  const playBuf = (id, { gain = 1, pan = 0, when = 0, offset = 0, duration, loop = false } = {}) => {
    const b = buffers[id];
    if (!b) return false;
    const src = ac.createBufferSource();
    src.buffer = b;
    src.loop = loop;
    const gn = ac.createGain();
    gn.gain.value = gain * vol();  // gain 是演出权重；素材响度已在归一阶段统一（见文件头）
    const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    src.connect(gn);
    (p ? gn.connect(p) : gn).connect(master);
    track(src);
    const t0 = ac.currentTime + when;
    src.start(t0, offset, duration ?? (loop ? undefined : b.duration - offset));
    return src;
  };

  const noiseBurst = (t0, dur, freq, gain, pan = 0) => {
    const n = ac.createBufferSource();
    const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    n.buffer = b;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const gn = ac.createGain();
    gn.gain.value = gain * vol();
    const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    n.connect(f).connect(gn);
    (p ? gn.connect(p) : gn).connect(master);
    track(n).start(ac.currentTime + t0);
  };

  const tone = (t0, dur, freq, gain, type = 'sine') => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0, ac.currentTime + t0);
    gn.gain.linearRampToValueAtTime(gain * vol(), ac.currentTime + t0 + 0.05);
    gn.gain.linearRampToValueAtTime(0, ac.currentTime + t0 + dur);
    o.connect(gn).connect(master);
    track(o).start(ac.currentTime + t0);
    o.stop(ac.currentTime + t0 + dur + 0.05);
  };

  const startLoop = (id, gain, ref) => {
    if (ref || !buffers[id]) return ref;
    const src = playBuf(id, { gain, loop: true });
    return src || ref;
  };

  const api = {
    ready: () => loadBuffers(),
    // 自检用：返回已解码的 buffer id（播放前确认“路径对 + 解码成功”，而不是静默回退到合成音）
    loaded: () => Object.keys(buffers),
    stopAll,
    setAmbient(on) {
      if (!on) { ambientNode = stopLayer(ambientNode); tvNode = stopLayer(tvNode); return; }
      ambientNode = startLoop('ambient', 0.22, ambientNode);
    },
    setTvLayer(on) {
      if (!on) { tvNode = stopLayer(tvNode); return; }
      tvNode = startLoop('tv_loop', 0.14, tvNode);
    },
    warn() {
      // 变体池按听校结果挑过：不会在预警时说“我进来了”这种预告错位的台词
      const id = pickFrom('warn', 'parent_warn') || 'parent_warn';
      if (!playBuf(id, { gain: 0.95, pan: panFor(1.65, 3.5) })) {
        playBuf('parent_warn', { gain: 0.95, pan: panFor(1.65, 3.5) });
      }
    },
    // 脚步：可传声源位置（家长实际所在），按距离衰减、按方位左右分布；
    // 不传位置时退回门口（预警期家长还在楼道里）。
    footsteps(n = 6, gap = 0.5, at) {
      // at 可以是 { x, z }（原地），也可以是 { from:{x,z}, to:{x,z} }（走进来）
      const from = at?.from || at || { x: 1.65, z: 3.5 };
      const to = at?.to || at || from;
      const p0 = here();
      for (let i = 0; i < n; i++) {
        const k = n > 1 ? i / (n - 1) : 0;
        const mix = spatialMix((from.x + (to.x - from.x) * k) - p0.x, (from.z + (to.z - from.z) * k) - p0.z, p0.yaw);
        const t = i * gap;
        if (!playBuf('footstep', { gain: 0.85 * mix.gain + 0.15, pan: mix.pan, when: t, duration: 0.32 })) {
          noiseBurst(t, 0.12, 380 * (0.7 + 0.3 * mix.gain), 0.5 * mix.gain, mix.pan);
        }
      }
    },
    // 单步（家长真实走位时按位移触发）：距离越近越响、越闷
    stepAt(x, z, { gain = 1 } = {}) {
      const p0 = here();
      const mix = spatialMix(x - p0.x, z - p0.z, p0.yaw);
      if (!playBuf('footstep', { gain: (0.55 + 0.55 * mix.gain) * gain, pan: mix.pan, duration: 0.3 })) {
        noiseBurst(0, 0.11, 300 + 260 * mix.gain, 0.42 * mix.gain * gain, mix.pan);
      }
    },
    handle() {
      const p = panFor(1.65, 3);
      if (!playBuf('handle', { gain: 0.95, pan: p })) {
        noiseBurst(0, 0.08, 2400, 0.35, p);
        noiseBurst(0.12, 0.05, 3000, 0.3, p);
      }
    },
    door() {
      if (!playBuf('door', { gain: 1, pan: panFor(1.65, 3) })) noiseBurst(0, 0.5, 600, 0.4, panFor(1.65, 3));
    },
    page() {
      if (!playBuf('page', { gain: 1 })) noiseBurst(0, 0.18, 5000, 0.12);
    },
    safe() {
      if (!playBuf('safe', { gain: 0.85 })) {
        tone(0, 0.25, 520, 0.08);
        tone(0.12, 0.3, 660, 0.06);
      }
    },
    // 呼吸：带方位与距离——家长越近越响、从哪边靠近就从哪边传来（此前是固定居中）
    breathLoop(at) {
      const p0 = here();
      const mix = at ? spatialMix(at.x - p0.x, at.z - p0.z, p0.yaw) : { pan: 0, gain: 0.6 };
      if (!playBuf('breath', { gain: 0.55 + 0.55 * mix.gain, pan: mix.pan })) noiseBurst(0, 0.45, 220, 0.06 * (0.5 + mix.gain), mix.pan);
    },
    clockTick() {
      if (!playBuf('clock_tick', { gain: 0.7 })) tone(0, 0.04, 1800, 0.06, 'square');
    },
    // 钥匙：两枚金属小铃，短促、偏高频（黄铜串）
    keys() {
      if (!playBuf('keys', { gain: 0.9 })) {
        tone(0, 0.09, 2350, 0.07, 'triangle');
        tone(0.05, 0.12, 3120, 0.05, 'triangle');
      }
    },
    // 倒计时最后几秒：一声轻表针；低恐怖下音量自动跟随 vol()
    countdown(last = false) {
      if (!playBuf('clock_tick', { gain: last ? 0.9 : 0.5 })) tone(0, last ? 0.09 : 0.05, last ? 1200 : 1600, last ? 0.09 : 0.05, 'square');
    },
    // 摆错钟：家长沉默地多站一会儿——低频、比失败音更“闷”
    wrongTime() {
      if (!playBuf('wrong_time', { gain: 0.8 })) {
        tone(0, 0.5, 96, 0.14, 'sine');
        tone(0.18, 0.6, 72, 0.10, 'sine');
      }
    },
    escaped() {
      stopAll();
      const p = panFor(1.65, 3);
      if (!playBuf('escaped', { gain: 1, pan: p })) {
        playBuf('door', { gain: 0.85, pan: p });
        tone(0.4, 1.2, 180, 0.12, 'sine');
      }
    },
    caught(duty = 'study', why = 'schedule') {
      // 被抓瞬间先把环境/电视层整层掐掉（stopAll 也会停掉还在播的脚步），
      // 再让 master 在 0.18 s 内掉到几乎无声：耳朵里只剩自己的耳鸣 + 家长第一句话。
      stopAll();
      const peak = Math.max(0.001, master.gain.value || vol()); // 已含玩家音量/静音；静音时 peak≈0，什么都听不到
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setValueAtTime(peak, ac.currentTime);
      master.gain.linearRampToValueAtTime(0.001, ac.currentTime + 0.18);
      master.gain.setValueAtTime(0.001, ac.currentTime + 0.5);          // 留一小段真空，别立刻回填
      master.gain.linearRampToValueAtTime(peak * 0.4, ac.currentTime + 0.9);

      // 耳鸣：短促高频、只在非低恐怖时给；低恐怖下这一幕不该再“炸”一下
      if (!getLowHorror()) {
        if (!playBuf('caught_ring', { gain: 0.5, when: 0.05 })) {
          tone(0.02, 0.55, 5200, 0.035, 'sine');
          tone(0.02, 0.5, 6100, 0.02, 'sine');
        }
      }

      const parentKey = why === 'reading' ? 'parent_reading'
        : duty === 'tv' ? 'parent_tv'
          : duty === 'escape' ? 'parent_escape'
            : 'parent_study';
      const parentFamily = why === 'reading' ? 'reading'
        : duty === 'tv' ? 'tv'
          : duty === 'escape' ? 'escape'
            : 'study';
      if (!playBuf('caught_sting', { gain: 1.1, when: 0.32 })) {
        tone(0.32, 0.9, 82, 0.35, 'sawtooth');
        tone(0.32, 0.9, 87, 0.25, 'sawtooth');
      }
      const vid = pickFrom(parentFamily, parentKey) || parentKey;
      playBuf(vid, { gain: 1, when: 0.35 });
    },
    // 家长看了一眼钟：到点了 / 还没到时候 / 你动过这个钟（此前只有 HUD 文字，没有声音）
    timeOk() {
      playBuf(pickFrom('timeOk', 'parent_time_ok') || 'parent_time_ok', { gain: 0.95, pan: panFor(1.65, 2.9) });
    },
    timeEarly(n = 1) {
      // 第二次摆错才是“你动过这个钟”——语气必须升级，不能和第一次共用一句
      if (n >= 2 && buffers.parent_clock_suspicious) { playBuf('parent_clock_suspicious', { gain: 0.95, pan: panFor(1.65, 2.9) }); return; }
      playBuf(pickFrom('timeEarly', 'parent_time_early') || 'parent_time_early', { gain: 0.95, pan: panFor(1.65, 2.9) });
    },
  };

  return api;
}
