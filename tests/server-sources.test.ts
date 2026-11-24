import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
import { parseDotEnv, redactSecret, resolvePostgresUrl } from "../server/env-loader";
import { createQueryViewHandler } from "../server/handlers";
import { createShowViewTool } from "../server/show-view-tool";
import { executeSource } from "../server/sources";
import { ViewStore } from "../server/view-store";
import { DEFAULT_SETTINGS } from "../shared/settings";

const tempDirs: string[] = [];
const openServers: http.Server[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-gt-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (srv) =>
        new Promise<void>((resolve) => {
          srv.close(() => resolve());
        }),
    ),
  );
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("server sources and view lifecycle", () => {
  it("resolves Postgres URLs from .env / SUPABASE_DB_URL / custom env and redacts secrets", async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, ".env"),
      '# comment\nDATABASE_URL="postgres://alice:s3cr3t@db.local:5432/app"\nANALYTICS_URL="postgresql://ro:p4ss@db.local:5432/analytics"\n',
      "utf8",
    );

    expect(parseDotEnv('FOO="bar"\nexport BAZ=qux # inline')).toEqual({ FOO: "bar", BAZ: "qux" });

    const resolvedDefault = await resolvePostgresUrl(dir);
    expect(resolvedDefault).toEqual({
      ok: true,
      key: "DATABASE_URL",
      url: "postgres://alice:s3cr3t@db.local:5432/app",
    });

    const resolvedCustom = await resolvePostgresUrl(dir, "ANALYTICS_URL");
    expect(resolvedCustom).toEqual({
      ok: true,
      key: "ANALYTICS_URL",
      url: "postgresql://ro:p4ss@db.local:5432/analytics",
    });

    if (resolvedDefault.ok) {
      expect(redactSecret(`Failed connecting to ${resolvedDefault.url}`, resolvedDefault.url)).toBe(
        "Failed connecting to [REDACTED]",
      );
    }

    // Opt-in security guard
    await expect(
      executeSource(
        { kind: "postgres", query: "SELECT 1" },
        { cwd: dir, settings: DEFAULT_SETTINGS },
      ),
    ).rejects.toThrow(/disabled by default/i);

    // Missing named variable fails with clear guidance when enabled
    await expect(
      executeSource(
        { kind: "postgres", query: "SELECT 1", env: "MISSING_PG_VAR" },
        { cwd: dir, settings: { ...DEFAULT_SETTINGS, allowPostgresSource: true } },
      ),
    ).rejects.toThrow(/MISSING_PG_VAR/);
  });

  it("executes file (csv, tsv, json, nested, jsonl) and folder (flat & recursive) sources", async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, "sub"), { recursive: true });
    await writeFile(path.join(dir, "items.csv"), "id,name,score\n1,Alpha,90\n2,Beta,80\n", "utf8");
    await writeFile(path.join(dir, "items.tsv"), "name\tcount\nX\t5\nY\t9\n", "utf8");
    await writeFile(
      path.join(dir, "nested.json"),
      JSON.stringify({ payload: { rows: [{ k: "m", v: 42 }] } }),
      "utf8",
    );
    await writeFile(path.join(dir, "events.jsonl"), '{"ev":"start"}\n{"ev":"stop"}\n', "utf8");
    await writeFile(path.join(dir, "sub", "worker.ts"), "export const x = 1;", "utf8");

    expect(
      await executeSource({ kind: "file", path: "items.csv" }, { cwd: dir, settings: DEFAULT_SETTINGS }),
    ).toEqual([
      { id: 1, name: "Alpha", score: 90 },
      { id: 2, name: "Beta", score: 80 },
    ]);

    expect(
      await executeSource({ kind: "file", path: "items.tsv" }, { cwd: dir, settings: DEFAULT_SETTINGS }),
    ).toEqual([
      { name: "X", count: 5 },
      { name: "Y", count: 9 },
    ]);

    expect(
      await executeSource(
        { kind: "file", path: "nested.json", rows: "payload.rows" },
        { cwd: dir, settings: DEFAULT_SETTINGS },
      ),
    ).toEqual([{ k: "m", v: 42 }]);

    expect(
      await executeSource({ kind: "file", path: "events.jsonl" }, { cwd: dir, settings: DEFAULT_SETTINGS }),
    ).toEqual([{ ev: "start" }, { ev: "stop" }]);

    const folderFlat = await executeSource(
      { kind: "folder", path: ".", glob: "*.csv" },
      { cwd: dir, settings: DEFAULT_SETTINGS },
    );
    expect(folderFlat.map((r) => r.name)).toEqual(["items.csv"]);

    const folderRec = await executeSource(
      { kind: "folder", path: ".", glob: "**/*.ts" },
      { cwd: dir, settings: DEFAULT_SETTINGS },
    );
    expect(folderRec.map((r) => r.relativePath)).toEqual(["sub/worker.ts"]);
  });

  it("executes read-only sqlite queries and rejects SQL writes", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "test.db");
    await execCommand(
      "sqlite3",
      [dbPath, "CREATE TABLE metrics(k TEXT, v INT); INSERT INTO metrics VALUES ('a', 10), ('b', 20);"],
      { cwd: dir },
    );

    const rows = await executeSource(
      { kind: "sqlite", path: "test.db", query: "SELECT k, v FROM metrics WHERE v >= {{min}}" },
      { cwd: dir, settings: DEFAULT_SETTINGS, controlValues: { min: 15 } },
    );
    expect(rows).toEqual([{ k: "b", v: 20 }]);

    await expect(
      executeSource(
        { kind: "sqlite", path: "test.db", query: "DELETE FROM metrics" },
        { cwd: dir, settings: DEFAULT_SETTINGS },
      ),
    ).rejects.toThrow(/readonly/i);
  });

  it("executes HTTP sources with dot-path extraction, CSV, headers, templating, and error handling", async () => {
    const dir = await makeTempDir();
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              items: [
                {
                  region: url.searchParams.get("region") ?? "ALL",
                  token: req.headers["x-test-key"] ?? "",
                },
              ],
            },
          }),
        );
        return;
      }
      if (url.pathname === "/csv") {
        res.writeHead(200, { "content-type": "text/csv" });
        res.end("service,rps\napi,420\nworker,95\n");
        return;
      }
      res.writeHead(500, "Upstream Boom");
      res.end("error");
    });
    openServers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const jsonRows = await executeSource(
      {
        kind: "http",
        url: `${baseUrl}/json?region={{region}}`,
        headers: { "x-test-key": "k42" },
        rows: "data.items",
      },
      { cwd: dir, settings: DEFAULT_SETTINGS, controlValues: { region: "EU" } },
    );
    expect(jsonRows).toEqual([{ region: "EU", token: "k42" }]);

    const csvRows = await executeSource(
      { kind: "http", url: `${baseUrl}/csv`, format: "csv" },
      { cwd: dir, settings: DEFAULT_SETTINGS },
    );
    expect(csvRows).toEqual([
      { service: "api", rps: 420 },
      { service: "worker", rps: 95 },
    ]);

    await expect(
      executeSource(
        { kind: "http", url: `${baseUrl}/fail` },
        { cwd: dir, settings: DEFAULT_SETTINGS },
      ),
    ).rejects.toThrow(/500/);
  });

  it("enforces opt-in guards and executes command and script (node, python, bash) sources", async () => {
    const dir = await makeTempDir();
    await expect(
      executeSource(
        { kind: "command", command: "echo '[{\"x\":1}]'" },
        { cwd: dir, settings: DEFAULT_SETTINGS },
      ),
    ).rejects.toThrow(/disabled by default/i);

    await expect(
      executeSource(
        { kind: "script", language: "python", code: "print('[]')" },
        { cwd: dir, settings: DEFAULT_SETTINGS },
      ),
    ).rejects.toThrow(/disabled by default/i);

    const cmdRows = await executeSource(
      {
        kind: "command",
        command: 'printf \'[{"tag":%s}]\' {{tag}}',
        format: "json",
      },
      {
        cwd: dir,
        settings: { ...DEFAULT_SETTINGS, allowCommandSource: true },
        controlValues: { tag: '"safe"' },
      },
    );
    // Double check non-templated JSON line output cleanly via node echo
    expect(Array.isArray(cmdRows)).toBe(true);

    const scriptSettings = { ...DEFAULT_SETTINGS, allowScriptSource: true };
    const nodeRows = await executeSource(
      {
        kind: "script",
        language: "node",
        code: "console.log(JSON.stringify([{ ok: true, arg: process.argv[2] }]))",
        args: ["{{tag}}"],
      },
      { cwd: dir, settings: scriptSettings, controlValues: { tag: "v1" } },
    );
    expect(nodeRows).toEqual([{ ok: true, arg: "v1" }]);

    const pyRows = await executeSource(
      {
        kind: "script",
        language: "python",
        code: "import json, sys; print(json.dumps([{'lang': 'py', 'arg': sys.argv[1]}]))",
        args: ["{{tag}}"],
      },
      { cwd: dir, settings: scriptSettings, controlValues: { tag: "hello" } },
    );
    expect(pyRows).toEqual([{ lang: "py", arg: "hello" }]);

    const bashRows = await executeSource(
      {
        kind: "script",
        language: "bash",
        code: 'echo "lang,val"; echo "bash,$1"',
        args: ["{{tag}}"],
        format: "csv",
      },
      { cwd: dir, settings: scriptSettings, controlValues: { tag: "42" } },
    );
    expect(bashRows).toEqual([{ lang: "bash", val: 42 }]);
  });

  it("stores views via show_view, supports control source overrides, and refreshes stale polling views", async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, "sales.json"),
      JSON.stringify([
        { region: "NA", revenue: 100 },
        { region: "EU", revenue: 300 },
        { region: "APAC", revenue: 200 },
      ]),
      "utf8",
    );
    await writeFile(
      path.join(dir, "alt.json"),
      JSON.stringify([{ region: "LATAM", revenue: 550 }]),
      "utf8",
    );

    const store = new ViewStore({ storeDir: dir });
    const tool = createShowViewTool(store, () => DEFAULT_SETTINGS);
    const result = await tool.execute(
      {
        view: {
          type: "table",
          title: "Regional Sales",
          refresh: 1,
          source: { kind: "file", path: "sales.json" },
          controls: [
            {
              id: "dataset",
              type: "buttons",
              options: [
                { label: "Primary" },
                { label: "Alt", source: { kind: "file", path: "alt.json" } },
              ],
            },
            { id: "region", type: "select", column: "region" },
          ],
        },
      },
      {
        agent: {
          id: "agent-1",
          workspaceId: "ws-1",
          parentAgentId: null,
          provider: "codex",
          cwd: dir,
          title: "Test",
          background: false,
          metadata: {},
        },
        paseo: {} as never,
        signal: new AbortController().signal,
      },
    );

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { viewId: string; token: string; rowCount: number };
    expect(sc.rowCount).toBe(3);

    const handler = createQueryViewHandler(store, () => DEFAULT_SETTINGS);
    const queried = await handler({
      viewId: sc.viewId,
      sort: "-revenue",
      controlValues: { region: "EU" },
    });
    expect(queried.filteredRows).toBe(1);
    expect(queried.rows).toEqual([{ region: "EU", revenue: 300 }]);

    // Source override via button option
    const altResult = await handler({
      viewId: sc.viewId,
      controlValues: { dataset: "Alt" },
    });
    expect(altResult.rows).toEqual([{ region: "LATAM", revenue: 550 }]);

    // Update backing file + simulate stale fetchedAt to confirm refresh polling triggers re-read
    await writeFile(
      path.join(dir, "sales.json"),
      JSON.stringify([{ region: "NA", revenue: 999 }]),
      "utf8",
    );
    const stored = await store.get(sc.viewId);
    expect(stored).not.toBeNull();
    stored!.fetchedAt = new Date(Date.now() - 5000).toISOString();

    const refreshed = await handler({ viewId: sc.viewId });
    expect(refreshed.rows).toEqual([{ region: "NA", revenue: 999 }]);

    await store.flush();
  });
});
