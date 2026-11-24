import { formatCellValue, type DataRow } from "./query-engine";
import type { ColumnSpec } from "./view-schema";

export type ExportValueMode = "formatted" | "raw";

function isRightAlignedColumn(col: ColumnSpec): boolean {
  if (col.align === "right") return true;
  if (col.align === "left" || col.align === "center") return false;
  return (
    col.type === "number" ||
    col.type === "currency" ||
    col.type === "percent" ||
    col.type === "bytes"
  );
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function resolveCellString(
  raw: unknown,
  col: ColumnSpec,
  mode: ExportValueMode,
  emptyFallback = "",
): string {
  if (raw === null || raw === undefined) return emptyFallback;
  if (mode === "raw") {
    if (typeof raw === "object") return JSON.stringify(raw);
    return String(raw);
  }
  return formatCellValue(raw, col.type);
}

export function rowsToMarkdownTable(
  columns: readonly ColumnSpec[],
  rows: readonly DataRow[],
  mode: ExportValueMode = "formatted",
): string {
  if (columns.length === 0) return "";
  const header = `| ${columns.map((c) => escapeMarkdownCell(c.label ?? c.key)).join(" | ")} |`;
  const alignRow = `| ${columns
    .map((c) => {
      if (c.align === "center") return ":---:";
      return isRightAlignedColumn(c) ? "---:" : ":---";
    })
    .join(" | ")} |`;

  const body = rows.map((row) => {
    const cells = columns.map((col) => {
      const text = resolveCellString(row[col.key], col, mode, mode === "raw" ? "" : "—");
      return escapeMarkdownCell(text);
    });
    return `| ${cells.join(" | ")} |`;
  });

  return [header, alignRow, ...body].join("\n");
}

export function rowsToCsv(
  columns: readonly ColumnSpec[],
  rows: readonly DataRow[],
  mode: ExportValueMode = "formatted",
): string {
  if (columns.length === 0) return "";
  const escape = (val: string) =>
    /[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
  const header = columns.map((c) => escape(c.label ?? c.key)).join(",");
  const body = rows.map((row) =>
    columns
      .map((col) => {
        const raw = row[col.key];
        const text =
          mode === "formatted" && (typeof raw === "number" || typeof raw === "boolean")
            ? col.type === "currency" || col.type === "percent" || col.type === "bytes" || col.type === "bool"
              ? formatCellValue(raw, col.type)
              : String(raw)
            : resolveCellString(raw, col, mode, "");
        return escape(text);
      })
      .join(","),
  );
  return [header, ...body].join("\n");
}

export function rowsToTsv(
  columns: readonly ColumnSpec[],
  rows: readonly DataRow[],
  mode: ExportValueMode = "formatted",
): string {
  if (columns.length === 0) return "";
  const cleanTsv = (val: string) =>
    val.replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
  const header = columns.map((c) => cleanTsv(c.label ?? c.key)).join("\t");
  const body = rows.map((row) =>
    columns
      .map((col) => cleanTsv(resolveCellString(row[col.key], col, mode, "")))
      .join("\t"),
  );
  return [header, ...body].join("\n");
}

export function rowsToJson(
  columns: readonly ColumnSpec[],
  rows: readonly DataRow[],
  mode: ExportValueMode = "formatted",
): string {
  const out = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      const key = mode === "formatted" ? (col.label ?? col.key) : col.key;
      const raw = row[col.key];
      obj[key] =
        mode === "raw"
          ? (raw ?? null)
          : raw === null || raw === undefined
            ? null
            : formatCellValue(raw, col.type);
    }
    return obj;
  });
  return JSON.stringify(out, null, 2);
}

function quoteSqlIdentifier(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}_]/gu, "_").replace(/^_+|_+$/g, "") || "col";
  return `"${clean.replace(/"/g, '""')}"`;
}

function quoteSqlLiteral(raw: unknown, col: ColumnSpec, mode: ExportValueMode): string {
  if (raw === null || raw === undefined) return "NULL";
  if (mode === "raw") {
    if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "NULL";
    if (typeof raw === "boolean") return raw ? "TRUE" : "FALSE";
    if (typeof raw === "object") return `'${JSON.stringify(raw).replace(/'/g, "''")}'`;
    return `'${String(raw).replace(/'/g, "''")}'`;
  }
  return `'${formatCellValue(raw, col.type).replace(/'/g, "''")}'`;
}

export function rowsToSqlInserts(
  columns: readonly ColumnSpec[],
  rows: readonly DataRow[],
  tableName = "exported_view",
  mode: ExportValueMode = "formatted",
): string {
  if (columns.length === 0 || rows.length === 0) return "";
  const safeTable = quoteSqlIdentifier(tableName);
  const colList = columns.map((c) => quoteSqlIdentifier(c.key)).join(", ");
  return rows
    .map((row) => {
      const vals = columns.map((col) => quoteSqlLiteral(row[col.key], col, mode)).join(", ");
      return `INSERT INTO ${safeTable} (${colList}) VALUES (${vals});`;
    })
    .join("\n");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function sanitizeExportFilename(
  title: string | undefined,
  ext: string,
  now = new Date(),
): string {
  const cleanExt = ext.replace(/^\.+/, "").replace(/[^a-zA-Z0-9]/g, "") || "txt";
  const rawBase = (title ?? "view")
    .replace(/[/\\]/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const safeBase = rawBase || "view";
  const stamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    "-",
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join("");

  return `${safeBase}-${stamp}.${cleanExt}`;
}
