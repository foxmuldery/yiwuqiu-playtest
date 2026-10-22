// 《一屋囚》最小 Demo —— 渲染、输入、界面、声音。逻辑全部在 game/logic.js。
import * as THREE from './vendor/three.module.js';
import * as L from './game/logic.js';
import { resolvePreview } from './game/previewRes.js';
import { stickVector, touchLookDelta, STICK_RADIUS } from './game/touch.js';
import { createSfx } from './game/sfx.js';
import { createPlaytestLog } from './game/telemetry.js';
import { createVideoRecorder } from './game/video-recorder.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
// YWQ-STYLE-A 小样开关：?style=a → 低精度旧主机画风（低分辨率内部渲染、最近邻贴图、顶点抖动、15 位色+抖色、低面数角落）
// YWQ-STYLE-A2：?style=a1 / ?style=a2 → 同一方向的两档加强（参数见 STYLE_TIERS 与 docs/design/STYLE_A_PLAN.md §5）。
// 只改渲染与角落模型外观；逻辑、碰撞、门位、学习点、检查脚本一律不动。三档灯光与雾完全相同（同光照对照）。
const STYLE_TIERS = {
  a:  { id: 'a',  name: 'A 基准（旧小样参数）', lines: 240, snapDiv: 2, tileTex: 64, texLevels: 0,  colorLevels: 31, bayer: 2, maxSeg: 0, affine: false, subdiv: 0, ditherAmp: 1 },
  a1: { id: 'a1', name: 'A+1 加强一档',         lines: 150, snapDiv: 3, tileTex: 24, texLevels: 14, colorLevels: 17, bayer: 4, maxSeg: 5, affine: false, subdiv: 0,   crackFill: 0x6f6b61, ditherAmp: 0.8, texDither: 0.6 },
  a2: { id: 'a2', name: 'A+2 加强二档',         lines: 120, snapDiv: 4, tileTex: 16, texLevels: 10, colorLevels: 15, bayer: 4, maxSeg: 4, affine: true,  subdiv: 0.5, crackFill: 0x6f6b61, ditherAmp: 0.5, texDither: 0 },
  // YWQ-STYLE-FUSION-01 融合候选（用户选定：低多边形空间 + 手绘 3D 纹理 + 较强但可读的旧主机低清；参考 YWQ-MIX-v1 只定笔触/体积/色彩/低清语言，几何与摆位不动）
  fusion: { id: 'fusion', name: '融合候选 F1（低模+手绘纹理+可读低清）', lines: 180, snapDiv: 2, tileTex: 48, texLevels: 0, colorLevels: 23, bayer: 2, maxSeg: 6, affine: false, subdiv: 0, crackFill: 0x5f6461, ditherAmp: 0.35, paint: 1, wallTint: 0xb9c6c6, woodWarm: 0xffd9a8, fog: [6.5, 13], ambient: 0.95, gain: 1.08 },
};
const STYLE_TIER0 = STYLE_TIERS[new URLSearchParams(location.search).get('style')] || null;
// YWQ-STYLE-FUSION-01 定位开关（只影响渲染）：?dbg=magenta,nosnap,noaffine,nosubdiv —— 逐项关掉可疑环节做同路线对照
const PARAMS = new URLSearchParams(location.search);
// 调试面只在显式 ?dev=1（或自动化参数）下开放：?dbg=、__ywq.setAutopilot/newGame、__ywqMeshIds。正式玩家入口不带这些。
const DEVTOOLS = PARAMS.has('dev') || PARAMS.has('evidence') || PARAMS.has('autostart');
const DBG = DEVTOOLS ? new Set((PARAMS.get('dbg') || '').split(',').filter(Boolean)) : new Set();
// ?res=360|540|720|full：清晰度预览（只覆盖渲染分辨率/色阶/抖色/吸附/贴图降采样，配色与笔触不变；不带 res 时与原档完全一致）
// 5.3 拍板：默认 180 融合；玩家设置只开放「标准 / 精细 540」；720 不对玩家开放（仍是预览参数）
const RES_PARAM = PARAMS.get('res');
const BOOT_QUALITY = (() => { try { const v = JSON.parse(localStorage.getItem('ywq.settings.v1') || '{}'); return v && v.quality === 'fine' ? 'fine' : 'standard'; } catch { return 'standard'; } })();
const RES = RES_PARAM || (BOOT_QUALITY === 'fine' ? '540' : null);
const KEEPSTYLE = PARAMS.get('keepstyle') === '1' || (!RES_PARAM && BOOT_QUALITY === 'fine');
const BRUSHFINE = PARAMS.get('brush') === 'fine' || (!RES_PARAM && BOOT_QUALITY === 'fine');
const HD = { ...resolvePreview(STYLE_TIER0, RES) }; // 见 game/previewRes.js（单元测试覆盖）
if (HD.hd && BRUSHFINE) HD.brushFine = true; // 预览可选：更细的笔触颗粒（仍需 res，默认与融合档一致）
// YWQ-STYLE-FUSION-01 预览候选：?res=NNN&keepstyle=1 —— 只提分辨率，保留融合档的色阶/抖色/分段上限（默认档拍板前不动默认；不带 res 或 keepstyle 时零影响）
if (HD.hd && KEEPSTYLE && STYLE_TIER0) {
  for (const k of ['colorLevels', 'ditherAmp', 'maxSeg', 'texLevels', 'crackFill']) if (STYLE_TIER0[k] !== undefined) HD[k] = STYLE_TIER0[k];
  HD.keepStyle = true;
}
const STYLE_TIER = STYLE_TIER0 && { ...STYLE_TIER0, ...HD, ...(DBG.has('noaffine') ? { affine: false } : {}), ...(DBG.has('nosubdiv') ? { subdiv: 0 } : {}), ...(DBG.has('magenta') ? { crackFill: 0xff00ff } : {}) };
const STYLE_A = !!STYLE_TIER;
const STYLE_A_LINES = STYLE_TIER ? STYLE_TIER.lines : 240; // 内部渲染行数（宽度按画面比例）
document.body.classList.toggle('style-a', STYLE_A && !(STYLE_TIER && STYLE_TIER.hd));
// 标题不再固定写「灰盒」：按实际档位显示，避免预览/发布时口径不一致（自审 S2-4 的同一问题）
const TIER_LABEL = HD.hd ? `高清 ${STYLE_TIER.lines} 行` : (STYLE_A ? '融合档' : '灰盒');
document.title = `一屋囚 · 最小 Demo（${TIER_LABEL}）`;
{ const ts = document.getElementById('titleSub'); if (ts) ts.textContent = ts.textContent.replace('灰盒', TIER_LABEL); }
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !STYLE_A || !!(STYLE_TIER && STYLE_TIER.hd),
  preserveDrawingBuffer: PARAMS.has('evidence') || PARAMS.has('autostart') || PARAMS.has('dev') }); // 仅取证需要；iPad 上常开会持续吃带宽
renderer.setPixelRatio(STYLE_A ? 1 : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c0d);
scene.fog = new THREE.Fog(0x14171a, 6, 14);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40);
camera.rotation.order = 'YXZ';
const EYE = 1.35; // 孩子视高（假定）

const SETTINGS_KEY = 'ywq.settings.v1';
const BEST_KEY = 'ywq.best.v1';       // 最快逃出用时（本地，纯展示；不参与判定）
let bestInfo = null;                  // 本局逃出时的 { best, isNew }，供结果页显示
let saved = {};
try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* 无痕模式 */ }
let g = L.createGame(L.sanitizeSettings(saved));
const params = new URLSearchParams(location.search);
// 内测试玩记录：默认只记 JSON（事件级 + 2 Hz 采样，几百条/局），录像由玩家自己点「⏺」或按 F9 开始。
// 它与 ?evidence=1 的区别：evidence 给自动化取证用（含原始键鼠流、默认关闭）；这个是给真人内测用的成品包。
const pt = createPlaytestLog({
  ua: navigator.userAgent, dpr: devicePixelRatio || 1, size: [innerWidth, innerHeight],
  touch: matchMedia('(pointer: coarse)').matches, settings: { ...g.settings },
});
let vid = null;            // 首次按下「⏺」时才创建（依赖 canvas 与 AudioContext）

// ------------------------------------------------------------------ 程序贴图（技术占位，非原作贴图）
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = HD.hd ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4; return t;
}
// 地面：乳白釉面方砖约 60 cm、细灰缝（E580/E442，见 docs/design/SCENE_ELEMENTS.md §1）
const tileTex = canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#d8cfbc'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(150,135,110,${Math.random() * 0.05})`; x.fillRect(Math.random() * w, Math.random() * h, 4, 4); }
  x.strokeStyle = '#a59c88'; x.lineWidth = 3; x.strokeRect(0, 0, w, h);
}, [L.ROOM.maxX * 2 / 0.6, (L.ROOM.maxZ * 2 + 2.2) / 0.6]);
const woodTex = canvasTex(256, 128, (x, w, h) => {
  x.fillStyle = '#7a5434'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(40,22,10,${0.08 + Math.random() * 0.12})`; x.beginPath(); const y = Math.random() * h; x.moveTo(0, y); x.bezierCurveTo(80, y + 6, 160, y - 6, 256, y + 2); x.stroke(); }
  x.fillStyle = 'rgba(30,18,8,.6)'; for (let i = 0; i < 4; i++) x.fillRect(i * 64, 0, 2, h);
}, [6, 1]);
const wallTex = canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#e2dccb'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(90,90,70,${Math.random() * 0.04})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
}, [4, 2]);

// 木墙裙：蜂蜜色清漆框格 + 凸起浅色菱形（E308/E580；分格数为占位）
const wainsTex = canvasTex(256, 128, (x, w, h) => {
  x.fillStyle = '#c49553'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) { x.strokeStyle = `rgba(70,40,15,${0.05 + Math.random() * 0.08})`; x.beginPath(); const y = Math.random() * h; x.moveTo(0, y); x.bezierCurveTo(80, y + 4, 170, y - 4, 256, y + 1); x.stroke(); }
  x.fillStyle = '#8a5f2c'; x.fillRect(0, 0, w, 14); // 顶部压条
  x.strokeStyle = '#7a5225'; x.lineWidth = 5; x.strokeRect(12, 24, w - 24, h - 34);
  x.fillStyle = '#ddb877'; x.beginPath(); x.moveTo(w / 2, 34); x.lineTo(w - 40, h / 2 + 7); x.lineTo(w / 2, h - 20); x.lineTo(40, h / 2 + 7); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(90,55,20,.7)'; x.lineWidth = 2; x.stroke();
}, [5, 1]);
// 沙发/椅垫：灰米千鸟格（E308/E310/E442）
const checkTex = canvasTex(64, 64, (x, w, h) => {
  x.fillStyle = '#a29d92'; x.fillRect(0, 0, w, h); x.fillStyle = '#7a756c';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) { x.fillRect(i * 8, j * 8, 8, 8); x.fillRect(i * 8 + 6, j * 8 - 2, 3, 3); }
}, [3, 2]);
// 窗帘：浅底灰玫瑰小碎花（E308）
const floralTex = canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#ece4d4'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { const cx = Math.random() * w, cy = Math.random() * h; x.fillStyle = 'rgba(160,95,100,.55)';
    for (let k = 0; k < 5; k++) { x.beginPath(); x.arc(cx + Math.cos(k * 1.26) * 4, cy + Math.sin(k * 1.26) * 4, 3, 0, 7); x.fill(); }
    x.fillStyle = 'rgba(110,120,90,.5)'; x.fillRect(cx + 3, cy + 6, 2, 8); }
}, [2, 4]);
// 珠帘：红色长椭圆珠 + 白色小圆珠交替（E080/E065）
const beadTex = canvasTex(16, 128, (x, w, h) => {
  for (let y = 0; y < h; y += 32) { x.fillStyle = '#c23a2e'; x.fillRect(0, y, w, 22); x.fillStyle = '#ffffff'; x.fillRect(0, y + 20, w, 12); }
}, [1, 8]);
// 桌布：白色钩针蕾丝（E308/E442）
const laceTex = canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#f1ede4'; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(150,140,120,.55)'; x.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(i * 32 + 16, j * 32 + 16, 11, 0, 7); x.stroke(); x.beginPath(); x.arc(i * 32 + 16, j * 32 + 16, 4, 0, 7); x.stroke(); }
}, [3, 2]);

function paperTex(lines, opts = {}) {
  return canvasTex(512, 640, (x, w, h) => {
    x.fillStyle = opts.bg || '#ece5cc'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2b2a26'; x.font = `${opts.size || 34}px "Songti SC","STSong",serif`;
    lines.forEach((s, i) => x.fillText(s, 34, 80 + i * (opts.lh || 64)));
  });
}

// ------------------------------------------------------------------ PBR 细节（OneDrive TextureLibrary/polyhaven，CC0；仅法线 + ARM，颜色仍按原帧用程序贴图）
// 资产来源见 src/assets/tex/SOURCES.md。加载失败时材质照常用程序贴图，不影响玩法。
const texLoader = new THREE.TextureLoader();
const ANISO_CAP = 8; // iPad 报告常为 16×，实际带宽代价更高；封顶 8 足够且更稳（自审 §6）
function pbr(mat, name, size, repeat, normalScale = 1) {
  if (STYLE_A && !HD.hd) return mat; // A 风格低清档不用 PBR 细节；高清档（显式 res）开启，保留融合色阶
  const hdSize = HD.hd ? (size >= 1024 ? 2048 : 1024) : size; // 高清档用 1K/2K 细节贴图（4K 原图降采样），低清档保持 512/1024
  mat.normalScale.set(normalScale, normalScale);
  // 加载成功才挂：失败/加载中保持程序贴图（空纹理会让 AO=0、法线畸形，首帧发黑）
  const load = (k, apply) => texLoader.load(`assets/tex/${name}_${k}_${hdSize}.jpg`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
    t.anisotropy = HD.hd ? Math.min(ANISO_CAP, renderer.capabilities.getMaxAnisotropy()) : 4;
    apply(t); mat.needsUpdate = true;
  }, undefined, () => { /* 保持程序贴图 */ });
  load('nor_gl', (t) => { mat.normalMap = t; });
  load('arm', (t) => { mat.roughnessMap = t; mat.aoMap = t; mat.aoMapIntensity = 0.6; mat.metalness = 0; });
  return mat;
}

// ------------------------------------------------------------------ 材质
const M = {
  floor: new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.55 }),
  wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }),
  wains: new THREE.MeshStandardMaterial({ map: wainsTex, roughness: 0.45 }),
  ceil: new THREE.MeshStandardMaterial({ color: 0xd9d6c9, roughness: 1, emissive: 0x3a3832 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.6 }),
  darkwood: new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.6 }),
  rattan: new THREE.MeshStandardMaterial({ color: 0xa88a58, roughness: 0.9 }),
  fabric: new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.95 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x9a9a95, roughness: 0.8 }),
  crt: new THREE.MeshStandardMaterial({ color: 0xbdb9ad, roughness: 0.5 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x223a55, emissive: 0x4a7fbf, emissiveIntensity: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xbfd6e6, emissive: 0x8fa9bf, emissiveIntensity: 0.55, transparent: true, opacity: 0.85 }),
  plant: new THREE.MeshStandardMaterial({ color: 0x3f5a35, roughness: 0.9 }),
  door: new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6 }),
  silhouette: new THREE.MeshBasicMaterial({ color: 0x050505, fog: false }),
  gray: new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 1 }), // 灰盒未核区域
  // V4：门槛廊换成墙面材质 + 更暗的楼道色（R 检查时家长就站在这里，不能是灰盒）
  corridorWall: new THREE.MeshStandardMaterial({ map: wallTex, color: 0x8e8a80, roughness: 0.95 }),
  corridorFloor: new THREE.MeshStandardMaterial({ map: tileTex, color: 0x7f786c, roughness: 0.8 }),
  corridorCeil: new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 1 }),
  bead: new THREE.MeshStandardMaterial({ map: beadTex, roughness: 0.35, emissive: 0x6a1a14, emissiveIntensity: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.9 }),
  ac: new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.6 }),
};
// 地砖法线：large_floor_tiles_02 每张 3×3 块 → 每张贴图 1.8 m，使砖缝落在 0.6 m 网格（与程序地砖色缝对齐）
pbr(M.floor, 'large_floor_tiles_02', 1024, [L.ROOM.maxX * 2 / 1.8, (L.ROOM.maxZ * 2 + 2.2) / 1.8], 0.8); M.floor.roughness = 0.35;
pbr(M.wall, 'painted_plaster_wall', 512, [4, 2], 0.18); // 高清档 1K 法线；强度压低，避免墙面像划痕
pbr(M.wains, 'fine_grained_wood', 512, [5, 1], 0.4);
pbr(M.wood, 'fine_grained_wood', 512, [1, 1], 0.5); pbr(M.darkwood, 'fine_grained_wood', 512, [1, 1], 0.5);
pbr(M.fabric, 'poly_wool_herringbone', 512, [3, 2], 1.0);
// 高清档沙发面料：原来 64px/8px 一格的千鸟格放大后像占位棋盘；高清档换「大块绒面明暗 + 细斜纹」，配色仍用 E308 的 #a29d92/#7a756c
if (HD.hd) {
  const weaveTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#a29d92'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { // 低频绒面明暗（磨损/压痕），只做很轻的起伏，避免整块像水渍
      const cx = Math.random() * w, cy = Math.random() * h, r = 22 + Math.random() * 34;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      const up = Math.random() < 0.5;
      g.addColorStop(0, up ? 'rgba(196,189,175,.10)' : 'rgba(112,106,96,.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    }
    x.lineWidth = 3; // 45° 斜纹，周期 8 整除 256（四边无缝）；一格约 2cm
    let n = 0;
    for (let i = -h; i < w + h; i += 8) {
      x.strokeStyle = (n++ % 2) ? 'rgba(120,114,104,.22)' : 'rgba(214,207,193,.18)';
      const j = (Math.random() - 0.5) * 3; // 逐条抖动，打断严格周期（否则斜向缩小时会出摩尔纹带）
      x.beginPath(); x.moveTo(i + j, 0); x.lineTo(i + h + j, h); x.stroke();
    }
    x.strokeStyle = 'rgba(122,117,108,.16)';
    for (let i = -h; i < w + h; i += 10) { x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke(); }
    for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(255,252,244,${Math.random() * 0.07})`; x.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
  }, [3, 2]);
  M.fabric.map = weaveTex;
  if (M.fabric.normalMap) M.fabric.normalMap.repeat.set(4, 3);
  M.fabric.normalScale.set(0.9, 0.9);
}

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m;
}
const fromAABB = (b, h, mat, parent) => box(b.maxX - b.minX, h, b.maxZ - b.minZ, mat, (b.minX + b.maxX) / 2, h / 2, (b.minZ + b.maxZ) / 2, parent);
const C = Object.fromEntries(L.COLLIDERS.map((c) => [c.id, c]));
const R = L.ROOM; const W = R.maxX - R.minX, D = R.maxZ - R.minZ, H = R.ceiling;

