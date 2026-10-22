// 《一屋囚》最小 Demo —— 与渲染无关的纯逻辑层（可在 Node 中单测）
// 所有尺寸、时序、数值均为「灰盒/改编假定」，不是原作实测。见 docs/design/LAYOUT_ASSUMPTIONS.md
//
// 坐标：米。俯视 x 向右，z 向下（朝对端墙 W2）。窗墙 W1 在 z=-3。
// 角度：XZ 平面数学角 atan2(dz, dx)，单位弧度。

export const CONFIG = {
  walkSpeed: 2.0,          // m/s，默认步行，无冲刺/跳跃
  playerRadius: 0.25,
  studyRadius: 0.8,        // 学习点吸附半径（设计稿：约 0.8 米）
  studySettle: 0.2,        // 就位动画时长（逻辑上按键即算进入）
  warnTime: 3.5,           // 预警（脚步/门把）
  sweepTime: 1.2,          // 视线从起始方向转到终止方向的时长
  holdFrom: 0.6,           // 扫入后在起始方向的额外停留（实际停留 = 宽限 + 此值，保证起始方向也被真正检查）
  graceSweep: 1.2,         // 扫入阶段被看见的宽限
  graceConfirm: 0.8,       // 确认阶段离开姿态后的短宽限
  confirmTime: 2.0,        // 学习姿态保持约 2 秒后视线离开
  leaveTime: 1.0,          // 家长转身离开（无判定）
  viewRange: 9.0,
  viewHalfFov: (40 * Math.PI) / 180,
  // YWQ-003-LOS-B：边界「包含」——距离 ≤ 9 m、|角度差| ≤ 40° 都算可见。容差只吸收浮点误差（atan2/三角函数往返约 1e-15 量级），
  // 1e-9 rad ≈ 5.7e-8°、1e-9 m = 1 纳米，不扩大实际视野，也不恢复任何近身探测。
  losEpsAngle: 1e-9,
  losEpsDist: 1e-9,
  parentRadius: 0.24,      // 家长可见身体（胶囊）半径；只用于身体碰撞，不参与视线（YWQ-003-LOS-A）
  occluderMinHeight: 1.0,  // 高于此值的家具遮挡视线（玩家检测点约 1.1 m）
  windowTime: 8,           // 出口窗口（M3：14 s 余量过大，8 s 才需要不犹豫）
  windowReturnWarn: 4,     // 家长返回前提前预告
  checkATimer: 25,         // M1：explore1 主动游玩满 25 s 也触发 A（与线索事件先到先得）
  bShortWarn: 2,           // M2：第二次钟错后，下一次 B 的预警缩短到 2 s
  bExtraConfirm: 1,        // M2：第一次钟错后，家长多站 1 s
  pendingADelay: 2.5,      // 教学期已看过作息纸：退出教学后补触发 A 的延迟（否则 A 永远不触发 → 卡关）
  // 蹲（A 方案）：低姿态更难被注意，但慢、且不能写作业；低家具开始遮挡
  crouchSpeed: 1.15,       // 蹲行速度（站立 2.0）
  crouchSettle: 0.18,      // 蹲/起的过渡时长（仅表现与判定同步用）
  crouchSightY: 0.75,      // 蹲下后的身体最高点 → 低于它的家具（书桌 0.76 / 沙发 0.85）能挡住
  standSightY: 1.1,        // 站立时的身体最高点（与 occluderMinHeight 等价，保持既有判定）
  crouchExposure: 0.55,    // 蹲着被看见时暴露累积倍率
  correctClock: 21 * 60 + 20,
  initialClock: 19 * 60 + 40,
  interactRange: 1.35,
};

export const ROOM = { minX: -2.6, maxX: 2.6, minZ: -3.0, maxZ: 3.0, ceiling: 2.8 };
export const DOOR = { minX: 1.2, maxX: 2.1, z: 3.0 };            // 入户门 O-LX（候选位置，改编）
export const THRESHOLD = { minX: 0.9, maxX: 2.4, minZ: 3.0, maxZ: 5.0, escapeZ: 3.5 }; // 门槛模块 M（灰盒）

// 家具碰撞体。src: E=有原帧证据锚点（位置仍为推定）；N=本作新增改编；T=技术占位
export const COLLIDERS = [
  { id: 'F1_tv',       minX: -2.6,  maxX: -2.05, minZ: -0.6,  maxZ: 0.6,   h: 1.25, src: 'E' },
  { id: 'F2_corner',   minX: -2.6,  maxX: -2.0,  minZ: -3.0,  maxZ: -2.4,  h: 0.9,  src: 'E' },
  { id: 'F3_chairL',   minX: -1.05, maxX: -0.35, minZ: -2.95, maxZ: -2.2,  h: 0.9,  src: 'E' },
  { id: 'F3_table',    minX: -0.25, maxX: 0.25,  minZ: -2.95, maxZ: -2.45, h: 0.6,  src: 'E' },
  { id: 'F3_chairR',   minX: 0.35,  maxX: 1.05,  minZ: -2.95, maxZ: -2.2,  h: 0.9,  src: 'E' },
  { id: 'F5_coffee',   minX: -0.7,  maxX: 0.7,   minZ: 0.0,   maxZ: 0.9,   h: 0.45, src: 'E' },
  { id: 'F4_sofa',     minX: 2.0,   maxX: 2.6,   minZ: -0.5,  maxZ: 1.9,   h: 0.85, src: 'E' },
  { id: 'N1_desk',     minX: -2.6,  maxX: -1.95, minZ: 1.0,   maxZ: 2.2,   h: 0.76, src: 'N' },
  { id: 'F7_sidecab',  minX: -1.2,  maxX: -0.2,  minZ: 2.55,  maxZ: 3.0,   h: 0.9,  src: 'E' },
  { id: 'F8_rack',     minX: 2.25,  maxX: 2.6,   minZ: 2.6,   maxZ: 3.0,   h: 1.8,  src: 'E' },
];

export const STUDY_POINTS = [
  { id: 'P1', name: '书桌', x: -1.6, z: 1.6, look: { x: -2.3, y: 0.78, z: 1.6 } },
  { id: 'P2', name: '沙发', x: 1.7, z: 0.7, look: { x: 2.0, y: 0.6, z: 0.7 }, seat: { x: 2.2, z: 0.7 } },
];

export const INTERACTABLES = [
  { id: 'schedule', name: '侧柜上的作息纸', x: -0.7, z: 2.3, target: { x: -0.7, z: 2.75 } },
  { id: 'guide',    name: '窗边的旧节目表', x: -1.45, z: -2.2, target: { x: -1.45, z: -2.9 } },
  { id: 'clock',    name: '书桌上的台钟',   x: -1.6, z: 1.85, target: { x: -2.25, z: 1.9 } },
  { id: 'door',     name: '入户门',         x: 1.65, z: 2.6, target: { x: 1.65, z: 3.0 } },
  // M3：窗口期必须先拿钥匙再开门。交互点放在衣帽架前可站立处（F8 柜体本身不可站立）
  { id: 'keys',     name: '衣帽架上的钥匙', x: 2.3, z: 2.25, target: { x: 2.42, z: 2.9 } },
];

export const CLUES = {
  schedule: { title: '作息纸（侧柜）', lines: ['6:30 起床　7:00 早读', '12:10 午饭　午休不许看电视', '晚饭后写作业，九点前不准开电视', '新闻结束后一刻钟，下楼倒垃圾。', '周六上午 背课文'] },
  guide:    { title: '旧节目表（窗台）', lines: ['本周三（今天）晚间节目', '19:00 新闻联播', '19:38 天气预报', '20:30–21:00 晚间新闻', '21:00 电视剧（两集连播）'] },
  calib:    { title: '台钟背面的校时纸', lines: ['比电视快五分钟。', '（别调，你爸说快点好，不迟到）'] },
};

