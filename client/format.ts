import type { PluginTheme } from "@getpaseo/plugin";
import {
  rowsToCsv,
  rowsToJson,
  rowsToMarkdownTable,
  rowsToSqlInserts,
  rowsToTsv,
  type ExportValueMode,
} from "../shared/export-format";
import type { DataRow } from "../shared/query-engine";
import {
  computeNiceScale,
  formatCompactNumber,
  type ChartExportData,
  type ChartExportSeries,
  type ScatterPoint,
} from "../shared/svg-export";
import type { ColumnSpec, ViewSpec } from "../shared/view-schema";

export {
  computeNiceScale,
  formatCompactNumber,
  rowsToCsv,
  rowsToJson,
  rowsToMarkdownTable,
  rowsToSqlInserts,
  rowsToTsv,
  type ExportValueMode,
  type ScatterPoint,
};

export type ChartSeries = ChartExportSeries;
export type ParsedChartData = ChartExportData;

const FALLBACK_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

export function normalizeColorItem(item: unknown): { value: string; label?: string } | null {
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed ? { value: trimmed } : null;
  }
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const rawVal = obj.value ?? obj.color ?? obj.hex;
    if (typeof rawVal === "string" && rawVal.trim()) {
      const label =
        typeof obj.label === "string"
          ? obj.label
          : typeof obj.name === "string"
            ? obj.name
            : undefined;
      return { value: rawVal.trim(), label };
    }
  }
  return null;
}

export function getSeriesColors(theme: PluginTheme, customColors?: unknown[]): string[] {
  const custom = (customColors ?? [])
    .map((item) => normalizeColorItem(item)?.value)
    .filter((v): v is string => Boolean(v));
  if (custom.length > 0) return custom;

  const base = [
    theme.colors.accent,
    theme.colors.statusSuccess,
    theme.colors.statusWarning,
    theme.colors.statusDanger,
    ...FALLBACK_PALETTE,
  ];
  return [...new Set(base.filter(Boolean))];
}