// ------------------------------------------------------------------ 房间 L
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D + 2.2), M.floor);
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 1.1); scene.add(floor);
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.ceil);
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = H; scene.add(ceiling);

function wallSeg(x0, z0, x1, z1, y0 = 0, y1 = H, mat = M.wall) {
  const len = Math.hypot(x1 - x0, z1 - z0); const m = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, 0.08), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); scene.add(m); return m;
}
function wainscot(x0, z0, x1, z1) { // 木护墙（原帧可见，高度假定 1.0 m）
  const len = Math.hypot(x1 - x0, z1 - z0); const m = new THREE.Mesh(new THREE.BoxGeometry(len, 1.0, 0.03), M.wains);
  const nx = (z1 - z0) / len, nz = -(x1 - x0) / len; // 朝室内的法线（YWQ-004 修正：旧符号把墙裙放到了墙外 5.5 cm，画面里从来看不见）
  m.position.set((x0 + x1) / 2 + nx * 0.055, 0.5, (z0 + z1) / 2 + nz * 0.055); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); scene.add(m);
}
// W1 窗墙 z=-3，窗洞 x∈[-1.5,1.5]，y∈[0.95,2.35]
wallSeg(R.minX, R.minZ, -1.5, R.minZ); wallSeg(1.5, R.minZ, R.maxX, R.minZ);
wallSeg(-1.5, R.minZ, 1.5, R.minZ, 0, 0.95); wallSeg(-1.5, R.minZ, 1.5, R.minZ, 2.35, H);
const win = box(3.0, 1.4, 0.02, M.glass, 0, 1.65, R.minZ - 0.03);
for (const x of [-1.5, -0.5, 0.5, 1.5]) box(0.06, 1.4, 0.06, M.white, x, 1.65, R.minZ);
box(3.1, 0.06, 0.12, M.white, 0, 0.95, R.minZ + 0.03); box(3.1, 0.06, 0.06, M.white, 0, 2.35, R.minZ);
box(3.2, 0.04, 0.25, M.white, 0, 0.97, R.minZ + 0.12); // 窗台
// 窗帘（E308 可见浅色纱帘，形态假定）
for (const x of [-1.75, 1.75]) box(0.45, 1.9, 0.05, pbr(new THREE.MeshStandardMaterial({ map: floralTex, transparent: true, opacity: 0.92 }), 'floral_jacquard', 512, [2, 4], 0.8), x, 1.55, R.minZ + 0.12);
wainscot(R.maxX, R.minZ, R.minX, R.minZ);
// L-A 电视墙 x=-2.6 / L-C 沙发墙 x=2.6
wallSeg(R.minX, R.maxZ, R.minX, R.minZ); wainscot(R.minX, R.minZ, R.minX, R.maxZ);
wallSeg(R.maxX, R.minZ, R.maxX, R.maxZ); wainscot(R.maxX, R.maxZ, R.maxX, R.minZ);
// W2 对端墙 z=3：入户门 O-LX x∈[1.2,2.1]（候选）；珠帘 O-LD x∈[-2.5,-1.4]（通向 D，未建模）
wallSeg(R.minX, R.maxZ, -2.5, R.maxZ); wallSeg(-1.4, R.maxZ, 1.2, R.maxZ); wallSeg(2.1, R.maxZ, R.maxX, R.maxZ);
wallSeg(-2.5, R.maxZ, -1.4, R.maxZ, 2.1, H); wallSeg(1.2, R.maxZ, 2.1, R.maxZ, 2.1, H);
wainscot(-1.4, R.maxZ, 1.2, R.maxZ); wainscot(2.1, R.maxZ, R.maxX, R.maxZ);
// 珠帘：串珠竖线 + 后方灰盒（D 区未建模，不可通行）
const beads = new THREE.Group(); scene.add(beads);
for (let x = -2.45; x < -1.42; x += 0.07) box(0.015, 2.0, 0.015, M.bead, x, 1.08, R.maxZ - 0.02, beads);
box(1.1, 2.1, 0.05, M.gray, -1.95, 1.05, R.maxZ + 0.6);

// ------------------------------------------------------------------ 门槛模块 M（灰盒）
const T = L.THRESHOLD;
box(0.06, H, T.maxZ - T.minZ, M.corridorWall, T.minX, H / 2, (T.minZ + T.maxZ) / 2);
box(0.06, H, T.maxZ - T.minZ, M.corridorWall, T.maxX, H / 2, (T.minZ + T.maxZ) / 2);
box(T.maxX - T.minX, H, 0.06, M.corridorWall, (T.minX + T.maxX) / 2, H / 2, T.maxZ);
box(T.maxX - T.minX, 0.06, T.maxZ - T.minZ, M.corridorCeil, (T.minX + T.maxX) / 2, H, (T.minZ + T.maxZ) / 2);
// 楼道地面、门槛压条、尽头暗带：让门外像“别人家的楼道”，而不是一块灰板
box(T.maxX - T.minX, 0.02, T.maxZ - T.minZ, M.corridorFloor, (T.minX + T.maxX) / 2, 0.012, (T.minZ + T.maxZ) / 2);
box(T.maxX - T.minX, 0.02, 0.1, M.darkwood, (T.minX + T.maxX) / 2, 0.022, T.minZ + 0.05);
box(T.maxX - T.minX, 0.6, 0.02, M.corridorWall, (T.minX + T.maxX) / 2, 0.3, T.maxZ - 0.04);
const stairLight = new THREE.PointLight(0xffd9a0, 0.6, 4); stairLight.position.set(1.65, 2.4, 4.4); scene.add(stairLight);
// 入户门：铰链在 x=1.2
const doorPivot = new THREE.Group(); doorPivot.position.set(L.DOOR.minX, 0, L.DOOR.z + 0.02); scene.add(doorPivot);
box(0.9, 2.08, 0.05, STYLE_A ? new THREE.MeshStandardMaterial({ color: 0xcdc4ab }) : M.door, 0.45, 1.04, 0, doorPivot); // A：功能门位假定＋A040 外观候选（浅色内门板；与 A112/O-LX 同一性未定）
const handle = box(0.04, 0.04, 0.12, M.grey, 0.8, 1.0, 0, doorPivot);

// ------------------------------------------------------------------ 家具（证据锚点 + 新增）
// F1 CRT + 电视柜（E098/310/313）
const tvGroup = new THREE.Group(); scene.add(tvGroup); // 异常缩放以「底面中心」为 pivot：柜体 + CRT + 屏幕整体放大，不穿插也不位移
// 缩放围绕家具自身的底面中心，而不是世界原点；否则靠墙的电视柜会被推进墙里
const pivotAtBase = (group, cx, cz) => {
  group.position.set(cx, 0, cz); group.userData.cx = cx; group.userData.cz = cz;
  for (const ch of group.children) { ch.position.x -= cx; ch.position.z -= cz; }
};
const tvCab = fromAABB(C.F1_tv, 0.55, M.wood);
const crt = box(0.5, 0.45, 0.6, M.crt, -2.33, 0.78, 0); const scr = box(0.02, 0.32, 0.44, M.screen, -2.07, 0.8, 0);
tvGroup.attach(tvCab); tvGroup.attach(crt); tvGroup.attach(scr);
pivotAtBase(tvGroup, (C.F1_tv.minX + C.F1_tv.maxX) / 2, (C.F1_tv.minZ + C.F1_tv.maxZ) / 2);
const crtLight = new THREE.PointLight(0x5d8fd6, 0.9, 4.5); crtLight.position.set(-1.8, 0.9, 0); scene.add(crtLight);
// 墙上照片拼框 + 横幅山水画（原画作以占位轮廓表示，不补原作细节）
box(0.03, 0.42, 0.55, M.darkwood, R.minX + 0.05, 1.85, -1.2); box(0.03, 0.55, 1.3, M.darkwood, R.minX + 0.05, 1.85, 0.4);
box(0.01, 0.48, 1.2, M.white, R.minX + 0.07, 1.85, 0.4);
// F2 角柜 + 盆栽（E098/308/310）
fromAABB(C.F2_corner, 0.9, M.wood); box(0.25, 0.25, 0.25, M.grey, -2.3, 1.02, -2.7);
for (let i = 0; i < 5; i++) { const lf = box(0.04, 0.5, 0.22, M.plant, -2.3, 1.35, -2.7); lf.rotation.set(Math.random() - 0.5, i * 1.2, Math.random() - 0.5); }
// F3 藤椅组合（E099/308）
for (const id of ['F3_chairL', 'F3_chairR']) { const c = C[id]; const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
  box(0.66, 0.42, 0.7, M.rattan, cx, 0.21, cz); box(0.66, 0.5, 0.08, M.rattan, cx, 0.65, c.minZ + 0.05);
  box(0.08, 0.25, 0.7, M.rattan, c.minX + 0.04, 0.55, cz); box(0.08, 0.25, 0.7, M.rattan, c.maxX - 0.04, 0.55, cz); }
fromAABB(C.F3_table, 0.55, M.rattan);
// F5 茶几（E308）
const coffeeGroup = new THREE.Group(); scene.add(coffeeGroup); // 同上：蕾丝桌布跟茶几一起缩放，才不会埋进桌面
const coffee = fromAABB(C.F5_coffee, 0.42, M.darkwood);
const lace = box(1.3, 0.02, 0.8, new THREE.MeshStandardMaterial({ map: laceTex, roughness: 0.9 }), 0, 0.43, 0.45); // 原玻璃面换蕾丝桌布（同尺寸同位置）
coffeeGroup.attach(coffee); coffeeGroup.attach(lace);
pivotAtBase(coffeeGroup, 0, (C.F5_coffee.minZ + C.F5_coffee.maxZ) / 2);
// F4 沙发（E101/308）
{ const c = C.F4_sofa; const cz = (c.minZ + c.maxZ) / 2, len = c.maxZ - c.minZ;
  box(0.6, 0.42, len, M.fabric, 2.3, 0.21, cz); box(0.14, 0.85, len, M.fabric, 2.53, 0.43, cz);
  box(0.6, 0.62, 0.12, M.fabric, 2.3, 0.31, c.minZ + 0.06); box(0.6, 0.62, 0.12, M.fabric, 2.3, 0.31, c.maxZ - 0.06); }
// 沙发墙：空调、壁挂柜、长壁架（E096/100/101，挂装高度假定）
box(0.22, 0.28, 0.85, M.ac, R.maxX - 0.12, 2.4, -1.8); box(0.3, 0.4, 1.2, M.wood, R.maxX - 0.16, 1.85, -0.6);
box(0.22, 0.03, 1.8, M.wood, R.maxX - 0.11, 2.05, 0.9);
// 挂历（O-LD 旁 P1 墙面，E065）
const calTex = paperTex(['2000年', '十月', '', '一 二 三 四 五 六 日', '            1', ' 2  3  4  5  6  7  8', ' 9 10 11 12 13 14 15', '16 17 18 19 20 21 22'], { size: 30, lh: 50 });
const calendar = box(0.02, 0.6, 0.42, new THREE.MeshStandardMaterial({ map: calTex }), R.minX + 0.05, 1.6, 2.65);
calendar.rotation.y = 0;
// F7 边柜（E440-442，摆位假定）+ 作息纸
if (!STYLE_A) fromAABB(C.F7_sidecab, 0.9, M.wood);
const scheduleTex = paperTex(L.CLUES.schedule.lines.map((s) => s.slice(0, 13)), { size: 30, lh: 54 });
const schedulePaper = box(0.34, 0.42, 0.01, new THREE.MeshStandardMaterial({ map: scheduleTex }), -0.7, 1.15, 2.95);
// F8 衣帽架（E063，摆位假定）
if (!STYLE_A) box(0.35, 1.8, 0.35, M.darkwood, 2.42, 0.9, 2.8);
// 节目表（新增）：放在窗台
const guideTex = paperTex(L.CLUES.guide.lines, { bg: '#dfe6e8', size: 30, lh: 58 });
const guidePaper = box(0.32, 0.01, 0.4, new THREE.MeshStandardMaterial({ map: guideTex }), -1.45, 0.995, -2.86);
guidePaper.rotation.y = 0.12;

// N1 书桌（新增改编：学习点 P1）
const deskGroup = new THREE.Group(); scene.add(deskGroup);
{ const c = C.N1_desk; const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
  box(c.maxX - c.minX, 0.04, c.maxZ - c.minZ, M.wood, cx, 0.74, cz, deskGroup);
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(0.04, 0.72, 0.04, M.wood, cx + dx * 0.28, 0.36, cz + dz * 0.55, deskGroup);
  box(0.42, 0.01, 0.3, new THREE.MeshStandardMaterial({ map: paperTex(['第三单元 练习', '1. 解方程', '2x + 5 = 17', '', '2. 应用题 ……'], { size: 34 }) }), -2.2, 0.765, 1.55, deskGroup);
  const pencil = box(0.16, 0.01, 0.01, new THREE.MeshStandardMaterial({ color: 0xd9b23f }), -2.1, 0.775, 1.4, deskGroup); pencil.rotation.y = 0.5;
  box(0.12, 0.02, 0.12, M.grey, -2.45, 0.77, 1.2, deskGroup); box(0.02, 0.35, 0.02, M.grey, -2.45, 0.95, 1.2, deskGroup);
  box(0.18, 0.08, 0.14, new THREE.MeshStandardMaterial({ color: 0x3f6b4a, emissive: 0xffe0a0, emissiveIntensity: 0.3 }), -2.38, 1.1, 1.25, deskGroup);
  box(0.4, 0.45, 0.4, M.wood, -1.75, 0.22, 1.6, deskGroup); box(0.04, 0.45, 0.4, M.wood, -1.55, 0.67, 1.6, deskGroup); // 椅子（无碰撞，学习点占位）
}
const lamp = new THREE.PointLight(0xffd59a, 0.6, 3.0); lamp.position.set(-2.3, 1.15, 1.35); scene.add(lamp);
// 台钟（新增改编）
const clockCanvas = document.createElement('canvas'); clockCanvas.width = 256; clockCanvas.height = 160;
const clockTex = new THREE.CanvasTexture(clockCanvas); clockTex.colorSpace = THREE.SRGBColorSpace;
const clockMesh = new THREE.Group(); clockMesh.position.set(-2.25, 0.84, 1.9); scene.add(clockMesh);
box(0.08, 0.16, 0.22, M.darkwood, 0, 0, 0, clockMesh);
const clockFace = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshBasicMaterial({ map: clockTex }));
clockFace.position.set(0.045, 0, 0); clockFace.rotation.y = Math.PI / 2; clockMesh.add(clockFace);
let lastClockDrawn = -1;
function drawClock() {
  if (lastClockDrawn === g.clock) return; lastClockDrawn = g.clock;
  const x = clockCanvas.getContext('2d'); x.fillStyle = '#e9e3cf'; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#222'; x.font = 'bold 72px Menlo, monospace'; x.textAlign = 'center'; x.fillText(L.fmtClock(g.clock), 128, 105);
  clockTex.needsUpdate = true;
}
// P2 沙发学习点（新增）：膝上练习册 + 硬垫板
const p2Kit = new THREE.Group(); scene.add(p2Kit);
box(0.36, 0.015, 0.28, M.darkwood, 2.05, 0.45, 0.7, p2Kit);
box(0.3, 0.01, 0.22, new THREE.MeshStandardMaterial({ map: paperTex(['语文 默写本', '', '床前明月光', '……'], { size: 34 }) }), 2.05, 0.46, 0.7, p2Kit);