// 检查脚本：预设站位与朝向曲线，不做寻路 AI
const ang = (fx, fz, tx, tz) => Math.atan2(tz - fz, tx - fx);
// from = 预警阶段门外站位（门关着，只有声音）；to = 门开后的门口站位（扫入/确认阶段的眼点）
export const CHECKS = {
  A: { id: 'A', from: { x: 1.65, z: 3.8 }, to: { x: 1.65, z: 2.8 },      // 门口看向书桌区
       gazeFrom: ang(1.65, 2.8, 1.65, 0), gazeTo: ang(1.65, 2.8, -1.6, 1.6) },
  B: { id: 'B', from: { x: 1.65, z: 3.8 }, to: { x: 1.4, z: 2.55 },      // 迈进一步，从沙发转看台钟/书桌
       gazeFrom: ang(1.4, 2.55, 1.7, 0.7), gazeTo: ang(1.4, 2.55, -1.6, 1.6) },
  // M2：第二次钟错后的 B —— 预警缩短，扫视范围加宽到沙发角与书桌角两端
  B2: { id: 'B', from: { x: 1.65, z: 3.8 }, to: { x: 1.4, z: 2.55 },
        gazeFrom: ang(1.4, 2.55, 2.55, 1.9), gazeTo: ang(1.4, 2.55, -2.55, 2.3) },
  // M2：第三次钟错后的 B —— 家长直接进屋，站在屋子中间转一整圈；不写作业必被看见
  B3: { id: 'B', from: { x: 0, z: 1.0 }, to: { x: 0, z: 1.0 },
        gazeFrom: ang(0, 1.0, 0, -1), gazeTo: ang(0, 1.0, 0, -1) + Math.PI * 2 },
  R: { id: 'R', from: { x: 1.65, z: 4.6 }, to: { x: 1.65, z: 4.6 },      // 窗口结束：家长从楼道上来，透过门洞看进屋
       gazeFrom: ang(1.65, 4.6, 1.65, 0), gazeTo: ang(1.65, 4.6, 1.65, 0) },
};

// YWQ-HARD-01：作息表 = 硬规则。检查 sweep/confirm 中被看见且不合规 → 一击死（无暴露宽限）。
// 时段与节目表/作息纸一致；窗口期与 R 检查强制「出门」合规。
const TV_FOCUS = { x: -2.3, z: 0 };
const TV_YAW_TOL = (52 * Math.PI) / 180;
export const SCHEDULE_DUTIES = {
  tv: { id: 'tv', label: '坐沙发看电视', short: '看电视', hint: '坐到沙发，面向电视，别写作业' },
  study: { id: 'study', label: '写作业', short: '写作业', hint: '在书桌或沙发按学习键，别乱逛' },
  escape: { id: 'escape', label: '下楼倒垃圾', short: '出门', hint: '拿钥匙，别写作业，往门口走' },
};

export function scheduleDutyAt(clockMin) {
  const m = ((Math.round(clockMin) % 1440) + 1440) % 1440;
  // 21:20 家长来「看钟」时仍须装写作业；出门时段只在窗口期 / R 检查生效（见 scheduleDuty）
  if (m >= 21 * 60 && m < CONFIG.correctClock + 20) return 'study';
  if (m >= 20 * 60 + 30 && m < 21 * 60) return 'tv';
  if (m >= 19 * 60 + 38 && m < 20 * 60 + 30) return 'study';
  if (m >= 19 * 60 && m < 19 * 60 + 38) return 'tv';
  return 'study';
}

export function scheduleDuty(g) {
  if (g.phase === 'window' || g.phase === 'returning' || g.check?.id === 'R') return 'escape';
  return scheduleDutyAt(g.clock);
}

function facingWorld(g, tx, tz, tol = TV_YAW_TOL) {
  const want = Math.atan2(-(tx - g.player.x), -(tz - g.player.z));
  let d = g.player.yaw - want;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) <= tol;
}

export function isScheduleCompliant(g) {
  if (g.modal && ['clue', 'clock', 'notes'].includes(g.modal.type)) return false;
  const duty = scheduleDuty(g);
  const { point, d } = nearestStudyPoint(g.player.x, g.player.z);
  if (duty === 'escape') {
    // R（家长返回、从门口看进屋）：窗口已关，任一学习点装写作业都算伪装成功。
    // 否则会出现“书桌安全、沙发必死”的隐形规则（两者都是学习点）。
    if (g.check?.id === 'R' && g.studying && d <= CONFIG.studyRadius) return true;
    return g.hasKeys && !g.studying && (g.player.z >= 2.35 || dist(g.player.x, g.player.z, 1.65, 2.6) < 1.25);
  }
  if (duty === 'tv') {
    return point.id === 'P2' && d <= CONFIG.studyRadius && !g.studying && facingWorld(g, TV_FOCUS.x, TV_FOCUS.z);
  }
  return g.studying && d <= CONFIG.studyRadius;
}

// 章节：同一套规则，只换开场时段。第一章从 19:40（写作业）开始；第二章从 20:40（看电视）开始，
// 让作息表里的 tv 分支真正被玩到，而不是只存在于“玩家自己把钟摆错”的边缘路径。
// tutorialKind：'study' = 书桌按学习键；'tv' = 走到沙发坐下并面向电视（只教姿势，不给答案/不改判定）。
export const CHAPTERS = {
  desk: {
    id: 'desk', name: '第一章 · 书桌', tag: '书桌',
    clock: 19 * 60 + 40, tutorial: true, tutorialKind: 'study',
    intro: '19:40，该写作业。',
    note: '从写作业时段开始：第一次检查在书桌/沙发装写作业。',
  },
  tv: {
    id: 'tv', name: '第二章 · 电视', tag: '电视',
    clock: 20 * 60 + 40, tutorial: true, tutorialKind: 'tv',
    intro: '20:40，晚间新闻还没完。',
    note: '从看电视时段开始：先坐沙发、面向电视（有教学），第一次检查要保住这个姿势。',
  },
};
export function chapterOf(g) { return CHAPTERS[g?.settings?.chapter] || CHAPTERS.desk; }

export const DEFAULT_SETTINGS = {
  extendedWarn: false,   // 预警 ×1.6
  extendedGrace: false,  // 宽限 ×1.5
  holdMode: false,       // 按住学习键保持姿态（默认按一次切换）
  assist: false,         // 在学习点范围内、检查来临时自动进入姿态（不传送、不解谜）
  lowMotion: false,
  lowHorror: false,
  showCone: false,       // 辅助：显示家长视线锥（默认关；改用门缝光与地面投影表达朝向）
  quality: 'standard',   // 清晰度：standard=180 融合（默认）/ fine=540 精细（下次打开页面生效）
  studyKey: 'Space',
  sens: 1,               // 鼠标灵敏度倍率（0.3–2.5；只缩放转视角，不改视野角度）
  volume: 0.8,           // 主音量 0–1（发布必需：外放/耳机/深夜都能自己调）
  muted: false,          // 静音（保留音量值，取消静音即恢复）
  chapter: 'desk',       // 章节：desk=第一章 19:40 书桌 / tv=第二章 20:40 电视
};

