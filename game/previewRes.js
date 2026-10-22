// 清晰度预览参数（?res=）的纯函数解析——从 main.js 抽出以便单元测试，行为与内联版本逐字一致。
// 约定：没有 res（或 res 为空串）时返回 {}，调用方展开后与原档参数完全相同（默认画面零变化）。
export function resolvePreview(tier, resParam) {
  if (!tier || !resParam) return {};
  const n = resParam === 'full' ? 0 : Math.max(120, Math.min(2160, Number(resParam) || 540));
  return { lines: n, hd: true, colorLevels: 255, ditherAmp: 0, tileTex: 256, texLevels: 0, maxSeg: 0, crackFill: undefined };
}