// 学习点地面标识（技术提示，非原作）：只在教学与检查期间淡入，其余时间隐藏——常亮会像调试可视化
const studyRings = [];
for (const p of L.STUDY_POINTS) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.6, 40), new THREE.MeshBasicMaterial({ color: 0xf0b44a, transparent: true, opacity: 0 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.01, p.z); ring.visible = false; scene.add(ring); studyRings.push(ring);
}

// ------------------------------------------------------------------ 异常差分（改编提案）
// 1) 时间错层：挂历与台钟出现半透明重影；色温偏移
const ghostCal = calendar.clone(); ghostCal.material = calendar.material.clone(); ghostCal.material.transparent = true; ghostCal.material.opacity = 0.45;
ghostCal.position.set(R.minX + 0.06, 1.85, 2.3); ghostCal.rotation.x = 0.08; ghostCal.visible = false; scene.add(ghostCal);
const ghostCal2 = ghostCal.clone(); ghostCal2.position.set(R.minX + 0.06, 1.35, 2.15); ghostCal2.rotation.x = -0.1; scene.add(ghostCal2);
// 2) 尺度崩坏：桌椅与茶几视觉放大（不改变碰撞与学习点）
// 3) 天花下压：假天花装饰层下移
const fakeCeil = new THREE.Group(); fakeCeil.visible = false; scene.add(fakeCeil);
box(W - 0.2, 0.06, D - 0.2, M.ceil, 0, 0, 0, fakeCeil);
for (let i = -2; i <= 2; i++) box(0.06, 0.12, D - 0.3, M.wood, i * 1.0, -0.08, 0, fakeCeil);
const chandelier = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9fd09a, emissive: 0x4a7a46, emissiveIntensity: 0.6 }));
chandelier.position.set(0, -0.35, -0.2); fakeCeil.add(chandelier);

// ------------------------------------------------------------------ 家长轮廓（无完整角色）
// V2：腰、肩、颈、头分开建，读起来是“一个大人”的剪影；仍然纯黑、无五官、无贴图
const parent = new THREE.Group(); scene.add(parent);
const silPart = (geo, y, ry = 0) => { const m = new THREE.Mesh(geo, M.silhouette); m.position.y = y; m.rotation.y = ry; parent.add(m); return m; };
silPart(new THREE.CylinderGeometry(0.17, 0.24, 1.1, STYLE_A ? 5 : 7, 1), 0.72);          // 躯干：上窄下宽
silPart(new THREE.CylinderGeometry(0.25, 0.235, 0.26, STYLE_A ? 5 : 7, 1), 1.28);          // 肩线（略窄，避免 T 字）
silPart(new THREE.CylinderGeometry(0.062, 0.055, 0.62, 5, 1), 1.1, 0).position.x = 0.235;  // 左臂
silPart(new THREE.CylinderGeometry(0.062, 0.055, 0.62, 5, 1), 1.1, 0).position.x = -0.235; // 右臂
silPart(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 5, 1), 1.44);                      // 颈
const head = silPart(new THREE.SphereGeometry(0.145, STYLE_A ? 6 : 10, STYLE_A ? 4 : 8), 1.59);
head.scale.set(1, 1.08, 0.94);
// V2：辅助视线 = 地面扇形（半角 viewHalfFov、半径 viewRange）+ 边线；从锥内看也不会糊屏
const CONE_HALF = L.CONFIG.viewHalfFov;
const CONE_R = Math.min(L.CONFIG.viewRange, 4.2); // 可视扇区只画近段，避免半径 9 m 铺满全屋像打了一层黄光
const gazeCone = new THREE.Group(); gazeCone.position.y = 0.022; gazeCone.visible = false;
const coneMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
const coneLineMat = new THREE.LineBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.4, depthWrite: false, fog: false });
{
  const seg = 28, verts = [0, 0, 0];
  for (let i = 0; i <= seg; i++) { const a = -CONE_HALF + (2 * CONE_HALF) * i / seg; verts.push(Math.cos(a) * CONE_R, 0, Math.sin(a) * CONE_R); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const idx = []; for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
  geo.setIndex(idx);
  gazeCone.add(new THREE.Mesh(geo, coneMat));
  const outline = [new THREE.Vector3(0, 0.001, 0)];
  for (let i = 0; i <= seg; i++) { const a = -CONE_HALF + (2 * CONE_HALF) * i / seg; outline.push(new THREE.Vector3(Math.cos(a) * CONE_R, 0.001, Math.sin(a) * CONE_R)); }
  outline.push(new THREE.Vector3(0, 0.001, 0));
  gazeCone.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), coneLineMat));
}
const gazePivot = new THREE.Group(); gazePivot.add(gazeCone); parent.add(gazePivot);
// 默认的朝向表达：地面上一块窄长的暖色投影（近端亮、远端散），跟着视线转
const gazeDecalTex = canvasTex(128, 64, (x, w, h) => {
  const img = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / (w - 1), v = Math.abs(j / (h - 1) - 0.5) * 2;
    const a = Math.max(0, Math.pow(1 - u, 0.7) * (1 - v * v)) * 0.9, k = (j * w + i) * 4;
    img.data[k] = 255; img.data[k + 1] = 198; img.data[k + 2] = 128; img.data[k + 3] = Math.round(a * 255);
  }
  x.putImageData(img, 0, 0);
});
const gazeDecal = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.5), new THREE.MeshBasicMaterial({ map: gazeDecalTex, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
gazeDecal.rotation.x = -Math.PI / 2; gazeDecal.position.set(1.75, 0.014, 0); gazeDecal.renderOrder = 2; gazePivot.add(gazeDecal);
// 预警阶段的门缝光：门还关着时，唯一能看见的是脚边这道光
const doorSlit = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.52), new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
doorSlit.rotation.x = -Math.PI / 2; doorSlit.position.set(1.65, 0.016, 2.72); scene.add(doorSlit);
// 预警期从门缝漏进屋里的光：比门缝亮条更“实体”，会随着脚步逼近变宽变亮，
// 并且照亮门口地面的一小片——警察/家长还没出现，但屋子里已经“有人”了。
const doorSpill = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.7), new THREE.MeshBasicMaterial({ color: 0xffb877, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
doorSpill.rotation.x = -Math.PI / 2; doorSpill.position.set(1.65, 0.014, 2.1); scene.add(doorSpill);
const doorLight = new THREE.PointLight(0xffb877, 0, 3.2); doorLight.position.set(1.65, 0.3, 2.55); scene.add(doorLight);
parent.visible = false;

// M3：衣帽架上的钥匙（黄铜小件，窗口期才可拿；交互点见 logic.js INTERACTABLES）
{
  const brass = new THREE.MeshStandardMaterial({ color: 0xb9944a, metalness: 0.55, roughness: 0.35, emissive: 0x241a08 });
  const keyG = new THREE.Group(); keyG.position.set(2.42, 1.2, 2.84); scene.add(keyG);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.009, 6, 12), brass); ring.rotation.x = Math.PI / 2; keyG.add(ring);
  box(0.012, 0.012, 0.11, brass, 0, 0, 0.08, keyG);
  box(0.035, 0.01, 0.012, brass, 0.018, 0, 0.12, keyG);
  box(0.026, 0.01, 0.012, brass, 0.014, 0, 0.095, keyG);
}

