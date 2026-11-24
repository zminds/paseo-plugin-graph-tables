import { visualTextUnits } from "./query-engine";
import type { GraphEdge, GraphNode, GraphSpec } from "./view-schema";

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
}

export interface PositionedEdge {
  edge: GraphEdge;
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  labelX: number;
  labelY: number;
  isBackEdge: boolean;
}

export interface GraphLayoutResult {
  width: number;
  height: number;
  direction: "right" | "down" | "left" | "up";
  nodes: PositionedNode[];
  groups: PositionedGroup[];
  edges: PositionedEdge[];
}

function estimateNodeSize(node: GraphNode): { width: number; height: number } {
  const titleUnits = visualTextUnits(node.label);
  const subUnits = visualTextUnits(node.sublabel ?? "");
  const maxFieldUnits = (node.fields ?? []).reduce(
    (max, f) => Math.max(max, visualTextUnits(`${f.name}: ${f.type ?? ""}`) + 4),
    0,
  );
  const maxItemUnits = (node.items ?? []).reduce(
    (max, it) => Math.max(max, visualTextUnits(it.label) + 4),
    0,
  );
  const textUnits = Math.max(
    titleUnits,
    subUnits * 0.88,
    maxFieldUnits * 0.82,
    maxItemUnits * 0.85,
    10,
  );
  const width = Math.min(300, Math.max(138, Math.round(textUnits * 7.6 + 38)));

  let height = 48;
  if (node.sublabel) height += 16;
  if (node.value !== undefined) height += 22;
  if (node.fields?.length) height += Math.min(node.fields.length, 6) * 16 + 10;
  if (node.items?.length) height += Math.min(node.items.length, 6) * 16 + 10;
  if (node.type === "decision") height = Math.max(height, 64);

  return { width, height };
}