// YWQ-040：设置只接受 DEFAULT_SETTINGS 已知键且类型一致的值；旧存储里的未知字段（包括任何“进度”样字段）一律丢弃。
export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof raw[k] === typeof DEFAULT_SETTINGS[k]) out[k] = raw[k];
  if (!/^[A-Za-z0-9]+$/.test(out.studyKey)) out.studyKey = DEFAULT_SETTINGS.studyKey;
  if (!CHAPTERS[out.chapter]) out.chapter = DEFAULT_SETTINGS.chapter; // 只认两章，未知值回落第一章
  if (out.quality !== 'fine') out.quality = 'standard'; // 只认两档，未知值回落默认
  const sens = Number(out.sens);
  out.sens = Number.isFinite(sens) ? Math.min(2.5, Math.max(0.3, sens)) : DEFAULT_SETTINGS.sens;
  const vol = Number(out.volume);
  out.volume = Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : DEFAULT_SETTINGS.volume;
  return out;
}

const PHASES = ['tutorial', 'explore1', 'explore2', 'window', 'escaped'];
export { PHASES };

// ---------------------------------------------------------------- 几何

export function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

export function nearestStudyPoint(x, z) {
  let best = null, bd = Infinity;
  for (const p of STUDY_POINTS) { const d = dist(x, z, p.x, p.z); if (d < bd) { bd = d; best = p; } }
  return { point: best, d: bd };
}

// 线段 (p0→p1) 与 AABB 在 XZ 平面是否相交（slab 法）
export function segmentHitsBox(x0, z0, x1, z1, b) {
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [o, d, lo, hi] of [[x0, dx, b.minX, b.maxX], [z0, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; }
    else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

const inRoom = (x, z) => x >= ROOM.minX && x <= ROOM.maxX && z >= ROOM.minZ && z <= ROOM.maxZ;
const inThreshold = (x, z) => x >= THRESHOLD.minX && x <= THRESHOLD.maxX && z >= THRESHOLD.minZ && z <= THRESHOLD.maxZ;

// 墙体遮挡：房间 ↔ 门槛模块之间只能经由「打开的」门洞
export function wallBlocks(ex, ez, px, pz, doorOpen) {
  const eIn = inRoom(ex, ez), pIn = inRoom(px, pz);
  if (eIn === pIn) return false; // 同侧（简化：房间为凸形）
  if (!doorOpen) return true;
  const t = (DOOR.z - ez) / (pz - ez);
  if (!(t >= 0 && t <= 1)) return true;
  const x = ex + (px - ex) * t;
  return !(x >= DOOR.minX && x <= DOOR.maxX);
}

// 视线：距离 + 朝向 + 无遮挡，三者同时满足（YWQ-003-LOS-A：已删除 1 m 内无视朝向的近身例外，用户规则只认视线）
export function canSee(eye, gaze, px, pz, doorOpen, playerTop = CONFIG.standSightY) {
  const d = dist(eye.x, eye.z, px, pz);
  if (d > CONFIG.viewRange + CONFIG.losEpsDist) return { seen: false, why: 'range' };
  let diff = Math.atan2(pz - eye.z, px - eye.x) - gaze;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  if (Math.abs(diff) > CONFIG.viewHalfFov + CONFIG.losEpsAngle) return { seen: false, why: 'fov' };
  if (wallBlocks(eye.x, eye.z, px, pz, doorOpen)) return { seen: false, why: 'wall' };
  const minH = Math.min(CONFIG.occluderMinHeight, playerTop); // 蹲下把遮挡阈值降到身体高度
  for (const b of COLLIDERS) {
    if (b.h < minH) continue;
    if (segmentHitsBox(eye.x, eye.z, px, pz, b)) return { seen: false, why: 'occluded:' + b.id };
  }
  return { seen: true, why: 'visible' };
}

// 家长身体碰撞：只在家长身体可见（门开后：扫入/确认/离开）时生效，范围 = 可见胶囊半径 + 玩家半径。
// 只阻止「更靠近」的移动：已重叠时（例如家长出现在玩家身上）仍可离开，不会被卡住。
// 钥匙可在 explore2 就取走：把「最后一秒找钥匙」摊成「最后一程」，门仍只在窗口期能开
function canTakeKeys(g) { return g.phase === 'explore2' || g.phase === 'window' || g.phase === 'returning'; }

export function parentBody(g) { return g.check && g.check.stage !== 'warn' ? g.check.eye : null; }
function hitsParent(g, x0, z0, x1, z1) {
  const e = parentBody(g); if (!e) return false;
  const lim = CONFIG.parentRadius + CONFIG.playerRadius; const d1 = dist(e.x, e.z, x1, z1);
  return d1 < lim && d1 < dist(e.x, e.z, x0, z0);
}

// 碰撞：玩家为圆，按轴分离解算
export function collides(x, z, doorPassable) {
  const r = CONFIG.playerRadius;
  const room = x - r >= ROOM.minX && x + r <= ROOM.maxX && z - r >= ROOM.minZ && z + r <= ROOM.maxZ;
  const passage = doorPassable && x - r >= DOOR.minX && x + r <= DOOR.maxX && z - r >= ROOM.minZ && z + r <= THRESHOLD.maxZ;
  if (!room && !passage) return true;
  for (const b of COLLIDERS) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
  }
  return false;
}

// 网格寻路（测试用：验证「最远探索点 → 最近学习点」实际可走距离）
export function pathLength(ax, az, bx, bz, doorOpen = false, cell = 0.1) {
  const minX = ROOM.minX, minZ = ROOM.minZ, W = Math.round((ROOM.maxX - minX) / cell) + 1, H = Math.round((THRESHOLD.maxZ - minZ) / cell) + 1;
  const idx = (i, j) => j * W + i;
  const toI = (x) => Math.round((x - minX) / cell), toJ = (z) => Math.round((z - minZ) / cell);
  const free = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) free[idx(i, j)] = collides(minX + i * cell, minZ + j * cell, doorOpen) ? 0 : 1;
  // 起止点吸附到最近可站立格（网格离散误差）
  const snap = (x, z) => { let b = -1, bd = Infinity; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
    const i = toI(x) + di, j = toJ(z) + dj; if (i < 0 || j < 0 || i >= W || j >= H || !free[idx(i, j)]) continue;
    const d = di * di + dj * dj; if (d < bd) { bd = d; b = idx(i, j); } } return b; };
  const s = snap(ax, az), g = snap(bx, bz);
  if (s < 0 || g < 0) return Infinity;
  const D = new Float64Array(W * H).fill(Infinity); D[s] = 0;
  const open = [s]; const done = new Uint8Array(W * H);
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (open.length) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (D[open[k]] < D[open[bi]]) bi = k;
    const c = open.splice(bi, 1)[0]; if (done[c]) continue; done[c] = 1;
    if (c === g) return D[g] * cell;
    const ci = c % W, cj = (c - ci) / W;
    for (const [di, dj, w] of nb) {
      const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = idx(ni, nj); if (!free[n] || done[n]) continue;
      if (di && dj && (!free[idx(ci + di, cj)] || !free[idx(ci, cj + dj)])) continue;
      if (D[c] + w < D[n]) { D[n] = D[c] + w; open.push(n); }
    }
  }
  return Infinity;
}

// ---------------------------------------------------------------- 状态

export const fmtClock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function freshPlayer() { return { x: STUDY_POINTS[0].x + 0.3, z: STUDY_POINTS[0].z + 0.2, yaw: Math.PI / 2 - 0.35, pitch: -0.2 }; } // 学习点范围内，斜看书桌与珠帘