// ------------------------------------------------------------------ YWQ-STYLE-A：入户门一角低面数重建 + 全局旧主机渲染
// 依据见 docs/design/STYLE_A_PLAN.md。物件形状为 Hermes 读原帧的低精度近似，尺寸为假定，待 fox 参考包核对。
const PSX = { snap: { value: new THREE.Vector2(213, 120) } };
if (STYLE_A) {
  const hex = (c) => new THREE.MeshStandardMaterial({ color: c });
  // 颜色依 60bfe7b 资产基线“主色”栏 + 原帧读图，为画面观感值，非色号。
  const yellowWood = hex(0xb3803f), seam = hex(0x4a2e16), redwood = hex(0x6b3020), cream = hex(0xd6cdb3), creamShade = hex(0xb9ae93);
  creamShade.emissive.setHex(0x3a372e); cream.emissive.setHex(0x2a2822); // 门套/横线脚的背光窄面不至于变成近黑细线（低分辨率下会断成虚线）
  const coatGreen = hex(0x283026), whiteCloth = hex(0xe4e1d8), brass = hex(0xb9944a), photoTone = hex(0x77736a), redBox = hex(0xa3291f), hookDark = hex(0x3a2a1e);
  // F7 = 玩法占位柜／假定摆位（不是 L-F7 摆位还原；源 L-F7/A031 为沙发同侧墙连续长柜）；外观取源资产 YWQ-A031 长边柜（E101 01:41 / E442 07:22：黄褐木、横长、多扇竖门、竖门缝）。
  // 碰撞盒、高度 0.9 m、摆位全部沿用 logic.js（摆位假定；与 PDF p9 虚线位置的冲突见 STYLE_A_PLAN §3）。
  { const c = C.F7_sidecab, h = 0.9, w = c.maxX - c.minX, d = c.maxZ - c.minZ, cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    box(w - 0.04, 0.06, d - 0.04, seam, cx, 0.03, cz);                         // 踢脚
    box(w, h - 0.085, d, yellowWood, cx, 0.06 + (h - 0.085) / 2, cz);          // 柜身
    box(w + 0.03, 0.025, d + 0.02, yellowWood, cx, h - 0.0125, cz);             // 台面
    for (let i = 1; i < 3; i++) box(0.014, 0.66, 0.008, seam, c.minX + (w * i) / 3, 0.43, c.minZ - 0.004); // 三扇竖门缝（门数按 A031“多扇”取 3，待核）
    box(w - 0.06, 0.012, 0.008, seam, cx, 0.77, c.minZ - 0.004);              // 门上沿缝
    for (let i = 0; i < 3; i++) box(0.03, 0.03, 0.02, brass, c.minX + (w * (i + 0.5)) / 3 + (i === 1 ? 0.1 : i === 0 ? 0.12 : -0.12), 0.6, c.minZ - 0.01); // 小拉手（形态待核）
    // A032 家庭合影框（E101/E442：浅金框竖矩形，靠墙立于柜上）；画面内容不复刻，只留中灰色块
    const pf = new THREE.Group(); pf.position.set(c.minX + 0.17, h + 0.2, R.maxZ - 0.06); pf.rotation.x = -0.1; scene.add(pf);
    box(0.28, 0.36, 0.02, brass, 0, 0, 0, pf); box(0.22, 0.29, 0.006, photoTone, 0, 0, -0.012, pf);
    // A114 相框右红色提手箱形物（补充帧 000103 01:43，用途未知，不命名）
    box(0.18, 0.13, 0.11, redBox, c.maxX - 0.17, h + 0.065, cz + 0.06);
    for (const dx of [-0.06, 0.06]) box(0.012, 0.05, 0.012, redBox, c.maxX - 0.17 + dx, h + 0.155, cz + 0.06);
    box(0.13, 0.012, 0.012, redBox, c.maxX - 0.17, h + 0.18, cz + 0.06); }
  // A041 墙上展开式菱形连杆挂钩（E442：“边柜末端门左上”，深色）；个数与精确挂高待核
  { const hg = new THREE.Group(); hg.position.set(0.45, 1.72, R.maxZ - 0.025); scene.add(hg);
    for (let i = 0; i < 4; i++) for (const sgn of [1, -1]) { const bar = box(0.17, 0.014, 0.01, hookDark, -0.18 + i * 0.12, 0, 0, hg); bar.rotation.z = sgn * 0.62; }
    for (let i = 0; i < 5; i++) box(0.016, 0.016, 0.05, hookDark, -0.24 + i * 0.12, 0.05, -0.02, hg); }
  // F8 = L-F8 衣帽架（YWQ-A036：细高车木立柱、多挂钩、三脚底、棕木；E063 01:03 / E442 07:22 / E580 09:40）
  { const g8 = new THREE.Group(); g8.position.set(2.42, 0, 2.8); scene.add(g8);
    const prof = [[0.032, 0.22], [0.046, 0.27], [0.026, 0.33], [0.024, 0.86], [0.04, 0.91], [0.024, 0.96], [0.021, 1.52], [0.038, 1.57], [0.026, 1.63], [0.046, 1.69], [0.03, 1.76], [0.0, 1.8]];
    const pole = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 8), redwood); g8.add(pole); // 旋木节点位置为近似
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4; // 三脚弯腿：两段折线近似弧形
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), redwood); up.position.set(Math.cos(a) * 0.07, 0.17, Math.sin(a) * 0.07); up.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); g8.add(up);
      const ft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), redwood); ft.position.set(Math.cos(a) * 0.16, 0.045, Math.sin(a) * 0.16); ft.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25); g8.add(ft); }
    for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3; const hk = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.13, 0.016), redwood); // 6 钩（“多挂钩”；背侧钩数原帧未知）
      hk.position.set(Math.cos(a) * 0.055, 1.6, Math.sin(a) * 0.055); hk.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8); g8.add(hk); }
    const lump = (mat, w, hh, d, x, y, z, ry, flare = 1.25) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d, 1, 2, 1), mat); m.position.set(x, y, z); m.rotation.y = ry;
      const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setX(i, pos.getX(i) * flare); m.geometry.computeVertexNormals(); m.geometry.userData.keepGeo = true; g8.add(m); return m; };
    // YWQ-A037 挂物：深外套（黑绿）、长花布（蓝绿花）、浅色布（白）；服饰类型不锁定
    lump(coatGreen, 0.3, 0.92, 0.12, 0.03, 1.13, 0.06, 0.3);
    const tealFloral = canvasTex(32, 64, (x, w, hh) => { x.fillStyle = '#3f6f73'; x.fillRect(0, 0, w, hh);
      for (let i = 0; i < 14; i++) { const fx = (i * 13) % w, fy = (i * 23) % hh; x.fillStyle = i % 3 ? '#9cc2b6' : '#d9d2b0'; x.fillRect(fx, fy, 4, 4); x.fillStyle = '#2b4c58'; x.fillRect(fx + 4, fy + 2, 2, 5); } }, [1, 2]);
    lump(new THREE.MeshStandardMaterial({ map: tealFloral }), 0.16, 1.15, 0.05, -0.14, 1.02, -0.05, -1.0, 1.05);
    lump(whiteCloth, 0.15, 0.3, 0.05, 0.11, 1.18, -0.12, 0.6, 1.1); }
  // 功能门位假定＋A040 外观候选（A040/E442 门片局部：浅色内门板、浅色细门套、门顶短横线脚）。门洞、铰链与开向沿用逻辑层，未改。
  for (const x of [L.DOOR.minX - 0.04, L.DOOR.maxX + 0.04]) box(0.08, 2.14, 0.06, cream, x, 1.07, R.maxZ - 0.03).userData.layer = 1;
  box(L.DOOR.maxX - L.DOOR.minX + 0.16, 0.08, 0.06, cream, (L.DOOR.minX + L.DOOR.maxX) / 2, 2.14, R.maxZ - 0.03).userData.layer = 1;
  box(L.DOOR.maxX - L.DOOR.minX + 0.26, 0.06, 0.1, creamShade, (L.DOOR.minX + L.DOOR.maxX) / 2, 2.215, R.maxZ - 0.05); // 门顶横线脚
  for (const zf of [-0.03, 0.03]) { // 门板两面的矩形凹板线（E442 读图；分格数待核）
    for (const b of [box(0.66, 0.045, 0.008, creamShade, 0.45, 1.86, zf, doorPivot), box(0.66, 0.045, 0.008, creamShade, 0.45, 0.24, zf, doorPivot),
      box(0.045, 1.62, 0.008, creamShade, 0.12, 1.05, zf, doorPivot), box(0.045, 1.62, 0.008, creamShade, 0.78, 1.05, zf, doorPivot)]) b.userData.layer = 1; } // 门板只有 5 cm 厚：两面凹线取 1 层偏移，避免背面那组被拉穿门板

  // —— 全局（参数随档位 STYLE_TIER）：平铺贴图降采样 + 可选色阶/抖色烘焙 + 最近邻；材质换 Lambert 平直着色；
  //    顶点吸附到低分辨率网格；输出色深量化 + Bayer 抖色；A+1/A+2 另减曲面段数；A+2 再加仿射贴图（无透视校正）并细分大面防止扭曲过度。
  const T = STYLE_TIER; const shrunk = new Map();
  if (T.woodWarm) for (const k of ['wains', 'wood']) M[k].color.multiply(new THREE.Color(T.woodWarm)); // 融合：木色偏蜂蜜暖（参考：暖木中间调）
  if (T.wallTint) M.wall.color.setHex(T.wallTint); // 融合：墙面按参考色彩语言偏灰蓝（画风调色，不是原帧墙色结论）
  // 融合：贴图空间的手绘笔触（固定种子，截图可复现）。短笔触 = 亮度±、轻微冷暖偏移；最近邻放大后成“块状笔触”，不是屏幕噪点。
  let seed = 20261017; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // 世界坐标笔触贴图（融合）：按表面法线取主轴投影，固定 0.9 m 一张 → 所有物件笔触密度一致（不随 UV/盒子大小放大成马赛克）
  const strokeTex = (() => { const S = T.brushFine ? 384 : (T.hd ? 128 : 32), K = S / 32, c = document.createElement('canvas'); c.width = c.height = S; const cx = c.getContext('2d');
    cx.fillStyle = 'rgb(128,128,128)'; cx.fillRect(0, 0, S, S);
    const N = T.brushFine ? 520 : 55; for (let i = 0; i < N; i++) { const x = rnd() * S, y = rnd() * S, len = (T.brushFine ? S / 9 + rnd() * S / 3.2 : S / 4 + rnd() * S / 2), w = T.brushFine ? (1.5 + rnd() * 2.5) * (S / 128) : (2 + rnd() * 4) * K, a = Math.PI / 2 + (rnd() - 0.5) * 1.1, v = (rnd() - 0.5) * 2;
      cx.save(); cx.translate(x, y); cx.rotate(a); cx.globalAlpha = 0.5 + rnd() * 0.4; // 亮度 ±、色相小漂移（灰蓝/灰绿/暖灰）
      const h = rnd(); cx.fillStyle = v > 0.4 ? 'rgb(170,166,150)' : `rgb(${Math.round(128 + v * 26 + (h < 0.33 ? 6 : 0))},${Math.round(128 + v * 26 + (h > 0.66 ? 5 : 0))},${Math.round(128 + v * 26 + (h > 0.33 && h < 0.66 ? 8 : 0))})`; // 少量暖奶油亮笔（参考墙面的浅色笔触）
      for (const dx of [0, S, -S]) for (const dy of [0, S, -S]) { cx.save(); cx.translate(dx * Math.cos(-a) - dy * Math.sin(-a), dx * Math.sin(-a) + dy * Math.cos(-a)); cx.fillRect(-len / 2, -w / 2, len, w); cx.restore(); } // 四方连续
      cx.restore(); } cx.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (T.hd) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; } else { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; } return t; })();
  const uStroke = { value: strokeTex };
  const b4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const lowTex = (t) => { if (!t || !t.image) return t;
    if (t.isCanvasTexture && t.wrapS === THREE.RepeatWrapping) { // 平铺表面：降采样；文字纸张/台钟不降采样（可读性）
      if (!shrunk.has(t)) { const S = T.tileTex, c = document.createElement('canvas'); c.width = c.height = S; const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(t.image, 0, 0, S, S); // 先平均再量化：大面是整块色，不是随机斑点
        if (T.texLevels) { const im = cx.getImageData(0, 0, S, S), q = T.texLevels - 1; // 贴图色阶 + 4×4 Bayer 烘焙进贴图
          for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4, th = (b4[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5; // 只量化亮度、保留色相（避免中性墙面被逐通道取整推成粉/绿色块）
            const r = im.data[i], gg = im.data[i + 1], bb = im.data[i + 2], Y = 0.299 * r + 0.587 * gg + 0.114 * bb + 1e-3;
            const Yq = Math.max(0, Math.min(q, Math.round((Y / 255) * q + th * T.texDither))) * 255 / q, f = Yq / Y;
            im.data[i] = Math.min(255, r * f); im.data[i + 1] = Math.min(255, gg * f); im.data[i + 2] = Math.min(255, bb * f); }
          cx.putImageData(im, 0, 0); }
        const n = new THREE.CanvasTexture(c); n.colorSpace = THREE.SRGBColorSpace; n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.copy(t.repeat); shrunk.set(t, n); }
      t = shrunk.get(t); }
    if (T.hd) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; } else { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.anisotropy = 1; } t.needsUpdate = true; return t; };
  const L_ = T.colorLevels.toFixed(1), BAYER = T.bayer === 4
    ? 'vec2 q = mod(floor(gl_FragCoord.xy), 4.0); vec2 q1 = mod(q, 2.0), q2 = floor(q / 2.0); float b = (4.0 * mod(2.0 * q1.x + 3.0 * q1.y, 4.0) + mod(2.0 * q2.x + 3.0 * q2.y, 4.0) + 0.5) / 16.0 - 0.5;'
    : 'float b = mod(floor(gl_FragCoord.x), 2.0) * 2.0 + mod(floor(gl_FragCoord.y), 2.0); b = (b == 1.0 ? 2.0 : b == 2.0 ? 3.0 : b == 3.0 ? 1.0 : 0.0) / 4.0 - 0.375;';
  const psx = (sh, noPaint = false) => { sh.uniforms.uSnap = PSX.snap;
    let vs = 'uniform vec2 uSnap;\n' + (T.affine ? 'varying float vAffW;\n' : '') + sh.vertexShader;
    vs = vs.replace('#include <project_vertex>', '#include <project_vertex>\n' + (DBG.has('nosnap') || (T.hd && !T.keepStyle) ? '//' : '') + '  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;'
      + (T.affine ? '\n  #ifdef USE_MAP\n  vMapUv *= gl_Position.w;\n  #endif\n  vAffW = gl_Position.w;' : ''));
    sh.vertexShader = vs;
    let fs = (T.affine ? 'varying float vAffW;\n' : '') + sh.fragmentShader;
    if (T.affine) fs = fs.replace('#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor *= texture2D( map, vMapUv / vAffW );\n#endif'); // 仿射：屏幕空间线性插值 UV
    if (T.paint && !noPaint) { sh.uniforms.uStroke = uStroke; vs = sh.vertexShader;
      sh.vertexShader = 'varying vec3 vWP;\n' + vs.replace('#include <project_vertex>', '#include <project_vertex>\n  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      fs = 'varying vec3 vWP;\nuniform sampler2D uStroke;\n' + fs.replace('#include <map_fragment>', `#include <map_fragment>
  { vec3 nW = abs(normalize(cross(dFdx(vWP), dFdy(vWP)))); vec2 suv = nW.y > max(nW.x, nW.z) ? vWP.xz : nW.x > nW.z ? vWP.zy : vWP.xy;
    vec3 st = texture2D(uStroke, suv / 0.9).rgb; diffuseColor.rgb *= 0.5 + st; }`).replace('#include <dithering_fragment>', `#include <dithering_fragment>
  { float ao = mix(0.66, 1.0, smoothstep(0.0, 0.5, vWP.y)) * (1.0 - 0.25 * smoothstep(${(H - 0.6).toFixed(2)}, ${H.toFixed(2)}, vWP.y)); // 手绘式底部/顶角压暗（按高度，非实时 AO）
    vec3 c = gl_FragColor.rgb * ao * ${(T.gain || 1).toFixed(2)}; float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 0.9) + vec3(-0.025, 0.0, 0.035) * (1.0 - smoothstep(0.05, 0.5, l)); // 轻降饱和 + 暗部偏冷（参考：冷暗部、暖木中间调）
    gl_FragColor.rgb = clamp(c, 0.0, 1.0); }`); }
    sh.fragmentShader = fs.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n  { ${BAYER}\n    gl_FragColor.rgb = floor(gl_FragColor.rgb * ${L_} + 0.5 + b * ${T.ditherAmp.toFixed(2)}) / ${L_}; }`); };
  const converted = new Map();
  const toPsx = (m) => { if (converted.has(m)) return converted.get(m);
    let n = m;
    if (m.isMeshStandardMaterial) n = new THREE.MeshLambertMaterial({ color: m.color, map: lowTex(m.map), emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
      transparent: m.transparent, opacity: m.opacity, side: m.side, flatShading: true });
    else if (m.map) lowTex(m.map);
    const np = m === M.silhouette; // 家长剪影保持中性纯黑，不吃笔触/冷暗部偏色（与门洞背景保持色相和明度双重分离）
    n.onBeforeCompile = (sh) => psx(sh, np); n.customProgramCacheKey = () => 'psx-' + T.id + (np ? '-np' : ''); converted.set(m, n); return n; };
  // 几何：A+1/A+2 曲面段数上限（棱角更硬）；A+2 大平面细分（仿射贴图下 PS1 式“分块”，大面不至于整面扭曲）
  const geoDone = new Map();
  const lowGeo = (g) => { if (geoDone.has(g)) return geoDone.get(g); const P = g.parameters || {}, k = T.maxSeg; let n = g;
    const cap = (v, lo = 3) => Math.max(lo, Math.min(v, k));
    if (k && g.type === 'CylinderGeometry' && P.radialSegments > k) n = new THREE.CylinderGeometry(P.radiusTop, P.radiusBottom, P.height, cap(P.radialSegments), 1, P.openEnded, P.thetaStart, P.thetaLength);
    else if (k && g.type === 'SphereGeometry' && P.widthSegments > k) n = new THREE.SphereGeometry(P.radius, cap(P.widthSegments), cap(P.heightSegments, 2) - 1);
    else if (k && g.type === 'CapsuleGeometry' && P.radialSegments > k) n = new THREE.CapsuleGeometry(P.radius, P.height, Math.max(1, Math.min(P.capSegments, 2)), cap(P.radialSegments));
    else if (k && g.type === 'LatheGeometry' && P.segments > k) n = new THREE.LatheGeometry(P.points, cap(P.segments));
    else if (k && g.type === 'ConeGeometry' && P.radialSegments > k * 2) n = new THREE.ConeGeometry(P.radius, P.height, k * 2, 1, P.openEnded);
    else if (k && g.type === 'CircleGeometry' && P.segments > k) n = new THREE.CircleGeometry(P.radius, cap(P.segments), P.thetaStart, P.thetaLength);
    else if (T.subdiv && g.type === 'BoxGeometry' && Math.max(P.width, P.height, P.depth) > T.subdiv * 1.2) { const sg = (v) => Math.max(1, Math.ceil(v / T.subdiv)); n = new THREE.BoxGeometry(P.width, P.height, P.depth, sg(P.width), sg(P.height), sg(P.depth)); }
    else if (T.subdiv && g.type === 'PlaneGeometry' && Math.max(P.width, P.height) > T.subdiv * 1.2) n = new THREE.PlaneGeometry(P.width, P.height, Math.ceil(P.width / T.subdiv), Math.ceil(P.height / T.subdiv));
    if (g.userData.keepGeo) n = g; // 已手改顶点的盒子（衣物下摆）保留原几何
    geoDone.set(g, n); return n; };
  // YWQ-STYLE-FUSION-01 修复 A+2 动态三角缺口：顶点吸附只移动 xy、不改深度，吸附后每个三角形的深度平面会随视角整体倾斜；
  //   两层贴得很近的薄面（画框芯/框、蕾丝桌布/茶几面、门板凹线/门板、门套/墙）各自独立吸附，前层的某一个三角形就会整块落到后层之后，
  //   露出后层 = 画面里随视角变化的大块深色三角。修法：按“贴面层级”给前层加斜率相关的深度偏移（polygonOffset factor ≥ 吸附位移像素数），
  //   位移上限 = 半个吸附格 × 2 层 = snapDiv 像素。只改深度比较，不改几何、颜色、分辨率和吸附强度。层级：0 主体；1 贴面（≤3.5 cm 薄盒/门套/画框）；2 贴面上的贴面（≤1.2 cm 或平面片）。
  const layerOf = (o) => { if (o.userData.layer != null) return o.userData.layer; const P = o.geometry.parameters || {};
    if (o.geometry.type === 'PlaneGeometry') return (o === floor || o === ceiling) ? 0 : 2;
    if (o.geometry.type !== 'BoxGeometry') return 0; const t = Math.min(P.width, P.height, P.depth); return t <= 0.012 ? 2 : t <= 0.035 ? 1 : 0; };
  const biased = new Map();
  const withLayer = (m, lv) => { if (!lv || DBG.has('nobias')) return m; const k = m.uuid + ':' + lv; if (biased.has(k)) return biased.get(k);
    const n = m.clone(); n.onBeforeCompile = m.onBeforeCompile; n.customProgramCacheKey = m.customProgramCacheKey;
    n.polygonOffset = true; n.polygonOffsetFactor = -T.snapDiv * lv; n.polygonOffsetUnits = -4 * lv; biased.set(k, n); return n; };
  window.__styleAApply = () => scene.traverse((o) => { if (o.isMesh) { o.geometry = lowGeo(o.geometry); const lv = layerOf(o);
    o.material = Array.isArray(o.material) ? o.material.map((m) => withLayer(toPsx(m), lv)) : withLayer(toPsx(o.material), lv); } });
  // 定位用 ?dbg=ids：每个网格换成唯一纯色（只保留顶点吸附，不抖色不量化），截图逐像素即可反查是哪件网格；__ywq.meshIds 给出编号→位置/尺寸
  if (DBG.has('ids')) { const ids = []; const idApply = window.__styleAApply; window.__styleAApply = () => { idApply(); let k = 0; scene.traverse((o) => { if (!o.isMesh) return; k++;
      const c = new THREE.Color().setRGB(((k * 47) % 256) / 255, ((k * 101) % 256) / 255, ((k * 173) % 256) / 255, THREE.SRGBColorSpace);
      const mm = new THREE.MeshBasicMaterial({ color: c, fog: false, side: o.material.side ?? THREE.FrontSide }); mm.onBeforeCompile = (sh) => { sh.uniforms.uSnap = PSX.snap;
        sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + (DBG.has('nosnap') ? '//' : '') + '  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;'); };
      mm.customProgramCacheKey = () => 'id'; if (o.material.polygonOffset) { mm.polygonOffset = true; mm.polygonOffsetFactor = o.material.polygonOffsetFactor; mm.polygonOffsetUnits = o.material.polygonOffsetUnits; } o.material = mm; const wp = new THREE.Vector3(); o.getWorldPosition(wp); const P = o.geometry.parameters || {};
      ids.push({ k, rgb: [(k * 47) % 256, (k * 101) % 256, (k * 173) % 256], type: o.geometry.type, pos: wp.toArray().map((v) => +v.toFixed(3)), size: [P.width, P.height, P.depth].map((v) => v && +v.toFixed(3)), seg: [P.widthSegments, P.heightSegments, P.depthSegments] }); }); }; window.__ywqMeshIds = ids; }
  renderer.toneMapping = THREE.NoToneMapping;
  if (DBG.has('gap')) scene.background = new THREE.Color(0xff00ff); // ?dbg=gap：正常材质+洋红清屏，数漏底像素（ids 会给网格刷洋红，不能用于此）
  else if (DBG.has('ids')) scene.background = new THREE.Color(0xff00ff); // 定位模式恒洋红（高清档 crackFill 被清空，不能靠它判断）
  else if (T.crackFill) scene.background = new THREE.Color(T.crackFill); // 顶点吸附会在墙块接缝处露出 1 像素缝：清屏色取墙面中间调，缝不再是黑线（不影响光照）
  scene.fog = new THREE.Fog(0x101214, ...(T.fog || [4.5, 11]));
}

// ------------------------------------------------------------------ 光照
// 融合候选：环境光略升、地面反光偏暖（左墙不至于沉成黑）；V5 检查时会整体压 15%
const HEMI_BASE = STYLE_TIER?.ambient ?? 0.55;
const hemi = new THREE.HemisphereLight(0xcfd8e0, STYLE_TIER?.paint ? 0x4a3a28 : 0x3a3328, HEMI_BASE);
scene.add(hemi);
const winLight = new THREE.DirectionalLight(0xdfe8f0, 0.9); winLight.position.set(0.5, 3, -6); winLight.target.position.set(0, 0, 0); scene.add(winLight, winLight.target);
const roomLight = new THREE.PointLight(0xfff1d6, 1.2, 9); roomLight.position.set(0, 2.5, 0); scene.add(roomLight);

