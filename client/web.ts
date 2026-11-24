/**
 * Web-only SVG chart, interactive React Flow-style graph canvas, and Retina PNG
 * rasterizer, re-implemented after Beluga (https://github.com/beluga-labs/beluga).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { createElement, type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Platform } from "react-native";
import type { GraphLayoutResult, PositionedNode } from "../shared/graph-layout";
import { type GraphViewTransform, zoomAroundPoint } from "../shared/graph-viewport";
import { nodeGlyphShapes, safeGraphImageHref, type GlyphShape } from "../shared/node-glyphs";
import { truncateVisualText, visualTextUnits } from "../shared/query-engine";
import {
  arcSlicePath,
  buildLinePath,
  computeNiceScale,
  formatCompactNumber,
  type ScatterPoint,
} from "../shared/svg-export";
import type { ChartKind } from "../shared/view-schema";
import type { ParsedChartData } from "./format";

export const isWebPlatform = Platform.OS === "web";

const svgEl = createElement as unknown as (
  type: string,
  props: Record<string, unknown> | null,
  ...children: ReactNode[]
) => ReactElement;

interface WebImageLike {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

interface WebCanvasCtx2dLike {
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
}

interface WebOffscreenCanvasLike {
  getContext(kind: "2d"): WebCanvasCtx2dLike | null;
  convertToBlob(opts?: { type?: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

function bytesToBase64(bytes: Uint8Array): string | null {
  const btoaFn = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (typeof btoaFn !== "function") return null;
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoaFn(binary);
}

export async function rasterizeSvgToPngBase64(
  svg: string,
  width: number,
  height: number,
  pixelRatio = 2,
): Promise<string | null> {
  if (!isWebPlatform) return null;
  const g = globalThis as {
    Image?: new () => WebImageLike;
    OffscreenCanvas?: new (w: number, h: number) => WebOffscreenCanvasLike;
    TextEncoder?: new () => { encode(s: string): Uint8Array };
  };
  if (!g.Image || !g.OffscreenCanvas || !g.TextEncoder) return null;

  try {
    const utf8 = new g.TextEncoder().encode(svg);
    const svgB64 = bytesToBase64(utf8);
    if (!svgB64) return null;

    const img = new g.Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = `data:image/svg+xml;base64,${svgB64}`;
    });
    if (!loaded) return null;

    const outW = Math.max(1, Math.round(width * pixelRatio));
    const outH = Math.max(1, Math.round(height * pixelRatio));
    const canvas = new g.OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(pixelRatio, pixelRatio);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return bytesToBase64(bytes);
  } catch {
    return null;
  }
}

export interface WebSvgChartProps {
  kind: ChartKind;
  data: ParsedChartData;
  curve?: "smooth" | "linear" | "step";
  stacked?: boolean;
  hiddenSeries: ReadonlySet<string>;
  selectedIndex: number | null;
  hoveredIndex?: number | null;
  onSelectIndex(index: number | null): void;
  onHoverIndex?(index: number | null): void;
  theme: PluginTheme;
  width: number;
  height: number;
}

function buildReverseLinePath(
  points: Array<{ x: number; y: number }>,
  curve: "smooth" | "linear" | "step",
): string {
  const reversed = [...points].reverse();
  if (reversed.length === 0) return "";
  if (reversed.length === 1) return `L ${reversed[0]!.x.toFixed(1)} ${reversed[0]!.y.toFixed(1)}`;
  if (curve === "step") {
    let d = `L ${reversed[0]!.x.toFixed(1)} ${reversed[0]!.y.toFixed(1)}`;
    for (let i = 1; i < reversed.length; i += 1) {
      d += ` L ${reversed[i - 1]!.x.toFixed(1)} ${reversed[i]!.y.toFixed(1)} L ${reversed[i]!.x.toFixed(1)} ${reversed[i]!.y.toFixed(1)}`;
    }
    return d;
  }
  if (curve === "smooth") {
    let d = `L ${reversed[0]!.x.toFixed(1)} ${reversed[0]!.y.toFixed(1)}`;
    for (let i = 1; i < reversed.length; i += 1) {
      const prev = reversed[i - 1]!;
      const curr = reversed[i]!;
      const mx = ((prev.x + curr.x) / 2).toFixed(1);
      d += ` C ${mx} ${prev.y.toFixed(1)}, ${mx} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    return d;
  }
  return reversed.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

export function WebSvgChart({
  kind,
  data,
  curve = "linear",
  stacked = false,
  hiddenSeries,
  selectedIndex,
  hoveredIndex = null,
  onSelectIndex,
  onHoverIndex,
  theme,
  width,
  height,
}: WebSvgChartProps): ReactElement | null {
  if (!isWebPlatform) return null;

  const visibleSeries = data.series.filter((s) => !hiddenSeries.has(s.key));
  const w = Math.max(280, width);
  const h = Math.max(180, height);
  const activeIdx = hoveredIndex ?? selectedIndex;

  if (kind === "pie" || kind === "donut") {
    const slices = data.pieSlices.filter((s) => s.value > 0);
    const total = slices.reduce((acc, s) => acc + s.value, 0);
    if (total <= 0) return null;

    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.min(w, h) * 0.42;
    const innerR = kind === "donut" ? outerR * 0.56 : 0;

    let angle = 0;
    const children: ReactNode[] = slices.map((slice, idx) => {
      const span = (slice.value / total) * 360;
      const start = angle;
      const end = angle + span;
      angle = end;
      const isActive = activeIdx === slice.rowIndex;
      const d = arcSlicePath(
        cx,
        cy,
        isActive ? outerR + 6 : outerR,
        innerR,
        start,
        end,
      );
      return svgEl("path", {
        key: `slice-${idx}`,
        d,
        fill: slice.color,
        stroke: theme.colors.surface1,
        strokeWidth: 2,
        opacity: activeIdx !== null && !isActive ? 0.5 : 1,
        style: { cursor: "pointer" },
        onMouseEnter: () => onHoverIndex?.(slice.rowIndex),
        onMouseLeave: () => onHoverIndex?.(null),
        onClick: () => onSelectIndex(selectedIndex === slice.rowIndex ? null : slice.rowIndex),
      });
    });

    if (kind === "donut") {
      const activeSlice =
        activeIdx !== null ? slices.find((s) => s.rowIndex === activeIdx) : undefined;
      children.push(
        svgEl(
          "text",
          {
            key: "center-val",
            x: cx,
            y: cy - 2,
            textAnchor: "middle",
            dominantBaseline: "central",
            fill: theme.colors.foreground,
            fontSize: 16,
            fontWeight: "700",
          },
          formatCompactNumber(activeSlice ? activeSlice.value : total),
        ),
        svgEl(
          "text",
          {
            key: "center-lbl",
            x: cx,
            y: cy + 16,
            textAnchor: "middle",
            dominantBaseline: "central",
            fill: theme.colors.foregroundMuted,
            fontSize: 11,
          },
          activeSlice ? truncateVisualText(activeSlice.label, 14) : "Total",
        ),
      );
    }

    return svgEl(
      "svg",
      {
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        style: { display: "block", maxWidth: "100%", userSelect: "none" },
      },
      ...children,
    );
  }

  const padLeft = 48;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 34;
  const plotW = Math.max(40, w - padLeft - padRight);
  const plotH = Math.max(40, h - padTop - padBottom);

  const count = data.xLabels.length;
  if (count === 0 || visibleSeries.length === 0) return null;

  if (kind === "scatter") {
    const pts: ScatterPoint[] =
      data.scatterPoints.length > 0
        ? data.scatterPoints.filter((p) => !hiddenSeries.has(p.seriesKey))
        : visibleSeries.flatMap((s) =>
            s.values
              .map((yVal, idx) =>
                yVal === null
                  ? null
                  : {
                      seriesKey: s.key,
                      seriesLabel: s.label,
                      color: s.color,
                      x: data.xNumbers[idx] ?? idx,
                      y: yVal,
                      xLabel: data.xLabels[idx] ?? String(idx),
                      rowIndex: idx,
                    },
              )
              .filter((v): v is ScatterPoint => v !== null),
          );
    if (pts.length === 0) return null;

    const xScale = computeNiceScale(
      Math.min(...pts.map((p) => p.x)),
      Math.max(...pts.map((p) => p.x)),
      5,
    );
    const yScale = computeNiceScale(
      Math.min(...pts.map((p) => p.y)),
      Math.max(...pts.map((p) => p.y)),
      5,
    );
    const mapX = (val: number) =>
      padLeft + ((val - xScale.min) / Math.max(1e-9, xScale.max - xScale.min)) * plotW;
    const mapY = (val: number) =>
      padTop + plotH - ((val - yScale.min) / Math.max(1e-9, yScale.max - yScale.min)) * plotH;

    const elements: ReactNode[] = [];
    yScale.ticks.forEach((tick, i) => {
      const py = mapY(tick);
      elements.push(
        svgEl("line", {
          key: `gy-${i}`,
          x1: padLeft,
          y1: py,
          x2: padLeft + plotW,
          y2: py,
          stroke: theme.colors.border,
          strokeDasharray: "3 3",
          strokeWidth: 1,
        }),
        svgEl(
          "text",
          {
            key: `gyl-${i}`,
            x: padLeft - 6,
            y: py + 3,
            textAnchor: "end",
            fill: theme.colors.foregroundMuted,
            fontSize: 10,
          },
          formatCompactNumber(tick),
        ),
      );
    });
    xScale.ticks.forEach((tick, i) => {
      const px = mapX(tick);
      elements.push(
        svgEl(
          "text",
          {
            key: `gxl-${i}`,
            x: px,
            y: padTop + plotH + 16,
            textAnchor: "middle",
            fill: theme.colors.foregroundMuted,
            fontSize: 10,
          },
          formatCompactNumber(tick),
        ),
      );
    });

    pts.forEach((pt, idx) => {
      const isActive = activeIdx === pt.rowIndex;
      elements.push(
        svgEl("circle", {
          key: `pt-${pt.seriesKey}-${idx}`,
          cx: mapX(pt.x),
          cy: mapY(pt.y),
          r: isActive ? 6.5 : 4.5,
          fill: pt.color,
          fillOpacity: activeIdx !== null && !isActive ? 0.35 : 0.88,
          stroke: isActive ? theme.colors.foreground : theme.colors.surface1,
          strokeWidth: isActive ? 2 : 1,
          style: { cursor: "pointer" },
          onMouseEnter: () => onHoverIndex?.(pt.rowIndex),
          onMouseLeave: () => onHoverIndex?.(null),
          onClick: () => onSelectIndex(selectedIndex === pt.rowIndex ? null : pt.rowIndex),
        }),
      );
    });

    return svgEl(
      "svg",
      {
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        style: { display: "block", maxWidth: "100%", userSelect: "none" },
      },
      ...elements,
    );
  }

  // Bar / Line / Area charts share Y-scale & categorical X
  let minY = 0;
  let maxY = 0;
  if (stacked) {
    for (let i = 0; i < count; i += 1) {
      let posSum = 0;
      let negSum = 0;
      for (const s of visibleSeries) {
        const v = s.values[i] ?? 0;
        if (v >= 0) posSum += v;
        else negSum += v;
      }
      maxY = Math.max(maxY, posSum);
      minY = Math.min(minY, negSum);
    }
  } else {
    const vals = visibleSeries.flatMap((s) => s.values.filter((v): v is number => v !== null));
    if (vals.length > 0) {
      minY = kind === "bar" ? Math.min(0, ...vals) : Math.min(...vals);
      maxY = kind === "bar" ? Math.max(0, ...vals) : Math.max(...vals);
    }
  }
  const yScale = computeNiceScale(minY, maxY, 5);
  const mapY = (val: number) =>
    padTop + plotH - ((val - yScale.min) / Math.max(1e-9, yScale.max - yScale.min)) * plotH;
  const zeroY = mapY(0);

  const elements: ReactNode[] = [];
  yScale.ticks.forEach((tick, i) => {
    const py = mapY(tick);
    elements.push(
      svgEl("line", {
        key: `gy-${i}`,
        x1: padLeft,
        y1: py,
        x2: padLeft + plotW,
        y2: py,
        stroke: theme.colors.border,
        strokeDasharray: tick === 0 ? undefined : "3 3",
        strokeWidth: 1,
      }),
      svgEl(
        "text",
        {
          key: `gyl-${i}`,
          x: padLeft - 6,
          y: py + 3,
          textAnchor: "end",
          fill: theme.colors.foregroundMuted,
          fontSize: 10,
        },
        formatCompactNumber(tick),
      ),
    );
  });

  // X axis labels (thin out when dense)
  const maxLabels = Math.max(2, Math.floor(plotW / 54));
  const stepLabel = Math.max(1, Math.ceil(count / maxLabels));
  const slotW = plotW / count;
  const getCategoryX = (idx: number) =>
    kind === "bar" || count === 1
      ? padLeft + slotW * idx + slotW / 2
      : padLeft + (idx / Math.max(1, count - 1)) * plotW;

  for (let idx = 0; idx < count; idx += stepLabel) {
    const rawLbl = data.xLabels[idx] ?? "";
    const lbl = truncateVisualText(rawLbl, 11);
    elements.push(
      svgEl(
        "text",
        {
          key: `xl-${idx}`,
          x: getCategoryX(idx),
          y: padTop + plotH + 17,
          textAnchor: "middle",
          fill: theme.colors.foregroundMuted,
          fontSize: 10,
        },
        lbl,
      ),
    );
  }

  // Subtle vertical crosshair when inspecting a point in line/area charts
  if (kind !== "bar" && activeIdx !== null && activeIdx >= 0 && activeIdx < count) {
    const guideX = getCategoryX(activeIdx);
    elements.push(
      svgEl("line", {
        key: "guide-x",
        x1: guideX,
        y1: padTop,
        x2: guideX,
        y2: padTop + plotH,
        stroke: theme.colors.accent,
        strokeDasharray: "3 3",
        strokeOpacity: 0.55,
        strokeWidth: 1.2,
      }),
    );
  }

  if (kind === "bar") {
    if (stacked) {
      const barW = Math.max(6, Math.min(44, slotW * 0.64));
      for (let idx = 0; idx < count; idx += 1) {
        let posBase = 0;
        let negBase = 0;
        const cx = getCategoryX(idx);
        const isActive = activeIdx === idx;
        visibleSeries.forEach((s) => {
          const val = s.values[idx];
          if (val === null || val === 0) return;
          const startVal = val >= 0 ? posBase : negBase;
          const endVal = startVal + val;
          if (val >= 0) posBase = endVal;
          else negBase = endVal;
          const yA = mapY(startVal);
          const yB = mapY(endVal);
          elements.push(
            svgEl("rect", {
              key: `bar-${s.key}-${idx}`,
              x: cx - barW / 2,
              y: Math.min(yA, yB),
              width: barW,
              height: Math.max(1.5, Math.abs(yA - yB)),
              rx: 2,
              fill: s.color,
              opacity: activeIdx !== null && !isActive ? 0.45 : 0.94,
              style: { cursor: "pointer" },
              onMouseEnter: () => onHoverIndex?.(idx),
              onMouseLeave: () => onHoverIndex?.(null),
              onClick: () => onSelectIndex(selectedIndex === idx ? null : idx),
            }),
          );
        });
      }
    } else {
      const groupW = Math.max(8, Math.min(56, slotW * 0.72));
      const barW = Math.max(4, groupW / Math.max(1, visibleSeries.length) - 2);
      for (let idx = 0; idx < count; idx += 1) {
        const slotLeft = getCategoryX(idx) - groupW / 2;
        const isActive = activeIdx === idx;
        visibleSeries.forEach((s, sIdx) => {
          const val = s.values[idx];
          if (val === null) return;
          const yVal = mapY(val);
          elements.push(
            svgEl("rect", {
              key: `bar-${s.key}-${idx}`,
              x: slotLeft + sIdx * (barW + 2),
              y: Math.min(zeroY, yVal),
              width: barW,
              height: Math.max(1.5, Math.abs(zeroY - yVal)),
              rx: 2,
              fill: s.color,
              opacity: activeIdx !== null && !isActive ? 0.45 : 0.94,
              style: { cursor: "pointer" },
              onMouseEnter: () => onHoverIndex?.(idx),
              onMouseLeave: () => onHoverIndex?.(null),
              onClick: () => onSelectIndex(selectedIndex === idx ? null : idx),
            }),
          );
        });
      }
    }
  } else if (kind === "area" && stacked) {
    // True cumulative stacked area bands
    const runningTotals = new Array<number>(count).fill(0);
    visibleSeries.forEach((s) => {
      const lowerPts: Array<{ x: number; y: number }> = [];
      const upperPts: Array<{ x: number; y: number; idx: number }> = [];
      for (let idx = 0; idx < count; idx += 1) {
        const base = runningTotals[idx] ?? 0;
        const val = s.values[idx] ?? 0;
        const top = base + val;
        runningTotals[idx] = top;
        const px = getCategoryX(idx);
        lowerPts.push({ x: px, y: mapY(base) });
        upperPts.push({ x: px, y: mapY(top), idx });
      }
      const topLine = buildLinePath(upperPts, curve);
      const revLower = buildReverseLinePath(lowerPts, curve);
      elements.push(
        svgEl("path", {
          key: `sarea-${s.key}`,
          d: `${topLine} ${revLower} Z`,
          fill: s.color,
          fillOpacity: 0.28,
        }),
        svgEl("path", {
          key: `sline-${s.key}`,
          d: topLine,
          fill: "none",
          stroke: s.color,
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      );
      if (upperPts.length <= 48) {
        upperPts.forEach((pt) => {
          const isActive = activeIdx === pt.idx;
          elements.push(
            svgEl("circle", {
              key: `sdot-${s.key}-${pt.idx}`,
              cx: pt.x,
              cy: pt.y,
              r: isActive ? 5.5 : 3.2,
              fill: isActive ? theme.colors.surface0 : s.color,
              stroke: s.color,
              strokeWidth: isActive ? 2.5 : 1,
              style: { cursor: "pointer" },
              onMouseEnter: () => onHoverIndex?.(pt.idx),
              onMouseLeave: () => onHoverIndex?.(null),
              onClick: () => onSelectIndex(selectedIndex === pt.idx ? null : pt.idx),
            }),
          );
        });
      }
    });
  } else {
    // Line or unstacked Area
    visibleSeries.forEach((s) => {
      const pts: Array<{ x: number; y: number; idx: number }> = [];
      s.values.forEach((val, idx) => {
        if (val !== null) {
          pts.push({ x: getCategoryX(idx), y: mapY(val), idx });
        }
      });
      if (pts.length === 0) return;

      const linePath = buildLinePath(pts, curve);
      if (kind === "area" && pts.length >= 2) {
        const baseLine = Math.min(padTop + plotH, Math.max(padTop, zeroY));
        const areaPath = `${linePath} L ${pts[pts.length - 1]!.x} ${baseLine} L ${pts[0]!.x} ${baseLine} Z`;
        elements.push(
          svgEl("path", {
            key: `area-${s.key}`,
            d: areaPath,
            fill: s.color,
            fillOpacity: 0.18,
          }),
        );
      }

      elements.push(
        svgEl("path", {
          key: `line-${s.key}`,
          d: linePath,
          fill: "none",
          stroke: s.color,
          strokeWidth: 2.2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      );

      if (pts.length <= 48) {
        pts.forEach((pt) => {
          const isActive = activeIdx === pt.idx;
          elements.push(
            svgEl("circle", {
              key: `dot-${s.key}-${pt.idx}`,
              cx: pt.x,
              cy: pt.y,
              r: isActive ? 5.5 : 3.2,
              fill: isActive ? theme.colors.surface0 : s.color,
              stroke: s.color,
              strokeWidth: isActive ? 2.5 : 1,
              style: { cursor: "pointer" },
              onMouseEnter: () => onHoverIndex?.(pt.idx),
              onMouseLeave: () => onHoverIndex?.(null),
              onClick: () => onSelectIndex(selectedIndex === pt.idx ? null : pt.idx),
            }),
          );
        });
      }
    });
  }

  return svgEl(
    "svg",
    {
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      style: { display: "block", maxWidth: "100%", userSelect: "none" },
    },
    ...elements,
  );
}

export interface WebSvgGraphProps {
  layout: GraphLayoutResult;
  theme: PluginTheme;
  viewportHeight: number;
  transform: GraphViewTransform;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  focusedIds: ReadonlySet<string> | null;
  activeStepNumber?: number | null;
  animateFlow?: boolean;
  enableTouchGestures?: boolean;
  onTransformChange(next: GraphViewTransform): void;
  onShiftNodes(nodeIds: readonly string[], dx: number, dy: number): void;
  onHoverNode(id: string | null): void;
  onSelectNode(id: string | null): void;
}

interface SvgPointerEventLike {
  button?: number;
  pointerType: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  stopPropagation(): void;
  preventDefault(): void;
  currentTarget: {
    setPointerCapture?(id: number): void;
    releasePointerCapture?(id: number): void;
    getBoundingClientRect?(): { left: number; top: number; width: number; height: number };
  };
}

interface SvgWheelEventLike {
  deltaMode: number;
  deltaY: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}

interface GraphSvgElement {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  addEventListener(
    type: "wheel",
    listener: (event: SvgWheelEventLike) => void,
    options: { passive: boolean },
  ): void;
  removeEventListener(type: "wheel", listener: (event: SvgWheelEventLike) => void): void;
}

interface ActiveDragState {
  mode: "pan" | "node" | "group";
  nodeIds: readonly string[];
  clickedNodeId: string | null;
  lastClientX: number;
  lastClientY: number;
  movedDist: number;
  capturedTarget: SvgPointerEventLike["currentTarget"] | null;
  pointerId: number;
}

function statusHex(status: string | undefined, theme: PluginTheme): string | null {
  switch (status) {
    case "done":
      return theme.colors.statusSuccess;
    case "active":
    case "review":
      return theme.colors.accent;
    case "blocked":
      return theme.colors.statusWarning;
    case "failed":
      return theme.colors.statusDanger;
    default:
      return null;
  }
}

function typeAccentColor(type: PositionedNode["node"]["type"], theme: PluginTheme): string {
  switch (type) {
    case "database":
    case "storage":
      return theme.colors.statusSuccess;
    case "queue":
    case "decision":
      return theme.colors.statusWarning;
    case "external":
      return theme.colors.statusDanger;
    case "client":
    case "actor":
    case "person":
    case "service":
    case "function":
    case "metric":
      return theme.colors.accent;
    default:
      return theme.colors.foregroundMuted;
  }
}

function glyphShapeProps(shape: GlyphShape, color: string, key: number): Record<string, unknown> {
  const filled = shape.fill === "color";
  const props: Record<string, unknown> = {
    key,
    fill: filled ? color : "none",
    stroke: filled || shape.tag === "text" ? "none" : color,
  };
  if (shape.tag !== "text") {
    props.strokeWidth = 1.5;
    props.strokeLinecap = "round";
    props.strokeLinejoin = "round";
  }
  if (shape.d !== undefined) props.d = shape.d;
  if (shape.x !== undefined) props.x = shape.x;
  if (shape.y !== undefined) props.y = shape.y;
  if (shape.width !== undefined) props.width = shape.width;
  if (shape.height !== undefined) props.height = shape.height;
  if (shape.rx !== undefined) props.rx = shape.rx;
  if (shape.ry !== undefined) props.ry = shape.ry;
  if (shape.cx !== undefined) props.cx = shape.cx;
  if (shape.cy !== undefined) props.cy = shape.cy;
  if (shape.r !== undefined) props.r = shape.r;
  if (shape.points !== undefined) props.points = shape.points;
  if (shape.tag === "text") {
    props.textAnchor = "middle";
    props.fontSize = shape.fontSize ?? 11;
    props.fontWeight = "700";
    if (shape.italic) props.fontStyle = "italic";
  }
  return props;
}

function renderNodeBadgeGlyph(
  type: PositionedNode["node"]["type"],
  cx: number,
  cy: number,
  color: string,
  label: string,
): ReactElement {
  return svgEl(
    "g",
    { key: "glyph" },
    ...nodeGlyphShapes(type, cx, cy, label).map((shape, index) =>
      svgEl(shape.tag, glyphShapeProps(shape, color, index), shape.text),
    ),
  );
}

export function WebSvgGraph({
  layout,
  theme,
  viewportHeight,
  transform,
  selectedNodeId,
  hoveredNodeId,
  focusedIds,
  activeStepNumber = null,
  animateFlow = true,
  enableTouchGestures = false,
  onTransformChange,
  onShiftNodes,
  onHoverNode,
  onSelectNode,
}: WebSvgGraphProps): ReactElement | null {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, "");
  const [draggingMode, setDraggingMode] = useState<"idle" | "pan" | "node" | "group">("idle");
  const dragRef = useRef<ActiveDragState | null>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const touchTap = useRef<{ id: string | null; distance: number } | null>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const graphSvgRef = useRef<GraphSvgElement | null>(null);

  useEffect(() => {
    const svg = graphSvgRef.current;
    if (!svg) return;

    const onWheel = (event: SvgWheelEventLike) => {
      const { deltaMode, deltaY } = event;
      if (!deltaY) return;

      event.preventDefault();
      event.stopPropagation();

      const rect = svg.getBoundingClientRect();
      const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? rect.height : 1;
      const delta = Math.max(-120, Math.min(120, deltaY * unit));
      const current = transformRef.current;
      const next = zoomAroundPoint(
        current,
        Math.exp(-delta * 0.0012),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      if (next === current) return;
      transformRef.current = next;
      onTransformChange(next);
    };

    // React's delegated wheel listener is passive. Bind to the canvas to cancel browser scrolling.
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [onTransformChange]);

  if (!isWebPlatform) return null;

  const idPrefix = `gt-${uid}`;
  const arrowId = `${idPrefix}-arrow`;
  const arrowAccentId = `${idPrefix}-arrow-accent`;
  const arrowDangerId = `${idPrefix}-arrow-danger`;
  const gridPatternId = `${idPrefix}-dots`;
  const shadowFilterId = `${idPrefix}-shadow`;
  const glowFilterId = `${idPrefix}-glow`;

  const highlightNodeId = hoveredNodeId ?? selectedNodeId;
  const connectedNodes = new Set<string>();
  if (highlightNodeId) {
    connectedNodes.add(highlightNodeId);
    for (const e of layout.edges) {
      if (e.edge.from === highlightNodeId) connectedNodes.add(e.edge.to);
      if (e.edge.to === highlightNodeId) connectedNodes.add(e.edge.from);
    }
  }

  const selectNode = (id: string | null) => {
    onSelectNode(selectedNodeId === id ? null : id);
  };

  const startDrag = (
    e: SvgPointerEventLike,
    mode: ActiveDragState["mode"],
    nodeIds: readonly string[],
    clickedNodeId: string | null,
  ) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();

    const isTouch = e.pointerType === "touch";
    if (!isTouch || enableTouchGestures) {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Pointer capture is optional in embedded browsers.
      }
    }

    if (isTouch) {
      const points = touchPoints.current;
      touchTap.current = points.size === 0 ? { id: clickedNodeId, distance: 0 } : null;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }

    e.preventDefault();
    dragRef.current = {
      mode,
      nodeIds,
      clickedNodeId,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      movedDist: 0,
      capturedTarget: e.currentTarget,
      pointerId: e.pointerId,
    };
    setDraggingMode(mode);
  };

  const updateTransform = (next: GraphViewTransform) => {
    transformRef.current = next;
    onTransformChange(next);
  };

  const moveTouch = (e: SvgPointerEventLike) => {
    const points = touchPoints.current;
    const previous = points.get(e.pointerId);
    if (!previous) return;

    const next = { x: e.clientX, y: e.clientY };
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    points.set(e.pointerId, next);
    if (touchTap.current) touchTap.current.distance += Math.hypot(dx, dy);
    if (!enableTouchGestures) return;

    const current = transformRef.current;
    if (points.size === 1) {
      updateTransform({ ...current, x: current.x + dx, y: current.y + dy });
      return;
    }
    if (points.size !== 2) return;

    const other = [...points.entries()].find(([id]) => id !== e.pointerId)?.[1];
    const rect = graphSvgRef.current?.getBoundingClientRect();
    if (!other || !rect) return;

    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    if (before < 1) return;
    const factor = Math.hypot(next.x - other.x, next.y - other.y) / before;
    const zoomed = zoomAroundPoint(
      current,
      factor,
      (previous.x + other.x) / 2 - rect.left,
      (previous.y + other.y) / 2 - rect.top,
    );
    updateTransform({ ...zoomed, x: zoomed.x + dx / 2, y: zoomed.y + dy / 2 });
  };

  const handlePointerMove = (e: SvgPointerEventLike) => {
    if (e.pointerType === "touch") {
      moveTouch(e);
      return;
    }

    const active = dragRef.current;
    if (!active || active.pointerId !== e.pointerId) return;
    const dx = e.clientX - active.lastClientX;
    const dy = e.clientY - active.lastClientY;
    if (dx === 0 && dy === 0) return;

    active.lastClientX = e.clientX;
    active.lastClientY = e.clientY;
    active.movedDist += Math.hypot(dx, dy);

    const cur = transformRef.current;
    if (active.mode === "pan") {
      updateTransform({ ...cur, x: cur.x + dx, y: cur.y + dy });
    } else if (active.nodeIds.length > 0) {
      onShiftNodes(active.nodeIds, dx / cur.scale, dy / cur.scale);
    }
  };

  const finishDrag = (e: SvgPointerEventLike, canceled = false) => {
    if (e.pointerType === "touch") {
      if (!touchPoints.current.delete(e.pointerId)) return;
      const tap = touchTap.current;
      touchTap.current = null;
      if (!canceled && tap && tap.distance < 5) selectNode(tap.id);
      e.stopPropagation();
      return;
    }

    const active = dragRef.current;
    if (!active || active.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDraggingMode("idle");
    try {
      active.capturedTarget?.releasePointerCapture?.(active.pointerId);
    } catch {
      // The browser may already have released the pointer.
    }

    if (!canceled && active.movedDist < 5) {
      if (active.mode === "node") selectNode(active.clickedNodeId);
      else if (active.mode === "pan") selectNode(null);
    }
    e.stopPropagation();
  };

  const defs = svgEl(
    "defs",
    { key: "defs" },
    svgEl(
      "pattern",
      {
        id: gridPatternId,
        width: 22,
        height: 22,
        patternUnits: "userSpaceOnUse",
        patternTransform: `translate(${transform.x} ${transform.y}) scale(${transform.scale})`,
      },
      svgEl("circle", {
        cx: 11,
        cy: 11,
        r: 1.05,
        fill: theme.colors.border,
        fillOpacity: 0.7,
      }),
    ),
    svgEl(
      "filter",
      { id: shadowFilterId, x: "-12%", y: "-12%", width: "124%", height: "130%" },
      svgEl("feDropShadow", {
        dx: 0,
        dy: 2,
        stdDeviation: 3,
        floodColor: "#000000",
        floodOpacity: 0.14,
      }),
    ),
    svgEl(
      "filter",
      { id: glowFilterId, x: "-22%", y: "-22%", width: "144%", height: "144%" },
      svgEl("feDropShadow", {
        dx: 0,
        dy: 0,
        stdDeviation: 5.5,
        floodColor: theme.colors.accent,
        floodOpacity: 0.45,
      }),
    ),
    svgEl(
      "marker",
      {
        id: arrowId,
        viewBox: "0 0 10 10",
        refX: 8.5,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: "auto-start-reverse",
      },
      svgEl("path", { d: "M 0 1.2 L 9 5 L 0 8.8 z", fill: theme.colors.foregroundMuted }),
    ),
    svgEl(
      "marker",
      {
        id: arrowAccentId,
        viewBox: "0 0 10 10",
        refX: 8.5,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse",
      },
      svgEl("path", { d: "M 0 1.2 L 9 5 L 0 8.8 z", fill: theme.colors.accent }),
    ),
    svgEl(
      "marker",
      {
        id: arrowDangerId,
        viewBox: "0 0 10 10",
        refX: 8.5,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse",
      },
      svgEl("path", { d: "M 0 1.2 L 9 5 L 0 8.8 z", fill: theme.colors.statusDanger }),
    ),
  );

  const stageChildren: ReactNode[] = [];

  // 1. Groups (draggable container frames)
  for (const grp of layout.groups) {
    const hasFocusedChild =
      focusedIds !== null && grp.memberIds.some((id) => focusedIds.has(id));
    const hasHighlightChild =
      highlightNodeId !== null && grp.memberIds.includes(highlightNodeId);
    const groupDimmed = focusedIds !== null && !hasFocusedChild;

    stageChildren.push(
      svgEl(
        "g",
        {
          key: `grp-${grp.node.id}`,
          opacity: groupDimmed ? 0.28 : 1,
          style: { cursor: draggingMode === "group" ? "grabbing" : "grab" },
          onPointerDown: (e: SvgPointerEventLike) => {
            const groupIds = new Set([grp.node.id]);
            for (const { node } of layout.groups) {
              if (node.group && groupIds.has(node.group)) groupIds.add(node.id);
            }
            startDrag(e, "group", [...grp.memberIds, ...groupIds], null);
          },
        },
        svgEl("rect", {
          x: grp.x,
          y: grp.y,
          width: grp.width,
          height: grp.height,
          rx: 14,
          fill: theme.colors.surface2,
          fillOpacity: hasFocusedChild || hasHighlightChild ? 0.56 : 0.42,
          stroke:
            hasFocusedChild || hasHighlightChild ? theme.colors.accent : theme.colors.border,
          strokeOpacity: hasFocusedChild || hasHighlightChild ? 0.5 : 0.9,
          strokeWidth: hasFocusedChild || hasHighlightChild ? 1.5 : 1.1,
        }),
        svgEl("circle", {
          cx: grp.x + 16,
          cy: grp.y + 20,
          r: 3,
          fill: hasFocusedChild ? theme.colors.accent : theme.colors.foregroundMuted,
        }),
        svgEl(
          "text",
          {
            x: grp.x + 25,
            y: grp.y + 23.5,
            fill: hasFocusedChild ? theme.colors.foreground : theme.colors.foregroundMuted,
            fontSize: 10.5,
            fontWeight: "700",
            letterSpacing: "0.05em",
          },
          (grp.node.label || grp.node.id).toUpperCase(),
        ),
      ),
    );
  }

  // 2. Edges (SmoothStep orthogonal paths + animated data-flow effects)
  for (const edgeBox of layout.edges) {
    const isConnectedToHighlight =
      highlightNodeId !== null &&
      (edgeBox.edge.from === highlightNodeId || edgeBox.edge.to === highlightNodeId);
    const bothFocused =
      focusedIds !== null &&
      focusedIds.has(edgeBox.edge.from) &&
      focusedIds.has(edgeBox.edge.to);
    const halfFocused =
      focusedIds !== null &&
      !bothFocused &&
      (focusedIds.has(edgeBox.edge.from) || focusedIds.has(edgeBox.edge.to));
    const isHighlighted = isConnectedToHighlight || bothFocused;

    let edgeOpacity = 0.88;
    if (focusedIds !== null) {
      edgeOpacity = bothFocused ? 1 : halfFocused ? 0.34 : 0.14;
    } else if (highlightNodeId !== null) {
      edgeOpacity = isConnectedToHighlight ? 1 : 0.2;
    }

    const isBlocks = edgeBox.edge.kind === "blocks";
    const strokeColor = isBlocks
      ? theme.colors.statusDanger
      : isHighlighted
        ? theme.colors.accent
        : theme.colors.foregroundMuted;
    const isAsyncKind =
      edgeBox.edge.kind === "async" ||
      edgeBox.edge.kind === "depends" ||
      edgeBox.isBackEdge;
    const isFlowAnimated =
      animateFlow &&
      !isBlocks &&
      edgeOpacity > 0.45 &&
      (isHighlighted ||
        edgeBox.edge.kind === "data" ||
        edgeBox.edge.kind === "flow" ||
        edgeBox.edge.kind === "async");

    const markerEnd = isBlocks
      ? `url(#${arrowDangerId})`
      : isHighlighted
        ? `url(#${arrowAccentId})`
        : `url(#${arrowId})`;

    const edgeParts: ReactNode[] = [
      // Soft base track beneath animated dash stream
      svgEl("path", {
        key: "track",
        d: edgeBox.svgPath,
        fill: "none",
        stroke: strokeColor,
        strokeOpacity: isFlowAnimated ? 0.38 : 1,
        strokeWidth: isHighlighted ? 2.4 : 1.5,
        strokeDasharray: isAsyncKind && !isFlowAnimated ? "5 4" : undefined,
        markerEnd,
      }),
    ];

    if (isFlowAnimated) {
      // Marching data-stream dash overlay
      edgeParts.push(
        svgEl(
          "path",
          {
            key: "flow-dash",
            d: edgeBox.svgPath,
            fill: "none",
            stroke: strokeColor,
            strokeWidth: isHighlighted ? 2.4 : 1.6,
            strokeDasharray: isHighlighted ? "8 6" : "5 7",
            strokeLinecap: "round",
          },
          svgEl("animate", {
            attributeName: "stroke-dashoffset",
            values: "28;0",
            dur: isHighlighted ? "0.85s" : "1.45s",
            repeatCount: "indefinite",
          }),
        ),
      );

      // Glowing packet dot riding the exact SmoothStep curve
      const packetDur = isHighlighted ? "1.45s" : "2.4s";
      const packetColor = isHighlighted ? theme.colors.accent : strokeColor;
      edgeParts.push(
        svgEl(
          "g",
          { key: "packet" },
          svgEl("circle", {
            cx: 0,
            cy: 0,
            r: isHighlighted ? 5.5 : 4,
            fill: packetColor,
            fillOpacity: isHighlighted ? 0.28 : 0.16,
          }),
          svgEl("circle", {
            cx: 0,
            cy: 0,
            r: isHighlighted ? 2.9 : 2.1,
            fill: packetColor,
          }),
          svgEl("animateMotion", {
            dur: packetDur,
            repeatCount: "indefinite",
            path: edgeBox.svgPath,
          }),
        ),
      );
    }

    // Crisp pill label along edge
    if (edgeBox.edge.label) {
      const clipped = truncateVisualText(edgeBox.edge.label, 24);
      const pillW = Math.min(188, Math.max(40, visualTextUnits(clipped) * 6.7 + 18));
      edgeParts.push(
        svgEl(
          "g",
          { key: "label" },
          svgEl("rect", {
            x: edgeBox.labelX - pillW / 2,
            y: edgeBox.labelY - 10,
            width: pillW,
            height: 20,
            rx: 10,
            fill: theme.colors.surface0,
            stroke: isHighlighted ? theme.colors.accent : theme.colors.border,
            strokeWidth: isHighlighted ? 1.3 : 0.9,
          }),
          svgEl(
            "text",
            {
              x: edgeBox.labelX,
              y: edgeBox.labelY + 3.5,
              textAnchor: "middle",
              fill: isHighlighted ? theme.colors.foreground : theme.colors.foregroundMuted,
              fontSize: 10,
              fontWeight: isHighlighted ? "700" : "500",
            },
            clipped,
          ),
        ),
      );
    }

    stageChildren.push(
      svgEl(
        "g",
        { key: `edge-${edgeBox.index}`, opacity: edgeOpacity },
        ...edgeParts,
      ),
    );
  }

  // 3. Nodes (React Flow-styled cards + pills + icons + drag + glow)
  for (const box of layout.nodes) {
    const { node, x, y, width, height } = box;
    const isSelected = selectedNodeId === node.id;
    const isHovered = hoveredNodeId === node.id;
    const isFocusTarget = focusedIds ? focusedIds.has(node.id) : false;
    const isDimmed =
      (focusedIds !== null && !isFocusTarget) ||
      (focusedIds === null && highlightNodeId !== null && !connectedNodes.has(node.id));

    const isPill =
      (node.type === "actor" || node.type === "client" || node.type === "person") &&
      !node.fields?.length &&
      !node.items?.length &&
      !node.value &&
      !node.image;

    const cardRx = isPill ? Math.min(height / 2, 26) : node.type === "decision" ? 16 : 12;
    const sColor = statusHex(node.status, theme);
    const badgeColor = typeAccentColor(node.type, theme);
    const isLit = isSelected || isFocusTarget || isHovered;
    const isAccented = isLit || Boolean(node.emphasis);

    const inner: ReactNode[] = [];

    // Outer subtle accent ring when focused/selected
    if (isSelected || isFocusTarget) {
      inner.push(
        svgEl("rect", {
          key: "halo",
          x: x - 3.5,
          y: y - 3.5,
          width: width + 7,
          height: height + 7,
          rx: cardRx + 3.5,
          fill: "none",
          stroke: theme.colors.accent,
          strokeOpacity: 0.25,
          strokeWidth: 4,
        }),
      );
    }

    // Card surface
    inner.push(
      svgEl("rect", {
        key: "bg",
        x,
        y,
        width,
        height,
        rx: cardRx,
        fill: isSelected || isFocusTarget ? theme.colors.surface1 : theme.colors.surface0,
        stroke: isAccented ? theme.colors.accent : theme.colors.border,
        strokeWidth: isSelected || isFocusTarget ? 2 : isHovered || node.emphasis ? 1.6 : 1.1,
        filter: isSelected || isFocusTarget ? `url(#${glowFilterId})` : `url(#${shadowFilterId})`,
      }),
    );

    // Subtle React Flow handle dots along primary flow axis
    const isHorizontalFlow = layout.direction === "right" || layout.direction === "left";
    const portFill = isLit ? theme.colors.accent : theme.colors.surface2;
    const portStroke = isLit ? theme.colors.surface0 : theme.colors.border;
    if (isHorizontalFlow) {
      inner.push(
        svgEl("circle", {
          key: "port-l",
          cx: x,
          cy: y + height / 2,
          r: 3.1,
          fill: portFill,
          stroke: portStroke,
          strokeWidth: 1.1,
        }),
        svgEl("circle", {
          key: "port-r",
          cx: x + width,
          cy: y + height / 2,
          r: 3.1,
          fill: portFill,
          stroke: portStroke,
          strokeWidth: 1.1,
        }),
      );
    } else {
      inner.push(
        svgEl("circle", {
          key: "port-t",
          cx: x + width / 2,
          cy: y,
          r: 3.1,
          fill: portFill,
          stroke: portStroke,
          strokeWidth: 1.1,
        }),
        svgEl("circle", {
          key: "port-b",
          cx: x + width / 2,
          cy: y + height,
          r: 3.1,
          fill: portFill,
          stroke: portStroke,
          strokeWidth: 1.1,
        }),
      );
    }

    // Left icon badge
    const badgeSize = 28;
    const badgeX = x + 12;
    const badgeY = isPill ? y + (height - badgeSize) / 2 : y + 14;
    inner.push(
      svgEl("rect", {
        key: "badge-bg",
        x: badgeX,
        y: badgeY,
        width: badgeSize,
        height: badgeSize,
        rx: isPill ? badgeSize / 2 : 8,
        fill: badgeColor,
        fillOpacity: 0.14,
        stroke: badgeColor,
        strokeOpacity: 0.28,
        strokeWidth: 0.9,
      }),
      renderNodeBadgeGlyph(
        node.type,
        badgeX + badgeSize / 2,
        badgeY + badgeSize / 2,
        badgeColor,
        node.label || node.id,
      ),
    );

    // Top-right STEP N floating badge (pinned above border so label never truncates) or status dot
    let rightReserved = 12;
    if (isFocusTarget && activeStepNumber !== null) {
      const badgeText = `STEP ${activeStepNumber}`;
      const pillW = badgeText.length * 5.6 + 12;
      inner.push(
        svgEl("rect", {
          key: "step-pill-bg",
          x: x + width - pillW - 10,
          y: y - 8,
          width: pillW,
          height: 15,
          rx: 7.5,
          fill: theme.colors.accent,
          stroke: theme.colors.surface0,
          strokeWidth: 1.5,
        }),
        svgEl(
          "text",
          {
            key: "step-pill-txt",
            x: x + width - pillW / 2 - 10,
            y: y + 2,
            textAnchor: "middle",
            fill: theme.colors.accentForeground,
            fontSize: 8.5,
            fontWeight: "700",
          },
          badgeText,
        ),
      );
    } else if (sColor) {
      rightReserved = 20;
      inner.push(
        svgEl("circle", {
          key: "dot",
          cx: x + width - 12,
          cy: y + 13,
          r: 3.8,
          fill: sColor,
        }),
      );
    }

    // Primary label + sublabel aligned right of the icon badge
    const textX = badgeX + badgeSize + 10;
    const maxLabelUnits = Math.max(10, (width - (textX - x) - rightReserved) / 7.5);
    const maxSubUnits = Math.max(10, (width - (textX - x) - 12) / 6.7);
    const labelY = isPill ? (node.sublabel ? y + 23 : y + height / 2 + 4.5) : y + 26;

    inner.push(
      svgEl(
        "text",
        {
          key: "lbl",
          x: textX,
          y: labelY,
          fill: theme.colors.foreground,
          fontSize: 12.5,
          fontWeight: "600",
        },
        truncateVisualText(node.label, maxLabelUnits),
      ),
    );

    let lineY = labelY + 16;
    if (node.sublabel) {
      inner.push(
        svgEl(
          "text",
          {
            key: "sub",
            x: textX,
            y: lineY,
            fill: theme.colors.foregroundMuted,
            fontSize: 10.5,
          },
          truncateVisualText(node.sublabel, maxSubUnits),
        ),
      );
      lineY += 18;
    }

    if (node.value !== undefined) {
      inner.push(
        svgEl(
          "text",
          {
            key: "val",
            x: x + 14,
            y: Math.max(lineY + 6, y + 60),
            fill: theme.colors.accent,
            fontSize: 14,
            fontWeight: "700",
          },
          String(node.value),
        ),
      );
      lineY += 22;
    }

    let extraY = Math.max(lineY + 2, y + 54);
    const imageHref = safeGraphImageHref(node.image);
    if (imageHref) {
      inner.push(
        svgEl("image", {
          key: "photo",
          href: imageHref,
          x: x + 14,
          y: extraY,
          width: width - 28,
          height: 44,
          preserveAspectRatio: "xMidYMid slice",
        }),
      );
      extraY += 50;
    }
    for (const [fIdx, field] of (node.fields ?? []).slice(0, 6).entries()) {
      const keyTag = field.key ? `${field.key.toUpperCase()} ` : "";
      inner.push(
        svgEl(
          "text",
          {
            key: `fld-${fIdx}`,
            x: x + 14,
            y: extraY,
            fill: theme.colors.foregroundMuted,
            fontSize: 10,
          },
          truncateVisualText(
            `${keyTag}${field.name}${field.type ? `: ${field.type}` : ""}`,
            (width - 28) / 6.5,
          ),
        ),
      );
      extraY += 16;
    }

    for (const [iIdx, item] of (node.items ?? []).slice(0, 6).entries()) {
      const mark = item.status === "done" ? "✓" : item.status === "failed" ? "✕" : "•";
      inner.push(
        svgEl(
          "text",
          {
            key: `itm-${iIdx}`,
            x: x + 14,
            y: extraY,
            fill: theme.colors.foregroundMuted,
            fontSize: 10,
          },
          truncateVisualText(`${mark} ${item.label}`, (width - 28) / 6.5),
        ),
      );
      extraY += 16;
    }

    stageChildren.push(
      svgEl(
        "g",
        {
          key: `node-${node.id}`,
          opacity: isDimmed ? 0.22 : 1,
          style: { cursor: draggingMode === "node" ? "grabbing" : "grab" },
          onMouseEnter: () => onHoverNode(node.id),
          onMouseLeave: () => {
            if (hoveredNodeId === node.id) onHoverNode(null);
          },
          onPointerDown: (e: SvgPointerEventLike) =>
            startDrag(e, "node", [node.id], node.id),
        },
        ...inner,
      ),
    );
  }

  return svgEl(
    "svg",
    {
      width: "100%",
      ref: graphSvgRef,
      height: viewportHeight,
      style: {
        display: "block",
        width: "100%",
        height: viewportHeight,
        touchAction: enableTouchGestures ? "none" : "pan-y pinch-zoom",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: draggingMode === "idle" ? "grab" : "grabbing",
      },
      onPointerDown: (e: SvgPointerEventLike) => startDrag(e, "pan", [], null),
      onPointerMove: handlePointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: (e: SvgPointerEventLike) => finishDrag(e, true),
    },
    defs,
    svgEl("rect", {
      key: "dot-grid",
      x: 0,
      y: 0,
      width: "100%",
      height: "100%",
      fill: `url(#${gridPatternId})`,
    }),
    svgEl(
      "g",
      {
        key: "stage",
        transform: `translate(${transform.x} ${transform.y}) scale(${transform.scale})`,
      },
      ...stageChildren,
    ),
  );
}

