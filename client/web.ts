import type { PluginTheme } from "@getpaseo/plugin";
import { createElement, type ReactElement, type ReactNode } from "react";
import { Platform } from "react-native";
import type { GraphLayoutResult } from "../shared/graph-layout";
import { truncateVisualText, visualTextUnits } from "../shared/query-engine";
import type { ChartKind } from "../shared/view-schema";
import { computeNiceScale, formatCompactNumber, type ParsedChartData } from "./format";

export const isWebPlatform = Platform.OS === "web";

const svgEl = createElement as unknown as (
  type: string,
  props: Record<string, unknown> | null,
  ...children: ReactNode[]
) => ReactElement;

export interface WebSvgChartProps {
  kind: ChartKind;
  data: ParsedChartData;
  curve?: "smooth" | "linear" | "step";
  stacked?: boolean;
  hiddenSeries: ReadonlySet<string>;
  selectedIndex: number | null;
  onSelectIndex(index: number | null): void;
  theme: PluginTheme;
  width: number;
  height: number;
}

function buildLinePath(
  points: Array<{ x: number; y: number }>,
  curve: "smooth" | "linear" | "step",
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (curve === "step") {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      d += ` L ${points[i].x} ${points[i - 1].y} L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }
  if (curve === "smooth") {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const mx = (prev.x + curr.x) / 2;
      d += ` C ${mx} ${prev.y}, ${mx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return d;
  }
  return points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcSlicePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = Math.min(359.99, endAngle - startAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  const p1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = polarToCartesian(cx, cy, rOuter, startAngle + sweep);
  if (rInner <= 0) {
    return [
      `M ${cx} ${cy}`,
      `L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  }
  const p3 = polarToCartesian(cx, cy, rInner, startAngle + sweep);
  const p4 = polarToCartesian(cx, cy, rInner, startAngle);
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function WebSvgChart({
  kind,
  data,
  curve = "linear",
  stacked = false,
  hiddenSeries,
  selectedIndex,
  onSelectIndex,
  theme,
  width,
  height,
}: WebSvgChartProps): ReactElement | null {
  if (!isWebPlatform) return null;

  const visibleSeries = data.series.filter((s) => !hiddenSeries.has(s.key));
  const w = Math.max(280, width);
  const h = Math.max(180, height);

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
      const isSelected = selectedIndex === slice.rowIndex;
      const d = arcSlicePath(
        cx,
        cy,
        isSelected ? outerR + 5 : outerR,
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
        opacity: selectedIndex !== null && !isSelected ? 0.55 : 1,
        style: { cursor: "pointer" },
        onClick: () => onSelectIndex(isSelected ? null : slice.rowIndex),
      });
    });

    if (kind === "donut") {
      const activeSlice =
        selectedIndex !== null
          ? slices.find((s) => s.rowIndex === selectedIndex)
          : undefined;
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
          activeSlice ? activeSlice.label.slice(0, 14) : "Total",
        ),
      );
    }

    return svgEl(
      "svg",
      {
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        style: { display: "block", maxWidth: "100%" },
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
    const validX = data.xNumbers.filter((v): v is number => v !== null);
    const allY = visibleSeries.flatMap((s) => s.values.filter((v): v is number => v !== null));
    if (allY.length === 0) return null;

    const xScale = computeNiceScale(
      validX.length ? Math.min(...validX) : 0,
      validX.length ? Math.max(...validX) : Math.max(1, count - 1),
      5,
    );
    const yScale = computeNiceScale(Math.min(...allY), Math.max(...allY), 5);
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

    visibleSeries.forEach((s) => {
      s.values.forEach((yVal, idx) => {
        if (yVal === null) return;
        const xVal = data.xNumbers[idx] ?? idx;
        const isSelected = selectedIndex === idx;
        elements.push(
          svgEl("circle", {
            key: `pt-${s.key}-${idx}`,
            cx: mapX(xVal),
            cy: mapY(yVal),
            r: isSelected ? 6.5 : 4.5,
            fill: s.color,
            fillOpacity: selectedIndex !== null && !isSelected ? 0.35 : 0.85,
            stroke: isSelected ? theme.colors.foreground : theme.colors.surface1,
            strokeWidth: isSelected ? 2 : 1,
            style: { cursor: "pointer" },
            onClick: () => onSelectIndex(isSelected ? null : idx),
          }),
        );
      });
    });

    return svgEl(
      "svg",
      {
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        style: { display: "block", maxWidth: "100%" },
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
    const lbl = rawLbl.length > 10 ? `${rawLbl.slice(0, 9)}…` : rawLbl;
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

  if (kind === "bar") {
    if (stacked) {
      const barW = Math.max(6, Math.min(44, slotW * 0.64));
      for (let idx = 0; idx < count; idx += 1) {
        let posBase = 0;
        let negBase = 0;
        const cx = getCategoryX(idx);
        const isSelected = selectedIndex === idx;
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
              opacity: selectedIndex !== null && !isSelected ? 0.45 : 0.92,
              style: { cursor: "pointer" },
              onClick: () => onSelectIndex(isSelected ? null : idx),
            }),
          );
        });
      }
    } else {
      const groupW = Math.max(8, Math.min(56, slotW * 0.72));
      const barW = Math.max(4, groupW / Math.max(1, visibleSeries.length) - 2);
      for (let idx = 0; idx < count; idx += 1) {
        const slotLeft = getCategoryX(idx) - groupW / 2;
        const isSelected = selectedIndex === idx;
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
              opacity: selectedIndex !== null && !isSelected ? 0.45 : 0.92,
              style: { cursor: "pointer" },
              onClick: () => onSelectIndex(isSelected ? null : idx),
            }),
          );
        });
      }
    }
  } else {
    // Line or Area
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
        const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${baseLine} L ${pts[0].x} ${baseLine} Z`;
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
          const isSelected = selectedIndex === pt.idx;
          elements.push(
            svgEl("circle", {
              key: `dot-${s.key}-${pt.idx}`,
              cx: pt.x,
              cy: pt.y,
              r: isSelected ? 5.5 : 3.2,
              fill: isSelected ? theme.colors.surface0 : s.color,
              stroke: s.color,
              strokeWidth: isSelected ? 2.5 : 1,
              style: { cursor: "pointer" },
              onClick: () => onSelectIndex(isSelected ? null : pt.idx),
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
      style: { display: "block", maxWidth: "100%" },
    },
    ...elements,
  );
}

export interface WebSvgGraphProps {
  layout: GraphLayoutResult;
  theme: PluginTheme;
  selectedNodeId: string | null;
  focusedIds: ReadonlySet<string> | null;
  onSelectNode(id: string | null): void;
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

export function WebSvgGraph({
  layout,
  theme,
  selectedNodeId,
  focusedIds,
  onSelectNode,
}: WebSvgGraphProps): ReactElement | null {
  if (!isWebPlatform) return null;

  const connectedNodes = new Set<string>();
  if (selectedNodeId) {
    connectedNodes.add(selectedNodeId);
    for (const e of layout.edges) {
      if (e.edge.from === selectedNodeId) connectedNodes.add(e.edge.to);
      if (e.edge.to === selectedNodeId) connectedNodes.add(e.edge.from);
    }
  }

  const children: ReactNode[] = [
    svgEl(
      "defs",
      { key: "defs" },
      svgEl(
        "marker",
        {
          id: "gt-arrow",
          viewBox: "0 0 10 10",
          refX: 8.5,
          refY: 5,
          markerWidth: 6.5,
          markerHeight: 6.5,
          orient: "auto-start-reverse",
        },
        svgEl("path", { d: "M 0 1 L 9 5 L 0 9 z", fill: theme.colors.foregroundMuted }),
      ),
      svgEl(
        "marker",
        {
          id: "gt-arrow-accent",
          viewBox: "0 0 10 10",
          refX: 8.5,
          refY: 5,
          markerWidth: 6.5,
          markerHeight: 6.5,
          orient: "auto-start-reverse",
        },
        svgEl("path", { d: "M 0 1 L 9 5 L 0 9 z", fill: theme.colors.accent }),
      ),
    ),
  ];

  // Groups
  for (const grp of layout.groups) {
    children.push(
      svgEl(
        "g",
        { key: `grp-${grp.node.id}` },
        svgEl("rect", {
          x: grp.x,
          y: grp.y,
          width: grp.width,
          height: grp.height,
          rx: 10,
          fill: theme.colors.surface2,
          fillOpacity: 0.35,
          stroke: theme.colors.border,
          strokeDasharray: "5 4",
          strokeWidth: 1.2,
        }),
        svgEl(
          "text",
          {
            x: grp.x + 12,
            y: grp.y + 18,
            fill: theme.colors.foregroundMuted,
            fontSize: 11,
            fontWeight: "600",
          },
          grp.node.label,
        ),
      ),
    );
  }

  // Edges
  for (const edgeBox of layout.edges) {
    const isHighlighted =
      selectedNodeId !== null &&
      (edgeBox.edge.from === selectedNodeId || edgeBox.edge.to === selectedNodeId);
    const isDimmed =
      (selectedNodeId !== null && !isHighlighted) ||
      (focusedIds !== null &&
        (!focusedIds.has(edgeBox.edge.from) || !focusedIds.has(edgeBox.edge.to)));

    const strokeColor =
      edgeBox.edge.kind === "blocks"
        ? theme.colors.statusDanger
        : isHighlighted
          ? theme.colors.accent
          : theme.colors.foregroundMuted;
    const dashed =
      edgeBox.edge.kind === "async" ||
      edgeBox.edge.kind === "depends" ||
      edgeBox.isBackEdge;

    const d = `M ${edgeBox.x1} ${edgeBox.y1} C ${edgeBox.cx1} ${edgeBox.cy1}, ${edgeBox.cx2} ${edgeBox.cy2}, ${edgeBox.x2} ${edgeBox.y2}`;

    children.push(
      svgEl(
        "g",
        { key: `edge-${edgeBox.index}`, opacity: isDimmed ? 0.25 : 0.9 },
        svgEl("path", {
          d,
          fill: "none",
          stroke: strokeColor,
          strokeWidth: isHighlighted ? 2.2 : 1.5,
          strokeDasharray: dashed ? "5 4" : undefined,
          markerEnd: isHighlighted ? "url(#gt-arrow-accent)" : "url(#gt-arrow)",
        }),
        edgeBox.edge.label
          ? (() => {
              const clipped = truncateVisualText(edgeBox.edge.label, 24);
              const pillW = Math.min(180, Math.max(36, visualTextUnits(clipped) * 6.8 + 16));
              return svgEl(
                "g",
                null,
                svgEl("rect", {
                  x: edgeBox.labelX - pillW / 2,
                  y: edgeBox.labelY - 9,
                  width: pillW,
                  height: 18,
                  rx: 4,
                  fill: theme.colors.surface0,
                  stroke: theme.colors.border,
                  strokeWidth: 0.8,
                }),
                svgEl(
                  "text",
                  {
                    x: edgeBox.labelX,
                    y: edgeBox.labelY + 3.5,
                    textAnchor: "middle",
                    fill: theme.colors.foregroundMuted,
                    fontSize: 10,
                  },
                  clipped,
                ),
              );
            })()
          : null,
      ),
    );
  }

  // Nodes
  for (const box of layout.nodes) {
    const { node, x, y, width, height } = box;
    const isSelected = selectedNodeId === node.id;
    const isFocusTarget = focusedIds ? focusedIds.has(node.id) : false;
    const isDimmed =
      (selectedNodeId !== null && !connectedNodes.has(node.id)) ||
      (focusedIds !== null && !isFocusTarget);

    const sColor = statusHex(node.status, theme);
    const borderColor = isSelected || isFocusTarget || node.emphasis
      ? theme.colors.accent
      : theme.colors.border;

    const inner: ReactNode[] = [
      svgEl("rect", {
        key: "bg",
        x,
        y,
        width,
        height,
        rx: node.type === "decision" ? 16 : 9,
        fill: theme.colors.surface1,
        stroke: borderColor,
        strokeWidth: isSelected || isFocusTarget || node.emphasis ? 2 : 1,
      }),
      svgEl(
        "text",
        {
          key: "kind",
          x: x + 10,
          y: y + 15,
          fill: theme.colors.foregroundMuted,
          fontSize: 9.5,
          fontWeight: "600",
        },
        (node.type ?? "service").toUpperCase(),
      ),
    ];

    if (sColor) {
      inner.push(
        svgEl("circle", {
          key: "dot",
          cx: x + width - 12,
          cy: y + 12,
          r: 4,
          fill: sColor,
        }),
      );
    }

    const maxUnits = Math.max(12, (width - 20) / 7.5);
    inner.push(
      svgEl(
        "text",
        {
          key: "lbl",
          x: x + 10,
          y: y + 32,
          fill: theme.colors.foreground,
          fontSize: 12.5,
          fontWeight: "700",
        },
        truncateVisualText(node.label, maxUnits),
      ),
    );

    let lineY = y + 48;
    if (node.sublabel) {
      inner.push(
        svgEl(
          "text",
          {
            key: "sub",
            x: x + 10,
            y: lineY,
            fill: theme.colors.foregroundMuted,
            fontSize: 10.5,
          },
          truncateVisualText(node.sublabel, maxUnits * 1.1),
        ),
      );
      lineY += 16;
    }

    if (node.value !== undefined) {
      inner.push(
        svgEl(
          "text",
          {
            key: "val",
            x: x + 10,
            y: lineY + 2,
            fill: theme.colors.accent,
            fontSize: 14,
            fontWeight: "700",
          },
          String(node.value),
        ),
      );
      lineY += 20;
    }

    for (const [fIdx, field] of (node.fields ?? []).slice(0, 6).entries()) {
      const keyTag = field.key ? `[${field.key}] ` : "";
      inner.push(
        svgEl(
          "text",
          {
            key: `fld-${fIdx}`,
            x: x + 10,
            y: lineY,
            fill: theme.colors.foregroundMuted,
            fontSize: 10,
          },
          truncateVisualText(
            `${keyTag}${field.name}${field.type ? `: ${field.type}` : ""}`,
            maxUnits * 1.15,
          ),
        ),
      );
      lineY += 15;
    }

    for (const [iIdx, item] of (node.items ?? []).slice(0, 6).entries()) {
      const mark = item.status === "done" ? "✓" : item.status === "failed" ? "✕" : "•";
      inner.push(
        svgEl(
          "text",
          {
            key: `itm-${iIdx}`,
            x: x + 10,
            y: lineY,
            fill: theme.colors.foregroundMuted,
            fontSize: 10,
          },
          truncateVisualText(`${mark} ${item.label}`, maxUnits * 1.15),
        ),
      );
      lineY += 15;
    }

    children.push(
      svgEl(
        "g",
        {
          key: `node-${node.id}`,
          opacity: isDimmed ? 0.35 : 1,
          style: { cursor: "pointer" },
          onClick: () => onSelectNode(isSelected ? null : node.id),
        },
        ...inner,
      ),
    );
  }

  return svgEl(
    "svg",
    {
      width: layout.width,
      height: layout.height,
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      style: { display: "block" },
    },
    ...children,
  );
}