// ------------------------------------------------------------------ 环境细节（YWQ-CH2-01）
// 三条都是纯表现层、默认极轻，并且完全服从「低动态」：不开阴影、不改碰撞、不增加 draw call 以外的逻辑。
// 1) 窗光里的浮尘：单一 Points，整组缓慢漂移 + 旋转（不做逐点 CPU 更新，iPad 帧预算友好）
const dustMat = new THREE.PointsMaterial({ color: 0xe8e2cf, size: 0.022, transparent: true, opacity: 0, depthWrite: false, fog: true, sizeAttenuation: true });
const dustGeo = new THREE.BufferGeometry();
{ const N = 240, pos = new Float32Array(N * 3);
  // 集中在窗前的光柱里（x∈[-1.6,1.6]、y∈[0.4,2.4]、z∈[-3,-0.6]），密度向窗侧略高
  for (let i = 0; i < N; i++) {
    const r = Math.random();
    pos[i * 3] = (Math.random() * 2 - 1) * 1.6;
    pos[i * 3 + 1] = 0.35 + Math.random() * 2.05;
    pos[i * 3 + 2] = -3.0 + Math.pow(r, 0.7) * 2.4;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const dust = new THREE.Points(dustGeo, dustMat); scene.add(dust);
// 2) CRT 扫描线：静态贴图 + 滚动 offset（比每帧重绘 canvas 便宜得多）
const scanTex = canvasTex(4, 64, (x, w, h) => {
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) { x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(0, y, w, 1); }
});
scanTex.wrapS = scanTex.wrapT = THREE.RepeatWrapping; scanTex.repeat.set(1, 2.2);
scr.material.emissiveMap = scanTex; scr.material.emissive.setHex(0x9fc4ff);
// 3) 电视时段的屏光：只在 tv 时段把孩子脸侧照亮一点（不参与判定，也不提示答案）
const tvGlow = new THREE.PointLight(0x8fb4ff, 0, 3.2); tvGlow.position.set(-1.85, 0.8, 0.2); scene.add(tvGlow);

if (STYLE_A) window.__styleAApply();

// ------------------------------------------------------------------ 声音（MP3 素材 + WebAudio 合成回退，见 src/assets/audio/SOURCES.md）
let ac = null; let master = null;
function panFor(x, z) { const a = Math.atan2(x - g.player.x, z - g.player.z) - (g.player.yaw + Math.PI); return -Math.max(-1, Math.min(1, Math.sin(a))); }
const sfxStub = { ready: () => Promise.resolve(), stopAll() {}, setAmbient() {}, setTvLayer() {}, warn() {}, footsteps() {}, stepAt() {}, handle() {}, caught() {}, safe() {}, page() {}, door() {}, breathLoop() {}, clockTick() {}, escaped() {}, keys() {}, countdown() {}, wrongTime() {}, timeOk() {}, timeEarly() {} };
const sfx = { ...sfxStub };
function stopAllAudio() { sfx.stopAll(); }
function ensureAudioRunning() { if (ac && ac.state === 'suspended') ac.resume().catch(() => {}); }
function audioInit() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.connect(ac.destination);
    Object.assign(sfx, createSfx(ac, master, { panFor, getLowHorror: () => g.settings.lowHorror, getPlayer: () => g.player }));
  }
  ensureAudioRunning();
  applyVolume();
  return sfx.ready();
}
function applyVolume() {
  if (!master) return;
  const base = Math.min(1, Math.max(0, Number(g.settings.volume)));
  // 主音量来自设置；低恐怖只把整体再压低，不覆盖玩家的音量/静音选择
  const v = (g.settings.muted ? 0 : base) * (g.settings.lowHorror ? 0.45 : 1);
  // 被抓时会把 master 压到 40% 再回升；取消遗留的自动化，避免重开后音量停在 40%
  master.gain.cancelScheduledValues(ac.currentTime);
  master.gain.setValueAtTime(v, ac.currentTime);
}
// ------------------------------------------------------------------ 试玩录像/记录（内测用，不改玩法）
// 画面来自 canvas.captureStream()：只录游戏画面，不需要屏幕共享权限；声音从 master 总线再引一路，
// 录到的就是玩家此刻听到的（含主音量、静音、被抓时的 ducking）。
function getVid() {
  if (!vid) vid = createVideoRecorder({ canvas, audioContext: ac, masterGain: master });
  return vid;
}
function updateRecPill() {
  const b = $('recBtn'); if (!b) return;
  const on = !!vid && vid.recording;
  b.classList.toggle('on', on);
  const s = on ? vid.seconds : 0;
  const t = on ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '录制本局';
  if (b.textContent !== (on ? `⏺ ${t}` : t)) b.textContent = on ? `⏺ ${t}` : t;
  b.title = on ? '停止并保存录像（F9）' : '录一段本局画面+声音（F9）；记录 JSON 按 F8 导出';
}
async function startVideo() {
  audioInit();
  updateRecPill();
  const r = await getVid().start();
  if (!r.ok) { toast = { text: r.reason === 'unsupported' ? '这个浏览器不支持录制（换 Chrome/Safari 新版）' : '已经在录了', until: performance.now() + 2600 }; return r; }
  toast = {
    text: r.audioDropped
      ? '开始录制：这段只录到画面（浏览器没接上音频轨）'
      : '开始录制：画面 + 你听到的声音；再按 F9 或点右下角停止',
    until: performance.now() + 4600,
  };
  updateRecPill();
  return r;
}
async function stopVideo({ auto = false } = {}) {
  if (!vid || !vid.recording) { updateRecPill(); return null; }
  const res = await vid.stop();
  updateRecPill();
  if (!res) return null;
  const mb = (res.bytes / 1048576).toFixed(1);
  toast = { text: auto ? `录像已保存：${mb} MB（见下载）` : `录像已保存：${mb} MB`, until: performance.now() + 5000 };
  if (!auto) vid.download(pt.filename('webm'));
  else lastAutoVideo = true;
  return res;
}
let lastAutoVideo = false;   // 结算自动停录时，把「下载录像」按钮摆到结算卡上
async function toggleVideo() { if (vid && vid.recording) await stopVideo(); else await startVideo(); updateRecPill(); }
function exportRecord() {
  const r = pt.download();
  toast = { text: `记录已导出：${(r.bytes / 1024).toFixed(0)} KB / ${r.runs} 局`, until: performance.now() + 4000 };
  return r;
}

let ambientOn = false;
let tvLayerOn = false;
let lastBreath = 0;
let lastParentEye = null;   // 上一帧家长眼睛位置（按位移出脚步声）
let parentStepAcc = 0;      // 已累计的位移（一步约 0.62 m）

// ------------------------------------------------------------------ 输入
function lockPointer() { try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* 无头/iframe 环境不支持指针锁定 */ } }
const keys = new Set(); let mouseDX = 0, mouseDY = 0; let rebinding = false; let started = false;
// 触屏：摇杆向量（x 右为正、y 下为正）与拖屏状态；桌面不初始化，零影响
const touchMove = { x: 0, y: 0 }; let touchLook = null; let isTouchUI = false;
let touchYaw = 0, touchPitch = 0;   // 本帧触屏累积的转角（弧度），消费后清零
const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
addEventListener('keydown', (e) => {
  if (!started) return;
  if (rebinding) { g.settings.studyKey = e.code; rebinding = false; saveSettings(); renderModal(); e.preventDefault(); return; }
  audioInit();
  if (e.code === g.settings.studyKey) { e.preventDefault(); if (!g.modal) L.pressStudy(g, { repeat: e.repeat }); return; }
  // 台钟弹层优先：A/W/S 同时是移动键，必须先给台钟，否则会被移动分支吞掉
  if (g.modal?.type === 'clock') {
    // 方向键也接台钟：↑↓ 分、←→ 时（Q/A/W/S 保留，照顾老习惯）
    const k = { KeyQ: [1, 0], KeyA: [-1, 0], KeyW: [0, 1], KeyS: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1], KeyF: 'flip', Enter: 'submit' }[e.code];
    if (k) { e.preventDefault(); if (k === 'flip') L.clockFlip(g); else if (k === 'submit') L.clockSubmit(g); else { L.clockAdjust(g, ...k); sfx.clockTick(); } renderModal(); return; }
  }
  if (MOVE[e.code]) { keys.add(e.code); e.preventDefault(); return; }
  if (e.code === 'KeyE') { if (g.modal?.type === 'clue') { L.closeModal(g); renderModal(); } else if (!g.modal) { if (L.interact(g)) sfx.page(); renderModal(); } }
  if (e.code === 'KeyN') { if (g.modal?.type === 'notes') { L.closeModal(g); } else L.openNotes(g); renderModal(); }
  if (e.code === 'KeyC' && !g.modal) { L.toggleCrouch(g); } // 蹲/起身：低姿态更难被注意，但慢、不能写作业
  if (e.code === 'Escape') { if (g.modal && !['caught', 'result'].includes(g.modal.type)) L.closeModal(g); else if (!g.modal) L.pause(g); renderModal(); }
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === g.settings.studyKey) L.releaseStudy(g); });
canvas.addEventListener('click', () => { audioInit(); if (!g.modal && started && !isTouchUI) lockPointer(); });
// 台钟弹层：滚轮微调分钟（一格 1 分钟），不必反复点键
canvas.addEventListener('wheel', (e) => {
  if (g.modal?.type !== 'clock') return;
  e.preventDefault(); L.clockAdjust(g, 0, e.deltaY < 0 ? 1 : -1); audioInit(); sfx.clockTick(); renderModal();
}, { passive: false });
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mouseDX += e.movementX; mouseDY += e.movementY; } });

// ---------------------------------------------------------------- 触屏：左摇杆走路，画面拖动转头
// 只在触屏设备（或 ?touch=1 预览）启用；指针类型为 touch 才响应，桌面鼠标完全不受影响。
const stickEl = $('stick'), knobEl = $('knob');
// 先用同步判断挂 body 类，保证标题页第一帧就显示触屏说明（不等 initTouchUI）
if (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')) document.body.classList.add('touchmode');
function touchUIActive() {
  return matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
}
function initTouchUI() {
  isTouchUI = touchUIActive();
  if (!isTouchUI) return;
  document.body.classList.add('touchmode');
  stickEl.hidden = false;
  let stickId = null;
  const setStick = (e) => {
    const r = stickEl.getBoundingClientRect();
    const v = stickVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), STICK_RADIUS);
    touchMove.x = v.x; touchMove.y = v.y;
    knobEl.style.transform = `translate(${(v.x * STICK_RADIUS).toFixed(1)}px, ${(v.y * STICK_RADIUS).toFixed(1)}px)`;
  };
  stickEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; stickId = e.pointerId; stickEl.setPointerCapture?.(e.pointerId); setStick(e); e.preventDefault(); });
  stickEl.addEventListener('pointermove', (e) => { if (e.pointerId !== stickId) return; setStick(e); e.preventDefault(); });
  const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; touchMove.x = touchMove.y = 0; knobEl.style.transform = ''; };
  stickEl.addEventListener('pointerup', endStick); stickEl.addEventListener('pointercancel', endStick);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touchLook || e.pointerId !== touchLook.id) return;
    touchYaw += touchLookDelta(e.clientX - touchLook.x, g.settings.sens);
    touchPitch += touchLookDelta(e.clientY - touchLook.y, g.settings.sens);
    touchLook.x = e.clientX; touchLook.y = e.clientY;
  });
  const endLook = (e) => { if (touchLook && e.pointerId === touchLook.id) touchLook = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
}
// Esc 释放指针锁定时浏览器不一定把 keydown 交给页面：鼠标被释放而游戏仍在跑 = 隐藏计时，按暂停处理
let hadPointerLock = false; // 只在“本来锁上过、后来又锁不上”时提示；无头环境从未锁成功，不该弹这个框
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && started && !g.modal && !autopilot) { L.pause(g); renderModal(); }
  if (document.pointerLockElement) { hadPointerLock = true; hud($('lockHint'), 'hidden', true); }
});
// 连续开关弹层时浏览器有约 1 s 的指针锁冷却：锁定失败要告诉玩家点一下画面，而不是“鼠标突然转不动”
document.addEventListener('pointerlockerror', () => {
  if (!hadPointerLock) return; // 无头取证/自动化没有用户手势，锁从未成功过；别把提示框录进证据图
  hud($('lockHint'), 'hidden', false);
  clearTimeout(lockHintTimer); lockHintTimer = setTimeout(() => hud($('lockHint'), 'hidden', true), 2600);
});
addEventListener('blur', () => { keys.clear(); if (started && !g.modal && !autopilot) { L.pause(g); renderModal(); } }); // 失焦即暂停
let lockHintTimer = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) keys.clear();
  else ensureAudioRunning(); // 回到前台把被 iOS 挂起的音频救回来
  if (document.hidden && started && !g.modal && !autopilot) { L.pause(g); renderModal(); }
});
let touchStudyAt = 0;
document.querySelectorAll('#touch button').forEach((b) => {
  const a = b.dataset.act;
  if (a === 'study') {
    // 按住模式需要真实的按下/抬起：click 只有抬起，releaseStudy 永远不会被调用
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return; e.preventDefault(); audioInit(); touchStudyAt = performance.now();
      if (!g.modal) L.pressStudy(g); renderModal();
    });
    const up = (e) => { if (e.pointerType === 'touch') L.releaseStudy(g); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }
  b.addEventListener('click', (e) => {
    if (a === 'study' && performance.now() - touchStudyAt < 700) return; // 触屏 pointerdown 已处理，别再来一次
    audioInit();
    if (a === 'study' && !g.modal) L.pressStudy(g);
    if (a === 'use') { if (g.modal?.type === 'clue') L.closeModal(g); else if (!g.modal) L.interact(g); }
    if (a === 'crouch' && !g.modal) L.toggleCrouch(g);
    if (a === 'notes') L.openNotes(g); if (a === 'pause') L.pause(g); renderModal();
  });
});
function readBest() { try { const v = JSON.parse(localStorage.getItem(BEST_KEY)); return v && Number.isFinite(v.t) ? v : null; } catch { return null; } }
function recordBest(t) {
  const b = readBest();
  if (!b || t < b.t) { const v = { t: +t.toFixed(2), at: new Date().toISOString().slice(0, 10) }; try { localStorage.setItem(BEST_KEY, JSON.stringify(v)); } catch { /* ignore */ } return { best: v, isNew: true }; }
  return { best: b, isNew: false };
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(g.settings)); } catch { /* ignore */ } applyVolume(); document.body.classList.toggle('lowmotion', g.settings.lowMotion); }

