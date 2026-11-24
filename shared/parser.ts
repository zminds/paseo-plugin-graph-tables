import { normalizeViewInput, type ColumnSpec, type ViewSpec } from "./view-schema";
import { coerceCellScalar } from "./query-engine";

export type ViewFenceKind = "paseo-view" | "beluga-view" | "paseo-graph" | "beluga-graph";

export type MessageSegment =
  | { kind: "markdown"; text: string }
  | { kind: "token"; viewId: string }
  | { kind: "streaming-view"; fenceKind: ViewFenceKind }
  | { kind: "inline-view"; spec: ViewSpec; raw: string }
  | { kind: "invalid-view"; error: string; raw: string; fenceKind: ViewFenceKind }
  | {
      kind: "gfm-table";
      rawMarkdown: string;
      columns: ColumnSpec[];
      rows: Record<string, unknown>[];
    };

export interface ParsedAssistantMessage {
  hasSpecialContent: boolean;
  segments: MessageSegment[];
}

const VIEW_FENCE_KINDS = new Set<string>([
  "paseo-view",
  "beluga-view",
  "paseo-graph",
  "beluga-graph",
]);

const TOKEN_LINE_RE = /^<<(?:paseo-)?view:([a-zA-Z0-9_-]+)>>$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const TABLE_SEP_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function splitTableCells(line: string): string[] | null {
  if (!line.includes("|")) return null;
  let trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function tryParseGfmTable(
  lines: string[],
  startIndex: number,
): {
  nextIndex: number;
  rawMarkdown: string;
  columns: ColumnSpec[];
  rows: Record<string, unknown>[];
} | null {
  if (startIndex + 3 >= lines.length) return null;
  const headerLine = lines[startIndex];
  const sepLine = lines[startIndex + 1];
  if (!TABLE_SEP_RE.test(sepLine)) return null;

  const headers = splitTableCells(headerLine);
  const aligns = splitTableCells(sepLine);
  if (!headers || !aligns || headers.length < 2 || headers.length !== aligns.length) {
    return null;
  }

  const bodyLines: string[] = [];
  let cursor = startIndex + 2;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line.trim() || !line.includes("|")) break;
    if (FENCE_OPEN_RE.test(line)) break;
    const cells = splitTableCells(line);
    if (!cells) break;
    bodyLines.push(line);
    cursor += 1;
  }

  // Require at least 2 body rows so tiny 1-row layout tables stay normal markdown
  if (bodyLines.length < 2) return null;

  const uniqueKeys: string[] = [];
  const seen = new Map<string, number>();
  const columns: ColumnSpec[] = headers.map((header, idx) => {
    const base = header.replace(/[`*_~]/g, "").trim() || `col_${idx + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const key = count === 1 ? base : `${base}_${count}`;
    uniqueKeys.push(key);

    const alignToken = aligns[idx] ?? "";
    const align =
      alignToken.startsWith(":") && alignToken.endsWith(":")
        ? "center"
        : alignToken.endsWith(":")
          ? "right"
          : "left";

    return { key, label: header || key, align };
  });

  const rows: Record<string, unknown>[] = bodyLines.map((line) => {
    const cells = splitTableCells(line) ?? [];
    const row: Record<string, unknown> = {};
    for (let i = 0; i < uniqueKeys.length; i += 1) {
      row[uniqueKeys[i]] = coerceCellScalar(cells[i] ?? "");
    }
    return row;
  });

  const rawMarkdown = lines.slice(startIndex, cursor).join("\n");
  return { nextIndex: cursor, rawMarkdown, columns, rows };
}

export function parseAssistantMessage(
  text: string,
  phase: "streaming" | "complete",
): ParsedAssistantMessage {
  if (!text) return { hasSpecialContent: false, segments: [] };

  const lines = text.split("\n");
  const segments: MessageSegment[] = [];
  const markdownBuffer: string[] = [];
  let hasSpecialContent = false;

  const flushMarkdown = () => {
    if (markdownBuffer.length === 0) return;
    const block = markdownBuffer.join("\n");
    markdownBuffer.length = 0;
    if (block.trim().length > 0) {
      segments.push({ kind: "markdown", text: block });
    }
  };

  let i = 0;
  let insideNormalFence: { char: string; len: number } | null = null;

  while (i < lines.length) {
    const line = lines[i];

    if (insideNormalFence) {
      markdownBuffer.push(line);
      const closeMatch = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === insideNormalFence.char &&
        closeMatch[1].length >= insideNormalFence.len
      ) {
        insideNormalFence = null;
      }
      i += 1;
      continue;
    }

    const fenceMatch = line.match(FENCE_OPEN_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const info = fenceMatch[2].trim().split(/\s+/)[0]?.toLowerCase() ?? "";

      if (VIEW_FENCE_KINDS.has(info)) {
        const fenceKind = info as ViewFenceKind;
        const fenceChar = marker[0];
        const fenceLen = marker.length;
        const bodyLines: string[] = [];
        let closed = false;
        let j = i + 1;
        while (j < lines.length) {
          const candidate = lines[j];
          const closeMatch = candidate.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
          if (
            closeMatch &&
            closeMatch[1][0] === fenceChar &&
            closeMatch[1].length >= fenceLen
          ) {
            closed = true;
            break;
          }
          bodyLines.push(candidate);
          j += 1;
        }

        flushMarkdown();
        hasSpecialContent = true;

        if (!closed && phase === "streaming") {
          segments.push({ kind: "streaming-view", fenceKind });
          i = lines.length;
          continue;
        }

        const rawJson = bodyLines.join("\n").trim();
        const defaultType = fenceKind.endsWith("graph") ? "graph" : undefined;
        const normalized = normalizeViewInput(rawJson, defaultType);
        if (normalized.ok) {
          segments.push({ kind: "inline-view", spec: normalized.spec, raw: rawJson });
        } else {
          segments.push({
            kind: "invalid-view",
            error: normalized.error,
            raw: rawJson,
            fenceKind,
          });
        }
        i = closed ? j + 1 : lines.length;
        continue;
      }

      // Normal code fence
      insideNormalFence = { char: marker[0], len: marker.length };
      markdownBuffer.push(line);
      i += 1;
      continue;
    }

    // Standalone view token line
    const tokenMatch = line.trim().match(TOKEN_LINE_RE);
    if (tokenMatch) {
      flushMarkdown();
      hasSpecialContent = true;
      segments.push({ kind: "token", viewId: tokenMatch[1] });
      i += 1;
      continue;
    }

    // GFM Markdown table outside code fences
    const table = tryParseGfmTable(lines, i);
    if (table) {
      flushMarkdown();
      hasSpecialContent = true;
      segments.push({
        kind: "gfm-table",
        rawMarkdown: table.rawMarkdown,
        columns: table.columns,
        rows: table.rows,
      });
      i = table.nextIndex;
      continue;
    }

    markdownBuffer.push(line);
    i += 1;
  }

  flushMarkdown();
  return { hasSpecialContent, segments };
}