export function createGame(settings = {}) {
  const st = sanitizeSettings(settings);
  const chap = CHAPTERS[st.chapter] || CHAPTERS.desk; // 章节只决定开场时段与是否播教学，不改任何判定
  const g = {
    t: 0,                 // 主动游玩时间（暂停/阅读时不推进）
    phase: chap.tutorial ? 'tutorial' : 'explore1',
    chapter: chap.id,
    player: freshPlayer(),
    studying: false, studyPoint: null, studyAnim: 0,
    crouch: false, crouchAnim: 0, retainedClues: [],
    tutorialEntered: !chap.tutorial, tutorialExited: !chap.tutorial,
    tutorialKind: chap.tutorialKind || 'study', tutHold: 0, // 'tv' 教学用：已在沙发+面向电视的连续时长
    tutTime: 0, tutHint: 0, // 教学已经过去多久 / 已给到第几级提示（两种教学共用，防止卡在教学里）
    clues: { schedule: false, guide: false, calib: false },
    clock: chap.clock, clockFlipped: false,
    check: null,          // {id, stage:'warn'|'sweep'|'confirm'|'leave', t, exposure, eye, gaze, leftPosture}
    checkAPassed: false, checkAArmed: false, pendingA: null, checkATimer: chap.tutorial ? null : CONFIG.checkATimer,
    doorOpen: false, windowLeft: 0, windowWarned: false, hasKeys: false,
    clockWrong: 0,        // M2：钟摆错的累计次数（决定下一次 B 用哪条脚本）
    stats: { checks: 0, seen: 0 }, // G5 结果页统计：本局经历了几次检查、被看见几次
    anomalies: { timeLayer: false, scale: false, ceiling: false },
    modal: null,          // null | {type:'clue',id} | {type:'clock'} | {type:'notes'} | {type:'caught',...} | {type:'pause'} | {type:'result'}
    settings: st,
    events: [],           // 渲染/音频消费的事件队列
    log: [],              // 测试与录屏核对用事件日志
    message: null,        // {text, until}
    fails: { A: 0, B: 0, R: 0 }, attempts: 0,
    checkpoints: {},
    run: 1,               // YWQ-040：本次会话第几局（会话计数，不是进度；渲染层用它丢弃旧局回调）
  };
  g.checkpoints.cp1 = snapshot(g);
  // 教学章节也要有开场字幕：第二章的教学不是“按空格”，玩家得先知道此刻该看电视
  if (chap.tutorial && g.tutorialKind === 'tv') {
    say(g, `${chap.intro}${SCHEDULE_DUTIES[scheduleDutyAt(chap.clock)].hint}。`, 7);
  } else if (!chap.tutorial) {
    say(g, `${chap.intro}${SCHEDULE_DUTIES[scheduleDutyAt(chap.clock)].hint}。`, 6);
  }
  return g;
}

function snapshot(g) { return { anomalies: { ...g.anomalies }, clock: g.clock }; }

function emit(g, type, data = {}) { const e = { type, t: +g.t.toFixed(3), ...data }; g.events.push(e); g.log.push(e); }
function say(g, text, dur = 3.5) { g.message = { text, until: g.t + dur }; emit(g, 'message', { text }); }

const warnDur = (g) => CONFIG.warnTime * (g.settings.extendedWarn ? 1.6 : 1);
const graceMul = (g) => (g.settings.extendedGrace ? 1.5 : 1);
// 起始方向停留：比扫入宽限长，否则站在起始方向的人只会被"扫过"、永远累计不满宽限
// 转向速度上限：被扫过的任一方向在视野内停留 ≥ 宽限×1.1，否则扫视会留下"一掠而过"的窄缝
export const sweepDur = (g, id) => { const s = CHECKS[id]; const span = Math.abs(s.gazeTo - s.gazeFrom);
  return Math.max(CONFIG.sweepTime, (CONFIG.graceSweep * graceMul(g) * 1.1 * span) / (2 * CONFIG.viewHalfFov)); };
export const holdDur = (g) => CONFIG.graceSweep * graceMul(g) + CONFIG.holdFrom;
const holdOf = (g, id) => (CHECKS[id].gazeTo === CHECKS[id].gazeFrom ? 0 : holdDur(g)); // 不转头的检查（R）无需起始停留

export function isFrozen(g) { return g.modal !== null; }

function freezesStep(g) {
  if (!g.modal) return false;
  if (['pause', 'caught', 'result'].includes(g.modal.type)) return true;
  const lethal = g.check && (g.check.stage === 'sweep' || g.check.stage === 'confirm');
  return !lethal;
}

// ---------------------------------------------------------------- 动作（UI 调用）

export function pressStudy(g, { repeat = false } = {}) {
  if (repeat || isFrozen(g) || g.phase === 'escaped') return false; // 忽略按住产生的重复事件
  if (g.studying) { leavePosture(g, 'key'); return true; }
  if (g.crouch) { g.crouch = false; say(g, '你得先站起来才能写。'); return false; } // 蹲着不能写作业
  const { point, d } = nearestStudyPoint(g.player.x, g.player.z);
  if (d > CONFIG.studyRadius) { emit(g, 'studyRefused', { nearest: point.id, d: +d.toFixed(2) }); return false; } // 远处不传送
  g.studying = true; g.studyPoint = point.id; g.studyAnim = 0;
  emit(g, 'studyEnter', { point: point.id });
  if (g.phase === 'tutorial') g.tutorialEntered = true;
  return true;
}

export function releaseStudy(g) { if (g.settings.holdMode && g.studying) leavePosture(g, 'release'); }

// 教学结束只有一条路径：不管哪种教学，都从这里进 explore1 并启动 A 计时，
// 避免“教学期读过程序纸但 A 永远不来”的卡关（M1 遗留问题）。
function exitTutorial(g) {
  if (g.phase !== 'tutorial') return;
  const kind = g.tutorialKind || 'study';
  g.tutorialExited = true; g.phase = 'explore1'; g.checkpoints.cp1 = snapshot(g);
  g.checkATimer = CONFIG.checkATimer; // M1：不看作息纸也会在 25 s 后迎来检查 A
  emit(g, 'phase', { phase: 'explore1' });
  say(g, kind === 'tv'
    ? '姿势对了——这段时间就该坐着看电视，别写作业。检查时保持这个姿势。'
    : '只有书桌和沙发能装作写作业。去看看屋里有什么。', 5);
  // 教学期就读过作息纸：A 的触发条件已经用掉，补一次，避免“目标打勾但检查永远不来”的卡关
  if (g.clues.schedule && !g.checkAArmed && !g.checkAPassed) g.pendingA = CONFIG.pendingADelay;
}

function leavePosture(g, why) {
  g.studying = false; emit(g, 'studyExit', { point: g.studyPoint, why }); g.studyPoint = null;
  if (g.check && g.check.stage === 'confirm') g.check.leftPosture = true;
  // 看电视教学里按学习键是“错误动作”，不能拿它当教学完成的信号（否则等于教玩家写作业）
  if (g.phase === 'tutorial' && g.tutorialEntered && (g.tutorialKind || 'study') === 'study') exitTutorial(g);
}

