import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import {
  parseStructuredRows,
  substituteTemplate,
  type DataRow,
} from "../shared/query-engine";
import type { GraphTablesSettings } from "../shared/settings";
import type { SourceSpec } from "../shared/view-schema";
import { redactSecret, resolvePostgresUrl } from "./env-loader";

const SOURCE_TIMEOUT_MS = 25_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function resolveWorkspacePath(cwd: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

async function listFolderRows(
  cwd: string,
  folderPath: string,
  glob: string | undefined,
  maxRows: number,
): Promise<DataRow[]> {
  const root = resolveWorkspacePath(cwd, folderPath);
  const matcher = glob ? globToRegExp(glob) : null;
  const recursive = Boolean(glob && glob.includes("**"));
  const rows: DataRow[] = [];

  async function walk(currentDir: string) {
    if (rows.length >= maxRows) return;
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (rows.length >= maxRows) break;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(root, fullPath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (recursive && entry.name !== "node_modules" && entry.name !== ".git") {
          await walk(fullPath);
        }
        continue;
      }
      if (matcher && !matcher.test(relPath) && !matcher.test(entry.name)) {
        continue;
      }
      const info = await stat(fullPath).catch(() => null);
      rows.push({
        name: entry.name,
        relativePath: relPath,
        path: fullPath,
        size: info?.size ?? 0,
        modifiedAt: info ? info.mtime.toISOString() : "",
        ext: path.extname(entry.name).replace(/^\./, ""),
      });
    }
  }

  await walk(root);
  return rows;
}

const SCRIPT_INTERPRETERS: Record<
  Extract<SourceSpec, { kind: "script" }>["language"],
  { command: string; ext: string }
> = {
  python: { command: "python3", ext: ".py" },
  node: { command: "node", ext: ".mjs" },
  sh: { command: "sh", ext: ".sh" },
  bash: { command: "bash", ext: ".sh" },
  ruby: { command: "ruby", ext: ".rb" },
  perl: { command: "perl", ext: ".pl" },
};

export interface SourceExecutionContext {
  cwd: string;
  settings: GraphTablesSettings;
  controlValues?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}

export async function executeSource(
  source: SourceSpec,
  ctx: SourceExecutionContext,
): Promise<DataRow[]> {
  const { cwd, settings, controlValues, signal } = ctx;
  const maxRows = settings.maxRowsPerQuery;

  switch (source.kind) {
    case "file": {
      if (!settings.allowFileSource) {
        throw new Error("File data sources are disabled in Graph & Tables settings.");
      }
      const resolvedPath = resolveWorkspacePath(cwd, source.path);
      const content = await readFile(resolvedPath, "utf8");
      const inferredFormat =
        source.format ??
        (resolvedPath.endsWith(".csv")
          ? "csv"
          : resolvedPath.endsWith(".tsv")
            ? "tsv"
            : resolvedPath.endsWith(".jsonl") || resolvedPath.endsWith(".ndjson")
              ? "jsonl"
              : "auto");
      return parseStructuredRows(content, inferredFormat, source.rows).slice(0, maxRows);
    }

    case "folder": {
      if (!settings.allowFileSource) {
        throw new Error("Folder data sources are disabled in Graph & Tables settings.");
      }
      return listFolderRows(cwd, source.path, source.glob, maxRows);
    }

    case "sqlite": {
      if (!settings.allowSqliteSource) {
        throw new Error("SQLite data sources are disabled in Graph & Tables settings.");
      }
      const dbPath = resolveWorkspacePath(cwd, source.path);
      const query = substituteTemplate(source.query, controlValues, "sql");
      const { stdout } = await execCommand("sqlite3", ["-readonly", "-json", dbPath, query], {
        cwd,
        timeout: SOURCE_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        signal,
      });
      if (!stdout.trim()) return [];
      return parseStructuredRows(stdout, "json").slice(0, maxRows);
    }

    case "postgres": {
      if (!settings.allowPostgresSource) {
        throw new Error(
          "PostgreSQL data sources are disabled by default. Enable them in Settings -> Graph & Tables.",
        );
      }
      const resolved = await resolvePostgresUrl(cwd, source.env);
      if (!resolved.ok) {
        throw new Error(resolved.error);
      }
      const query = substituteTemplate(source.query, controlValues, "sql");
      try {
        const { stdout } = await execCommand(
          "psql",
          [resolved.url, "-v", "ON_ERROR_STOP=1", "--csv", "-c", query],
          {
            cwd,
            timeout: SOURCE_TIMEOUT_MS,
            maxBuffer: MAX_BUFFER_BYTES,
            signal,
          },
        );
        if (!stdout.trim()) return [];
        return parseStructuredRows(stdout, "csv").slice(0, maxRows);
      } catch (error) {
        const rawMsg = error instanceof Error ? error.message : String(error);
        throw new Error(redactSecret(rawMsg, resolved.url));
      }
    }

    case "http": {
      if (!settings.allowHttpSource) {
        throw new Error("HTTP data sources are disabled in Graph & Tables settings.");
      }
      const rawUrl = substituteTemplate(source.url, controlValues, "url");
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        throw new Error(`Invalid HTTP source URL: ${rawUrl}`);
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
      const onParentAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", onParentAbort, { once: true });
      }
      try {
        const response = await fetch(parsedUrl.toString(), {
          method: source.method ?? "GET",
          headers: source.headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP source returned ${response.status} ${response.statusText}`);
        }
        const body = await response.text();
        return parseStructuredRows(body, source.format ?? "auto", source.rows).slice(0, maxRows);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onParentAbort);
      }
    }

    case "command": {
      if (!settings.allowCommandSource) {
        throw new Error(
          "Shell command sources are disabled by default. Enable them in Settings -> Graph & Tables.",
        );
      }
      const cmd = substituteTemplate(source.command, controlValues, "shell");
      const { stdout } = await execCommand(cmd, [], {
        cwd,
        shell: true,
        timeout: SOURCE_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        signal,
      });
      return parseStructuredRows(stdout, source.format ?? "auto").slice(0, maxRows);
    }

    case "script": {
      if (!settings.allowScriptSource) {
        throw new Error(
          "Inline script sources are disabled by default. Enable them in Settings -> Graph & Tables.",
        );
      }
      const runner = SCRIPT_INTERPRETERS[source.language];
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "paseo-gt-script-"));
      try {
        const scriptFile = path.join(tempDir, `run${runner.ext}`);
        await writeFile(scriptFile, source.code, "utf8");
        const args = (source.args ?? []).map((arg) =>
          substituteTemplate(arg, controlValues, "raw"),
        );
        const { stdout } = await execCommand(runner.command, [scriptFile, ...args], {
          cwd,
          timeout: SOURCE_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
          signal,
        });
        return parseStructuredRows(stdout, source.format ?? "auto").slice(0, maxRows);
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
