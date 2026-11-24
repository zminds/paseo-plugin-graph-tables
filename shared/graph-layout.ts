/**
 * Layered DAG + SmoothStep orthogonal router and group container layout engine,
 * replicating Beluga's (https://github.com/beluga-labs/beluga) React Flow graph model.
 */
import { visualTextUnits } from "./query-engine";
import type { GraphEdge, GraphNode, GraphSpec, GraphStep } from "./view-schema";

export type GraphLayoutInputNode = Omit<GraphNode, "type"> & {
  type?: GraphNode["type"];
};

export type GraphLayoutInputEdge = Omit<GraphEdge, "kind"> & {
  kind?: GraphEdge["kind"];
};

export interface GraphLayoutInput {
  title?: string;
  summary?: string;
  direction?: GraphSpec["direction"];
  nodes?: readonly GraphLayoutInputNode[];
  edges?: readonly GraphLayoutInputEdge[];
  steps?: readonly GraphStep[];
}

export interface PositionedNode {
  node: GraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface PositionedGroup {
  node: GraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  memberIds: string[];
}

export interface PositionedEdge {
  edge: GraphEdge;
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  svgPath: string;
  routePoints: readonly Point[];
  labelX: number;
  labelY: number;
  isBackEdge: boolean;
  isBidirectional: boolean;
}

export interface GraphLayoutResult {
  width: number;
  height: number;
  direction: "right" | "down" | "left" | "up";
  nodes: PositionedNode[];
  groups: PositionedGroup[];
  edges: PositionedEdge[];
}

export type NodeOffsetMap = Readonly<Record<string, { dx: number; dy: number }>>;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const LAYER_GAP_H = 104;
const SIBLING_GAP_H = 44;
const LAYER_GAP_V = 96;
const SIBLING_GAP_V = 56;
const GROUP_PAD_X = 24;
const GROUP_PAD_TOP = 46;
const GROUP_PAD_BOTTOM = 24;
const OUTER_PAD = 48;
const CORNER_RADIUS = 10;

function isPillNodeType(type: GraphNode["type"]): boolean {
  return type === "actor" || type === "client" || type === "person";
}

function estimateNodeSize(node: GraphNode): { width: number; height: number } {
  const labelUnits = visualTextUnits(node.label || node.id);
  const subUnits = node.sublabel ? visualTextUnits(node.sublabel) : 0;
  const valUnits = node.value !== undefined ? visualTextUnits(String(node.value)) : 0;
  const fieldUnits =
    node.fields?.reduce((max, f) => Math.max(max, visualTextUnits(`${f.name} ${f.type}`)), 0) ?? 0;
  const itemUnits = node.items?.reduce((max, item) => Math.max(max, visualTextUnits(item.label)), 0) ?? 0;

  const isCompactPill =
    isPillNodeType(node.type) &&
    !node.fields?.length &&
    !node.items?.length &&
    !node.value &&
    !node.image;

  const maxUnits = Math.max(labelUnits * 1.08, subUnits * 0.94, valUnits, fieldUnits * 0.9, itemUnits * 0.94);

  const width = isCompactPill
    ? Math.max(166, Math.min(310, Math.ceil(maxUnits * 7.8) + 74))
    : Math.max(176, Math.min(320, Math.ceil(maxUnits * 8.1) + 78));

  let height = isCompactPill ? (node.sublabel ? 56 : 46) : node.sublabel ? 66 : 52;
  if (node.value) height += 22;
  if (node.image) height += 54;
  if (node.fields?.length) height += Math.min(node.fields.length, 6) * 18 + 14;
  if (node.items?.length) height += Math.min(node.items.length, 6) * 18 + 14;

  return { width, height };
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect, pad: number): boolean {
  const rx1 = r.x - pad;
  const ry1 = r.y - pad;
  const rx2 = r.x + r.width + pad;
  const ry2 = r.y + r.height + pad;

  if (Math.abs(a.x - b.x) < 0.5) {
    // Vertical segment
    const x = a.x;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return x > rx1 && x < rx2 && maxY > ry1 && minY < ry2;
  }
  if (Math.abs(a.y - b.y) < 0.5) {
    // Horizontal segment
    const y = a.y;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return y > ry1 && y < ry2 && maxX > rx1 && minX < rx2;
  }
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > rx1 && minX < rx2 && maxY > ry1 && minY < ry2;
}

function polylineIntersectsAny(points: Point[], obstacles: Rect[], pad: number): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    for (const obs of obstacles) {
      if (segmentIntersectsRect(points[i]!, points[i + 1]!, obs, pad)) {
        return true;
      }
    }
  }
  return false;
}