export function nearbyInteractable(g) {
  const { x, z, yaw } = g.player; let best = null, bd = Infinity;
  for (const it of INTERACTABLES) {
    if (it.id === 'keys' && !canTakeKeys(g)) continue; // 钥匙从 explore2 起就能拿，门仍只在窗口开
    const d = dist(x, z, it.x, it.z); if (d > CONFIG.interactRange) continue;
    const fx = Math.sin(yaw) * -1, fz = Math.cos(yaw) * -1; // 相机朝向（three.js：yaw=0 看向 -z）
    const tx = it.target.x - x, tz = it.target.z - z, tl = Math.hypot(tx, tz) || 1;
    if ((fx * tx + fz * tz) / tl < 0.2) continue;
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

export function interact(g, id = null) {
  if (isFrozen(g) || g.phase === 'escaped') return false;
  if (g.studying) { say(g, '先停下（学习键）才能碰别的东西。', 2.5); return false; } // 之前是静默失败
  const it = id ? INTERACTABLES.find((i) => i.id === id && dist(g.player.x, g.player.z, i.x, i.z) <= CONFIG.interactRange) : nearbyInteractable(g);
  if (!it) return false;
  if (g.check && it.id !== 'door') { say(g, '检查中，现在动不了它。'); return false; } // 检查中不能操作谜题
  if (it.id === 'schedule' || it.id === 'guide') {
    g.modal = { type: 'clue', id: it.id };
    if (!g.clues[it.id]) { g.clues[it.id] = true; emit(g, 'clueFound', { id: it.id }); }
    return true;
  }
  if (it.id === 'clock') { g.modal = { type: 'clock' }; g.clockFlipped = false; return true; }
  if (it.id === 'keys') {
    if (!canTakeKeys(g)) { say(g, '现在拿钥匙没用。'); return false; }
    if (!g.hasKeys) { g.hasKeys = true; emit(g, 'keysTaken'); say(g, '钥匙到手。门就在旁边。', 3); }
    return true;
  }
  if (it.id === 'door') {
    if (g.phase === 'window') {
      if (!g.hasKeys) { say(g, '门锁着——钥匙挂在衣帽架上。', 3.5); emit(g, 'doorLocked'); return false; }
      if (!g.doorOpen) { g.doorOpen = true; emit(g, 'doorOpen', { by: 'player' }); }
      return true;
    }
    say(g, g.check ? '家长就在门口。' : '门外就是家长平时站着看你的地方。现在出去会被看见。');
    emit(g, 'doorRefused'); return false;
  }
  return false;
}

export function closeModal(g) {
  const m = g.modal; if (!m) return;
  if (m.type === 'caught' || m.type === 'result') return; // 需点重试/结束
  g.modal = null;
  if (m.type === 'clue' && g.phase === 'explore1' && !g.check && !g.checkAPassed) {
    if (m.id === 'schedule' && !g.anomalies.timeLayer) { g.anomalies.timeLayer = true; emit(g, 'anomaly', { id: 'timeLayer' }); }
    // M1：两条线索事件都能触发 A。窗台离学习点 3.9 m，关掉弹层就必须立刻往回跑
    if ((m.id === 'schedule' || m.id === 'guide') && !g.checkAArmed) startCheck(g, 'A');
  }
}

export function toggleCrouch(g, on) {
  if (isFrozen(g) || g.phase === 'escaped') return false;
  const next = on === undefined ? !g.crouch : !!on;
  if (next === g.crouch) return true;
  g.crouch = next; emit(g, next ? 'crouchOn' : 'crouchOff');
  return true;
}

export function openNotes(g) { if (!g.modal) g.modal = { type: 'notes' }; }
export function pause(g) { if (!g.modal) { g.modal = { type: 'pause' }; emit(g, 'pause'); } }

export function clockAdjust(g, dh, dm) {
  if (g.modal?.type !== 'clock') return;
  // 注意：explore1 也允许拨（tests/logic.test.mjs「线索2」锁定该行为）。
  // 副作用是 duty 直接读钟面，拧钟会改「此刻该做什么」——见 YWQ-ZERO-01 审计 §4.3，待拍板。
  let m = g.clock + dh * 60 + dm * 5; m = ((m % 1440) + 1440) % 1440; g.clock = Math.round(m / 5) * 5;
}
export function clockFlip(g) {
  if (g.modal?.type !== 'clock') return;
  g.clockFlipped = !g.clockFlipped;
  if (g.clockFlipped && !g.clues.calib) { g.clues.calib = true; emit(g, 'clueFound', { id: 'calib' }); }
}
export function clockCanSubmit(g) { return g.phase === 'explore2' && !g.check; }
export function clockSubmit(g) {
  if (g.modal?.type !== 'clock') return false;
  if (!clockCanSubmit(g)) { say(g, g.phase === 'explore1' ? '先别动它，被看见就完了。' : '现在不行。'); return false; }
  g.modal = null; emit(g, 'clockSubmit', { clock: fmtClock(g.clock) });
  startCheck(g, 'B'); return true;
}

// YWQ-HARD-01 / YWQ-040：一击死 → 整局重开，线索/台钟/进度全清，只保留 settings。
export function restartDemo(g, why = 'caught') {
  const prev = { run: g.run || 1, settings: g.settings };
  const fresh = createGame(prev.settings);
  for (const k of Object.keys(g)) if (!(k in fresh)) delete g[k];
  Object.assign(g, fresh);
  g.run = prev.run + 1;
  emit(g, 'restart', { run: g.run, why });
  if (g.run >= 2) {
    g.phase = 'explore1'; g.tutorialEntered = true; g.tutorialExited = true;
    g.checkpoints.cp1 = snapshot(g); g.checkATimer = CONFIG.checkATimer;
    const chap = chapterOf(g);
    say(g, chap.tutorial
      ? '又从书桌开始。作息纸在侧柜——这次别在错的时间做错的事。'
      : '又从电视时段开始。先去沙发坐好、面向电视——这段时间写作业会被看见。', 5);
  }
  return g;
}
// 暂停菜单里主动重开本局（与被抓重开同一入口，避免第二套复位逻辑）
export function restartFromPause(g) {
  if (g.modal?.type !== 'pause') return false;
  restartDemo(g, 'manual');
  return true;
}
// 兼容旧调用名：被抓卡片的按钮、录屏脚本仍调用 retry；语义已改为整局重开。
export function retry(g) { if (g.modal?.type !== 'caught') return; restartDemo(g, 'caught'); }
// 逃出后“再玩一次”也走同一入口，保证同样的干净初态。
export function playAgain(g) { if (g.modal?.type !== 'result') return; restartDemo(g, 'result'); }

// ---------------------------------------------------------------- 检查状态机

// M2：钟错的次数决定下一次 B 用哪条脚本（0/1 → B；2 → B2；≥3 → B3）
export function scriptFor(g, id) {
  if (id !== 'B') return id;
  const n = g.clockWrong || 0;
  return n >= 3 ? 'B3' : n === 2 ? 'B2' : 'B';
}

function startCheck(g, id) {
  const sid = scriptFor(g, id);
  const s = CHECKS[sid];
  g.check = { id, script: sid, stage: 'warn', t: 0, exposure: 0, eye: { ...s.from }, gaze: s.gazeFrom, leftPosture: false, seen: false };
  g.stats.checks++;
  if (id === 'A') { g.checkAArmed = true; g.pendingA = null; g.checkATimer = null; }
  if (id === 'A' && !g.anomalies.scale) { g.anomalies.scale = true; emit(g, 'anomaly', { id: 'scale' }); }
  if (id === 'B' && !g.anomalies.ceiling) { g.anomalies.ceiling = true; emit(g, 'anomaly', { id: 'ceiling' }); }
  emit(g, 'checkWarn', { id, script: sid });
  if (id === 'R' || sid === 'B3') { // R 的预告已在窗口末给出；B3 是家长直接进屋，没有预警
    g.check.stage = 'sweep'; g.check.eye = { ...s.to }; g.doorOpen = true;
    if (sid === 'B3') say(g, '门被推开了——他进了屋。', 2.5);
    emit(g, 'checkSweep', { id, script: sid });
  } else {
    say(g, id === 'A' ? '门把在响——脚步声从门口传来（右后方）' : '脚步声：有人朝客厅走来（门口方向）', checkWarnDur(g, sid));
  }
}

// M2：B2 的预警缩短到 2 s（辅助设置的延长预警仍然按倍数生效）
export function checkWarnDur(g, sid) { // 导出：渲染层要按同一时长做预警演出（不复制公式，避免和规则漂移）
  if (sid === 'B2') return CONFIG.bShortWarn * (g.settings.extendedWarn ? 1.6 : 1);
  return warnDur(g);
}

function caught(g, why = 'schedule') {
  const id = g.check?.id || 'R';
  const segment = id === 'A' ? 'A' : id === 'R' ? 'R' : 'B';
  const duty = scheduleDuty(g);
  const d = SCHEDULE_DUTIES[duty] || SCHEDULE_DUTIES.study;
  const lines = {
    schedule: duty === 'tv' ? '九点前不准开电视——你在干什么？' : duty === 'escape' ? '让你倒垃圾，你还在屋里磨蹭？' : '不是让你写作业吗？',
    reading: '我在跟你说话，你在看什么？',
  };
  g.fails[id] = (g.fails[id] || 0) + 1;
  // from：被抓时玩家正开着哪个弹层（clue / clock / notes，或 null）。
  // 这条之前没记，导致审计只能拿「本帧 step 之前」的 modal 去对，误判过「按 E 读纸、
  // 同一帧被扫到」这种合法死亡（1000 局 TV 模拟里出现过 1 次规则异常假阳性）。
  const from = g.modal?.type ?? null;
  emit(g, 'caught', { id, why, duty, from, x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2) });
  // 电视时段的死因要说人话：0 知识模拟里 249 条 A/tv 死亡是「人就在沙发边、只是没面向电视」，
  // 结算只说「此刻该看电视」等于让玩家自己猜哪里错了。
  const fb = dutyFeedback(g);
  const why2 = duty === 'tv'
    ? fb.kind === 'facing' ? '你人在沙发边，但视线没对着电视——检查看到的是你的朝向。'
      : fb.kind === 'posture' ? '你人在沙发边，却摆着写作业的姿势——这个时段不算在看电视。'
        : ''
    : '';
  g.modal = {
    type: 'caught', segment, duty,
    line: lines[why] || lines.schedule,
    note: `台钟 ${fmtClock(g.clock)}：此刻该「${d.label}」。被看见即出局——线索、钟、进度全部清空。${why2}`,
    fb: fb.kind,
  };
  g.check = null;
  g.doorOpen = false;
}

function finishCheck(g) {
  const c = g.check; g.check = null; g.doorOpen = false;
  if (g.player.z > ROOM.maxZ - CONFIG.playerRadius) { g.player.x = 1.65; g.player.z = 2.6; } // 门关上时不把玩家卡在门洞里
  emit(g, 'checkEnd', { id: c.id });
  if (c.id === 'A') {
    g.checkAPassed = true; g.phase = 'explore2'; g.checkpoints.cp2 = snapshot(g);
    emit(g, 'phase', { phase: 'explore2' }); say(g, '视线已移开。', 3);
  } else if (c.id === 'B') {
    if (g.clock === CONFIG.correctClock) {
      g.phase = 'window'; g.windowLeft = CONFIG.windowTime; g.windowWarned = false;
      emit(g, 'windowOpen'); say(g, '家长看了一眼钟：“到点了。”——拎着垃圾下楼了。门外没人。', 4);
    } else {
      g.clockWrong++;
      emit(g, 'wrongTime', { clock: fmtClock(g.clock), n: g.clockWrong });
      if (g.clockWrong === 1) say(g, '家长看了一眼钟：“还没到时候。”他多站了一会儿才走。', 4);
      else if (g.clockWrong === 2) say(g, '家长眯起眼睛：“你动过这个钟？”——下次他会看得更仔细。', 4.5);
      else say(g, '家长没再说话，把钟摆回原处。屋里的空气沉了下来。', 4);
    }
  } else if (c.id === 'R') {
    g.phase = 'explore2'; emit(g, 'windowClosed');
    say(g, '家长回来了。窗口关闭——钟还摆着，可以再摆一次。', 4);
  }
}

// M2：第一次钟错之后，B 的确认阶段多站 1 s（“他多站了一会儿”）
function confirmDur(g, c) { return CONFIG.confirmTime + (c.id === 'B' && c.script === 'B' && (g.clockWrong || 0) >= 1 ? CONFIG.bExtraConfirm : 0); }

// 暴露上限：扫入阶段 = graceSweep；确认阶段离开姿态后 = 更短的 graceConfirm；辅助设置按倍数放宽。
// 导出给 HUD 画进度条，避免 UI 自己复制一套公式后又和规则漂移。
export function exposureLimit(g, c) {
  return (c.stage === 'confirm' && c.leftPosture ? CONFIG.graceConfirm : CONFIG.graceSweep) * graceMul(g);
}

function stepCheck(g, dt) {
  const c = g.check; const s = CHECKS[c.script || c.id]; c.t += dt;
  if (c.stage === 'warn') {
    if (c.t >= checkWarnDur(g, c.script || c.id)) { c.stage = 'sweep'; c.t = 0; c.eye = { ...s.to }; g.doorOpen = true; emit(g, 'checkSweep', { id: c.id, script: c.script }); }
    return;
  }
  if (c.stage === 'leave') { if (c.t >= CONFIG.leaveTime) finishCheck(g); return; }
  if (c.stage === 'sweep') {
    // 先在起始方向停留（≥ 宽限），再转向终止方向；扫过的区域都会被真正看一眼，而不是一掠而过
    const sid = c.script || c.id; // B2/B3 的扫视速度按各自脚本算，不能回落到 B
    const k = Math.max(0, Math.min(1, (c.t - holdOf(g, sid)) / sweepDur(g, sid)));
    c.gaze = s.gazeFrom + (s.gazeTo - s.gazeFrom) * k;
  }
  const v = canSee(c.eye, c.gaze, g.player.x, g.player.z, g.doorOpen, g.crouch ? CONFIG.crouchSightY : CONFIG.standSightY);
  if (v.seen !== c.seen) { c.seen = v.seen; if (v.seen) g.stats.seen++; emit(g, v.seen ? 'seenStart' : 'seenEnd', { id: c.id, why: v.why }); }
  if ((c.stage === 'sweep' || c.stage === 'confirm') && v.seen) {
    const why = g.modal && ['clue', 'clock', 'notes'].includes(g.modal.type) ? 'reading' : 'schedule';
    if (!isScheduleCompliant(g)) { caught(g, why); return; }
  }
  if (c.stage === 'sweep' && c.t >= holdOf(g, c.script || c.id) + sweepDur(g, c.script || c.id)) { c.stage = 'confirm'; c.t = 0; emit(g, 'checkConfirm', { id: c.id, script: c.script }); }
  else if (c.stage === 'confirm' && c.t >= confirmDur(g, c)) { c.stage = 'leave'; c.t = 0; emit(g, 'checkLeave', { id: c.id }); }
}

// ---------------------------------------------------------------- 主循环

// input: { mx, mz } 本地移动（-1..1，mz<0 前进），dyaw, dpitch
// 斜向顶住家具外角时的切向补救：两轴都被拒绝说明正好切在圆-盒的斜面上，
// 此时只沿目标方向推会把玩家“钉”在角落（仿真里能复现 45 s 不动）。沿表面切向滑半步即可脱困，
// 仍然经过 collides 检查，所以不会穿墙、也不会让玩家绕过本来过不去的缝。
function slideTangent(x, z, wx, wz, passable) {
  let best = null, bestD = Infinity;
  for (const b of COLLIDERS) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const d = Math.hypot(x - cx, z - cz); if (d < bestD) { bestD = d; best = { cx, cz }; }
  }
  if (!best || bestD > CONFIG.playerRadius + 0.12) return null;
  let nx = x - best.cx, nz = z - best.cz; const nl = Math.hypot(nx, nz);
  if (nl < 1e-6) return null;
  nx /= nl; nz /= nl;
  const len = Math.hypot(wx, wz) || 1;
  const tx = -nz, tz = nx;                       // 两个切向
  const s = (tx * wx + tz * wz) >= 0 ? 1 : -1;    // 选“朝目标那侧”
  const step = Math.min(len * 0.5, CONFIG.playerRadius * 0.5);
  const nx2 = x + s * tx * step, nz2 = z + s * tz * step;
  if (collides(nx2, nz2, passable)) return null;
  return { x: s * tx * step, z: s * tz * step };
}