export function layoutGraph(spec: GraphSpec): GraphLayoutResult {
  const direction = spec.direction ?? "right";
  const allNodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];

  const groupNodes = allNodes.filter((n) => n.type === "group");
  const contentNodes = allNodes.filter((n) => n.type !== "group");
  const contentById = new Map(contentNodes.map((n) => [n.id, n]));

  // Only keep edges between known content nodes
  const validEdges = edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => contentById.has(edge.from) && contentById.has(edge.to));

  // Cycle detection via DFS to classify back-edges
  const outgoing = new Map<string, number[]>();
  for (const node of contentNodes) outgoing.set(node.id, []);
  validEdges.forEach(({ edge }, i) => {
    outgoing.get(edge.from)?.push(i);
  });

  const visitState = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=done
  const backEdgeIndices = new Set<number>();

  const dfs = (nodeId: string) => {
    visitState.set(nodeId, 1);
    for (const idx of outgoing.get(nodeId) ?? []) {
      const target = validEdges[idx].edge.to;
      if (target === nodeId) {
        backEdgeIndices.add(idx);
        continue;
      }
      const state = visitState.get(target) ?? 0;
      if (state === 1) {
        backEdgeIndices.add(idx);
      } else if (state === 0) {
        dfs(target);
      }
    }
    visitState.set(nodeId, 2);
  };

  for (const node of contentNodes) {
    if ((visitState.get(node.id) ?? 0) === 0) dfs(node.id);
  }

  // Longest-path layering on DAG (excluding back-edges)
  const inDegree = new Map<string, number>();
  const dagOut = new Map<string, string[]>();
  const dagIn = new Map<string, string[]>();
  for (const node of contentNodes) {
    inDegree.set(node.id, 0);
    dagOut.set(node.id, []);
    dagIn.set(node.id, []);
  }
  validEdges.forEach(({ edge }, idx) => {
    if (backEdgeIndices.has(idx)) return;
    dagOut.get(edge.from)!.push(edge.to);
    dagIn.get(edge.to)!.push(edge.from);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  });

  const queue: string[] = [];
  const layer = new Map<string, number>();
  for (const node of contentNodes) {
    if ((inDegree.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
      layer.set(node.id, 0);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const currentLayer = layer.get(id) ?? 0;
    for (const next of dagOut.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, currentLayer + 1));
      const rem = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, rem);
      if (rem === 0) queue.push(next);
    }
  }
  for (const node of contentNodes) {
    if (!layer.has(node.id)) layer.set(node.id, 0);
  }

  // Group nodes by layer and reduce crossings with barycenter heuristic
  const maxLayer = contentNodes.reduce((m, n) => Math.max(m, layer.get(n.id) ?? 0), 0);
  const layers: GraphNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const node of contentNodes) {
    layers[layer.get(node.id) ?? 0].push(node);
  }

  // Keep grouped siblings clustered together initially
  for (const bucket of layers) {
    bucket.sort((a, b) => (a.group ?? "").localeCompare(b.group ?? ""));
  }

  const orderIndex = new Map<string, number>();
  const rebuildOrderIndex = () => {
    layers.forEach((bucket) => {
      bucket.forEach((n, idx) => orderIndex.set(n.id, idx));
    });
  };
  rebuildOrderIndex();

  for (let pass = 0; pass < 4; pass += 1) {
    for (let l = 1; l < layers.length; l += 1) {
      layers[l].sort((a, b) => {
        const predsA = dagIn.get(a.id) ?? [];
        const predsB = dagIn.get(b.id) ?? [];
        const avgA =
          predsA.length > 0
            ? predsA.reduce((s, p) => s + (orderIndex.get(p) ?? 0), 0) / predsA.length
            : orderIndex.get(a.id) ?? 0;
        const avgB =
          predsB.length > 0
            ? predsB.reduce((s, p) => s + (orderIndex.get(p) ?? 0), 0) / predsB.length
            : orderIndex.get(b.id) ?? 0;
        return avgA - avgB;
      });
      rebuildOrderIndex();
    }
  }

  const isHorizontal = direction === "right" || direction === "left";
  const isReversed = direction === "left" || direction === "up";
  const sizes = new Map(contentNodes.map((n) => [n.id, estimateNodeSize(n)]));

  const layerGap = isHorizontal ? 76 : 64;
  const siblingGap = isHorizontal ? 28 : 34;
  const padX = 36;
  const padY = 44;

  // Compute primary-axis depth per layer
  const orderedLayers = isReversed ? [...layers].reverse() : layers;
  const layerThickness = orderedLayers.map((bucket) =>
    bucket.reduce(
      (max, n) => {
        const sz = sizes.get(n.id)!;
        return Math.max(max, isHorizontal ? sz.width : sz.height);
      },
      isHorizontal ? 140 : 54,
    ),
  );

  const layerOffsets: number[] = [];
  let primaryCursor = isHorizontal ? padX : padY;
  for (let l = 0; l < orderedLayers.length; l += 1) {
    layerOffsets.push(primaryCursor);
    primaryCursor += layerThickness[l] + layerGap;
  }

  // Compute secondary-axis total extent per layer to center layers
  const layerSpans = orderedLayers.map((bucket) => {
    if (bucket.length === 0) return 0;
    const sum = bucket.reduce((acc, n) => {
      const sz = sizes.get(n.id)!;
      return acc + (isHorizontal ? sz.height : sz.width);
    }, 0);
    return sum + (bucket.length - 1) * siblingGap;
  });
  const maxSpan = Math.max(200, ...layerSpans);

  const positionedNodes: PositionedNode[] = [];
  const nodePosById = new Map<string, PositionedNode>();

  orderedLayers.forEach((bucket, lIdx) => {
    const span = layerSpans[lIdx];
    let secondaryCursor = (isHorizontal ? padY : padX) + (maxSpan - span) / 2;
    const pOffset = layerOffsets[lIdx];

    for (const node of bucket) {
      const sz = sizes.get(node.id)!;
      const x = isHorizontal
        ? pOffset + (layerThickness[lIdx] - sz.width) / 2
        : secondaryCursor;
      const y = isHorizontal
        ? secondaryCursor
        : pOffset + (layerThickness[lIdx] - sz.height) / 2;

      const positioned: PositionedNode = {
        node,
        x,
        y,
        width: sz.width,
        height: sz.height,
        layer: layer.get(node.id) ?? 0,
      };
      positionedNodes.push(positioned);
      nodePosById.set(node.id, positioned);
      secondaryCursor += (isHorizontal ? sz.height : sz.width) + siblingGap;
    }
  });

  // Compute group bounding boxes around member nodes
  const positionedGroups: PositionedGroup[] = [];
  const groupPadX = 18;
  const groupPadTop = 32;
  const groupPadBottom = 18;
  let orphanGroupY = 24;

  for (const groupNode of groupNodes) {
    const members = positionedNodes.filter((n) => n.node.group === groupNode.id);
    if (members.length === 0) {
      positionedGroups.push({
        node: groupNode,
        x: padX,
        y: orphanGroupY,
        width: 160,
        height: 60,
      });
      orphanGroupY += 76;
      continue;
    }
    const minX = Math.min(...members.map((m) => m.x)) - groupPadX;
    const minY = Math.min(...members.map((m) => m.y)) - groupPadTop;
    const maxX = Math.max(...members.map((m) => m.x + m.width)) + groupPadX;
    const maxY = Math.max(...members.map((m) => m.y + m.height)) + groupPadBottom;
    positionedGroups.push({
      node: groupNode,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  // Normalize coordinates if any group padding pushed coordinates < 16
  const allBoxes = [
    ...positionedNodes.map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height })),
    ...positionedGroups.map((g) => ({ x: g.x, y: g.y, w: g.width, h: g.height })),
  ];
  const minBoundX = allBoxes.length ? Math.min(...allBoxes.map((b) => b.x)) : 0;
  const minBoundY = allBoxes.length ? Math.min(...allBoxes.map((b) => b.y)) : 0;
  const shiftX = minBoundX < 20 ? 20 - minBoundX : 0;
  const shiftY = minBoundY < 20 ? 20 - minBoundY : 0;

  if (shiftX !== 0 || shiftY !== 0) {
    for (const n of positionedNodes) {
      n.x += shiftX;
      n.y += shiftY;
    }
    for (const g of positionedGroups) {
      g.x += shiftX;
      g.y += shiftY;
    }
  }

  const positionedEdges: PositionedEdge[] = validEdges.map(({ edge, index }, idx) => {
    const fromBox = nodePosById.get(edge.from)!;
    const toBox = nodePosById.get(edge.to)!;
    const isBack = backEdgeIndices.has(idx);

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    let cx1: number;
    let cy1: number;
    let cx2: number;
    let cy2: number;

    if (isHorizontal) {
      const goRight = toBox.x >= fromBox.x;
      x1 = goRight ? fromBox.x + fromBox.width : fromBox.x;
      y1 = fromBox.y + fromBox.height / 2;
      x2 = goRight ? toBox.x : toBox.x + toBox.width;
      y2 = toBox.y + toBox.height / 2;

      if (fromBox === toBox) {
        x1 = fromBox.x + fromBox.width * 0.7;
        y1 = fromBox.y;
        x2 = fromBox.x + fromBox.width * 0.3;
        y2 = fromBox.y;
        cx1 = x1 + 24;
        cy1 = y1 - 44;
        cx2 = x2 - 24;
        cy2 = y2 - 44;
      } else if (isBack) {
        const arcOffset = -Math.max(46, Math.abs(y1 - y2) * 0.3 + 42);
        cx1 = x1 + (goRight ? 40 : -40);
        cy1 = y1 + arcOffset;
        cx2 = x2 + (goRight ? -40 : 40);
        cy2 = y2 + arcOffset;
      } else {
        const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
        cx1 = x1 + (goRight ? dx : -dx);
        cy1 = y1;
        cx2 = x2 - (goRight ? dx : -dx);
        cy2 = y2;
      }
    } else {
      const goDown = toBox.y >= fromBox.y;
      x1 = fromBox.x + fromBox.width / 2;
      y1 = goDown ? fromBox.y + fromBox.height : fromBox.y;
      x2 = toBox.x + toBox.width / 2;
      y2 = goDown ? toBox.y : toBox.y + toBox.height;

      if (fromBox === toBox) {
        x1 = fromBox.x + fromBox.width;
        y1 = fromBox.y + fromBox.height * 0.3;
        x2 = fromBox.x + fromBox.width;
        y2 = fromBox.y + fromBox.height * 0.7;
        cx1 = x1 + 48;
        cy1 = y1 - 12;
        cx2 = x2 + 48;
        cy2 = y2 + 12;
      } else if (isBack) {
        const arcOffset = Math.max(48, Math.abs(x1 - x2) * 0.3 + 42);
        cx1 = x1 + arcOffset;
        cy1 = y1 + (goDown ? 36 : -36);
        cx2 = x2 + arcOffset;
        cy2 = y2 + (goDown ? -36 : 36);
      } else {
        const dy = Math.max(32, Math.abs(y2 - y1) * 0.45);
        cx1 = x1;
        cy1 = y1 + (goDown ? dy : -dy);
        cx2 = x2;
        cy2 = y2 - (goDown ? dy : -dy);
      }
    }

    // Point on cubic Bezier at t = 0.5
    const labelX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
    const labelY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;

    return {
      edge,
      index,
      x1,
      y1,
      x2,
      y2,
      cx1,
      cy1,
      cx2,
      cy2,
      labelX,
      labelY,
      isBackEdge: isBack,
    };
  });

  const maxRight = Math.max(
    360,
    ...positionedNodes.map((n) => n.x + n.width + 28),
    ...positionedGroups.map((g) => g.x + g.width + 28),
    ...positionedEdges.map((e) => Math.max(e.cx1, e.cx2, e.x1, e.x2) + 28),
  );
  const maxBottom = Math.max(
    180,
    ...positionedNodes.map((n) => n.y + n.height + 28),
    ...positionedGroups.map((g) => g.y + g.height + 28),
    ...positionedEdges.map((e) => Math.max(e.cy1, e.cy2, e.y1, e.y2) + 28),
  );

  return {
    width: Math.ceil(maxRight),
    height: Math.ceil(maxBottom),
    direction,
    nodes: positionedNodes,
    groups: positionedGroups,
    edges: positionedEdges,
  };
}