function simplifyPolyline(points: Point[]): Point[] {
  const deduped: Point[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) {
      deduped.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
    }
  }
  if (deduped.length <= 2) return deduped;

  const clean: Point[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = clean[clean.length - 1]!;
    const curr = deduped[i]!;
    const next = deduped[i + 1]!;
    const collinearX = Math.abs(prev.x - curr.x) < 0.5 && Math.abs(curr.x - next.x) < 0.5;
    const collinearY = Math.abs(prev.y - curr.y) < 0.5 && Math.abs(curr.y - next.y) < 0.5;
    if (!collinearX && !collinearY) {
      clean.push(curr);
    }
  }
  clean.push(deduped[deduped.length - 1]!);
  return clean;
}

function polylineToSmoothStepPath(rawPoints: Point[], radius = CORNER_RADIUS): string {
  const pts = simplifyPolyline(rawPoints);
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  if (pts.length === 2) {
    return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`;
  }

  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const curr = pts[i]!;
    const next = pts[i + 1]!;

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2);

    const r = Math.min(radius, len1 / 2, len2 / 2);
    if (r < 1) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const ux1 = dx1 / len1;
    const uy1 = dy1 / len1;
    const ux2 = dx2 / len2;
    const uy2 = dy2 / len2;

    const pEnterX = Math.round((curr.x - ux1 * r) * 10) / 10;
    const pEnterY = Math.round((curr.y - uy1 * r) * 10) / 10;
    const pExitX = Math.round((curr.x + ux2 * r) * 10) / 10;
    const pExitY = Math.round((curr.y + uy2 * r) * 10) / 10;

    d += ` L ${pEnterX} ${pEnterY} Q ${curr.x} ${curr.y} ${pExitX} ${pExitY}`;
  }

  const last = pts[pts.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function pickLabelAnchor(rawPoints: Point[], edgeOrderShift = 0): Point {
  const pts = simplifyPolyline(rawPoints);
  if (pts.length <= 1) return pts[0] ?? { x: 0, y: 0 };

  if (pts.length === 4) {
    // Classic 3-segment SmoothStep: place on the middle bar if long enough, else longest segment
    const midA = pts[1]!;
    const midB = pts[2]!;
    const midLen = Math.hypot(midB.x - midA.x, midB.y - midA.y);
    const seg0Len = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
    const seg2Len = Math.hypot(pts[3]!.x - pts[2]!.x, pts[3]!.y - pts[2]!.y);
    if (midLen >= Math.max(44, Math.max(seg0Len, seg2Len) * 0.45)) {
      const t = 0.5 + edgeOrderShift * 0.14;
      return {
        x: midA.x + (midB.x - midA.x) * t,
        y: midA.y + (midB.y - midA.y) * t,
      };
    }
  }

  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    // Slight bonus to outer bypass bar or middle segments over tiny connector stubs
    const bonus = i > 0 && i < pts.length - 2 ? 1.25 : 1;
    const score = len * bonus;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const a = pts[bestIdx]!;
  const b = pts[bestIdx + 1]!;
  const t = Math.max(0.25, Math.min(0.75, 0.5 + edgeOrderShift * 0.14));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function groupFrame(group: GraphNode, children: readonly Rect[]): Rect {
  if (children.length === 0) {
    return { x: 0, y: 0, width: Math.max(180, visualTextUnits(group.label) * 8 + 64), height: 92 };
  }

  const left = Math.min(...children.map((child) => child.x));
  const top = Math.min(...children.map((child) => child.y));
  const right = Math.max(...children.map((child) => child.x + child.width));
  const bottom = Math.max(...children.map((child) => child.y + child.height));
  const contentWidth = right - left + GROUP_PAD_X * 2;
  const width = Math.max(contentWidth, Math.ceil(visualTextUnits(group.label) * 7.8) + 64);
  return {
    x: left - GROUP_PAD_X - (width - contentWidth) / 2,
    y: top - GROUP_PAD_TOP,
    width,
    height: bottom - top + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
  };
}

function routeEdges(
  edges: GraphEdge[],
  positionedNodes: PositionedNode[],
  direction: "right" | "down" | "left" | "up",
): PositionedEdge[] {
  const nodeMap = new Map(positionedNodes.map((n) => [n.node.id, n]));
  const isVerticalFlow = direction === "down" || direction === "up";

  // Group edges by unordered endpoint pair so opposite or parallel edges get distinct lanes
  const pairGroups = new Map<string, number[]>();
  edges.forEach((edge, idx) => {
    const key = edge.from <= edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
    const list = pairGroups.get(key);
    if (list) list.push(idx);
    else pairGroups.set(key, [idx]);
  });

  // Compute global node bounding hull for outer bypass lanes
  let globalMinX = Number.POSITIVE_INFINITY;
  let globalMinY = Number.POSITIVE_INFINITY;
  let globalMaxX = Number.NEGATIVE_INFINITY;
  let globalMaxY = Number.NEGATIVE_INFINITY;
  for (const pn of positionedNodes) {
    if (pn.x < globalMinX) globalMinX = pn.x;
    if (pn.y < globalMinY) globalMinY = pn.y;
    if (pn.x + pn.width > globalMaxX) globalMaxX = pn.x + pn.width;
    if (pn.y + pn.height > globalMaxY) globalMaxY = pn.y + pn.height;
  }

  let bypassCount = 0;

  return edges.map((edge, idx) => {
    const src = nodeMap.get(edge.from);
    const dst = nodeMap.get(edge.to);
    if (!src || !dst) {
      return {
        edge,
        index: idx,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        svgPath: "M 0 0 L 0 0",
        routePoints: [],
        labelX: 0,
        labelY: 0,
        isBackEdge: false,
        isBidirectional: false,
      };
    }

    // Self-loop edge
    if (src.node.id === dst.node.id) {
      const x1 = src.x + src.width * 0.72;
      const y1 = src.y;
      const x2 = src.x + src.width * 0.28;
      const y2 = src.y;
      const loopY = src.y - 34;
      const pts: Point[] = [
        { x: x1, y: y1 },
        { x: x1, y: loopY },
        { x: x2, y: loopY },
        { x: x2, y: y2 },
      ];
      return {
        edge,
        index: idx,
        x1,
        y1,
        x2,
        y2,
        svgPath: polylineToSmoothStepPath(pts),
        routePoints: pts,
        labelX: (x1 + x2) / 2,
        labelY: loopY,
        isBackEdge: true,
        isBidirectional: false,
      };
    }

    const pairKey = edge.from <= edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
    const siblings = pairGroups.get(pairKey) ?? [idx];
    const hasOpposite = siblings.some((sIdx) => {
      const other = edges[sIdx]!;
      return other.from === edge.to && other.to === edge.from;
    });
    const isBidirectional = hasOpposite || siblings.length > 1;
    const siblingRank = siblings.indexOf(idx);

    const srcCx = src.x + src.width / 2;
    const srcCy = src.y + src.height / 2;
    const dstCx = dst.x + dst.width / 2;
    const dstCy = dst.y + dst.height / 2;

    // Detect whether edge runs opposite to nominal graph flow
    const isBackEdge =
      (direction === "right" && dstCx < srcCx - 16) ||
      (direction === "left" && dstCx > srcCx + 16) ||
      (direction === "down" && dstCy < srcCy - 16) ||
      (direction === "up" && dstCy > srcCy + 16) ||
      (src.node.group === dst.node.group && dst.layer < src.layer);
    const adjacentLayers = src.node.group === dst.node.group && Math.abs(dst.layer - src.layer) <= 1;

    // Parallel / opposite edge lateral lane separation
    let portOffset = 0;
    if (siblings.length > 1) {
      if (hasOpposite && siblings.length === 2) {
        // Keep forward on -lane, return on +lane (in canonical sorted direction)
        const forwardSign = edge.from <= edge.to ? -1 : 1;
        const maxLane = Math.min(src.width, dst.width, src.height, dst.height) * 0.34;
        portOffset = forwardSign * Math.min(28, Math.max(18, maxLane));
      } else {
        const spread = 24;
        const centered = siblingRank - (siblings.length - 1) / 2;
        const maxLane = Math.min(src.width, dst.width, src.height, dst.height) * 0.36;
        portOffset = Math.max(-maxLane, Math.min(maxLane, centered * spread));
      }
    }

    const obstacles: Rect[] = positionedNodes.filter(
      (pn) => pn.node.id !== src.node.id && pn.node.id !== dst.node.id,
    );

    const isReverseReturnOnOppositeSide =
      isBidirectional && hasOpposite && isBackEdge && !isVerticalFlow && Math.abs(srcCy - dstCy) < 24;

    if (!isVerticalFlow) {
      // Horizontal flows ("right" | "left")
      const forwardRight = dstCx >= srcCx;
      const forwardFlow = direction === "right" ? dstCx >= srcCx - 10 : dstCx <= srcCx + 10;

      let x1: number;
      let y1: number;
      let x2: number;
      let y2: number;

      if (forwardFlow) {
        x1 = direction === "right" ? src.x + src.width : src.x;
        x2 = direction === "right" ? dst.x : dst.x + dst.width;
        y1 = srcCy + portOffset;
        y2 = dstCy + portOffset;
      } else if (isBidirectional && adjacentLayers && !isReverseReturnOnOppositeSide) {
        // Adjacent reverse edge in a 2-way pair: direct return facing ports with lateral separation
        x1 = forwardRight ? src.x + src.width : src.x;
        x2 = forwardRight ? dst.x : dst.x + dst.width;
        y1 = srcCy + portOffset;
        y2 = dstCy + portOffset;
      } else {
        // Long back-edge: connect cleanly using side/top-bottom ports or primary outer U-loop
        x1 = direction === "right" ? src.x + src.width * 0.5 : src.x + src.width * 0.5;
        x2 = direction === "right" ? dst.x + dst.width * 0.5 : dst.x + dst.width * 0.5;
        // Prefer routing along top or bottom edge ports cleanly
        const spanMinX = Math.min(src.x, dst.x);
        const spanMaxX = Math.max(src.x + src.width, dst.x + dst.width);
        let spanTop = Math.min(src.y, dst.y);
        let spanBottom = Math.max(src.y + src.height, dst.y + dst.height);
        for (const obs of obstacles) {
          if (obs.x + obs.width > spanMinX - 20 && obs.x < spanMaxX + 20) {
            if (obs.y < spanTop) spanTop = obs.y;
            if (obs.y + obs.height > spanBottom) spanBottom = obs.y + obs.height;
          }
        }
        const corridorStep = (bypassCount++ % 5) * 20;
        const avgY = (srcCy + dstCy) / 2;
        const distToTop = Math.abs(avgY - spanTop);
        const distToBottom = Math.abs(spanBottom - avgY);
        const goTop = distToTop <= distToBottom;
        const laneY = goTop ? spanTop - 32 - corridorStep : spanBottom + 32 + corridorStep;
        y1 = goTop ? src.y : src.y + src.height;
        y2 = goTop ? dst.y : dst.y + dst.height;

        const pts: Point[] = [
          { x: x1, y: y1 },
          { x: x1, y: laneY },
          { x: x2, y: laneY },
          { x: x2, y: y2 },
        ];
        const label = pickLabelAnchor(pts, siblingRank - (siblings.length - 1) / 2);
        return {
          edge,
          index: idx,
          x1,
          y1,
          x2,
          y2,
          svgPath: polylineToSmoothStepPath(pts),
          routePoints: pts,
          labelX: label.x,
          labelY: label.y,
          isBackEdge: true,
          isBidirectional,
        };
      }

      // Direct horizontal Z-bend
      const midX = (x1 + x2) / 2 + (siblings.length > 1 ? portOffset * 0.35 : 0);
      const directPts: Point[] =
        Math.abs(y1 - y2) < 1
          ? [
              { x: x1, y: y1 },
              { x: x2, y: y2 },
            ]
          : [
              { x: x1, y: y1 },
              { x: midX, y: y1 },
              { x: midX, y: y2 },
              { x: x2, y: y2 },
            ];

      const hitsNode =
        (direction === "right" ? x2 < x1 + 12 : x2 > x1 - 12) ||
        polylineIntersectsAny(directPts, obstacles, 10);

      if (!hitsNode) {
        const label = pickLabelAnchor(
          directPts,
          siblings.length > 1 ? (siblingRank - (siblings.length - 1) / 2) * 0.7 : 0,
        );
        return {
          edge,
          index: idx,
          x1,
          y1,
          x2,
          y2,
          svgPath: polylineToSmoothStepPath(directPts),
          routePoints: directPts,
          labelX: label.x,
          labelY: label.y,
          isBackEdge,
          isBidirectional,
        };
      }

      // Route around obstacles along an outer horizontal corridor above or below interfering nodes
      const exitSign = direction === "right" ? 1 : -1;
      const stub = 24;
      const spanMinX = Math.min(x1, x2) - stub;
      const spanMaxX = Math.max(x1, x2) + stub;
      let spanTop = Math.min(src.y, dst.y, globalMinY);
      let spanBottom = Math.max(src.y + src.height, dst.y + dst.height, globalMaxY);
      let localTop = Math.min(src.y, dst.y);
      let localBottom = Math.max(src.y + src.height, dst.y + dst.height);
      for (const obs of obstacles) {
        if (obs.x + obs.width > spanMinX && obs.x < spanMaxX) {
          if (obs.y < localTop) localTop = obs.y;
          if (obs.y + obs.height > localBottom) localBottom = obs.y + obs.height;
        }
      }
      spanTop = localTop;
      spanBottom = localBottom;

      const corridorStep = (bypassCount++ % 5) * 20;
      const avgY = (y1 + y2) / 2;
      const goTop = Math.abs(avgY - spanTop) <= Math.abs(spanBottom - avgY);
      const laneY = goTop ? spanTop - 28 - corridorStep : spanBottom + 28 + corridorStep;

      const bypassPts: Point[] = [
        { x: x1, y: y1 },
        { x: x1 + exitSign * stub, y: y1 },
        { x: x1 + exitSign * stub, y: laneY },
        { x: x2 - exitSign * stub, y: laneY },
        { x: x2 - exitSign * stub, y: y2 },
        { x: x2, y: y2 },
      ];
      const label = pickLabelAnchor(bypassPts, 0);
      return {
        edge,
        index: idx,
        x1,
        y1,
        x2,
        y2,
        svgPath: polylineToSmoothStepPath(bypassPts),
        routePoints: bypassPts,
        labelX: label.x,
        labelY: label.y,
        isBackEdge,
        isBidirectional,
      };
    }

    // Vertical flows ("down" | "up")
    const forwardFlow = direction === "down" ? dstCy >= srcCy - 10 : dstCy <= srcCy + 10;

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;

    if (forwardFlow) {
      x1 = srcCx + portOffset;
      x2 = dstCx + portOffset;
      y1 = direction === "down" ? src.y + src.height : src.y;
      y2 = direction === "down" ? dst.y : dst.y + dst.height;
    } else if (isBidirectional && adjacentLayers) {
      // Opposite return edge cleanly tracks beside forward edge (facing bottom<->top ports)
      x1 = srcCx + portOffset;
      x2 = dstCx + portOffset;
      y1 = dstCy >= srcCy ? src.y + src.height : src.y;
      y2 = dstCy >= srcCy ? dst.y : dst.y + dst.height;
    } else {
      // Long vertical back-edge: route along left or right side corridor outside intermediate nodes
      const spanMinY = Math.min(src.y, dst.y);
      const spanMaxY = Math.max(src.y + src.height, dst.y + dst.height);
      let localLeft = Math.min(src.x, dst.x);
      let localRight = Math.max(src.x + src.width, dst.x + dst.width);
      for (const obs of obstacles) {
        if (obs.y + obs.height > spanMinY - 20 && obs.y < spanMaxY + 20) {
          if (obs.x < localLeft) localLeft = obs.x;
          if (obs.x + obs.width > localRight) localRight = obs.x + obs.width;
        }
      }
      const corridorStep = (bypassCount++ % 5) * 22;
      const avgX = (srcCx + dstCx) / 2;
      const goLeft = Math.abs(avgX - localLeft) <= Math.abs(localRight - avgX);
      const laneX = goLeft ? localLeft - 36 - corridorStep : localRight + 36 + corridorStep;
      x1 = goLeft ? src.x : src.x + src.width;
      x2 = goLeft ? dst.x : dst.x + dst.width;
      y1 = srcCy;
      y2 = dstCy;

      const pts: Point[] = [
        { x: x1, y: y1 },
        { x: laneX, y: y1 },
        { x: laneX, y: y2 },
        { x: x2, y: y2 },
      ];
      const label = pickLabelAnchor(pts, siblingRank - (siblings.length - 1) / 2);
      return {
        edge,
        index: idx,
        x1,
        y1,
        x2,
        y2,
        svgPath: polylineToSmoothStepPath(pts),
        routePoints: pts,
        labelX: label.x,
        labelY: label.y,
        isBackEdge: true,
        isBidirectional,
      };
    }

    const midY = (y1 + y2) / 2 + (siblings.length > 1 ? portOffset * 0.25 : 0);
    const directPts: Point[] =
      Math.abs(x1 - x2) < 1
        ? [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ]
        : [
            { x: x1, y: y1 },
            { x: x1, y: midY },
            { x: x2, y: midY },
            { x: x2, y: y2 },
          ];

    const hitsNode =
      (direction === "down" ? y2 < y1 + 12 : y2 > y1 - 12) ||
      polylineIntersectsAny(directPts, obstacles, 10);

    if (!hitsNode) {
      const label = pickLabelAnchor(
        directPts,
        siblings.length > 1 ? (siblingRank - (siblings.length - 1) / 2) * 0.55 : 0,
      );
      return {
        edge,
        index: idx,
        x1,
        y1,
        x2,
        y2,
        svgPath: polylineToSmoothStepPath(directPts),
        routePoints: directPts,
        labelX: label.x,
        labelY: label.y,
        isBackEdge,
        isBidirectional,
      };
    }

    const exitSign = direction === "down" ? 1 : -1;
    const stub = 22;
    const spanMinY = Math.min(y1, y2) - stub;
    const spanMaxY = Math.max(y1, y2) + stub;
    let localLeft = Math.min(src.x, dst.x);
    let localRight = Math.max(src.x + src.width, dst.x + dst.width);
    for (const obs of obstacles) {
      if (obs.y + obs.height > spanMinY && obs.y < spanMaxY) {
        if (obs.x < localLeft) localLeft = obs.x;
        if (obs.x + obs.width > localRight) localRight = obs.x + obs.width;
      }
    }
    const corridorStep = (bypassCount++ % 5) * 22;
    const avgX = (x1 + x2) / 2;
    const goLeft = Math.abs(avgX - localLeft) <= Math.abs(localRight - avgX);
    const laneX = goLeft ? localLeft - 32 - corridorStep : localRight + 32 + corridorStep;

    const bypassPts: Point[] = [
      { x: x1, y: y1 },
      { x: x1, y: y1 + exitSign * stub },
      { x: laneX, y: y1 + exitSign * stub },
      { x: laneX, y: y2 - exitSign * stub },
      { x: x2, y: y2 - exitSign * stub },
      { x: x2, y: y2 },
    ];
    const label = pickLabelAnchor(bypassPts, 0);
    return {
      edge,
      index: idx,
      x1,
      y1,
      x2,
      y2,
      svgPath: polylineToSmoothStepPath(bypassPts),
      routePoints: bypassPts,
      labelX: label.x,
      labelY: label.y,
      isBackEdge,
      isBidirectional,
    };
  });
}

function computeCanvasSize(
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  edges: PositionedEdge[],
): { width: number; height: number } {
  let maxX = 480;
  let maxY = 260;

  for (const n of nodes) {
    if (n.x + n.width + OUTER_PAD > maxX) maxX = n.x + n.width + OUTER_PAD;
    if (n.y + n.height + OUTER_PAD > maxY) maxY = n.y + n.height + OUTER_PAD;
  }
  for (const g of groups) {
    if (g.x + g.width + OUTER_PAD > maxX) maxX = g.x + g.width + OUTER_PAD;
    if (g.y + g.height + OUTER_PAD > maxY) maxY = g.y + g.height + OUTER_PAD;
  }
  for (const e of edges) {
    if (e.labelX + 90 > maxX) maxX = e.labelX + 90;
    if (e.labelY + 40 > maxY) maxY = e.labelY + 40;
  }

  return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
}

export function applyGraphOffsets(base: GraphLayoutResult, offsets: NodeOffsetMap): GraphLayoutResult {
  const keys = Object.keys(offsets);
  if (keys.length === 0) return base;

  const shiftedNodes = base.nodes.map((pn) => {
    const off = offsets[pn.node.id];
    if (!off || (off.dx === 0 && off.dy === 0)) return pn;
    return {
      ...pn,
      x: pn.x + off.dx,
      y: pn.y + off.dy,
    };
  });

  const children = new Map<string, Rect[]>();
  for (const group of base.groups) children.set(group.node.id, []);
  for (const node of shiftedNodes) {
    if (node.node.group) children.get(node.node.group)?.push(node);
  }
  const updated = new Map<string, PositionedGroup>();
  // The layout emits each parent before its descendants.
  for (const group of [...base.groups].reverse()) {
    const members = children.get(group.node.id)!;
    const offset = offsets[group.node.id];
    const frame = members.length > 0
      ? groupFrame(group.node, members)
      : { ...group, x: group.x + (offset?.dx ?? 0), y: group.y + (offset?.dy ?? 0) };
    const shifted = { ...group, ...frame };
    updated.set(group.node.id, shifted);
    if (group.node.group) children.get(group.node.group)?.push(shifted);
  }
  const shiftedGroups = base.groups.map((group) => updated.get(group.node.id)!);
  const rawEdges = base.edges.map((e) => e.edge);
  const routedEdges = routeEdges(rawEdges, shiftedNodes, base.direction);
  const size = computeCanvasSize(shiftedNodes, shiftedGroups, routedEdges);

  return {
    ...base,
    width: size.width,
    height: size.height,
    nodes: shiftedNodes,
    groups: shiftedGroups,
    edges: routedEdges,
  };
}

type LayoutEdge = Pick<GraphEdge, "from" | "to">;
type NodeSize = Pick<Rect, "width" | "height">;

function positionSiblings(
  nodes: GraphNode[],
  edges: LayoutEdge[],
  sizes: ReadonlyMap<string, NodeSize>,
  direction: GraphLayoutResult["direction"],
  grouped: boolean,
): PositionedNode[] {
  const contentSet = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }

  // Break cycles via DFS to produce a clean DAG for layering
  const rawAdj = new Map<string, { to: string; idx: number }[]>();
  for (const n of nodes) rawAdj.set(n.id, []);
  edges.forEach((e, idx) => {
    if (contentSet.has(e.from) && contentSet.has(e.to) && e.from !== e.to) {
      rawAdj.get(e.from)!.push({ to: e.to, idx });
    }
  });

  const visitState = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=done
  const backEdgeSet = new Set<number>();

  const dfs = (id: string) => {
    visitState.set(id, 1);
    for (const edgeRef of rawAdj.get(id) ?? []) {
      const state = visitState.get(edgeRef.to) ?? 0;
      if (state === 1) {
        backEdgeSet.add(edgeRef.idx);
      } else if (state === 0) {
        dfs(edgeRef.to);
      }
    }
    visitState.set(id, 2);
  };

  for (const n of nodes) {
    if ((visitState.get(n.id) ?? 0) === 0) dfs(n.id);
  }

  const dagInEdges = new Map<string, string[]>();
  for (const n of nodes) dagInEdges.set(n.id, []);

  edges.forEach((e, idx) => {
    if (!contentSet.has(e.from) || !contentSet.has(e.to) || e.from === e.to) return;
    if (backEdgeSet.has(idx)) return;
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    dagInEdges.get(e.to)!.push(e.from);
  });

  // Topological longest-path layer assignment
  const layerMap = new Map<string, number>();
  const queue: string[] = [];
  const tempIn = new Map(inDegree);

  for (const n of nodes) {
    if ((tempIn.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
      layerMap.set(n.id, 0);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layerMap.get(curr) ?? 0;
    for (const next of adj.get(curr) ?? []) {
      const candidate = currLayer + 1;
      if ((layerMap.get(next) ?? 0) < candidate) {
        layerMap.set(next, candidate);
      }
      const nextIn = (tempIn.get(next) ?? 1) - 1;
      tempIn.set(next, nextIn);
      if (nextIn === 0) queue.push(next);
    }
  }

  for (const n of nodes) {
    if (!layerMap.has(n.id)) layerMap.set(n.id, 0);
  }

  // Group content nodes by layer
  let maxLayer = 0;
  for (const l of layerMap.values()) {
    if (l > maxLayer) maxLayer = l;
  }

  const layers: GraphNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) {
    layers[layerMap.get(n.id) ?? 0]!.push(n);
  }

  const order = new Map<string, number>();
  for (const layer of layers) {
    const scores = new Map(layer.map((node) => {
      const parents = dagInEdges.get(node.id) ?? [];
      const total = parents.reduce((sum, parent) => sum + (order.get(parent) ?? 0), 0);
      return [node.id, parents.length ? total / parents.length : 0];
    }));
    layer.sort((a, b) => {
      const difference = scores.get(a.id)! - scores.get(b.id)!;
      return Math.abs(difference) > 0.15 ? difference : 0;
    });
    layer.forEach((node, index) => order.set(node.id, index));
  }

  const horizontal = direction === "right" || direction === "left";
  const reverse = direction === "left" || direction === "up";
  const layerGap = grouped ? (horizontal ? 72 : 52) : (horizontal ? LAYER_GAP_H : LAYER_GAP_V);
  const siblingGap = grouped ? 36 : (horizontal ? SIBLING_GAP_H : SIBLING_GAP_V);
  const flowSize = (size: NodeSize) => horizontal ? size.width : size.height;
  const crossSize = (size: NodeSize) => horizontal ? size.height : size.width;
  const spans = layers.map((layer) => {
    const content = layer.reduce((span, node) => span + crossSize(sizes.get(node.id)!), 0);
    return content + Math.max(0, layer.length - 1) * siblingGap;
  });
  const maxSpan = Math.max(...spans);
  const positioned: PositionedNode[] = [];
  let flow = 0;

  layers.forEach((layer, index) => {
    const thickness = Math.max(...layer.map((node) => flowSize(sizes.get(node.id)!)));
    let cross = (maxSpan - spans[index]!) / 2;
    for (const node of layer) {
      const size = sizes.get(node.id)!;
      const at = flow + (thickness - flowSize(size)) / 2;
      positioned.push({ node, ...size, layer: index, x: horizontal ? at : cross, y: horizontal ? cross : at });
      cross += crossSize(size) + siblingGap;
    }
    flow += thickness + layerGap;
  });

  if (reverse) {
    const extent = flow - layerGap;
    for (const item of positioned) {
      if (horizontal) item.x = extent - item.x - item.width;
      else item.y = extent - item.y - item.height;
    }
  }
  return positioned;
}

function groupHierarchy(nodes: GraphNode[]): Map<string | undefined, GraphNode[]> {
  const groups = new Map(nodes.filter((node) => node.type === "group").map((node) => [node.id, node]));
  const parents = new Map<string, string>();
  for (const node of nodes) {
    if (node.group && node.group !== node.id && groups.has(node.group)) parents.set(node.id, node.group);
  }

  // Authored group references can contain cycles. Promote one group from each cycle to the root.
  const checked = new Set<string>();
  for (const group of groups.values()) {
    const ancestors = new Set<string>();
    let id: string | undefined = group.id;
    while (id !== undefined && !checked.has(id)) {
      ancestors.add(id);
      const parent: string | undefined = parents.get(id);
      if (parent !== undefined && ancestors.has(parent)) {
        parents.delete(id);
        break;
      }
      id = parent;
    }
    for (const ancestor of ancestors) checked.add(ancestor);
  }

  const hierarchy = new Map<string | undefined, GraphNode[]>();
  for (const node of nodes) {
    const parent = parents.get(node.id);
    const siblings = hierarchy.get(parent) ?? [];
    siblings.push(node.group === parent ? node : { ...node, group: parent });
    hierarchy.set(parent, siblings);
  }
  return hierarchy;
}

function positionGraph(
  allNodes: GraphNode[],
  edges: GraphEdge[],
  direction: GraphLayoutResult["direction"],
): { nodes: PositionedNode[]; groups: PositionedGroup[] } {
  const hierarchy = groupHierarchy(allNodes);
  const root = hierarchy.get(undefined) ?? [];
  const grouped = root.some((node) => node.type === "group");

  function positionScope(siblings: GraphNode[]): { nodes: PositionedNode[]; groups: PositionedGroup[] } {
    if (siblings.length === 0) return { nodes: [], groups: [] };
    const sizes = new Map<string, NodeSize>();
    const branches = new Map<string, { frame: Rect; nodes: PositionedNode[]; groups: PositionedGroup[] }>();
    const owner = new Map<string, string>();

    for (const sibling of siblings) {
      if (sibling.type !== "group") {
        sizes.set(sibling.id, estimateNodeSize(sibling));
        owner.set(sibling.id, sibling.id);
        continue;
      }

      const branch = positionScope(hierarchy.get(sibling.id) ?? []);
      const frame = groupFrame(sibling, [
        ...branch.nodes.filter((node) => node.node.group === sibling.id),
        ...branch.groups.filter((group) => group.node.group === sibling.id),
      ]);
      sizes.set(sibling.id, frame);
      branches.set(sibling.id, { frame, ...branch });
      for (const item of branch.nodes) owner.set(item.node.id, sibling.id);
    }

    // An edge constrains sibling placement at the lowest scope containing both endpoints.
    // Keep all original edges for routing and count repeated cross-group links only once here.
    const links: LayoutEdge[] = [];
    const seen = new Map<string, Set<string>>();
    for (const edge of edges) {
      const from = owner.get(edge.from);
      const to = owner.get(edge.to);
      if (from === undefined || to === undefined || from === to) continue;
      if (grouped) {
        const destinations = seen.get(from) ?? new Set<string>();
        if (destinations.has(to)) continue;
        destinations.add(to);
        seen.set(from, destinations);
      }
      links.push({ from, to });
    }

    const nodes: PositionedNode[] = [];
    const groups: PositionedGroup[] = [];
    for (const item of positionSiblings(siblings, links, sizes, direction, grouped)) {
      const branch = branches.get(item.node.id);
      if (!branch) {
        nodes.push(item);
        continue;
      }

      const { node, x, y, width, height } = item;
      const dx = x - branch.frame.x;
      const dy = y - branch.frame.y;
      groups.push({ node, x, y, width, height, memberIds: branch.nodes.map((n) => n.node.id) });
      nodes.push(...branch.nodes.map((child) => ({ ...child, x: child.x + dx, y: child.y + dy })));
      groups.push(...branch.groups.map((group) => ({ ...group, x: group.x + dx, y: group.y + dy })));
    }
    return { nodes, groups };
  }

  return positionScope(root);
}

export function layoutGraph(spec: GraphLayoutInput): GraphLayoutResult {
  const direction = spec.direction ?? "right";
  const allNodes: GraphNode[] = (spec.nodes ?? []).map((node) => ({ ...node, type: node.type ?? "service" }));
  if (allNodes.length === 0) {
    return { width: 420, height: 220, direction, nodes: [], groups: [], edges: [] };
  }
  const edges: GraphEdge[] = (spec.edges ?? []).map((edge) => ({ ...edge, kind: edge.kind ?? "flow" }));

  const { nodes: positionedNodes, groups } = positionGraph(allNodes, edges, direction);

  // Normalize all positions so top-left content starts inside OUTER_PAD without negative coords
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const pn of positionedNodes) {
    if (pn.x < minX) minX = pn.x;
    if (pn.y < minY) minY = pn.y;
  }
  for (const pg of groups) {
    if (pg.x < minX) minX = pg.x;
    if (pg.y < minY) minY = pg.y;
  }
  const shiftX = Number.isFinite(minX) ? OUTER_PAD - minX : 0;
  const shiftY = Number.isFinite(minY) ? OUTER_PAD - minY : 0;
  if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
    for (const pn of positionedNodes) {
      pn.x += shiftX;
      pn.y += shiftY;
    }
    for (const pg of groups) {
      pg.x += shiftX;
      pg.y += shiftY;
    }
  }

  const routedEdges = positionedNodes.length === 0 ? [] : routeEdges(edges, positionedNodes, direction);

  // Shift right/down if any outer bypass corridor pushed left/top below OUTER_PAD
  let extraLeft = Number.POSITIVE_INFINITY;
  let extraTop = Number.POSITIVE_INFINITY;
  for (const pn of positionedNodes) {
    if (pn.x < extraLeft) extraLeft = pn.x;
    if (pn.y < extraTop) extraTop = pn.y;
  }
  for (const pg of groups) {
    if (pg.x < extraLeft) extraLeft = pg.x;
    if (pg.y < extraTop) extraTop = pg.y;
  }
  for (const e of routedEdges) {
    if (e.labelX - 70 < extraLeft) extraLeft = e.labelX - 70;
    if (e.labelY - 24 < extraTop) extraTop = e.labelY - 24;
  }
  const corrX = extraLeft < 24 ? 24 - extraLeft : 0;
  const corrY = extraTop < 24 ? 24 - extraTop : 0;
  const finalEdges =
    corrX > 0 || corrY > 0
      ? (() => {
          for (const pn of positionedNodes) {
            pn.x += corrX;
            pn.y += corrY;
          }
          for (const pg of groups) {
            pg.x += corrX;
            pg.y += corrY;
          }
          return routedEdges.length === 0 ? [] : routeEdges(edges, positionedNodes, direction);
        })()
      : routedEdges;

  const size = computeCanvasSize(positionedNodes, groups, finalEdges);

  return {
    width: size.width,
    height: size.height,
    direction,
    nodes: positionedNodes,
    groups,
    edges: finalEdges,
  };
}