export function step(g, dt, input = {}) {
  if (g.phase === 'escaped') return;
  if (freezesStep(g)) return;
  dt = Math.min(dt, 0.1);
  g.t += dt;
  const p = g.player;
  p.yaw += input.dyaw || 0; p.pitch = Math.max(-1.2, Math.min(1.2, p.pitch + (input.dpitch || 0)));

  // 学习姿态中移动 = 明确退出
  const mx = input.mx || 0, mz = input.mz || 0;
  if (g.studying && (mx || mz)) leavePosture(g, 'move');
  if (g.studying) g.studyAnim = Math.min(1, g.studyAnim + dt / CONFIG.studySettle);
  g.crouchAnim = Math.max(0, Math.min(1, (g.crouchAnim || 0) + (g.crouch ? dt : -dt) / CONFIG.crouchSettle));
  if (!g.modal && !g.studying && (mx || mz)) {
    const len = Math.hypot(mx, mz) || 1, sp = (g.crouch ? CONFIG.crouchSpeed : CONFIG.walkSpeed) * dt;
    const sx = Math.sin(p.yaw), cz = Math.cos(p.yaw);
    const passable = g.doorOpen && (g.phase === 'window' || g.phase === 'returning');
    const wx = ((mx * cz + mz * sx) / len) * sp, wz = ((-mx * sx + mz * cz) / len) * sp;
    // 只有真的发生了位移才算“动过”：纯轴向顶住桌子时不该触发切向滑动（那是穿缝/滑行，不该给）
    const wantX = Math.abs(wx) > 1e-9, wantZ = Math.abs(wz) > 1e-9;
    let movedX = false, movedZ = false;
    if (wantX && !collides(p.x + wx, p.z, passable) && !hitsParent(g, p.x, p.z, p.x + wx, p.z)) { p.x += wx; movedX = true; }
    if (wantZ && !collides(p.x, p.z + wz, passable) && !hitsParent(g, p.x, p.z, p.x, p.z + wz)) { p.z += wz; movedZ = true; }
    if (wantX && wantZ && !movedX && !movedZ) { // 斜向两轴同时被拒：沿家具切向滑半步，避免卡在桌角/柜角
      const t = slideTangent(p.x, p.z, wx, wz, passable);
      if (t && !hitsParent(g, p.x, p.z, p.x + t.x, p.z + t.z)) { p.x += t.x; p.z += t.z; }
    }
  }

  // 教学：两种教学都必须有「时间兜底」，否则不知道按键的玩家会一直站在没有任何反馈的教学里
  // （1000 局模拟里唯一剩下的卡关就是这一条：乱点档 1 局，教学期永远不出来）。
  // 兜底不是作弊：放行后 A 计时才开始，规则一点没松，只是把「不会开始玩」变成「开始玩然后可能被抓」。
  if (g.phase === 'tutorial') {
    g.tutTime = (g.tutTime || 0) + dt;
    if (g.tutorialKind === 'tv') {
      // 看电视教学：真的在沙发坐下、面向电视并保持 0.9 s 才算学会（教的是姿势，不是“按某个键”）
      g.tutHold = isScheduleCompliant(g) ? g.tutHold + dt : 0;
      if (g.tutHold >= 0.9) exitTutorial(g);
      else if (g.tutTime > 45) { exitTutorial(g); say(g, '先不坐着也行——记住：这段时间的正确姿势是坐沙发、面向电视。', 6); }
    } else if (!g.studying) {
      // 书桌教学：25 s 还没坐下 → 指路；40 s → 把动作说到最直白；60 s → 放行（A 计时开始）
      if (g.tutTime > 25 && g.tutHint < 1) { g.tutHint = 1; emit(g, 'tutorialHint', { step: 1 }); }
      if (g.tutTime > 40 && g.tutHint < 2) { g.tutHint = 2; emit(g, 'tutorialHint', { step: 2 }); }
      if (g.tutTime > 60) { exitTutorial(g); say(g, '先不用急着坐下——从现在起，检查随时会来。', 6); }
    }
  }

  // 辅助模式：仅在「写作业时段」自动进入姿态
  if (g.settings.assist && scheduleDuty(g) === 'study' && g.check && g.check.stage !== 'leave' && !g.studying) {
    const { d } = nearestStudyPoint(p.x, p.z); if (d <= CONFIG.studyRadius) pressStudy(g);
  }

  // 教学期已读过作息纸的兜底：退出教学后延迟一小段再触发 A（给出“回书桌”的时间）
  if (g.pendingA != null && !g.check && g.phase === 'explore1') {
    g.pendingA -= dt; if (g.pendingA <= 0) { g.pendingA = null; startCheck(g, 'A'); }
  }
  // M1：explore1 里主动游玩满 checkATimer 秒，也会迎来检查 A（不读线索也躲不过）
  if (g.phase === 'explore1' && !g.check && !g.checkAArmed && g.checkATimer != null) {
    g.checkATimer -= dt;
    if (g.checkATimer <= 0) { g.checkATimer = null; startCheck(g, 'A'); }
  }
  if (g.check) stepCheck(g, dt);
  if (g.modal) return;

  if (g.phase === 'window') {
    g.windowLeft -= dt;
    if (g.doorOpen && p.z > THRESHOLD.escapeZ) {
      g.phase = 'escaped'; emit(g, 'escaped', { t: +g.t.toFixed(2), windowLeft: +g.windowLeft.toFixed(2) });
      g.modal = { type: 'result' }; return;
    }
    if (!g.windowWarned && g.windowLeft <= CONFIG.windowReturnWarn) { g.windowWarned = true; emit(g, 'windowWarn'); say(g, '楼道里有脚步声往上走——家长要回来了（门口方向）。来不及出门就回学习点装写作业。', 5); }
    if (g.windowLeft <= 0) { g.windowLeft = 0; g.phase = 'returning'; startCheck(g, 'R'); } // 门槛上来不及：由 R 检查按视线判定
  }
  if (g.phase === 'returning' && !g.check) g.phase = 'explore2';
  if (g.message && g.t > g.message.until) g.message = null;
}

