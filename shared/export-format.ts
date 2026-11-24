import { formatCellValue, type DataRow } from "./query-engine";
import type { ColumnSpec } from "./view-schema";

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

export function rowsToMarkdownTable(
  columns: readonly ColumnSpec[],
  rows: readonly DataRow[],
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
      const formatted = formatCellValue(row[col.key], col.type);
      return escapeMarkdownCell(formatted);
    });
    return `| ${cells.join(" | ")} |`;
  });

  return [header, alignRow, ...body].join("\n");
}

export function rowsToCsv(columns: readonly ColumnSpec[], rows: readonly DataRow[]): string {
  if (columns.length === 0) return "";
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
