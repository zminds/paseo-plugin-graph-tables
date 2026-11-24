import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-gt-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("server sources and view lifecycle", () => {
  it("parses .env files and redacts Postgres URLs", async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, ".env"),
      '# comment\nDATABASE_URL="postgres://alice:s3cr3t@db.local:5432/app"\n',
      "utf8",
    );

    expect(parseDotEnv('FOO="bar"\nexport BAZ=qux # inline')).toEqual({ FOO: "bar", BAZ: "qux" });
    const resolved = await resolvePostgresUrl(dir);
    expect(resolved).toEqual({
      ok: true,
      key: "DATABASE_URL",
      url: "postgres://alice:s3cr3t@db.local:5432/app",
    });
    if (resolved.ok) {
      expect(redactSecret(`Failed connecting to ${resolved.url}`, resolved.url)).toBe(
        "Failed connecting to [REDACTED]",
      );
    }
  });

  it("executes file, folder, and read-only sqlite sources", async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, "items.csv"), "id,name,score\n1,Alpha,90\n2,Beta,80\n", "utf8");
    await writeFile(path.join(dir, "notes.md"), "# Notes", "utf8");

    const fileRows = await executeSource(
      { kind: "file", path: "items.csv" },
      { cwd: dir, settings: DEFAULT_SETTINGS },
    );
    expect(fileRows).toEqual([
      { id: 1, name: "Alpha", score: 90 },
      { id: 2, name: "Beta", score: 80 },
    ]);

    const folderRows = await executeSource(
      { kind: "folder", path: ".", glob: "*.csv" },
      { cwd: dir, settings: DEFAULT_SETTINGS },
    );
    expect(folderRows).toHaveLength(1);
    expect(folderRows[0]?.name).toBe("items.csv");

    const dbPath = path.join(dir, "test.db");
    await execCommand(
      "sqlite3",
      [dbPath, "CREATE TABLE metrics(k TEXT, v INT); INSERT INTO metrics VALUES ('a', 10), ('b', 20);"],
      { cwd: dir },
    );
    const sqliteRows = await executeSource(
      { kind: "sqlite", path: "test.db", query: "SELECT k, v FROM metrics WHERE v >= {{min}}" },
      { cwd: dir, settings: DEFAULT_SETTINGS, controlValues: { min: 15 } },
    );
    expect(sqliteRows).toEqual([{ k: "b", v: 20 }]);
  });

  it("blocks opt-in sources by default and allows them when enabled", async () => {
    const dir = await makeTempDir();
    await expect(
      executeSource(
        { kind: "command", command: "echo '[{\"x\":1}]'" },
        { cwd: dir, settings: DEFAULT_SETTINGS },
      ),
    ).rejects.toThrow(/disabled by default/i);

    const allowed = await executeSource(
      { kind: "script", language: "node", code: 'console.log(JSON.stringify([{ ok: true, arg: process.argv[2] }]))', args: ["{{tag}}"] },
      {
        cwd: dir,
        settings: { ...DEFAULT_SETTINGS, allowScriptSource: true },
        controlValues: { tag: "v1" },
      },
    );
    expect(allowed).toEqual([{ ok: true, arg: "v1" }]);
  });

  it("stores views via show_view tool and queries them via RPC handler", async () => {
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

    const store = new ViewStore({ storeDir: dir });
    const tool = createShowViewTool(store, () => DEFAULT_SETTINGS);
    const result = await tool.execute(
      {
        view: {
          type: "table",
          title: "Regional Sales",
          source: { kind: "file", path: "sales.json" },
          controls: [{ id: "region", type: "select", column: "region" }],
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
    expect(result.text).toContain(sc.token);

    const handler = createQueryViewHandler(store, () => DEFAULT_SETTINGS);
    const queried = await handler({
      viewId: sc.viewId,
      sort: "-revenue",
      controlValues: { region: "EU" },
    });
    expect(queried.filteredRows).toBe(1);
    expect(queried.rows).toEqual([{ region: "EU", revenue: 300 }]);
    await store.flush();
  });
});
