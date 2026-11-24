import type { ColumnSpec, ColumnType, WhereClause } from "./view-schema";

export type DataRow = Record<string, unknown>;

export interface QueryRequest {
  where?: readonly WhereClause[];
  search?: string;
  sort?: string;
  top?: number;
  page?: number;
  pageSize?: number;
}

export interface QueryResult {
  rows: DataRow[];
  totalRows: number;
  filteredRows: number;
  page: number;
  pageSize: number;
  facets: Record<string, string[]>;
}

const STRICT_NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const URL_RE = /^https?:\/\/\S+$/i;

export function coerceCellScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (STRICT_NUMBER_RE.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return raw;
}

/** RFC-4180 compliant CSV/TSV parser supporting quoted newlines and doubled quotes. */
export function parseDelimitedRows(text: string, delimiter = ","): DataRow[] {
  const records: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  const cleaned = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentField);
      currentField = "";
    } else if (ch === "\r") {
      if (cleaned[i + 1] === "\n") i += 1;
      currentRow.push(currentField);
      records.push(currentRow);
      currentRow = [];
      currentField = "";
    } else if (ch === "\n") {
      currentRow.push(currentField);
      records.push(currentRow);
      currentRow = [];
      currentField = "";
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    records.push(currentRow);
  }

  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const headers = nonEmpty[0].map((header, idx) => {
    const trimmed = header.trim();
    return trimmed || `col_${idx + 1}`;
  });

  const rows: DataRow[] = [];
  for (let r = 1; r < nonEmpty.length; r += 1) {
    const record = nonEmpty[r];
    const row: DataRow = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = coerceCellScalar(record[c] ?? "");
    }
    rows.push(row);
  }
  return rows;
}

export function extractByDotPath(value: unknown, dotPath?: string): unknown {
  if (!dotPath) return value;
  let cursor: unknown = value;
  for (const segment of dotPath.split(".")) {
    if (!segment) continue;
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = Reflect.get(cursor, segment);
  }
  return cursor;
}

function normalizeRowArray(value: unknown): DataRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected an array of row objects from data source.");
  }
  return value.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return item as DataRow;
    }
    return { value: item };
  });
}

export function parseStructuredRows(
  text: string,
  format: "auto" | "json" | "jsonl" | "csv" | "tsv" = "auto",
  rowsPath?: string,
): DataRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const tryJson = () => {
    const parsed = JSON.parse(trimmed) as unknown;
    const target = rowsPath ? extractByDotPath(parsed, rowsPath) : parsed;
    if (Array.isArray(target)) return normalizeRowArray(target);
    if (target && typeof target === "object") {
      for (const fallbackKey of ["rows", "data", "items", "results", "records"]) {
        const candidate = Reflect.get(target, fallbackKey);
        if (Array.isArray(candidate)) return normalizeRowArray(candidate);
      }
      return [target as DataRow];
    }
    return [{ value: target }];
  };

  if (format === "json") return tryJson();
  if (format === "csv") return parseDelimitedRows(trimmed, ",");
  if (format === "tsv") return parseDelimitedRows(trimmed, "\t");
  if (format === "jsonl") {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as DataRow)
          : { value: parsed };
      });
  }

  // auto format detection
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return tryJson();
    } catch {
      // May be JSONL (multiple lines of JSON objects)
      const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length > 1) {
        try {
          return lines.map((line) => {
            const parsed = JSON.parse(line) as unknown;
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as DataRow)
              : { value: parsed };
          });
        } catch {
          // fall through to delimited
        }
      }
    }
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("\t") && !firstLine.includes(",")) {
    return parseDelimitedRows(trimmed, "\t");
  }
  return parseDelimitedRows(trimmed, ",");
}

