import type { PluginTheme } from "@getpaseo/plugin";
import type { DataRow } from "../shared/query-engine";
import { formatCellValue } from "../shared/query-engine";
import type { ColumnSpec, ViewSpec } from "../shared/view-schema";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

export interface ParsedChartData {
  xKey: string;
  xLabels: string[];
  xNumbers: Array<number | null>;
  series: ChartSeries[];
  pieSlices: Array<{ label: string; value: number; color: string; rowIndex: number }>;
}

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
    const matrix = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const xVal = String(row[xKey] ?? "");
      const gVal = String(row[groupKey] ?? "Default");
      const yNum = toNumeric(row[primaryY]);
      if (!xSeen.has(xVal)) {
        xSeen.add(xVal);
        xLabels.push(xVal);
      }
      if (!groupSeen.has(gVal)) {
        groupSeen.add(gVal);
        groupNames.push(gVal);
      }
      if (yNum !== null) {
        let bucket = matrix.get(gVal);
        if (!bucket) {
          bucket = new Map();
          matrix.set(gVal, bucket);
        }
        bucket.set(xVal, (bucket.get(xVal) ?? 0) + yNum);
      }
    }

    const xNumbers = xLabels.map((lbl) => toNumeric(lbl));
    const series: ChartSeries[] = groupNames.map((gName, idx) => ({
      key: gName,
      label: gName,
      color: palette[idx % palette.length],
      values: xLabels.map((lbl) => matrix.get(gName)?.get(lbl) ?? null),
    }));
    const pieSlices = groupNames.map((gName, idx) => {
      const sum = xLabels.reduce((acc, lbl) => acc + (matrix.get(gName)?.get(lbl) ?? 0), 0);
      return { label: gName, value: sum, color: palette[idx % palette.length], rowIndex: idx };
    });
    return { xKey, xLabels, xNumbers, series, pieSlices };
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
    color: palette[idx % palette.length],
    values: rows.map((row) => toNumeric(row[yKey])),
  }));

  const firstSeries = series[0];
  const pieSlices = rows.map((_row, idx) => ({
    label: xLabels[idx] ?? `#${idx + 1}`,
    value: Math.max(0, firstSeries?.values[idx] ?? 0),
    color: palette[idx % palette.length],
    rowIndex: idx,
  }));

  return { xKey, xLabels, xNumbers, series, pieSlices };
}

export function rowsToCsv(columns: readonly ColumnSpec[], rows: readonly DataRow[]): string {
  const escape = (val: string) =>
    /[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
  const header = columns.map((c) => escape(c.label ?? c.key)).join(",");
  const body = rows.map((row) =>
    columns
      .map((col) => {
        const raw = row[col.key];
        const formatted =
          raw === null || raw === undefined
            ? ""
            : typeof raw === "number" || typeof raw === "boolean"
              ? String(raw)
              : formatCellValue(raw, col.type);
        return escape(formatted);
      })
      .join(","),
  );
  return [header, ...body].join("\n");
}