// ------------------------------------------------------------------ 标题页：难度二选一 + 本地最快纪录
// 直接用既有设置键表达难度，不新增规则：温和 = 延长预警/宽限 + 学习点自动摆姿势。
const TITLE_MODES = {
  standard: { label: '标准', note: '标准：预警 3.5 秒 · 扫视宽限 1.2 秒 · 不自动摆姿势', settings: { extendedWarn: false, extendedGrace: false, assist: false } },
  mild: { label: '温和', note: '温和：预警 ×1.6 · 宽限 ×1.5 · 检查来临时自动装写作业（谜题不变）', settings: { extendedWarn: true, extendedGrace: true, assist: true } },
};
function titleMode() { return g.settings.extendedWarn && g.settings.extendedGrace ? 'mild' : 'standard'; }
function renderTitle() {
  const mode = titleMode(); const m = TITLE_MODES[mode];
  document.querySelectorAll('#titleModes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const note = $('titleModeNote'); if (note) note.textContent = m.note;
  // 章节：只改开场时段与是否播教学；切换后立即重开一局干净状态（标题页，未开始）
  const chap = L.chapterOf(g);
  document.querySelectorAll('#titleChapters button').forEach((b) => b.classList.toggle('on', b.dataset.chapter === chap.id));
  const cnote = $('titleChapterNote'); if (cnote) cnote.textContent = `${chap.name}：${chap.note}`;
  const best = readBest(); const line = $('titleBest');
  if (line) { line.hidden = !best; line.textContent = best ? `最快一次：${L.fmtTime(best.t)}（${best.at}）` : ''; }
}
function setTitleMode(mode) {
  if (!TITLE_MODES[mode]) return;
  Object.assign(g.settings, TITLE_MODES[mode].settings);
  saveSettings(); renderTitle();
}
// 切换章节 = 换一张干净的局（时钟/线索/检查全按新章节初始化）；设置与最快纪录保留
function setTitleChapter(id) {
  if (!L.CHAPTERS[id] || g.settings.chapter === id) return;
  g.settings.chapter = id;
  saveSettings();
  g = L.createGame(g.settings);
  resetPresentation();
  renderTitle();
}
document.querySelectorAll('#titleModes button').forEach((b) => b.addEventListener('click', () => setTitleMode(b.dataset.mode)));
document.querySelectorAll('#titleChapters button').forEach((b) => b.addEventListener('click', () => setTitleChapter(b.dataset.chapter)));
renderTitle();

// ------------------------------------------------------------------ 弹层
const modalEl = $('modal'), card = $('modalCard');
// 台钟步进按钮的长按连发（19:40 → 21:20 共 9 步；按住约 1 秒即可走完，粒度仍是 5 分钟）
const CLOCK_STEP = { 'h+': [1, 0], 'h-': [-1, 0], 'm+': [0, 1], 'm-': [0, -1] };
let clockHold = 0;
function stopClockHold() { if (clockHold) { clearInterval(clockHold); clockHold = 0; } }
addEventListener('pointerup', stopClockHold, true);
addEventListener('pointercancel', stopClockHold, true);
addEventListener('blur', stopClockHold);
function clueDoc(id) {
  const c = L.CLUES[id];
  return `<div class="paperdoc clue-${id}">${c.lines.map((s) => `<div>${s}</div>`).join('')}</div>`;
}
function renderModal() {
  const m = g.modal;
  document.body.classList.toggle('modal-open', !!m); modalEl.hidden = !m; if (!m) { if (started && !autopilot) lockPointer(); return; }
  if (document.pointerLockElement) document.exitPointerLock();
  if (m.type === 'clue') {
    card.innerHTML = `<h2>${L.CLUES[m.id].title}</h2>${clueDoc(m.id)}<p class="note">已记入线索笔记（N）。预警期可读；家长扫视中开纸 = 违规。</p><div class="row"><button class="primary" data-a="close">放回去（E）</button></div>`;
  } else if (m.type === 'notes') {
    const cols = ['schedule', 'guide', 'calib'].map((id) => g.clues[id] ? `<div><b>${L.CLUES[id].title}</b>${clueDoc(id)}</div>` : '<div class="missing">？ 还没找到</div>').join('');
    card.innerHTML = `<h2>线索笔记</h2><div class="notes">${cols}</div><p class="note">笔记只记录看到的原文，不替你计算。游戏暂停中。</p><div class="row"><button class="primary" data-a="close">合上（N）</button></div>`;
  } else if (m.type === 'clock') {
    const can = L.clockCanSubmit(g); const [h, mi] = L.fmtClock(g.clock).split(':');
    card.innerHTML = `<h2>书桌上的台钟</h2>${g.clockFlipped
      ? `<div class="clockback"><div class="slip">${L.CLUES.calib.lines[0]}</div><div style="margin-top:10px;font-size:13px">${L.CLUES.calib.lines[1]}</div></div>`
      : `<div class="clockface"><div class="knob"><button data-a="h+">▲</button>${h}<button data-a="h-">▼</button></div>:<div class="knob"><button data-a="m+">▲</button>${mi}<button data-a="m-">▼</button></div></div>`}
      <p class="note">键盘：←→ / Q/A 时 ±1　↑↓ / W/S 分 ±5　滚轮微调分　F 翻面　Enter 摆回去。按钮可按住连发。调整中不会判定答案。</p>
      <div class="row"><button data-a="flip">${g.clockFlipped ? '翻回正面' : '翻到背面（F）'}</button>
      <button class="primary" data-a="submit" ${can ? '' : 'disabled'}>摆回给家长看的位置（Enter）</button><button data-a="close">先放着（Esc）</button></div>
      ${can ? '' : '<p class="note">现在把钟摆回去太显眼了——等第一次检查过去再说。</p>'}`;
  } else if (m.type === 'caught') {
    card.innerHTML = `<div class="caught"><div style="color:var(--amber)">◉ 被看见了</div><div class="line">“${m.line}”</div><p>${m.note}</p><div class="row" style="justify-content:center"><button class="primary" data-a="retry">从头开始</button></div></div>`;
  } else if (m.type === 'result') {
    const rec = bestInfo || { best: readBest(), isNew: false };
    const bestLine = rec.best ? (rec.isNew ? `<b>新纪录：${L.fmtTime(rec.best.t)}</b>` : `最快一次：${L.fmtTime(rec.best.t)}`) : '';
    const cluesRead = Object.values(g.clues).filter(Boolean).length;
    const grade = L.resultGrade(g);
    card.innerHTML = `<h2>你跨过了门槛。</h2><p>楼道里很安静。</p>
      <div class="grade"><span class="g-mark">${grade.id}</span><span class="g-label">${grade.label}</span></div>
      <p class="g-note">${grade.note}</p>
      <p class="note">本局主动游玩 ${L.fmtTime(g.t)} · 本次会话第 ${g.run} 局</p>
      <ul class="result-stats">
        <li>经历检查 <b>${g.stats.checks}</b> 次 · 被看见 <b>${g.stats.seen}</b> 次</li>
        <li>台钟摆错 <b>${g.clockWrong}</b> 次</li>
        <li>线索 <b>${cluesRead}/3</b>${cluesRead === 3 ? '（全部读过）' : ''}</li>
      </ul>
      <p class="note">评级只看用时、摆错次数与被看见次数；跳线索不扣分。</p>
      ${bestLine ? `<p class="note">${bestLine}</p>` : ''}
      <div class="row rec-row"><button class="rec" data-a="save-json">导出本局记录（JSON）</button>${lastAutoVideo ? '<button class="rec" data-a="save-video">下载录像（webm）</button>' : ''}</div>
      <p class="rec-note">记录包含本局的检查、走位、按键节奏与结果；不发到任何服务器，只下载到本机。</p>
      ${g.chapter === 'desk'
        ? `<p class="note">下一段：20:40，晚间新闻还没完——这一次，该坐到沙发上了。</p>
           <div class="row"><button class="primary" data-a="next-chapter">继续 · 第二章「电视」</button><button data-a="restart">再玩一次本章</button><button data-a="title">回到标题</button></div>`
        : `<div class="row"><button class="primary" data-a="restart">再玩一次</button><button data-a="title">回到标题</button></div>`}`;
  } else if (m.type === 'pause') {
    const s = g.settings; const ck = (k, label) => `<label><input type="checkbox" data-s="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`;
    card.innerHTML = `<h2>暂停</h2><div class="settings">
      ${ck('extendedWarn', '延长预警（×1.6）')}${ck('extendedGrace', '延长宽限（×1.5）')}${ck('holdMode', '学习姿态：按住保持（默认按一次切换）')}
      ${ck('assist', '辅助：在学习点范围内检查来临时自动写作业（不传送、不解谜）')}${ck('showCone', '辅助：显示家长视线锥（默认用门缝光与地面投影表达）')}${ck('lowMotion', '低动态')}${ck('lowHorror', '低恐怖音量')}${ck('muted', '静音')}
      <label>主音量：<input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-vol> <b id="volVal">${Math.round(s.volume * 100)}%</b></label>
      <label>清晰度：<select data-quality>
        <option value="standard" ${s.quality !== 'fine' ? 'selected' : ''}>标准（180 融合，默认）</option>
        <option value="fine" ${s.quality === 'fine' ? 'selected' : ''}>精细（540，下次打开页面生效）</option>
      </select></label>
      <label>学习键：<b>${s.studyKey}</b> <button data-a="rebind">${rebinding ? '请按新键…' : '改键'}</button></label>
      <p class="rec-note">试玩记录：${pt.data.runs.length} 局已记录${vid && vid.recording ? ` · 正在录像 ${Math.floor(vid.seconds)}s` : ''}</p>
      <div class="row rec"><button data-a="record">${vid && vid.recording ? '停止并保存录像' : '录制本局（F9）'}</button><button data-a="save-json">导出记录（F8）</button>${vid && !vid.recording && vid.bytes ? '<button data-a="save-video">下载上一段录像</button>' : ''}</div>
      <label>鼠标灵敏度：<input type="range" min="0.4" max="2.2" step="0.1" value="${s.sens}" data-sens> <b id="sensVal">${s.sens.toFixed(1)}×</b></label></div>
      <p class="note">暂停、失焦、阅读线索与笔记时，所有计时冻结，关闭后不补算。</p>
      <div class="row"><button class="primary" data-a="close">继续</button><button data-a="notes">线索笔记</button>
      <button data-a="restart-run" class="danger">${m.arm ? '再点一次：本局从头开始' : '重开本局'}</button><button data-a="title">${m.armTitle ? '再点一次：回标题（本局作废）' : '回到标题'}</button></div>
      ${m.arm ? '<p class="note">线索、台钟进度都会清空，设置保留。</p>' : ''}`;
  }
  card.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', (ev) => {
    const a = b.dataset.a;
    // 台钟步进按钮：指针按下时已即时处理并连发，click 只接键盘激活（detail=0）
    if (CLOCK_STEP[a] && ev.detail > 0) return;
    if (a === 'close') L.closeModal(g); if (a === 'retry') { L.retry(g); resetPresentation(); } if (a === 'flip') L.clockFlip(g); if (a === 'submit') L.clockSubmit(g);
    if (a === 'h+') { audioInit(); L.clockAdjust(g, 1, 0); sfx.clockTick(); } if (a === 'h-') { audioInit(); L.clockAdjust(g, -1, 0); sfx.clockTick(); } if (a === 'm+') { audioInit(); L.clockAdjust(g, 0, 1); sfx.clockTick(); } if (a === 'm-') { audioInit(); L.clockAdjust(g, 0, -1); sfx.clockTick(); }
    if (a === 'notes') g.modal = { type: 'notes' }; if (a === 'rebind') { rebinding = true; }
    if (a === 'save-json') exportRecord();
    if (a === 'save-video') { if (vid) vid.download(pt.filename('webm')); }
    if (a === 'record') toggleVideo();
    if (a === 'restart') { L.playAgain(g); resetPresentation(); }
    // 首通路径：第一章结算 → 第二章（同一会话、同一难度与设置，纪录分开记）
    if (a === 'next-chapter') {
      g.settings.chapter = 'tv'; saveSettings();
      g = L.createGame(g.settings); resetPresentation();
      renderTitle(); return;
    }
    if (a === 'restart-run') { if (g.modal?.arm) { L.restartFromPause(g); resetPresentation(); } else if (g.modal) g.modal.arm = true; }
    if (a === 'title') {
      if (g.modal?.type === 'result' || g.modal?.armTitle) { quitToTitle(); return; }
      if (g.modal) g.modal.armTitle = true;
    }
    renderModal();
  }));
  // 按住连发：19:40 → 21:20 不再需要点 9 次（长按 1 秒约 7 步，仍按 5 分钟粒度）
  card.querySelectorAll('[data-a]').forEach((b) => {
    const step = CLOCK_STEP[b.dataset.a]; if (!step) return;
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); audioInit();
      stopClockHold();
      const tick = () => {
        if (g.modal?.type !== 'clock') { stopClockHold(); return; }
        L.clockAdjust(g, step[0], step[1]); sfx.clockTick(); renderModal();
      };
      tick();
      clockHold = setInterval(tick, 110);
    });
  });
  card.querySelectorAll('[data-s]').forEach((c) => c.addEventListener('change', () => { g.settings[c.dataset.s] = c.checked; saveSettings(); }));
  const qsel = card.querySelector('[data-quality]');
  if (qsel) qsel.addEventListener('change', () => { g.settings.quality = qsel.value === 'fine' ? 'fine' : 'standard'; saveSettings(); });
  const sens = card.querySelector('[data-sens]');
  if (sens) sens.addEventListener('input', () => {
    g.settings.sens = Math.min(2.5, Math.max(0.3, Number(sens.value) || 1));
    const out = card.querySelector('#sensVal'); if (out) out.textContent = g.settings.sens.toFixed(1) + '×';
    saveSettings();
  });
  const vol = card.querySelector('[data-vol]');
  if (vol) vol.addEventListener('input', () => {
    g.settings.volume = Math.min(1, Math.max(0, Number(vol.value) || 0));
    if (g.settings.muted && g.settings.volume > 0) { g.settings.muted = false; const mb = card.querySelector('[data-s="muted"]'); if (mb) mb.checked = false; }
    const out = card.querySelector('#volVal'); if (out) out.textContent = Math.round(g.settings.volume * 100) + '%';
    saveSettings();
  });
}

// ------------------------------------------------------------------ 事件 → 声画
function consumeEvents() {
  for (const e of g.events.splice(0)) {
    pt.event(e, g);
    if (e.type === 'checkWarn') {
      if (e.id !== 'R') {
        sfx.footsteps(e.id === 'A' ? 6 : 7);
        sfx.warn();
        if (e.id === 'A') sfx.handle();
        // 首局第一次检查：把“现在该做什么”写成一句可执行的话（只出现一次）
        if (!coachCheckShown && g.run === 1) {
          coachCheckShown = true;
          const d = L.SCHEDULE_DUTIES[L.scheduleDuty(g)];
          if (d) showCoach(`<b>检查来了。</b>此刻该「${d.short}」——${d.hint}。<b>就位之后别碰移动键</b>，扫视中别翻笔记（N）。`);
        }
      }
    }
    if (e.type === 'phase' && e.phase === 'explore2') { explore2At = g.t; coachStallShown = false; }
    if (e.type === 'windowWarn') sfx.footsteps(8, 0.55, { from: { x: 1.65, z: 5.2 }, to: { x: 1.65, z: 3.4 } });
    if (e.type === 'windowOpen') {
      // 家长看了一眼钟说“到点了”（交付包里新增的语音；文字提示仍由 say 给）
      sfx.timeOk();
      if (!coachWindowShown) {
        coachWindowShown = true;
        showCoach('先去<b>衣帽架</b>拿钥匙，再到门口<b>开门</b>出去。门只在倒计时内能开。', 9000);
      }
    }
    if (e.type === 'checkSweep') sfx.door();
    // 教学期两级兜底提示：第 1 级只指路，第 2 级把动作说到最直白（仍然不给任何谜题答案）
    if (e.type === 'tutorialHint') {
      if (e.step === 1) showCoach('走到<b>书桌</b>旁边，按<b>空格</b>装作写作业——检查随时会来。方向条指着书桌。', 10000);
      else showCoach('就站在<b>书桌边</b>按一下<b>空格</b>（触屏点「写作业」）。按一下就好，不用按住。', 11000);
    }
    if (e.type === 'caught') {
      sfx.caught(e.duty, e.why); renderModal();
      pt.finishRun(g, { outcome: 'caught', result: { why: e.why || null, duty: e.duty || null, line: e.line || null }, grade: L.resultGrade(g).id });
      if (vid && vid.recording) stopVideo({ auto: true });
    }
    if (e.type === 'phase' && e.phase === 'explore1') { ambientOn = true; sfx.setAmbient(true); }
    if (e.type === 'checkEnd') sfx.safe();
    if (e.type === 'escaped') {
      sfx.escaped(); bestInfo = recordBest(g.t); renderModal();
      pt.finishRun(g, { outcome: 'escaped', result: { windowLeft: e.windowLeft ?? null }, grade: L.resultGrade(g).id });
      if (vid && vid.recording) stopVideo({ auto: true });
    }
    if (e.type === 'clueFound') sfx.page();
    // 钥匙：只有第一次拿到才响金属声（重复按 E 不该反复叮）
    if (e.type === 'keysTaken') sfx.keys();
    // 门：玩家自己开门 → 一声门轴；拿不到钥匙/不在窗口被拒 → 短促门把声
    if (e.type === 'doorOpen' && e.by === 'player') sfx.door();
    if (e.type === 'doorLocked' || e.type === 'doorRefused') sfx.handle();
    // 钟摆错：家长“多站一会儿”的低频压迫；同时播他看一眼钟的台词（到点了/还没到时候/你动过这个钟）
    if (e.type === 'wrongTime') {
      sfx.wrongTime();
      sfx.timeEarly(e.n);
      // 只提示“去翻钟的背面”，不给答案：0 知识首玩里最常见的死法是同一个错答案反复交
      if (e.n === 1 && !coachClockShown) { coachClockShown = true; showCoach('时间没对上。<b>把台钟翻过来（F）看看背面</b>——那里贴着一张校时纸。', 9000); }
    }
    if (e.type === 'studyRefused') { // 远处按空格不再“无反应”
      const p = L.STUDY_POINTS.find((s) => s.id === e.nearest);
      toast = { text: `离${p ? p.name : '学习点'}太远（${e.d.toFixed(1)} 米）`, until: performance.now() + 2200 };
      sfx.page();
    }
    if (e.type === 'restart') renderModal();
  }
}

// ------------------------------------------------------------------ HUD
const PHASE_NAME = { tutorial: '教学：在书桌按空格写作业，再按一次停下', explore1: '探索', explore2: '探索 · 推算', window: '家长出门了', returning: '家长回来了', escaped: '离开' };
// 第二章的教学教的是“坐沙发、面向电视”，和第一章的“按空格”不是同一件事
const PHASE_NAME_TV = { tutorial: '教学：走到沙发坐下，面向电视（不是写作业）' };
const phaseName = (g) => (g.phase === 'tutorial' && g.tutorialKind === 'tv' ? PHASE_NAME_TV.tutorial : PHASE_NAME[g.phase] || '');
// updateHUD 每帧都跑：只在值变化时写 DOM，避免每秒 60 次重建目标清单与样式重算（iPad 帧预算，审计 P1-2）
const hudPrev = new WeakMap();
function hud(el, prop, val) {
  if (!el) return;
  let m = hudPrev.get(el); if (!m) { m = {}; hudPrev.set(el, m); }
  if (m[prop] === val) return;
  m[prop] = val;
  if (prop === 'text') el.textContent = val;
  else if (prop === 'html') el.innerHTML = val;
  else el[prop] = val;
}
let toast = null; // { text, until }：一次性提示（不写进逻辑层状态）
let windowTickAt = -1; // 窗口倒计时最后 3 秒的整秒打点（避免每帧重复播放）

// 首玩一次性教练条：只解释“现在该做什么”，不暂停、不改规则；每局最多出现一次。
const coachEl = $('coach');
let coachLine = null, coachUntil = 0, coachCheckShown = false, coachWindowShown = false, coachClockShown = false, coachTvStaged = false;
let explore2At = null, coachStallShown = false;
function showCoach(html, ms = 9000) { coachLine = html; coachUntil = performance.now() + ms; }
function updateCoach() {
  const on = !!coachLine && performance.now() < coachUntil && !g.modal && g.phase !== 'escaped';
  hud(coachEl, 'hidden', !on);
  if (on) hud(coachEl, 'html', coachLine);
}

