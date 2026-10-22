// 触屏输入换算（纯函数，便于单测；不碰规则/碰撞/视野）
export const STICK_RADIUS = 52;   // 摇杆可用半径（px，与 #stick 尺寸对应）
export const STICK_DEAD = 0.12;   // 死区（归一化后），避免手指微抖就走
export const TOUCH_LOOK = 0.0045; // 每 px 转多少弧度（桌面鼠标为 0.0025）

// 把“相对摇杆中心的位移”换成归一化方向 + 力度：往上拖是前进（屏幕 y 向下为正，故调用方取 -y）
export function stickVector(dx, dy, radius = STICK_RADIUS) {
  const r = Math.hypot(dx, dy);
  if (!r || r < 1) return { x: 0, y: 0, mag: 0 };
  const mag = Math.min(1, r / radius);
  if (mag < STICK_DEAD) return { x: 0, y: 0, mag: 0 };
  return { x: (dx / r) * mag, y: (dy / r) * mag, mag };
}

// 触屏拖动的像素位移 → 弧度；sens 沿用设置里的灵敏度倍率
export function touchLookDelta(px, sens = 1) {
  return px * TOUCH_LOOK * sens;
}