// 给 UI 的提示文本
export function hint(g) {
  if (g.modal) return '';
  const duty = scheduleDuty(g);
  const dInfo = SCHEDULE_DUTIES[duty] || SCHEDULE_DUTIES.study;
  const { point, d } = nearestStudyPoint(g.player.x, g.player.z);
  const key = g.settings.studyKey === 'Space' ? '空格' : g.settings.studyKey;
  const clockTag = `【${fmtClock(g.clock)}·${dInfo.short}】`;
  if (g.studying) {
    // R（窗口超时、家长从门口看进来）：写作业就是伪装，别提示“停下”（那是致死建议）
    if (g.check?.id === 'R') return `${clockTag} 保持写作业，别动——他正从门口看进来`;
    // 窗口期还坐着：写作业已不合法，直接给下一步（拿钥匙），而不是让玩家自己猜
    if (duty === 'escape') return `${clockTag} 还坐着——${key}停下，去衣帽架拿钥匙`;
    // 检查中：任何一次移动都会立刻退出学习姿态（0 知识首玩模拟里 70% 的 A 死亡是这一下）
    if (g.check) return `${clockTag} 写作业中（${point.name}）· 别动，别碰${key}`;
    return `${clockTag} 写作业中（${point.name}）——${key}或移动：停下`;
  }
  // 检查中 E / N 都不能用，且 N 在扫视阶段会直接出局：HUD 不再提示，避免诱导致死操作
  if (g.check) return `${clockTag} ${dInfo.hint}`;
  const it = nearbyInteractable(g);
  let base = `${clockTag} ${dInfo.hint}`;
  if (duty === 'study' && d <= CONFIG.studyRadius) base += `　·　${key}：写作业`;
  if (it) base += `　·　E：${it.name}`;
  else { const n = Object.values(g.clues).filter(Boolean).length; if (n > 0 && g.phase !== 'escaped') base += `　·　N：笔记（${n}）`; }
  return g.crouch ? `蹲行中（C 起身）　·　${base}`.trim() : base;
}