function updateHUD() {
  const chap = L.chapterOf(g);
  hud($('phaseTag'), 'text', `${chap.tag}　${phaseName(g)}`.trim());
  // 目标清单：教学期不显示；暂停/线索/被抓/离开时不叠在弹层上
  const ob = $('objectives'); const hideOb = g.phase === 'tutorial' || !!g.modal || g.phase === 'escaped';
  hud(ob, 'hidden', hideOb);
  if (!hideOb) hud(ob, 'html', L.objectives(g).map((o) => `<li class="${o.done ? 'done' : ''}">${o.label}</li>`).join(''));
  const hintText = L.hint(g);
  // 触屏上把键盘提示换成按钮名，避免“按 E”却找不到键
  hud($('hint'), 'text', isTouchUI ? hintText.replaceAll('空格：写作业', '点「写作业」').replaceAll('E：查看', '点「查看」') : hintText);
  // 准星：附近有可交互物时变成 ◎ 并变色（否则玩家不知道“这个能按 E”）
  const near = L.nearbyInteractable(g);
  hud($('crosshair'), 'text', near ? '◎' : '·');
  hud($('crosshair'), 'className', near ? 'aim' : '');
  const c = g.check; const ban = $('checkBanner');
  if (g.modal?.type === 'caught') hud(ban, 'hidden', true); // 被抓弹层已说明原因，横幅不再叠“正看向你”
  else if (c && c.stage !== 'leave') {
    hud(ban, 'hidden', false);
    const seen = c.stage !== 'warn' && c.seen;
    hud(ban, 'className', seen ? 'seen' : (c.stage === 'warn' ? 'warn' : ''));
    const duty = L.SCHEDULE_DUTIES[L.scheduleDuty(g)]?.short || '规矩';
    const dfb2 = L.dutyFeedback(g);
    const why = dfb2.kind === 'facing' ? '·没面向电视' : dfb2.kind === 'posture' ? '·你在写作业' : dfb2.kind === 'far' ? '·人不在沙发' : '';
    hud(ban, 'text', c.stage === 'warn' ? `有人过来了——此刻该：${duty}` : seen ? (L.isScheduleCompliant(g) ? `正看你（合规矩·${duty}）` : `违规！该${duty}${why}`) : '视线在屋里扫');
    const expVal = seen && !L.isScheduleCompliant(g) ? '1' : '0';
    if (ban.dataset.exp !== expVal) { ban.dataset.exp = expVal; ban.style.setProperty('--exp', expVal); }
  } else if (c && c.stage === 'leave') { hud(ban, 'hidden', false); hud(ban, 'className', ''); hud(ban, 'text', '视线移开了'); }
  else hud(ban, 'hidden', true);
  // 字幕：逻辑消息优先；一次性提示（如“离学习点太远”）用本地 toast 覆盖几秒
  const toastText = toast && performance.now() < toast.until ? toast.text : '';
  const subText = toastText || (g.message ? g.message.text : '');
  hud($('subtitle'), 'hidden', !subText); hud($('subtitle'), 'text', subText);
  updateCoach();
  hud($('windowBar'), 'hidden', g.phase !== 'window');
  if (g.phase === 'window') {
    const w = `${(g.windowLeft / L.CONFIG.windowTime) * 100}%`;
    if ($('windowFill').dataset.w !== w) { $('windowFill').dataset.w = w; $('windowFill').style.width = w; }
    hud($('windowText'), 'text', `门外没人 · 约 ${Math.ceil(g.windowLeft)} 秒`);
    // 最后 3 秒各一声表针（低恐怖/静音自动跟随主音量）；只在整秒边界触发一次
    const sec = Math.ceil(g.windowLeft);
    if (sec !== windowTickAt && sec > 0 && sec <= 3) { windowTickAt = sec; sfx.countdown(sec === 1); }
  } else windowTickAt = -1;
  // 检查中、远离目标点：只提示方向，不传送；提示词跟着当下定时任务变（电视时段指沙发，不是书桌）
  // 第二章教学也用同一条方向条：屋里没灯，靠它把玩家引到沙发，而不是让他摸黑撞茶几
  const dh = $('dirHint'); const dd = L.nearestDutyDirection(g);
  const nearEnough = dd.duty === 'study' ? dd.d <= L.CONFIG.studyRadius : dd.d <= 0.9;
  const tvTutorial = g.phase === 'tutorial' && g.tutorialKind === 'tv';
  // 书桌教学也走同一条方向条：站在屋子中间不知道该去哪时，至少能看见书桌在哪个方向
  const studyTutFar = g.phase === 'tutorial' && !tvTutorial && dd.d > L.CONFIG.studyRadius;
  // 电视时段：人已经站对地方但姿势/朝向不对时，也要有反馈——这是之前完全没有的一条隐形规则
  const dfb = L.dutyFeedback(g);
  const tvFix = dfb.kind === 'facing' || dfb.kind === 'posture';
  const showDir = (!!c && c.stage !== 'leave' && !g.studying && !g.modal && !nearEnough) || (tvTutorial && !nearEnough) || studyTutFar || (tvFix && !g.modal);
  hud(dh, 'hidden', !showDir);
  if (showDir) {
    if (tvFix) {
      hud(dh, 'text', dfb.kind === 'posture'
        ? '看电视时段：起身（空格），别摆写作业的姿势'
        : `把视线转向电视（${dfb.side === 'right' ? '往右' : '往左'}转一点）`);
    } else {
      const deg = (dd.rel * 180) / Math.PI;
      const dir = Math.abs(deg) < 30 ? '前方' : Math.abs(deg) > 150 ? '身后' : deg < 0 ? '右边' : '左边';
      const what = dd.duty === 'tv' ? '沙发（坐下面向电视）' : dd.duty === 'escape' ? `${dd.point.name}${g.hasKeys ? '' : '（拿钥匙）'}` : dd.point.name;
      hud(dh, 'text', `该去：${what}（${dir}，${dd.d.toFixed(1)} 米）`);
    }
  }
  // 第二章出教学后的一次性节奏提示：教“别跑远”（不作弊、不解谜，只讲节奏）
  if (!coachTvStaged && g.tutorialKind === 'tv' && g.phase === 'explore1' && !g.modal) {
    coachTvStaged = true;
    showCoach('这段时间的正解是<b>坐在沙发上看电视</b>。检查随时会来——先做沙发附近的事，别跑到屋子另一头再翻纸。', 11000);
  }
  if (explore2At != null && !coachStallShown && g.phase === 'explore2' && !g.check && !g.modal
      && !g.clues.calib && g.t - explore2At > 75) {
    coachStallShown = true;
    showCoach('钟还没摆对。<b>把它拨到「该出门」的那一刻</b>，再回书桌/沙发等家长来看。翻过来看看背面，也许贴着东西。', 12000);
  }
  hud($('studyOverlay'), 'hidden', !g.studying);
  if (started && g.phase !== 'tutorial' && g.phase !== 'escaped' && !ambientOn) { ambientOn = true; sfx.setAmbient(true); }
  const wantTv = started && !g.modal && L.scheduleDuty(g) === 'tv';
  if (wantTv !== tvLayerOn) { tvLayerOn = wantTv; sfx.setTvLayer(wantTv); }
  const cc = g.check;
  if (cc && cc.seen && cc.stage !== 'warn' && !L.isScheduleCompliant(g) && performance.now() - lastBreath > 480) {
    lastBreath = performance.now();
    sfx.breathLoop(cc.eye); // 带方位与距离：从他站的那侧传来
  }
  // 家长真实走位的脚步：按位移触发（约 0.62 m 一步），比“定时播一串”更跟得上画面
  if (cc && cc.stage !== 'warn' && lastParentEye) {
    const moved = Math.hypot(cc.eye.x - lastParentEye.x, cc.eye.z - lastParentEye.z);
    parentStepAcc += moved;
    if (parentStepAcc > 0.62) { parentStepAcc = 0; sfx.stepAt(cc.eye.x, cc.eye.z); }
  }
  lastParentEye = cc && cc.stage !== 'warn' ? { x: cc.eye.x, z: cc.eye.z } : null;
}

// ------------------------------------------------------------------ 整局重开：表现层复位（YWQ-040）
// 逻辑层 restartDemo 已把 g 换成新局；这里清掉只存在于渲染/输入/音频里的旧局残留。监听器不重绑（全局只注册一次）。
function resetPresentation() {
  stopClockHold();
  stopAllAudio();
  applyVolume();                       // 被抓的 ducking 会让 master 停在 40%，重开必须复位
  ambientOn = false;
  tvLayerOn = false;
  keys.clear(); mouseDX = mouseDY = 0; rebinding = false; bestInfo = null;
  coachLine = null; coachUntil = 0; coachCheckShown = false; coachWindowShown = false; coachClockShown = false; coachTvStaged = false;
  lastAutoVideo = false;               // 上一局的录像按钮不带到下一局结算卡
  if (vid && vid.recording) stopVideo({ auto: true });   // 中途重开：录像要收尾，不能留下半段文件
  explore2At = null; coachStallShown = false;
  lastParentEye = null; parentStepAcc = 0; lastBreath = 0;
  mood = 0; warnP = 0;                 // 预警演出/压光不能从上一局带过来
  doorSlit.material.opacity = 0; doorSlit.scale.set(1, 1, 1);
  doorSpill.material.opacity = 0; doorSpill.scale.set(1, 1, 1); doorLight.intensity = 0;
  doorPivot.rotation.y = 0;            // 门不再从开着的角度慢慢关上
  lastClockDrawn = -1; drawClock();   // 台钟贴图回到 19:40
  last = performance.now();           // 下一帧 dt 不包含点击按钮前的时间
  updateHUD(); renderModal();
}

// 暂停/结算 → 回标题：新开一局干净状态（设置保留），标题页可换难度/看最快纪录。
// 不改逻辑层规则，等价于“关掉再打开”，但不用刷新页面。
function quitToTitle() {
  const st = g.settings;
  started = false;
  if (document.pointerLockElement) document.exitPointerLock();
  g = L.createGame(st);
  autopilot = null;
  bestInfo = null; ambientOn = false; tvLayerOn = false;
  stopClockHold(); stopAllAudio();
  $('title').hidden = false;
  document.body.classList.remove('playing', 'modal-open');
  resetPresentation();
  renderTitle();
}

