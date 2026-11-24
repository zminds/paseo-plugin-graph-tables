import type { GraphLayoutResult, PositionedNode } from "./graph-layout";
import { truncateVisualText, visualTextUnits } from "./query-engine";
import type { ChartKind } from "./view-schema";

export interface SvgThemePalette {
  surface0: string;
  surface1: string;
  surface2: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  accentForeground: string;
  statusSuccess: string;
  statusWarning: string;
  statusDanger: string;
}

export interface ChartExportSeries {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

export interface ScatterPoint {
  seriesKey: string;
  seriesLabel: string;
  color: string;
  x: number;
  y: number;
  xLabel: string;
  rowIndex: number;
}

export interface ChartExportData {
  xKey: string;
  xLabels: string[];
  xNumbers: Array<number | null>;
  series: ChartExportSeries[];
  pieSlices: Array<{ label: string; value: number; color: string; rowIndex: number }>;
  scatterPoints: ScatterPoint[];
}

const SVG_FONT =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function computeNiceScale(
  rawMin: number,
  rawMax: number,
  tickCount = 5,
): { min: number; max: number; ticks: number[] } {
  let min = Number.isFinite(rawMin) ? rawMin : 0;
  let max = Number.isFinite(rawMax) ? rawMax : 1;
  if (min === max) {
    if (min === 0) {
      max = 1;
    } else if (min > 0) {
      min = 0;
    } else {
      max = 0;
    }
  }
  if (min > max) [min, max] = [max, min];

  const range = max - min;
  const roughStep = range / Math.max(1, tickCount - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  let niceStep = mag;
  if (norm > 5) niceStep = 10 * mag;
  else if (norm > 2) niceStep = 5 * mag;
  else if (norm > 1) niceStep = 2 * mag;

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.25; v += niceStep) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { min: niceMin, max: niceMax, ticks };
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(abs < 10 ? 2 : 1);
}

export function buildLinePath(
  points: Array<{ x: number; y: number }>,
  curve: "smooth" | "linear" | "step",
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  if (curve === "step") {
    let d = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
    for (let i = 1; i < points.length; i += 1) {
      d += ` L ${points[i]!.x.toFixed(1)} ${points[i - 1]!.y.toFixed(1)} L ${points[i]!.x.toFixed(1)} ${points[i]!.y.toFixed(1)}`;
    }
    return d;
  }
  if (curve === "smooth") {
    let d = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const mx = ((prev.x + curr.x) / 2).toFixed(1);
      d += ` C ${mx} ${prev.y.toFixed(1)}, ${mx} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    return d;
  }
  return points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function arcSlicePath(
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
      `M ${cx.toFixed(2)} ${cy.toFixed(2)}`,
      `L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  }
  const p3 = polarToCartesian(cx, cy, rInner, startAngle + sweep);
  const p4 = polarToCartesian(cx, cy, rInner, startAngle);
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${rOuter.toFixed(2)} ${rOuter.toFixed(2)} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function buildReverseLinePath(
  points: Array<{ x: number; y: number }>,
  curve: "smooth" | "linear" | "step",
): string {
  const reversed = [...points].reverse();
  if (reversed.length === 0) return "";
  if (reversed.length === 1) {
    return `L ${reversed[0]!.x.toFixed(1)} ${reversed[0]!.y.toFixed(1)}`;
  }
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

export function exportChartToSvg(input: {
  kind: ChartKind;
  title?: string;
  summary?: string;
  data: ChartExportData;
  curve?: "smooth" | "linear" | "step";
  stacked?: boolean;
  hiddenSeries?: ReadonlySet<string>;
  colors: SvgThemePalette;
  width?: number;
  height?: number;
}): { svg: string; width: number; height: number } {
  const {
    kind,
    title,
    summary,
    data,
    curve = "linear",
    stacked = false,
    hiddenSeries,
    colors,
  } = input;
  const w = Math.max(420, Math.round(input.width ?? 760));
  const headerH = (title ? 26 : 0) + (summary ? 18 : 0) + (title || summary ? 14 : 0);
  const visibleSeries = data.series.filter((s) => !hiddenSeries?.has(s.key));
  const showSeriesLegend = kind !== "pie" && kind !== "donut" && visibleSeries.length > 1;
  const legendH = showSeriesLegend ? 28 : 0;
  const plotAreaH = Math.max(220, Math.round(input.height ?? 320));
  const h = headerH + legendH + plotAreaH + 16;

  const chunks: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${escapeXml(SVG_FONT)}">`,
    `<rect width="${w}" height="${h}" fill="${escapeXml(colors.surface0)}" rx="10" />`,
  ];

  let cursorY = 24;
  if (title) {
    chunks.push(
      `<text x="20" y="${cursorY}" fill="${escapeXml(colors.foreground)}" font-size="15" font-weight="700">${escapeXml(title)}</text>`,
    );
    cursorY += 20;
  }
  if (summary) {
    chunks.push(
      `<text x="20" y="${cursorY}" fill="${escapeXml(colors.foregroundMuted)}" font-size="11.5">${escapeXml(summary)}</text>`,
    );
    cursorY += 18;
  }

  if (showSeriesLegend) {
    let lx = 20;
    const ly = cursorY + 4;
    for (const s of visibleSeries) {
      const label = truncateVisualText(s.label, 24);
      chunks.push(
        `<circle cx="${lx + 5}" cy="${ly}" r="4.5" fill="${escapeXml(s.color)}" />`,
        `<text x="${lx + 14}" y="${ly + 3.5}" fill="${escapeXml(colors.foreground)}" font-size="11">${escapeXml(label)}</text>`,
      );
      lx += Math.ceil(visualTextUnits(label) * 7 + 30);
      if (lx > w - 120) break;
    }
    cursorY += 28;
  }

  const topOffset = cursorY + 8;

  if (kind === "pie" || kind === "donut") {
    const slices = data.pieSlices.filter((s) => s.value > 0);
    const total = slices.reduce((acc, s) => acc + s.value, 0);
    if (total > 0) {
      const pieSpaceW = Math.max(220, w * 0.56);
      const cx = 20 + pieSpaceW / 2;
      const cy = topOffset + plotAreaH / 2 - 4;
      const outerR = Math.min(pieSpaceW, plotAreaH) * 0.39;
      const innerR = kind === "donut" ? outerR * 0.56 : 0;
      let angle = 0;
      for (const slice of slices) {
        const span = (slice.value / total) * 360;
        const d = arcSlicePath(cx, cy, outerR, innerR, angle, angle + span);
        angle += span;
        chunks.push(
          `<path d="${d}" fill="${escapeXml(slice.color)}" stroke="${escapeXml(colors.surface0)}" stroke-width="2" />`,
        );
      }
      if (kind === "donut") {
        chunks.push(
          `<text x="${cx}" y="${cy - 2}" text-anchor="middle" dominant-baseline="central" fill="${escapeXml(colors.foreground)}" font-size="16" font-weight="700">${escapeXml(formatCompactNumber(total))}</text>`,
          `<text x="${cx}" y="${cy + 16}" text-anchor="middle" dominant-baseline="central" fill="${escapeXml(colors.foregroundMuted)}" font-size="11">Total</text>`,
        );
      }

      // Legend column on the right
      const legX = 24 + pieSpaceW;
      let legY = topOffset + 24;
      for (const slice of slices.slice(0, 10)) {
        const pct = ((slice.value / total) * 100).toFixed(1);
        const text = `${truncateVisualText(slice.label, 18)} (${formatCompactNumber(slice.value)} · ${pct}%)`;
        chunks.push(
          `<rect x="${legX}" y="${legY - 8}" width="10" height="10" rx="2" fill="${escapeXml(slice.color)}" />`,
          `<text x="${legX + 16}" y="${legY + 1}" fill="${escapeXml(colors.foreground)}" font-size="11">${escapeXml(text)}</text>`,
        );
        legY += 22;
      }
    }
    chunks.push("</svg>");
    return { svg: chunks.join(""), width: w, height: h };
  }

  const padLeft = 56;
  const padRight = 24;
  const padTop = topOffset + 10;
  const padBottom = 38;
  const plotW = Math.max(80, w - padLeft - padRight);
  const plotH = Math.max(80, h - padTop - padBottom);

  if (kind === "scatter") {
    const pts =
      data.scatterPoints.length > 0
        ? data.scatterPoints.filter((p) => !hiddenSeries?.has(p.seriesKey))
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

    if (pts.length > 0) {
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

      for (const tick of yScale.ticks) {
        const py = mapY(tick);
        chunks.push(
          `<line x1="${padLeft}" y1="${py.toFixed(1)}" x2="${padLeft + plotW}" y2="${py.toFixed(1)}" stroke="${escapeXml(colors.border)}" stroke-dasharray="3 3" stroke-width="1" />`,
          `<text x="${padLeft - 8}" y="${(py + 3.5).toFixed(1)}" text-anchor="end" fill="${escapeXml(colors.foregroundMuted)}" font-size="10">${escapeXml(formatCompactNumber(tick))}</text>`,
        );
      }
      for (const tick of xScale.ticks) {
        const px = mapX(tick);
        chunks.push(
          `<text x="${px.toFixed(1)}" y="${padTop + plotH + 18}" text-anchor="middle" fill="${escapeXml(colors.foregroundMuted)}" font-size="10">${escapeXml(formatCompactNumber(tick))}</text>`,
        );
      }
      for (const pt of pts) {
        chunks.push(
          `<circle cx="${mapX(pt.x).toFixed(1)}" cy="${mapY(pt.y).toFixed(1)}" r="4.5" fill="${escapeXml(pt.color)}" fill-opacity="0.86" stroke="${escapeXml(colors.surface0)}" stroke-width="1" />`,
        );
      }
    }
    chunks.push("</svg>");
    return { svg: chunks.join(""), width: w, height: h };
  }

  const count = data.xLabels.length;
  if (count > 0 && visibleSeries.length > 0) {
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

    for (const tick of yScale.ticks) {
      const py = mapY(tick);
      chunks.push(
        `<line x1="${padLeft}" y1="${py.toFixed(1)}" x2="${padLeft + plotW}" y2="${py.toFixed(1)}" stroke="${escapeXml(colors.border)}" ${tick === 0 ? "" : 'stroke-dasharray="3 3"'} stroke-width="1" />`,
        `<text x="${padLeft - 8}" y="${(py + 3.5).toFixed(1)}" text-anchor="end" fill="${escapeXml(colors.foregroundMuted)}" font-size="10">${escapeXml(formatCompactNumber(tick))}</text>`,
      );
    }

    const maxLabels = Math.max(2, Math.floor(plotW / 62));
    const stepLabel = Math.max(1, Math.ceil(count / maxLabels));
    const slotW = plotW / count;
    const getCategoryX = (idx: number) =>
      kind === "bar" || count === 1
        ? padLeft + slotW * idx + slotW / 2
        : padLeft + (idx / Math.max(1, count - 1)) * plotW;

    for (let idx = 0; idx < count; idx += stepLabel) {
      const lbl = truncateVisualText(data.xLabels[idx] ?? "", 12);
      chunks.push(
        `<text x="${getCategoryX(idx).toFixed(1)}" y="${padTop + plotH + 18}" text-anchor="middle" fill="${escapeXml(colors.foregroundMuted)}" font-size="10">${escapeXml(lbl)}</text>`,
      );
    }

    if (kind === "bar") {
      if (stacked) {
        const barW = Math.max(6, Math.min(46, slotW * 0.64));
        for (let idx = 0; idx < count; idx += 1) {
          let posBase = 0;
          let negBase = 0;
          const cx = getCategoryX(idx);
          for (const s of visibleSeries) {
            const val = s.values[idx];
            if (val === null || val === 0) continue;
            const startVal = val >= 0 ? posBase : negBase;
            const endVal = startVal + val;
            if (val >= 0) posBase = endVal;
            else negBase = endVal;
            const yA = mapY(startVal);
            const yB = mapY(endVal);
            chunks.push(
              `<rect x="${(cx - barW / 2).toFixed(1)}" y="${Math.min(yA, yB).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1.5, Math.abs(yA - yB)).toFixed(1)}" rx="2" fill="${escapeXml(s.color)}" opacity="0.92" />`,
            );
          }
        }
      } else {
        const groupW = Math.max(8, Math.min(58, slotW * 0.72));
        const barW = Math.max(4, groupW / Math.max(1, visibleSeries.length) - 2);
        for (let idx = 0; idx < count; idx += 1) {
          const slotLeft = getCategoryX(idx) - groupW / 2;
          visibleSeries.forEach((s, sIdx) => {
            const val = s.values[idx];
            if (val === null) return;
            const yVal = mapY(val);
            chunks.push(
              `<rect x="${(slotLeft + sIdx * (barW + 2)).toFixed(1)}" y="${Math.min(zeroY, yVal).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1.5, Math.abs(zeroY - yVal)).toFixed(1)}" rx="2" fill="${escapeXml(s.color)}" opacity="0.92" />`,
            );
          });
        }
      }
    } else if (kind === "area" && stacked) {
      const runningTotals = new Array<number>(count).fill(0);
      for (const s of visibleSeries) {
        const lowerPts: Array<{ x: number; y: number }> = [];
        const upperPts: Array<{ x: number; y: number }> = [];
        for (let idx = 0; idx < count; idx += 1) {
          const base = runningTotals[idx] ?? 0;
          const val = s.values[idx] ?? 0;
          const top = base + val;
          runningTotals[idx] = top;
          const px = getCategoryX(idx);
          lowerPts.push({ x: px, y: mapY(base) });
          upperPts.push({ x: px, y: mapY(top) });
        }
        const topLine = buildLinePath(upperPts, curve);
        const reverseLower = buildReverseLinePath(lowerPts, curve);
        chunks.push(
          `<path d="${topLine} ${reverseLower} Z" fill="${escapeXml(s.color)}" fill-opacity="0.28" />`,
          `<path d="${topLine}" fill="none" stroke="${escapeXml(s.color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`,
        );
      }
    } else {
      const baseLine = Math.min(padTop + plotH, Math.max(padTop, zeroY));
      for (const s of visibleSeries) {
        const pts: Array<{ x: number; y: number; idx: number }> = [];
        s.values.forEach((val, idx) => {
          if (val !== null) pts.push({ x: getCategoryX(idx), y: mapY(val), idx });
        });
        if (pts.length === 0) continue;
        const linePath = buildLinePath(pts, curve);
        if (kind === "area" && pts.length >= 2) {
          const areaPath = `${linePath} L ${pts[pts.length - 1]!.x.toFixed(1)} ${baseLine.toFixed(1)} L ${pts[0]!.x.toFixed(1)} ${baseLine.toFixed(1)} Z`;
          chunks.push(
            `<path d="${areaPath}" fill="${escapeXml(s.color)}" fill-opacity="0.2" />`,
          );
        }
        chunks.push(
          `<path d="${linePath}" fill="none" stroke="${escapeXml(s.color)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`,
        );
        if (pts.length <= 48) {
          for (const pt of pts) {
            chunks.push(
              `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.2" fill="${escapeXml(s.color)}" stroke="${escapeXml(colors.surface0)}" stroke-width="1" />`,
            );
          }
        }
      }
    }
  }

  chunks.push("</svg>");
  return { svg: chunks.join(""), width: w, height: h };
}

function statusHex(status: string | undefined, colors: SvgThemePalette): string | null {
  switch (status) {
    case "done":
      return colors.statusSuccess;
    case "active":
    case "review":
      return colors.accent;
    case "blocked":
      return colors.statusWarning;
    case "failed":
      return colors.statusDanger;
    default:
      return null;
  }
}

function typeAccentColor(type: PositionedNode["node"]["type"], colors: SvgThemePalette): string {
  switch (type) {
    case "database":
    case "storage":
      return colors.statusSuccess;
    case "queue":
    case "decision":
      return colors.statusWarning;
    case "external":
      return colors.statusDanger;
    case "client":
    case "actor":
    case "person":
    case "service":
    case "function":
    case "metric":
      return colors.accent;
    default:
      return colors.foregroundMuted;
  }
}

function renderGlyphXml(
  type: PositionedNode["node"]["type"],
  cx: number,
  cy: number,
  color: string,
  label: string,
): string {
  const c = escapeXml(color);
  const strokeAttr = `fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
  switch (type) {
    case "database":
    case "storage":
      return [
        `<ellipse cx="${cx}" cy="${cy - 3.5}" rx="5" ry="2.2" ${strokeAttr} />`,
        `<path d="M ${cx - 5} ${cy - 3.5} v 7 c 0 1.2 2.2 2.2 5 2.2 s 5 -1 5 -2.2 v -7" ${strokeAttr} />`,
        `<path d="M ${cx - 5} ${cy} c 0 1.2 2.2 2.2 5 2.2 s 5 -1 5 -2.2" ${strokeAttr} />`,
      ].join("");
    case "queue":
      return [
        `<rect x="${cx - 5}" y="${cy - 4.5}" width="10" height="2.5" rx="1" ${strokeAttr} />`,
        `<rect x="${cx - 5}" y="${cy - 0.5}" width="10" height="2.5" rx="1" ${strokeAttr} />`,
        `<rect x="${cx - 5}" y="${cy + 3.5}" width="10" height="2.5" rx="1" ${strokeAttr} />`,
      ].join("");
    case "file":
    case "note":
      return [
        `<path d="M ${cx - 4} ${cy - 5.5} h 5.5 l 2.5 2.5 v 8.5 h -8 z" ${strokeAttr} />`,
        `<path d="M ${cx - 2} ${cy} h 4 M ${cx - 2} ${cy + 2.8} h 3" ${strokeAttr} />`,
      ].join("");
    case "function":
      return `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${c}" font-size="13" font-style="italic" font-weight="700">f</text>`;
    case "decision":
      return `<polygon points="${cx},${cy - 5.5} ${cx + 5.5},${cy} ${cx},${cy + 5.5} ${cx - 5.5},${cy}" ${strokeAttr} />`;
    case "metric":
      return `<path d="M ${cx - 5.5} ${cy + 2} l 3 -3.5 l 2.5 2 l 4.5 -5" ${strokeAttr} />`;
    case "client":
    case "actor":
    case "person": {
      const ch = escapeXml((label.trim().charAt(0) || "A").toUpperCase());
      return `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${c}" font-size="11.5" font-weight="700">${ch}</text>`;
    }
    case "external":
      return [
        `<circle cx="${cx}" cy="${cy}" r="5" ${strokeAttr} />`,
        `<path d="M ${cx - 5} ${cy} h 10 M ${cx} ${cy - 5} c 2 2 2 8 0 10" ${strokeAttr} />`,
      ].join("");
    default:
      return [
        `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" rx="2" ${strokeAttr} />`,
        `<rect x="${cx - 2}" y="${cy - 2}" width="4" height="4" rx="0.8" fill="${c}" />`,
      ].join("");
  }
}

export function exportGraphToSvg(input: {
  layout: GraphLayoutResult;
  title?: string;
  summary?: string;
  focusedIds?: ReadonlySet<string> | null;
  activeStepNumber?: number | null;
  colors: SvgThemePalette;
}): { svg: string; width: number; height: number } {
  const { layout, title, summary, focusedIds = null, activeStepNumber = null, colors } = input;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const n of layout.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y - 12);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  for (const g of layout.groups) {
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.width);
    maxY = Math.max(maxY, g.y + g.height);
  }
  for (const e of layout.edges) {
    minX = Math.min(minX, e.labelX - 75);
    minY = Math.min(minY, e.labelY - 22);
    maxX = Math.max(maxX, e.labelX + 75);
    maxY = Math.max(maxY, e.labelY + 22);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 480;
    maxY = 240;
  }

  const pad = 36;
  const headerH = (title ? 26 : 0) + (summary ? 18 : 0) + (title || summary ? 12 : 0);
  const w = Math.max(420, Math.ceil(maxX - minX + pad * 2));
  const h = Math.max(240, Math.ceil(maxY - minY + pad * 2 + headerH));
  const shiftX = pad - minX;
  const shiftY = pad + headerH - minY;

  const chunks: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${escapeXml(SVG_FONT)}">`,
    `<defs>`,
    `<pattern id="gt-exp-dots" width="22" height="22" patternUnits="userSpaceOnUse">`,
    `<circle cx="11" cy="11" r="1.05" fill="${escapeXml(colors.border)}" fill-opacity="0.7" />`,
    `</pattern>`,
    `<filter id="gt-exp-shadow" x="-12%" y="-12%" width="124%" height="130%">`,
    `<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.14" />`,
    `</filter>`,
    `<marker id="gt-exp-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `<path d="M 0 1.2 L 9 5 L 0 8.8 z" fill="${escapeXml(colors.foregroundMuted)}" />`,
    `</marker>`,
    `<marker id="gt-exp-arrow-accent" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`,
    `<path d="M 0 1.2 L 9 5 L 0 8.8 z" fill="${escapeXml(colors.accent)}" />`,
    `</marker>`,
    `<marker id="gt-exp-arrow-danger" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`,
    `<path d="M 0 1.2 L 9 5 L 0 8.8 z" fill="${escapeXml(colors.statusDanger)}" />`,
    `</marker>`,
    `</defs>`,
    `<rect width="${w}" height="${h}" fill="${escapeXml(colors.surface0)}" rx="10" />`,
    `<rect x="0" y="${headerH}" width="${w}" height="${h - headerH}" fill="url(#gt-exp-dots)" />`,
  ];

  let headerY = 24;
  if (title) {
    chunks.push(
      `<text x="20" y="${headerY}" fill="${escapeXml(colors.foreground)}" font-size="15" font-weight="700">${escapeXml(title)}</text>`,
    );
    headerY += 20;
  }
  if (summary) {
    chunks.push(
      `<text x="20" y="${headerY}" fill="${escapeXml(colors.foregroundMuted)}" font-size="11.5">${escapeXml(summary)}</text>`,
    );
  }

  chunks.push(`<g transform="translate(${shiftX.toFixed(1)} ${shiftY.toFixed(1)})">`);

  // Groups
  for (const grp of layout.groups) {
    const hasFocused = focusedIds !== null && grp.memberIds.some((id) => focusedIds.has(id));
    const opacity = focusedIds !== null && !hasFocused ? 0.28 : 1;
    chunks.push(
      `<g opacity="${opacity}">`,
      `<rect x="${grp.x}" y="${grp.y}" width="${grp.width}" height="${grp.height}" rx="14" fill="${escapeXml(colors.surface2)}" fill-opacity="${hasFocused ? 0.56 : 0.42}" stroke="${escapeXml(hasFocused ? colors.accent : colors.border)}" stroke-width="${hasFocused ? 1.5 : 1.1}" />`,
      `<circle cx="${grp.x + 16}" cy="${grp.y + 20}" r="3" fill="${escapeXml(hasFocused ? colors.accent : colors.foregroundMuted)}" />`,
      `<text x="${grp.x + 25}" y="${grp.y + 23.5}" fill="${escapeXml(hasFocused ? colors.foreground : colors.foregroundMuted)}" font-size="10.5" font-weight="700" letter-spacing="0.05em">${escapeXml((grp.node.label || grp.node.id).toUpperCase())}</text>`,
      `</g>`,
    );
  }

  // Edges
  for (const edgeBox of layout.edges) {
    const bothFocused =
      focusedIds !== null &&
      focusedIds.has(edgeBox.edge.from) &&
      focusedIds.has(edgeBox.edge.to);
    const halfFocused =
      focusedIds !== null &&
      !bothFocused &&
      (focusedIds.has(edgeBox.edge.from) || focusedIds.has(edgeBox.edge.to));
    const isHighlighted = bothFocused;
    const opacity = focusedIds !== null ? (bothFocused ? 1 : halfFocused ? 0.34 : 0.14) : 0.9;
    const isBlocks = edgeBox.edge.kind === "blocks";
    const stroke = isBlocks
      ? colors.statusDanger
      : isHighlighted
        ? colors.accent
        : colors.foregroundMuted;
    const markerEnd = isBlocks
      ? "url(#gt-exp-arrow-danger)"
      : isHighlighted
        ? "url(#gt-exp-arrow-accent)"
        : "url(#gt-exp-arrow)";
    const dashed =
      edgeBox.edge.kind === "async" ||
      edgeBox.edge.kind === "depends" ||
      edgeBox.isBackEdge;

    chunks.push(`<g opacity="${opacity}">`);
    chunks.push(
      `<path d="${edgeBox.svgPath}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${isHighlighted ? 2.4 : 1.6}" ${dashed ? 'stroke-dasharray="5 4"' : ""} marker-end="${markerEnd}" />`,
    );
    if (edgeBox.edge.label) {
      const clipped = truncateVisualText(edgeBox.edge.label, 24);
      const pillW = Math.min(188, Math.max(40, visualTextUnits(clipped) * 6.7 + 18));
      chunks.push(
        `<rect x="${edgeBox.labelX - pillW / 2}" y="${edgeBox.labelY - 10}" width="${pillW}" height="20" rx="10" fill="${escapeXml(colors.surface0)}" stroke="${escapeXml(isHighlighted ? colors.accent : colors.border)}" stroke-width="${isHighlighted ? 1.3 : 0.9}" />`,
        `<text x="${edgeBox.labelX}" y="${edgeBox.labelY + 3.5}" text-anchor="middle" fill="${escapeXml(isHighlighted ? colors.foreground : colors.foregroundMuted)}" font-size="10" font-weight="${isHighlighted ? "700" : "500"}">${escapeXml(clipped)}</text>`,
      );
    }
    chunks.push(`</g>`);
  }

  // Nodes
  const isHorizontalFlow = layout.direction === "right" || layout.direction === "left";
  for (const box of layout.nodes) {
    const { node, x, y, width, height } = box;
    const isFocusTarget = focusedIds ? focusedIds.has(node.id) : false;
    const isDimmed = focusedIds !== null && !isFocusTarget;
    const isPill =
      (node.type === "actor" || node.type === "client" || node.type === "person") &&
      !node.fields?.length &&
      !node.items?.length &&
      !node.value &&
      !node.image;
    const cardRx = isPill ? Math.min(height / 2, 26) : node.type === "decision" ? 16 : 12;
    const sColor = statusHex(node.status, colors);
    const badgeColor = typeAccentColor(node.type, colors);
    const isAccented = isFocusTarget || Boolean(node.emphasis);

    chunks.push(`<g opacity="${isDimmed ? 0.22 : 1}">`);
    if (isFocusTarget) {
      chunks.push(
        `<rect x="${x - 3.5}" y="${y - 3.5}" width="${width + 7}" height="${height + 7}" rx="${cardRx + 3.5}" fill="none" stroke="${escapeXml(colors.accent)}" stroke-opacity="0.28" stroke-width="4" />`,
      );
    }
    chunks.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${cardRx}" fill="${escapeXml(isFocusTarget ? colors.surface1 : colors.surface0)}" stroke="${escapeXml(isAccented ? colors.accent : colors.border)}" stroke-width="${isFocusTarget ? 2 : node.emphasis ? 1.6 : 1.1}" filter="url(#gt-exp-shadow)" />`,
    );

    const portFill = isFocusTarget ? colors.accent : colors.surface2;
    const portStroke = isFocusTarget ? colors.surface0 : colors.border;
    if (isHorizontalFlow) {
      chunks.push(
        `<circle cx="${x}" cy="${y + height / 2}" r="3.1" fill="${escapeXml(portFill)}" stroke="${escapeXml(portStroke)}" stroke-width="1.1" />`,
        `<circle cx="${x + width}" cy="${y + height / 2}" r="3.1" fill="${escapeXml(portFill)}" stroke="${escapeXml(portStroke)}" stroke-width="1.1" />`,
      );
    } else {
      chunks.push(
        `<circle cx="${x + width / 2}" cy="${y}" r="3.1" fill="${escapeXml(portFill)}" stroke="${escapeXml(portStroke)}" stroke-width="1.1" />`,
        `<circle cx="${x + width / 2}" cy="${y + height}" r="3.1" fill="${escapeXml(portFill)}" stroke="${escapeXml(portStroke)}" stroke-width="1.1" />`,
      );
    }

    const badgeSize = 28;
    const badgeX = x + 12;
    const badgeY = isPill ? y + (height - badgeSize) / 2 : y + 14;
    chunks.push(
      `<rect x="${badgeX}" y="${badgeY}" width="${badgeSize}" height="${badgeSize}" rx="${isPill ? badgeSize / 2 : 8}" fill="${escapeXml(badgeColor)}" fill-opacity="0.14" stroke="${escapeXml(badgeColor)}" stroke-opacity="0.28" stroke-width="0.9" />`,
      renderGlyphXml(
        node.type,
        badgeX + badgeSize / 2,
        badgeY + badgeSize / 2,
        badgeColor,
        node.label || node.id,
      ),
    );

    let rightReserved = 12;
    if (isFocusTarget && activeStepNumber !== null) {
      const badgeText = `STEP ${activeStepNumber}`;
      const pillW = badgeText.length * 5.6 + 12;
      chunks.push(
        `<rect x="${x + width - pillW - 10}" y="${y - 8}" width="${pillW}" height="15" rx="7.5" fill="${escapeXml(colors.accent)}" stroke="${escapeXml(colors.surface0)}" stroke-width="1.5" />`,
        `<text x="${x + width - pillW / 2 - 10}" y="${y + 2}" text-anchor="middle" fill="${escapeXml(colors.accentForeground)}" font-size="8.5" font-weight="700">${escapeXml(badgeText)}</text>`,
      );
    } else if (sColor) {
      rightReserved = 20;
      chunks.push(`<circle cx="${x + width - 12}" cy="${y + 13}" r="3.8" fill="${escapeXml(sColor)}" />`);
    }

    const textX = badgeX + badgeSize + 10;
    const maxLabelUnits = Math.max(10, (width - (textX - x) - rightReserved) / 7.5);
    const maxSubUnits = Math.max(10, (width - (textX - x) - 12) / 6.7);
    const labelY = isPill ? (node.sublabel ? y + 23 : y + height / 2 + 4.5) : y + 26;

    chunks.push(
      `<text x="${textX}" y="${labelY}" fill="${escapeXml(colors.foreground)}" font-size="12.5" font-weight="600">${escapeXml(truncateVisualText(node.label, maxLabelUnits))}</text>`,
    );

    let lineY = labelY + 16;
    if (node.sublabel) {
      chunks.push(
        `<text x="${textX}" y="${lineY}" fill="${escapeXml(colors.foregroundMuted)}" font-size="10.5">${escapeXml(truncateVisualText(node.sublabel, maxSubUnits))}</text>`,
      );
      lineY += 18;
    }

    if (node.value !== undefined) {
      chunks.push(
        `<text x="${x + 14}" y="${Math.max(lineY + 6, y + 60)}" fill="${escapeXml(colors.accent)}" font-size="14" font-weight="700">${escapeXml(String(node.value))}</text>`,
      );
      lineY += 22;
    }

    let extraY = Math.max(lineY + 2, y + 54);
    for (const field of (node.fields ?? []).slice(0, 6)) {
      const keyTag = field.key ? `${field.key.toUpperCase()} ` : "";
      chunks.push(
        `<text x="${x + 14}" y="${extraY}" fill="${escapeXml(colors.foregroundMuted)}" font-size="10">${escapeXml(truncateVisualText(`${keyTag}${field.name}${field.type ? `: ${field.type}` : ""}`, (width - 28) / 6.5))}</text>`,
      );
      extraY += 16;
    }
    for (const item of (node.items ?? []).slice(0, 6)) {
      const mark = item.status === "done" ? "✓" : item.status === "failed" ? "✕" : "•";
      chunks.push(
        `<text x="${x + 14}" y="${extraY}" fill="${escapeXml(colors.foregroundMuted)}" font-size="10">${escapeXml(truncateVisualText(`${mark} ${item.label}`, (width - 28) / 6.5))}</text>`,
      );
      extraY += 16;
    }

    chunks.push(`</g>`);
  }

  chunks.push("</g></svg>");
  return { svg: chunks.join(""), width: w, height: h };
}