function toNumeric(val: unknown): number | null {
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "string" && val.trim() !== "") {
    const cleaned = val.trim().replace(/[,$%]/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function inferChartAxes(
  rows: readonly DataRow[],
  columns: readonly ColumnSpec[],
  spec: Partial<ViewSpec>,
): { xKey: string; yKeys: string[] } {
  const colKeys =
    columns.length > 0
      ? columns.map((c) => c.key)
      : rows.length > 0
        ? Object.keys(rows[0] ?? {})
        : [];

  const isNumericCol = (key: string) =>
    rows.slice(0, 30).some((row) => toNumeric(row[key]) !== null);

  const xKey =
    spec.x ??
    colKeys.find((k) => !isNumericCol(k)) ??
    colKeys[0] ??
    "x";

  let yKeys: string[] = [];
  if (Array.isArray(spec.y)) {
    yKeys = spec.y.filter(Boolean);
  } else if (typeof spec.y === "string" && spec.y) {
    yKeys = [spec.y];
  } else {
    yKeys = colKeys.filter((k) => k !== xKey && k !== spec.group && isNumericCol(k));
    if (yKeys.length === 0) {
      const fallback = colKeys.find((k) => k !== xKey) ?? colKeys[0];
      if (fallback) yKeys = [fallback];
    }
  }

  return { xKey, yKeys };
}

export function hasNumericColumn(
  rows: readonly DataRow[],
  columns: readonly ColumnSpec[],
): boolean {
  if (rows.length === 0 || columns.length === 0) return false;
  return columns.some((col) => rows.slice(0, 30).some((row) => toNumeric(row[col.key]) !== null));
}

export function parseChartData(
  rows: readonly DataRow[],
  columns: readonly ColumnSpec[],
  spec: Partial<ViewSpec>,
  theme: PluginTheme,
): ParsedChartData {
  const palette = getSeriesColors(theme, spec.colors as unknown[] | undefined);
  const { xKey, yKeys } = inferChartAxes(rows, columns, spec);
  const groupKey = spec.group;

  if (groupKey && yKeys.length > 0) {
    const primaryY = yKeys[0];
    const xLabels: string[] = [];
    const xSeen = new Set<string>();
    const groupNames: string[] = [];
    const groupSeen = new Set<string>();
    const groupColorIndex = new Map<string, number>();
    const matrix = new Map<string, Map<string, number>>();
    const rawScatter: Array<{
      gVal: string;
      xVal: string;
      xNum: number | null;
      yNum: number;
      rowIndex: number;
    }> = [];

    rows.forEach((row, idx) => {
      const xVal = String(row[xKey] ?? "");
      const gVal = String(row[groupKey] ?? "Default");
      const yNum = toNumeric(row[primaryY]);
      const xNum = toNumeric(row[xKey]);
      if (!xSeen.has(xVal)) {
        xSeen.add(xVal);
        xLabels.push(xVal);
      }
      if (!groupSeen.has(gVal)) {
        groupSeen.add(gVal);
        groupColorIndex.set(gVal, groupNames.length);
        groupNames.push(gVal);
      }
      if (yNum !== null) {
        rawScatter.push({ gVal, xVal, xNum, yNum, rowIndex: idx });
        let bucket = matrix.get(gVal);
        if (!bucket) {
          bucket = new Map();
          matrix.set(gVal, bucket);
        }
        bucket.set(xVal, (bucket.get(xVal) ?? 0) + yNum);
      }
    });

    const xIndexMap = new Map(xLabels.map((lbl, idx) => [lbl, idx]));
    const xNumbers = xLabels.map((lbl) => toNumeric(lbl));
    const series: ChartSeries[] = groupNames.map((gName, idx) => ({
      key: gName,
      label: gName,
      color: palette[idx % palette.length]!,
      values: xLabels.map((lbl) => matrix.get(gName)?.get(lbl) ?? null),
    }));
    const pieSlices = groupNames.map((gName, idx) => {
      const sum = xLabels.reduce((acc, lbl) => acc + (matrix.get(gName)?.get(lbl) ?? 0), 0);
      return { label: gName, value: sum, color: palette[idx % palette.length]!, rowIndex: idx };
    });
    const scatterPoints: ScatterPoint[] = rawScatter.map((pt) => {
      const gIdx = groupColorIndex.get(pt.gVal) ?? 0;
      return {
        seriesKey: pt.gVal,
        seriesLabel: pt.gVal,
        color: palette[gIdx % palette.length]!,
        x: pt.xNum ?? xIndexMap.get(pt.xVal) ?? pt.rowIndex,
        y: pt.yNum,
        xLabel: pt.xVal,
        rowIndex: pt.rowIndex,
      };
    });
    return { xKey, xLabels, xNumbers, series, pieSlices, scatterPoints };
  }

  const xLabels = rows.map((row, idx) => {
    const val = row[xKey];
    return val === null || val === undefined ? `#${idx + 1}` : String(val);
  });
  const xNumbers = rows.map((row) => toNumeric(row[xKey]));

  const colMap = new Map(columns.map((c) => [c.key, c]));
  const series: ChartSeries[] = yKeys.map((yKey, idx) => ({
    key: yKey,
    label: colMap.get(yKey)?.label ?? yKey,
    color: palette[idx % palette.length]!,
    values: rows.map((row) => toNumeric(row[yKey])),
  }));

  const firstSeries = series[0];
  const pieSlices = rows.map((_row, idx) => ({
    label: xLabels[idx] ?? `#${idx + 1}`,
    value: Math.max(0, firstSeries?.values[idx] ?? 0),
    color: palette[idx % palette.length]!,
    rowIndex: idx,
  }));

  const scatterPoints: ScatterPoint[] = [];
  for (const s of series) {
    s.values.forEach((yVal, idx) => {
      if (yVal === null) return;
      scatterPoints.push({
        seriesKey: s.key,
        seriesLabel: s.label,
        color: s.color,
        x: xNumbers[idx] ?? idx,
        y: yVal,
        xLabel: xLabels[idx] ?? `#${idx + 1}`,
        rowIndex: idx,
      });
    });
  }

  return { xKey, xLabels, xNumbers, series, pieSlices, scatterPoints };
}
