import type { GraphLayoutResult } from "./graph-layout";
import { visualTextUnits } from "./query-engine";

export interface GraphViewTransform {
  x: number;
  y: number;
  scale: number;
}

export function computeFittedTransform(
  layout: GraphLayoutResult,
  width: number,
  height: number,
  focusIds: ReadonlySet<string> | null,
): GraphViewTransform {
  const focused = focusIds && focusIds.size > 0 ? new Set(focusIds) : null;
  for (const group of layout.groups) {
    if (focused?.has(group.node.id)) {
      for (const member of group.memberIds) focused.add(member);
    }
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const include = (x: number, y: number, w = 0, h = 0) => {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + w);
    bottom = Math.max(bottom, y + h);
  };

  for (const node of layout.nodes) {
    if (!focused || focused.has(node.node.id)) {
      include(node.x, node.y, node.width, node.height);
    }
  }
  for (const group of layout.groups) {
    if (!focused || focused.has(group.node.id)) {
      include(group.x, group.y, group.width, group.height);
    }
  }
  if (!Number.isFinite(left)) {
    return focused
      ? computeFittedTransform(layout, width, height, null)
      : { x: width / 2, y: height / 2, scale: 1 };
  }

  for (const { edge, labelX, labelY, routePoints } of layout.edges) {
    if (focused && (!focused.has(edge.from) || !focused.has(edge.to))) continue;
    for (const { x, y } of routePoints) include(x, y);
    if (edge.label) {
      const labelWidth = Math.min(188, Math.max(40, visualTextUnits(edge.label) * 6.7 + 18));
      include(labelX - labelWidth / 2, labelY - 10, labelWidth, 20);
    }
  }

  const paddingX = Math.min(width * 0.08, width < 480 ? 24 : 52);
  const paddingY = Math.min(height * 0.1, height < 340 ? 28 : 48);
  const scale = Math.min(
    focused ? 1.15 : 1.08,
    (width - 2 * paddingX) / Math.max(1, right - left),
    (height - 2 * paddingY) / Math.max(1, bottom - top),
  );

  return {
    x: width / 2 - ((left + right) / 2) * scale,
    y: height / 2 - ((top + bottom) / 2) * scale,
    scale,
  };
}

export function zoomAroundPoint(
  current: GraphViewTransform,
  factor: number,
  x: number,
  y: number,
): GraphViewTransform {
  const scale = Math.max(Math.min(current.scale, 0.02), Math.min(2.4, current.scale * factor));
  if (scale === current.scale) return current;

  const ratio = scale / current.scale;
  return {
    x: x - (x - current.x) * ratio,
    y: y - (y - current.y) * ratio,
    scale,
  };
}