export function inferColumnType(key: string, values: unknown[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonEmpty.length === 0) return "text";

  const lowerKey = key.toLowerCase();
  const sample = nonEmpty.slice(0, 60);

  if (sample.every((v) => typeof v === "boolean")) return "bool";
  if (sample.every((v) => typeof v === "number" && Number.isFinite(v))) {
    if (/(pct|percent|rate|ratio)/.test(lowerKey)) return "percent";
    if (/(bytes|size_bytes|memory_bytes)/.test(lowerKey)) return "bytes";
    if (/(price|cost|revenue|amount|spend|budget|usd|salary)/.test(lowerKey)) return "currency";
    return "number";
  }

  const strings = sample.map((v) => String(v).trim());
  if (strings.every((s) => HEX_COLOR_RE.test(s))) return "color";
  if (strings.every((s) => URL_RE.test(s))) {
    if (strings.every((s) => /\.(png|jpe?g|gif|webp|svg)(?:\?.*)?$/i.test(s))) return "image";
    return "url";
  }
  if (strings.every((s) => ISO_DATE_RE.test(s))) return "date";
  if (strings.every((s) => ISO_DATETIME_RE.test(s))) return "datetime";
  if (/(status|state|level|severity|priority|kind|env|tier)/.test(lowerKey)) {
    const unique = new Set(strings);
    if (unique.size <= 16 && strings.every((s) => s.length <= 28)) return "badge";
  }
  if (/(path|file|dir|cwd)/.test(lowerKey)) return "path";
  return "text";
}