// ------------------------------------------------------------------ 主循环
let autopilot = null; // 测试/录屏用脚本输入（不改逻辑）
let last = performance.now();
const vignette = $('vignette');
let mood = 0;      // V5：检查扫视期间的压光/暗角程度（0–1，0.3 s 过渡）
let warnP = 0;     // 预警期压力梯度（0–1）：脚步→门口的过程，驱动门缝光/暗角/镜头微颤
let fovCur = 70;   // V6：被看见过半时 70 → 66 的轻收缩
let fpsV = 0, fpsN = 0, fpsT = 0; // 每秒一次的帧率（写进试玩记录的采样里，方便看内测设备掉帧）
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  fpsN++;
  if (now - fpsT > 1000) { fpsV = Math.round((fpsN * 1000) / (now - fpsT)); fpsN = 0; fpsT = now; updateRecPill(); }
  // 学习点光圈淡入淡出（教学 / 检查预警与扫视），0.3 s 左右到位
  const ringsOn = g.phase === 'tutorial' || (!!g.check && g.check.stage !== 'leave');
  for (const r of studyRings) {
    const target = ringsOn ? 0.35 : 0;
    r.material.opacity += (target - r.material.opacity) * Math.min(1, dt * 5);
    r.visible = r.material.opacity > 0.01;
  }
  if (started) {
    let mx = 0, mz = 0; for (const k of keys) { mx += MOVE[k][0]; mz += MOVE[k][1]; }
    mx += touchMove.x; mz += -touchMove.y;   // 摇杆向上拖 = 前进
    let input = { mx, mz, dyaw: -mouseDX * 0.0025 * g.settings.sens - touchYaw, dpitch: -mouseDY * 0.0025 * g.settings.sens - touchPitch };
    mouseDX = mouseDY = 0; touchYaw = touchPitch = 0;
    if (autopilot) input = autopilot(dt, g) || {};
    L.step(g, dt, input); consumeEvents(); updateHUD();
    pt.sync(g); pt.sample(g, fpsV ? { fps: fpsV } : undefined);
  }
  // V5：检查进入扫视/确认 → 环境光降 15%、暗角加深、CRT 闪烁暂停；低动态/低恐怖下关闭
  const cc = g.check;
  const moodOn = !!cc && cc.stage !== 'warn' && !g.settings.lowMotion && !g.settings.lowHorror;
  mood += ((moodOn ? 1 : 0) - mood) * Math.min(1, dt / 0.3);
  // 预警期的“压迫感渐强”：warnP 从 0 → 1 对应家长从楼道走到门口的过程。
  // 之前预警阶段完全没有任何画面变化（只有门缝一条光在闪），玩家容易在“听见脚步”之后
  // 以为没事发生、继续站在原地。这里让画面在**规则生效之前**先给出连续的压力梯度，
  // 不改任何判定、不提示答案；低动态/低恐怖下整段关闭。
  const warnStaged = !!cc && cc.stage === 'warn' && !g.settings.lowMotion && !g.settings.lowHorror;
  const warnDur = cc && cc.stage === 'warn' ? Math.max(0.001, L.checkWarnDur(g, cc.script || cc.id)) : 1;
  const warnRaw = warnStaged ? Math.max(0, Math.min(1, cc.t / warnDur)) : 0;
  // 缓入：前 35% 几乎无感（脚步声才是主线索），之后快速上升，最后一刻最紧
  warnP += ((warnRaw <= 0.35 ? 0 : (warnRaw - 0.35) / 0.65) - warnP) * Math.min(1, dt * 6);
  hemi.intensity = HEMI_BASE * (1 - 0.2 * mood - 0.07 * warnP);
  roomLight.intensity = 1.2 * (1 - 0.14 * mood - 0.05 * warnP);
  if (vignette) vignette.style.opacity = (0.26 + 0.5 * mood + 0.12 * warnP).toFixed(3);
  // V6：暴露进度过半 → 70 → 66 的极轻 FOV 收缩（低动态关闭）；预警期再额外收 1.6°（压迫感，不改视野判定）
  const expRatio = cc && cc.exposure > 0 ? Math.min(1, cc.exposure / L.exposureLimit(g, cc)) : 0;
  const fovTarget = ((!g.settings.lowMotion && expRatio > 0.5) ? 66 : 70) - (g.settings.lowMotion ? 0 : 1.6 * warnP);
  fovCur += (fovTarget - fovCur) * Math.min(1, dt * 6);
  if (Math.abs(camera.fov - fovCur) > 0.01) { camera.fov = fovCur; camera.updateProjectionMatrix(); }
  // 相机
  const p = g.player; const sp = g.studying ? L.STUDY_POINTS.find((s) => s.id === g.studyPoint) : null;
  let cx = p.x, cy = EYE, cz = p.z, yaw = p.yaw, pitch = p.pitch;
  if (sp) { const k = g.studyAnim; const tx = sp.seat ? sp.seat.x - 0.15 : sp.x; const tz = sp.seat ? sp.seat.z : sp.z;
    cx = p.x + (tx - p.x) * k; cz = p.z + (tz - p.z) * k; cy = EYE - 0.25 * k;
    // 看向练习册，但保留门口在视野边缘：朝向在“练习册方向”与“门口方向”之间偏向练习册
    const lb = Math.atan2(-(sp.look.x - tx), -(sp.look.z - tz)); const ld = Math.atan2(-(1.65 - tx), -(3.0 - tz));
    const ly = lb + Math.atan2(Math.sin(ld - lb), Math.cos(ld - lb)) * 0.3;
    let dyw = Math.atan2(Math.sin(ly - yaw), Math.cos(ly - yaw)); yaw += dyw * k; pitch += (-0.42 - pitch) * k; }
  if (g.crouchAnim > 0) cy += (EYE - 0.85) * -g.crouchAnim; // 蹲下：视高 1.35 → 0.85
  if (!g.settings.lowMotion && !g.studying && !g.modal && started) cy += Math.sin(g.t * 9) * 0.012;
  // 预警期镜头微颤：1–2 cm 的低频抖动，只有 warnP 起来之后才有（低动态/低恐怖下恒为 0）。
  // 这不是提示，是生理反馈：让「听到脚步」和「画面开始绷紧」同时发生。
  if (warnP > 0.001) {
    const tr = warnP * 0.016;
    cx += Math.sin(now / 97) * tr; cy += Math.sin(now / 131) * tr * 0.7; cz += Math.cos(now / 113) * tr;
    yaw += Math.sin(now / 151) * warnP * 0.002;
  }
  camera.position.set(cx, cy, cz); camera.rotation.set(pitch, yaw, 0);
  // 门、家长、异常
  doorPivot.rotation.y += ((g.doorOpen ? -1.45 : 0) - doorPivot.rotation.y) * Math.min(1, dt * 6);
  const c = g.check; parent.visible = !!(c && c.stage !== 'warn');
  if (parent.visible) { parent.position.set(c.eye.x, 0, c.eye.z); gazePivot.rotation.y = -c.gaze; head.rotation.y = -c.gaze;
    gazeCone.visible = !!g.settings.showCone; // V2：默认只留地面投影
    coneMat.opacity = c.seen && !g.studying ? 0.4 : 0.26;
    coneLineMat.opacity = c.seen && !g.studying ? 0.7 : 0.5;
    gazeDecal.material.opacity = c.seen && !g.studying ? 0.9 : 0.72; }
  // 预警阶段的门缝光：门关着，只有脚边一道暖光在动。
  // 现在它随 warnP 变宽变亮，并把门口地面照亮一小片——脚步还没停，屋子已经“有人”了。
  const warnOn = !!c && c.stage === 'warn' && !g.settings.lowMotion;
  const slitBase = warnOn ? 0.34 + 0.42 * warnP : 0;
  doorSlit.material.opacity = warnOn ? slitBase + Math.sin(now / 240) * 0.08 : 0;
  doorSlit.scale.set(1 + 0.5 * warnP, 1, 1);
  doorSpill.material.opacity = warnOn ? 0.10 + 0.34 * warnP : 0;
  doorSpill.scale.set(1 + 0.35 * warnP, 1 + 1.1 * warnP, 1);   // 光斑朝屋里“铺开”
  doorSpill.position.z = 2.42 - 0.55 * warnP;
  doorLight.intensity = warnOn ? 0.12 + 0.85 * warnP : 0;
  ghostCal.visible = ghostCal2.visible = g.anomalies.timeLayer;
  roomLight.color.setHex(g.anomalies.timeLayer ? 0xf4e3c4 : 0xfff1d6);
  const s = g.anomalies.scale ? 1.22 : 1;
  coffeeGroup.scale.setScalar(s); tvGroup.scale.setScalar(s); // 地面为 pivot：不悬浮、不入地
  deskGroup.scale.set(1, s, 1); // 桌面视觉抬高（碰撞/学习点不变）
  clockMesh.position.y = 0.84 + 0.765 * (s - 1); // 台钟随桌面抬高，异常不得遮住关键道具
  fakeCeil.visible = g.anomalies.ceiling; fakeCeil.position.set(0, g.anomalies.ceiling ? 2.25 : H, 0);
  const flick = 1 - mood; // V5：检查扫视期间 CRT 停止闪烁
  // 预警期 CRT 从“正常轻微闪烁”变成“接触不良式的急促抖动”：幅度变大、频率变快，扫视时归零
  const nerv = warnP * flick;
  scr.material.emissiveIntensity = 0.7 + Math.sin(now / 90) * 0.1 * flick
    + (nerv > 0.01 ? Math.sin(now / 23) * 0.11 * nerv + Math.sin(now / 7.3) * 0.05 * nerv : 0);
  crtLight.intensity = 0.8 + Math.sin(now / 70) * 0.12 * flick + (nerv > 0.01 ? Math.sin(now / 31) * 0.10 * nerv : 0);
  // 环境细节：浮尘随“窗光”出现（回到室内才亮），扫视时压暗；低动态直接关掉
  const indoors = started && g.phase !== 'escaped';
  const dustTarget = indoors && !g.settings.lowMotion ? 0.5 * (1 - 0.55 * mood) : 0;
  dustMat.opacity += (dustTarget - dustMat.opacity) * Math.min(1, dt * 1.6);
  dust.visible = dustMat.opacity > 0.01;
  if (dust.visible) { // 整组漂移：每帧只改 2 个标量，不遍历顶点
    dust.position.set(Math.sin(now / 5200) * 0.22, Math.sin(now / 7100) * 0.06, Math.cos(now / 6100) * 0.12);
    dust.rotation.y = Math.sin(now / 15000) * 0.05;
  }
  // CRT 扫描线滚动 + 电视时段屏光（只在真的“该看电视”时亮，不暗示答案：玩家站着也能看到亮）
  scanTex.offset.y = (now / 9000) % 1;
  const tvWanted = started && L.scheduleDuty(g) === 'tv' && !g.settings.lowMotion;
  tvGlow.intensity += ((tvWanted ? 0.35 * flick : 0) - tvGlow.intensity) * Math.min(1, dt * 2.5);
  // 台灯呼吸：极轻，只在非低动态下 ±4%
  if (lamp) lamp.intensity = 0.6 * (g.settings.lowMotion ? 1 : 0.96 + Math.sin(now / 4300) * 0.04);
  drawClock();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize() { const w = innerWidth, h = innerHeight;
  if (STYLE_A && STYLE_TIER.hd && !STYLE_A_LINES) { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(w, h, false); }
  else if (STYLE_A) { renderer.setPixelRatio(1); renderer.setSize(Math.round(STYLE_A_LINES * w / h), STYLE_A_LINES, false); PSX.snap.value.set(Math.round(STYLE_A_LINES * w / h) / STYLE_TIER.snapDiv, STYLE_A_LINES / STYLE_TIER.snapDiv); } else renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
// ------------------------------------------------------------------ 高清档接触阴影（静态 AO 贴片）
// 低模盒体场景里补「家具 / 人物落地」：纯静态面片，不参与碰撞、不进光照，默认 180 档完全不创建。
if (HD.hd) {
  // 顶点 alpha 画衰减：暗部从「物体外沿」开始向外散开（核在物体下面，看不见）
  const blobGeo = (w, d, pad, peak = 0.95, seg = 24) => {
    const g = new THREE.PlaneGeometry(w + pad * 2, d + pad * 2, seg, seg);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const dx = Math.max(0, Math.abs(p.getX(i)) - w / 2) / pad;
      const dz = Math.max(0, Math.abs(p.getY(i)) - d / 2) / pad;
      const t = Math.min(1, Math.hypot(dx, dz));
      col[i * 4] = 0; col[i * 4 + 1] = 0; col[i * 4 + 2] = 0;
      const s = 1 - t; col[i * 4 + 3] = s * s * (1 + 2 * t) * peak;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    return g;
  };
  const blob = (x, z, w, d, pad, opacity, peak = 0.95, parent = scene) => {
    const m = new THREE.Mesh(blobGeo(w, d, pad, peak), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.position.set(x - (parent.userData.cx || 0), 0.012, z - (parent.userData.cz || 0)); m.renderOrder = 1; parent.add(m); return m;
  };
  // 家具落地影：按碰撞盒足迹 + 外扩，透明度按体积感分档（桌椅腿多 → 轻、柜体 → 实）
  // 两层：贴地暗边（窄、实）+ 外散柔光（宽、淡），合起来才像真阴影
  const lay = (cx, cz, w, d, pad, op, parent = scene) => {
    blob(cx, cz, w, d, 0.15, Math.min(0.92, op * 1.05), 0.9, parent);
    blob(cx, cz, w, d, pad, op * 0.6, 0.75, parent);
  };
  for (const [id, pad, op] of [['F1_tv', 0.62, 0.70], ['F2_corner', 0.46, 0.50], ['F3_chairL', 0.40, 0.50], ['F3_chairR', 0.40, 0.50],
    ['F3_table', 0.52, 0.42], ['F5_coffee', 0.50, 0.66], ['F4_sofa', 0.60, 0.80], ['F7_sidecab', 0.46, 0.72], ['N1_desk', 0.60, 0.40]]) {
    const c = C[id]; if (!c) continue;
    // 会随异常缩放的家具：影子挂进同一组，跟着一起放大，避免“家具变大、影子还是原尺寸”
    const parent = id === 'F1_tv' ? tvGroup : id === 'F5_coffee' ? coffeeGroup : scene;
    lay((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2, c.maxX - c.minX, c.maxZ - c.minZ, pad, op, parent);
  }
  // 房间四周落地暗部：一整块面片，最暗处埋进墙体内，可见区域只剩柔和渐变（不在墙脚留下硬边）
  {
    const peak = 0.58, width = 0.85, bury = 0.20;
    const w = (R.maxX - R.minX) + bury * 2, d = (R.maxZ - R.minZ) + bury * 2;
    const g = new THREE.PlaneGeometry(w, d, 56, 56);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const dw = Math.min(w / 2 - bury - Math.abs(p.getX(i)), d / 2 - bury - Math.abs(p.getY(i))); // 到最近墙面的距离
      const t = Math.min(1, Math.max(0, dw / width));
      col[i * 4] = 0; col[i * 4 + 1] = 0; col[i * 4 + 2] = 0;
      col[i * 4 + 3] = Math.pow(1 - t, 1.9) * peak;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.rotation.x = -Math.PI / 2; m.position.set((R.minX + R.maxX) / 2, 0.010, (R.minZ + R.maxZ) / 2);
    m.renderOrder = 1; scene.add(m);
  }
  lay(-1.75, 1.6, 0.42, 0.42, 0.42, 0.44);   // 书桌配椅
  lay(2.42, 2.8, 0.30, 0.30, 0.40, 0.46);    // 衣帽架三脚
  // 家长轮廓的接地影（跟随角色，圆形所以不随朝向变化）
  const pBlob = new THREE.Mesh(blobGeo(0.30, 0.30, 0.34, 0.9), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false }));
  pBlob.rotation.x = -Math.PI / 2; pBlob.position.y = 0.013; pBlob.renderOrder = 1; parent.add(pBlob);
}
// aoMap 在 three r152+ 走 uv1 通道；房间几何只有 uv，高清档补一份 uv1 让 ARM 的 AO 生效
if (HD.hd) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some((mm) => mm && mm.aoMap)) return;
    const g = o.geometry;
    if (g && g.attributes.uv && !g.attributes.uv1) g.setAttribute('uv1', g.attributes.uv.clone());
  });
}

initTouchUI();
addEventListener('resize', resize); resize();
requestAnimationFrame(frame);

fetch('version.txt').then((r) => (r.ok ? r.text() : 'dev')).catch(() => 'dev').then((v) => { pt.setBuild(v.trim()); $('build').textContent = `一屋囚 Demo · build ${v.trim()} · ${STYLE_A ? 'STYLE-A 小样 · ' + STYLE_TIER.name : '灰盒'}`; });
document.body.classList.toggle('lowmotion', g.settings.lowMotion);
function start() { started = true; $('title').hidden = true; document.body.classList.add('playing'); audioInit(); if (!autopilot) lockPointer(); }
$('startBtn').addEventListener('click', start);
// 内测记录器：右下角一颗小按钮；F9 录像、F8 导出记录（不抢 Esc / 不改玩法）
$('recBtn').addEventListener('click', (e) => { e.preventDefault(); audioInit(); toggleVideo(); });
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'F9') { e.preventDefault(); if (started) toggleVideo(); }
  else if (e.code === 'F8') { e.preventDefault(); if (started) exportRecord(); }
});

// ?evidence=1：实机证据 HUD（只读采集，不改任何游戏状态；默认关闭时不创建任何监听）
//   记录真实键鼠事件（含 isTrusted / movementX 累计）、指针锁与页面可见性变化、每 0.25 s 计时采样；F10 导出 JSON。
if (params.has('evidence')) {
  const ev = { schema: 'ywq-evidence-1', ua: navigator.userAgent, dpr: devicePixelRatio, size: [innerWidth, innerHeight], timeOrigin: +performance.timeOrigin.toFixed(0), style: STYLE_TIER ? STYLE_TIER.id : null, res: RES || null, draw: [renderer.domElement.width, renderer.domElement.height], frames: [], events: [] };
  const cap = (a, n) => { if (a.length > n) a.splice(0, a.length - n); };
  const rec = (o) => { ev.events.push(o); cap(ev.events, 60000); };
  const W = () => +performance.now().toFixed(0);
  addEventListener('keydown', (e) => rec({ w: W(), k: 'keydown', c: e.code, tr: e.isTrusted, rep: !!e.repeat }), true);
  addEventListener('keyup', (e) => rec({ w: W(), k: 'keyup', c: e.code, tr: e.isTrusted }), true);
  addEventListener('mousedown', (e) => rec({ w: W(), k: 'mousedown', b: e.button, tr: e.isTrusted }), true);
  addEventListener('mouseup', (e) => rec({ w: W(), k: 'mouseup', b: e.button, tr: e.isTrusted }), true);
  addEventListener('mousemove', (e) => { const l = ev.events[ev.events.length - 1];
    if (l && l.k === 'mousemove' && e.isTrusted === l.tr && performance.now() - l.w < 120) { l.n++; l.dx += e.movementX || 0; l.dy += e.movementY || 0; l.w2 = W(); }
    else rec({ w: W(), k: 'mousemove', dx: e.movementX || 0, dy: e.movementY || 0, n: 1, tr: e.isTrusted }); }, true);
  addEventListener('wheel', (e) => rec({ w: W(), k: 'wheel', dy: +e.deltaY.toFixed(1), tr: e.isTrusted }), { capture: true, passive: true });
  for (const k of ['pointerlockchange', 'pointerlockerror', 'visibilitychange', 'blur', 'focus', 'pagehide', 'pageshow'])
    addEventListener(k, () => rec({ w: W(), k, lock: !!document.pointerLockElement, vis: document.visibilityState }), true);
  setInterval(() => { const c = g.check; ev.frames.push({ w: W(), t: +g.t.toFixed(3), id: c ? c.id : null, st: c ? c.stage : null, ct: c ? +c.t.toFixed(3) : null, exp: c ? +c.exposure.toFixed(3) : null,
    wl: g.windowLeft == null ? null : +g.windowLeft.toFixed(3), modal: g.modal ? g.modal.type : null, phase: g.phase, pos: [+g.player.x.toFixed(2), +g.player.z.toFixed(2)], yaw: +g.player.yaw.toFixed(3),
    keys: [...keys].join('+') || null, lock: !!document.pointerLockElement, vis: document.visibilityState });
    cap(ev.frames, 40000); }, 250);
  let nf = 0, fps = 0; requestAnimationFrame(function tick() { nf++; requestAnimationFrame(tick); }); setInterval(() => { fps = nf; nf = 0; }, 1000);
  const hud = document.createElement('div'); hud.id = 'evhud';
  hud.style.cssText = 'position:fixed;left:8px;bottom:30px;z-index:99;font:11px/1.45 ui-monospace,Menlo,monospace;color:#e8f0e8;background:rgba(10,12,10,.72);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre;letter-spacing:.2px';
  document.body.appendChild(hud);
  setInterval(() => { const c = g.check, f = ev.frames[ev.frames.length - 1];
    hud.textContent = `REC ${ev.events.length}e/${ev.frames.length}f  F10=导出\n t ${g.t.toFixed(2)}  ${g.phase}${g.modal ? ' [' + g.modal.type + ']' : ''}\n${c ? ` check ${c.id} ${c.stage} t=${c.t.toFixed(2)} exp=${c.exposure.toFixed(2)}` : ' check —'}${g.windowLeft > 0 ? ` wl=${g.windowLeft.toFixed(2)}` : ''}\n pos ${g.player.x.toFixed(2)},${g.player.z.toFixed(2)} yaw ${g.player.yaw.toFixed(2)} ${f && f.keys ? f.keys : ''}\n ${ev.draw.join('x')}  ${fps} fps`; }, 200);
  window.__evidence = { get data() { return ev; },
    dump() { const s = JSON.stringify(ev); const b = new Blob([s], { type: 'application/json' }); const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `ywq-evidence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click();
      try { navigator.clipboard.writeText(s); } catch (e) {} return { events: ev.events.length, frames: ev.frames.length, bytes: s.length }; } };
  addEventListener('keydown', (e) => { if (e.code === 'F10') { e.preventDefault(); window.__evidence.dump(); } });
}
// 测试钩子：自动化试玩/录屏驱动（只提供输入，不绕过逻辑）
window.__ywq = {
  get g() { return g; }, L, start, renderModal,
  get sfx() { return sfx; }, // 音频自检（tools/audio-check.mjs）用；不改游戏行为
  get pt() { return pt; },   // 试玩记录（tools/playtest-check.mjs 验证导出结构；只读）
  get vid() { return vid; }, // 录像器状态（只读）
  get audio() { return { ac, master }; }, // 音频总线（录像/诊断用；只读引用）
  startVideo, stopVideo, exportRecord, toggleVideo,
  setAutopilot(fn) { if (DEVTOOLS) autopilot = fn; },
  newGame(settings) { if (DEVTOOLS) { g = L.createGame(settings || {}); renderModal(); } },
  // 只读诊断（录屏/回归用）：按键集合、存活音源数、是否正在改键
  debug() { return { audio: ac ? { state: ac.state, t: +ac.currentTime.toFixed(2), rate: ac.sampleRate } : null, keys: [...keys], lock: !!document.pointerLockElement, started, pos: [+g.player.x.toFixed(3), +g.player.z.toFixed(3), +g.player.yaw.toFixed(3)], ambientOn, rebinding, door: +doorPivot.rotation.y.toFixed(3), clockDrawn: lastClockDrawn, style: STYLE_TIER && STYLE_TIER.id, tris: renderer.info.render.triangles, drawSize: [renderer.domElement.width, renderer.domElement.height], fov: +camera.fov.toFixed(2) }; },
  // 演出层只读诊断（视觉证据用）：预警梯度、压光、门缝/地面光斑、浮尘、CRT
  stage() { return { phase: g.phase, check: g.check ? { id: g.check.id, stage: g.check.stage, t: +g.check.t.toFixed(2), seen: !!g.check.seen } : null,
    warnP: +warnP.toFixed(3), mood: +mood.toFixed(3),
    vignette: +(document.getElementById('vignette')?.style.opacity || 0),
    hemi: +hemi.intensity.toFixed(3), room: +roomLight.intensity.toFixed(3),
    doorSlit: +doorSlit.material.opacity.toFixed(3), doorSlitW: +doorSlit.scale.x.toFixed(3),
    doorSpill: +doorSpill.material.opacity.toFixed(3), doorSpillL: +doorSpill.scale.y.toFixed(3), doorLight: +doorLight.intensity.toFixed(3),
    dust: +dustMat.opacity.toFixed(3), crt: +scr.material.emissiveIntensity.toFixed(3), tvGlow: +tvGlow.intensity.toFixed(3),
    fov: +camera.fov.toFixed(2), camZ: +camera.position.z.toFixed(4) }; },
};
if (params.has('autostart')) start();