// ---------------------------------------------------------------- 目标清单（可玩性：让玩家始终知道“下一步做什么”）
// 只读既有状态，不改规则；顺序固定，已完成项打勾并压暗。线索类条目按“是否已看过”判定，不泄露答案。
export const OBJECTIVES = [
  { id: 'schedule', label: '看作息纸：每个时段该做什么' },
  { id: 'guide', label: '看节目表：新闻几点结束' },
  { id: 'clock', label: '把台钟拨到「该出门」的那一刻' },
  { id: 'leave', label: '在正确时段从门口离开' },
];

// 时间显示：结果页与最快纪录共用，避免两处各写一套四舍五入
export function fmtTime(sec) {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)} 分 ${String(t % 60).padStart(2, '0')} 秒`;
}

// 结算评级：只看「用时 / 摆错次数 / 被看见次数」，不引入新的判定规则。
// 设计意图：首玩约 55–70 s、可能摆错一次、被看见几次 → B；熟练 25–35 s → A/S。
// 不按线索数评级：跳线索是玩家自由，不该被扣分。
export const GRADES = [
  { id: 'S', label: '没留下痕迹', note: '快、准、一次都没被真正看见。' },
  { id: 'A', label: '干净的一次', note: '节奏稳，家长没抓到把柄。' },
  { id: 'B', label: '有惊无险', note: '手忙脚乱过，但你在窗口关上前出了门。' },
  { id: 'C', label: '磕磕绊绊', note: '被看见、摆错、来回折返——但你终究跨过了门槛。' },
];
export function resultGrade(g) {
  const t = g.t || 0, wrong = g.clockWrong || 0, seen = g.stats?.seen || 0;
  let id = 'C';
  if (t <= 32 && wrong === 0 && seen <= 1) id = 'S';
  else if (t <= 48 && wrong <= 1 && seen <= 3) id = 'A';
  else if (t <= 80) id = 'B';
  const meta = GRADES.find((x) => x.id === id);
  return { id, ...meta };
}

export function objectives(g) {
  const done = {
    schedule: !!g.clues.schedule,
    guide: !!g.clues.guide,
    clock: g.phase === 'window' || g.phase === 'escaped',
    leave: g.phase === 'escaped',
  };
  const rows = OBJECTIVES.map((o) => ({ ...o, done: !!done[o.id] }));
  // M3：窗口期把“拿钥匙”插在“离开”之前，玩家不用猜为什么门打不开
  if (g.phase === 'window') rows.splice(3, 0, { id: 'keys', label: '从衣帽架拿钥匙', done: !!g.hasKeys });
  return rows;
}

export function nearestStudyDirection(g) {
  const { point, d } = nearestStudyPoint(g.player.x, g.player.z);
  const a = Math.atan2(point.x - g.player.x, point.z - g.player.z); // 世界方位
  let rel = a - (g.player.yaw + Math.PI); rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  return { point, d, rel };
}

// 检查中「此刻该去哪」的方向提示：跟着定时任务走，不一律指学习点。
// 电视时段指向沙发（还要面向电视，由 hint 说明）；出门时段先指钥匙、拿到后指门口。
export const DUTY_SPOTS = {
  tv: { id: 'P2', name: '沙发', x: 1.7, z: 0.7 },
  door: { id: 'door', name: '门口', x: 1.65, z: 2.6 },
  keys: { id: 'keys', name: '衣帽架', x: 2.3, z: 2.25 },
};
export function nearestDutyDirection(g) {
  const duty = scheduleDuty(g);
  let spot;
  if (duty === 'tv') spot = DUTY_SPOTS.tv;
  else if (duty === 'escape') spot = g.hasKeys ? DUTY_SPOTS.door : DUTY_SPOTS.keys;
  else { const { point, d } = nearestStudyPoint(g.player.x, g.player.z); spot = { ...point }; spot.d = d; }
  const d = spot.d ?? Math.hypot(spot.x - g.player.x, spot.z - g.player.z);
  const a = Math.atan2(spot.x - g.player.x, spot.z - g.player.z);
  let rel = a - (g.player.yaw + Math.PI); rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  return { point: spot, d, rel, duty };
}

// 电视时段的“差在哪”诊断（只读、只用于 HUD 反馈；判定仍走 isScheduleCompliant，一个字没改）：
//   far     — 不在沙发附近
//   posture — 人到了，但摆着写作业的姿势（看电视时段这是违规，玩家常常以为“坐下＝按空格”）
//   facing  — 人到了、姿势对，但没面向电视（0 知识模拟里 A/tv 死亡的主因：站在沙发边朝别处）
//   ok      — 完全合规
// 为什么要有它：现在违规时 HUD 只会说“违规！该看电视”，玩家站在沙发边却不知道要转身——
// 这是一条没有反馈的隐形规则，属于体验缺口，不是难度。
export function dutyFeedback(g) {
  const duty = scheduleDuty(g);
  if (duty !== 'tv') return { duty, kind: 'na' };
  const { point, d } = nearestStudyPoint(g.player.x, g.player.z);
  const dSofa = dist(g.player.x, g.player.z, DUTY_SPOTS.tv.x, DUTY_SPOTS.tv.z);
  if (!(point.id === 'P2' && d <= CONFIG.studyRadius)) return { duty, kind: 'far', d: +dSofa.toFixed(2), point: point.id };
  if (g.studying) return { duty, kind: 'posture', d: +d.toFixed(2), point: point.id };
  if (!facingWorld(g, TV_FOCUS.x, TV_FOCUS.z)) {
    // 与方向条同一套约定（见 nearestDutyDirection）：rel < 0 → 目标在右手边
    const a = Math.atan2(TV_FOCUS.x - g.player.x, TV_FOCUS.z - g.player.z);
    let rel = a - (g.player.yaw + Math.PI); rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    return { duty, kind: 'facing', rel: +rel.toFixed(2), side: rel < 0 ? 'right' : 'left' };
  }
  return { duty, kind: 'ok', d: +d.toFixed(2), point: point.id };
}