export function humanizeColumnLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function inferColumns(rows: readonly DataRow[], explicit?: readonly ColumnSpec[]): ColumnSpec[] {
  const keySet = new Set<string>();
  for (const row of rows.slice(0, 100)) {
    for (const key of Object.keys(row)) keySet.add(key);
  }

  const sampleFor = (key: string) => rows.slice(0, 80).map((row) => row[key]);

  if (explicit && explicit.length > 0) {
    return explicit.map((col) => {
      const type = col.type ?? inferColumnType(col.key, sampleFor(col.key));
      return {
        ...col,
        label: col.label ?? humanizeColumnLabel(col.key),
        type,
        align:
          col.align ??
          (type === "number" || type === "percent" || type === "currency" || type === "bytes"
            ? "right"
            : "left"),
      };
    });
  }

  return [...keySet].map((key) => {
    const type = inferColumnType(key, sampleFor(key));
    return {
      key,
      label: humanizeColumnLabel(key),
      type,
      align:
        type === "number" || type === "percent" || type === "currency" || type === "bytes"
          ? "right"
          : "left",
    };
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return String(bytes);
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = abs / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const signed = bytes < 0 ? -value : value;
  return `${signed.toFixed(signed >= 100 ? 0 : 1)} ${units[idx]}`;
}

export function formatCellValue(value: unknown, type: ColumnType = "text"): string {
  if (value === null || value === undefined) return "—";
  if (type === "bool") {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (type === "bytes") return formatBytes(value);
    if (type === "percent") {
      const pct = Math.abs(value) <= 1 && value !== 0 ? value * 100 : value;
      return `${pct.toFixed(Number.isInteger(pct) ? 0 : 1)}%`;
    }
    if (type === "currency") {
      return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
        maximumFractionDigits: 2,
      })}`;
    }
    if (type === "number") {
      return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
    }
  }
  if (type === "datetime" && typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString().replace("T", " ").slice(0, 19);
    }
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const numA = typeof a === "number" ? a : Number(a);
  const numB = typeof b === "number" ? b : Number(b);
  if (
    typeof a !== "boolean" &&
    typeof b !== "boolean" &&
    String(a).trim() !== "" &&
    String(b).trim() !== "" &&
    Number.isFinite(numA) &&
    Number.isFinite(numB)
  ) {
    return numA - numB;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function matchesWhere(row: DataRow, clause: WhereClause): boolean {
  const raw = row[clause.key];
  const op = clause.op ?? "eq";
  const target = clause.value;

  if (op === "eq") {
    if (raw === target) return true;
    return String(raw ?? "") === String(target ?? "");
  }
  if (op === "ne") {
    return String(raw ?? "") !== String(target ?? "");
  }
  if (op === "contains") {
    return String(raw ?? "")
      .toLowerCase()
      .includes(String(target ?? "").toLowerCase());
  }
  if (op === "in") {
    const list = Array.isArray(target) ? target : [target];
    return list.some((item) => item === raw || String(item) === String(raw ?? ""));
  }

  const numRaw = typeof raw === "number" ? raw : Number(raw);
  const numTarget = typeof target === "number" ? target : Number(target);
  if (Number.isFinite(numRaw) && Number.isFinite(numTarget)) {
    if (op === "gt") return numRaw > numTarget;
    if (op === "gte") return numRaw >= numTarget;
    if (op === "lt") return numRaw < numTarget;
    if (op === "lte") return numRaw <= numTarget;
  }
  const cmp = compareValues(raw, target);
  if (op === "gt") return cmp > 0;
  if (op === "gte") return cmp >= 0;
  if (op === "lt") return cmp < 0;
  if (op === "lte") return cmp <= 0;
  return false;
}

export function buildFacets(rows: readonly DataRow[]): Record<string, string[]> {
  if (rows.length === 0) return {};
  const keys = Object.keys(rows[0] ?? {});
  const facets: Record<string, string[]> = {};
  for (const key of keys) {
    const values = new Set<string>();
    let tooMany = false;
    for (const row of rows) {
      const val = row[key];
      if (val === null || val === undefined || val === "") continue;
      if (typeof val === "object") {
        tooMany = true;
        break;
      }
      values.add(String(val));
      if (values.size > 40) {
        tooMany = true;
        break;
      }
    }
    if (!tooMany && values.size > 0) {
      facets[key] = [...values].sort((a, b) => a.localeCompare(b));
    }
  }
  return facets;
}

export function applyQuery(rows: readonly DataRow[], query: QueryRequest = {}): QueryResult {
  const totalRows = rows.length;
  let working = [...rows];

  if (query.where && query.where.length > 0) {
    working = working.filter((row) => query.where!.every((clause) => matchesWhere(row, clause)));
  }

  const needle = query.search?.trim().toLowerCase();
  if (needle) {
    working = working.filter((row) =>
      Object.values(row).some((val) =>
        val !== null && val !== undefined && String(val).toLowerCase().includes(needle),
      ),
    );
  }

  if (query.sort && query.sort.trim()) {
    const trimmed = query.sort.trim();
    const desc = trimmed.startsWith("-");
    const sortKey = desc || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
    working.sort((a, b) => {
      const cmp = compareValues(a[sortKey], b[sortKey]);
      return desc ? -cmp : cmp;
    });
  }

  if (typeof query.top === "number" && query.top > 0) {
    working = working.slice(0, query.top);
  }

  const filteredRows = working.length;
  const pageSize = Math.max(1, query.pageSize ?? Math.max(25, filteredRows || 25));
  const totalPages = Math.max(1, Math.ceil(filteredRows / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;
  const paged = working.slice(start, start + pageSize);

  return {
    rows: paged,
    totalRows,
    filteredRows,
    page,
    pageSize,
    facets: buildFacets(rows),
  };
}

export type TemplateEscapeMode = "shell" | "sql" | "url" | "raw";

export function escapeTemplateValue(value: unknown, mode: TemplateEscapeMode): string {
  if (value === null || value === undefined) {
    if (mode === "shell") return "''";
    if (mode === "sql") return "''";
    return "";
  }
  if (mode === "url") {
    return encodeURIComponent(String(value));
  }
  if (mode === "raw") {
    return String(value);
  }
  if (mode === "sql") {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return `'${String(value).replace(/'/g, "''")}'`;
  }
  // shell
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function substituteTemplate(
  template: string,
  controlValues: Readonly<Record<string, unknown>> | undefined,
  mode: TemplateEscapeMode,
): string {
  const values = controlValues ?? {};
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_match, key: string) =>
    escapeTemplateValue(values[key], mode),
  );
}

/** Visual width units counting wide CJK/emoji code points as ~1.8 ASCII characters. */
export function visualTextUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    units += cp > 0x2e7f ? 1.8 : 1;
  }
  return units;
}

export function truncateVisualText(text: string, maxUnits: number): string {
  if (visualTextUnits(text) <= maxUnits) return text;
  let units = 0;
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const w = cp > 0x2e7f ? 1.8 : 1;
    if (units + w > Math.max(1, maxUnits - 1.2)) break;
    out += ch;
    units += w;
  }
  return `${out}…`;
}
