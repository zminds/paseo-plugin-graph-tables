import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChartData } from "../client/format";
import { createExportViewHandler } from "../server/export";
import { ViewStore } from "../server/view-store";
import {
  rowsToCsv,
  rowsToJson,
  rowsToMarkdownTable,
  rowsToSqlInserts,
  rowsToTsv,
  sanitizeExportFilename,
} from "../shared/export-format";
import { applyGraphOffsets, layoutGraph } from "../shared/graph-layout";
import { inferColumns } from "../shared/query-engine";
import { DEFAULT_SETTINGS } from "../shared/settings";
import type { ChartKind } from "../shared/view-schema";
import {
  exportChartToSvg,
  exportGraphToSvg,
  type ChartExportData,
  type SvgThemePalette,
} from "../shared/svg-export";

const PALETTE: SvgThemePalette = {
  surface0: "#ffffff",
  surface1: "#f8fafc",
  surface2: "#f1f5f9",
  border: "#e2e8f0",
  foreground: "#0f172a",
  foregroundMuted: "#64748b",
  accent: "#2563eb",
  accentForeground: "#ffffff",
  statusSuccess: "#16a34a",
  statusWarning: "#d97706",
  statusDanger: "#dc2626",
};

const CHART_DATA: ChartExportData = {
  xKey: "q",
  xLabels: ["Q1", "Q2", "Q3"],
  xNumbers: [1, 2, 3],
  series: [
    { key: "a", label: "Alpha", color: "#2563eb", values: [10, 25, 18] },
    { key: "b", label: "Beta", color: "#16a34a", values: [15, 10, 22] },
  ],
  pieSlices: [
    { label: "Alpha", value: 53, color: "#2563eb", rowIndex: 0 },
    { label: "Beta", value: 47, color: "#16a34a", rowIndex: 1 },
  ],
  scatterPoints: [
    { seriesKey: "Alpha", seriesLabel: "Alpha", color: "#2563eb", x: 1, y: 10, xLabel: "Q1", rowIndex: 0 },
    { seriesKey: "Alpha", seriesLabel: "Alpha", color: "#2563eb", x: 1, y: 24, xLabel: "Q1", rowIndex: 1 },
    { seriesKey: "Beta", seriesLabel: "Beta", color: "#16a34a", x: 2, y: 15, xLabel: "Q2", rowIndex: 2 },
  ],
};

const CHART_VARIANTS: Array<{
  kind: ChartKind;
  curve?: "smooth" | "linear" | "step";
  stacked?: boolean;
}> = [
  { kind: "bar", stacked: false },
  { kind: "bar", stacked: true },
  { kind: "line", curve: "smooth" },
  { kind: "line", curve: "step" },
  { kind: "area", stacked: false },
  { kind: "area", stacked: true, curve: "smooth" },
  { kind: "pie" },
  { kind: "donut" },
  { kind: "scatter" },
];

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-gt-export-test-"));
  tempDirs.push(dir);
  return dir;
}

function createTestExportHandler(outDir: string) {
  return createExportViewHandler(new ViewStore(), () => ({
    ...DEFAULT_SETTINGS,
    exportDirectory: outDir,
  }));
}

function makeGraphExport() {
  const layout = layoutGraph({
    nodes: [
      { id: "a", label: "Start" },
      { id: "b", label: "Finish" },
    ],
    edges: [{ from: "a", to: "b", label: "next" }],
  });
  return exportGraphToSvg({ layout, title: "Pipeline", colors: PALETTE });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("markdown, csv, svg, and png export", () => {
  it("serializes formatted Markdown tables with alignment and cell escaping", () => {
    const rows = [
      { name: "Core | API", revenue: 12400, winRate: 0.75, note: "line1\nline2" },
      { name: "Edge", revenue: 800, winRate: 0.4, note: "ok" },
    ];
    const cols = [
      { key: "name", label: "Service" },
      { key: "revenue", label: "Revenue", type: "currency" as const },
      { key: "winRate", label: "Win%", type: "percent" as const },
      { key: "note", label: "Note" },
    ];
    const md = rowsToMarkdownTable(cols, rows);
    expect(md).toBe(
      [
        "| Service | Revenue | Win% | Note |",
        "| :--- | ---: | ---: | :--- |",
        "| Core \\| API | $12,400 | 75% | line1<br>line2 |",
        "| Edge | $800 | 40% | ok |",
      ].join("\n"),
    );

    const csvFormatted = rowsToCsv(inferColumns(rows, cols), rows, "formatted");
    expect(csvFormatted).toContain('Core | API,"$12,400",75%,"line1\nline2"');

    const csvRaw = rowsToCsv(inferColumns(rows, cols), rows, "raw");
    expect(csvRaw).toContain('Core | API,12400,0.75,"line1\nline2"');

    // TSV, JSON, SQL Inserts + formatted vs raw export value mode
    const rawTsv = rowsToTsv(cols, rows, "raw");
    expect(rawTsv).toContain("Core | API\t12400\t0.75\tline1\\nline2");

    const fmtJson = JSON.parse(rowsToJson(cols, rows, "formatted")) as Array<Record<string, unknown>>;
    expect(fmtJson[0]).toMatchObject({ Service: "Core | API", Revenue: "$12,400", "Win%": "75%" });

    const rawJson = JSON.parse(rowsToJson(cols, rows, "raw")) as Array<Record<string, unknown>>;
    expect(rawJson[0]).toMatchObject({ name: "Core | API", revenue: 12400, winRate: 0.75 });

    const sqlRaw = rowsToSqlInserts(cols, rows, "Service Metrics", "raw");
    expect(sqlRaw).toContain(
      'INSERT INTO "Service_Metrics" ("name", "revenue", "winRate", "note") VALUES (\'Core | API\', 12400, 0.75, \'line1\nline2\');',
    );
  });

  it("parses grouped scatter points without summing identical X coordinates", () => {
    const theme = { colors: PALETTE } as PluginTheme;
    const rows = [
      { latency: 320, cost: 1.2, tier: "Fast" },
      { latency: 320, cost: 2.1, tier: "Reasoning" },
      { latency: 480, cost: 1.8, tier: "Fast" },
    ];
    const parsed = parseChartData(
      rows,
      inferColumns(rows),
      { type: "chart", chart: "scatter", x: "latency", y: "cost", group: "tier" },
      theme,
    );
    expect(parsed.series.map((s) => s.key)).toEqual(["Fast", "Reasoning"]);
    expect(parsed.scatterPoints).toHaveLength(3);
    expect(parsed.scatterPoints[0]).toMatchObject({ seriesKey: "Fast", x: 320, y: 1.2 });
    expect(parsed.scatterPoints[1]).toMatchObject({ seriesKey: "Reasoning", x: 320, y: 2.1 });
  });

  it("sanitizes filenames safely across CJK and punctuation", () => {
    const dt = new Date(2026, 10, 24, 9, 5, 3);
    expect(sanitizeExportFilename("../架构/图 v1?*", "svg", dt)).toBe("架构-图-v1-20261124-090503.svg");
    expect(sanitizeExportFilename("   ", ".png", dt)).toBe("view-20261124-090503.png");
  });

  it("exports valid standalone SVGs for all 6 chart kinds including stacked area and grouped scatter", () => {
    for (const v of CHART_VARIANTS) {
      const { svg, width, height } = exportChartToSvg({
        kind: v.kind,
        title: `Chart ${v.kind}`,
        summary: "Test summary",
        data: CHART_DATA,
        curve: v.curve,
        stacked: v.stacked,
        colors: PALETTE,
      });
      expect(width).toBeGreaterThanOrEqual(420);
      expect(height).toBeGreaterThanOrEqual(220);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain("Chart ");
    }

    // Verify donut has Total label & pie has percentage legend
    const donutSvg = exportChartToSvg({
      kind: "donut",
      data: CHART_DATA,
      colors: PALETTE,
    }).svg;
    expect(donutSvg).toContain("Total");
    expect(donutSvg).toContain("53.0%");
  });

  it("exports standalone graph SVGs preserving groups, dragged offsets, and STEP pills", () => {
    const base = layoutGraph({
      direction: "down",
      nodes: [
        { id: "g1", type: "group", label: "Backend" },
        { id: "client", type: "actor", label: "Client" },
        { id: "api", type: "function", label: "API", group: "g1" },
      ],
      edges: [
        { from: "client", to: "api", label: "call", kind: "call" },
        { from: "api", to: "client", label: "reply", kind: "data" },
      ],
    });
    const moved = applyGraphOffsets(base, { api: { dx: 40, dy: 25 } });
    const { svg, width, height } = exportGraphToSvg({
      layout: moved,
      title: "Architecture & Data Flow",
      focusedIds: new Set(["client", "api"]),
      activeStepNumber: 1,
      colors: PALETTE,
    });

    expect(width).toBeGreaterThan(300);
    expect(height).toBeGreaterThan(200);
    expect(svg).toContain("BACKEND");
    expect(svg).toContain("STEP 1");
    expect(svg).toContain("Architecture &amp; Data Flow");
    expect(svg).not.toContain("<animate");
  });

  it("writes every table export format without changing the payload", async () => {
    const outDir = await makeTempDir();
    const handler = createTestExportHandler(outDir);
    const columns = [{ key: "service" }, { key: "count" }];
    const rows = [{ service: "架构, API", count: 10 }];
    const formats = [
      { format: "markdown", ext: "md", mime: "text/markdown", content: rowsToMarkdownTable(columns, rows) },
      { format: "csv", ext: "csv", mime: "text/csv", content: rowsToCsv(columns, rows) },
      { format: "tsv", ext: "tsv", mime: "text/tab-separated-values", content: rowsToTsv(columns, rows) },
      { format: "json", ext: "json", mime: "application/json", content: rowsToJson(columns, rows) },
      { format: "sql", ext: "sql", mime: "application/sql", content: rowsToSqlInserts(columns, rows, "metrics") },
    ] as const;

    for (const { format, ext, mime, content } of formats) {
      const result = await handler({ format, title: "Metrics Table", content });
      expect(result, result.error ?? undefined).toMatchObject({
        ok: true,
        bytes: Buffer.byteLength(content),
        mimeType: `${mime}; charset=utf-8`,
      });
      expect(result.filePath).toMatch(new RegExp(`\\.${ext}$`));
      expect(await readFile(result.filePath!, "utf8")).toBe(content);
    }
  });

  it("writes the exact SVG and complete PNG supplied by a client", async () => {
    const outDir = await makeTempDir();
    const handler = createTestExportHandler(outDir);
    const { svg } = makeGraphExport();
    const svgResult = await handler({ format: "svg", title: "Pipeline", svg });
    expect(svgResult, svgResult.error ?? undefined).toMatchObject({
      ok: true,
      bytes: Buffer.byteLength(svg),
      mimeType: "image/svg+xml; charset=utf-8",
    });
    expect(svgResult.filePath?.endsWith(".svg")).toBe(true);
    expect(await readFile(svgResult.filePath!, "utf8")).toBe(svg);

    vi.stubEnv("PATH", outDir);
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGM0Tpv5n4GBgYEJRIAwACDiAjV70IMnAAAAAElFTkSuQmCC";
    const png = Buffer.from(pngBase64, "base64");
    const pngResult = await handler({
      format: "png",
      title: "Client Shot",
      svg,
      pngBase64: `data:image/png;base64,${pngBase64}`,
    });
    expect(pngResult, pngResult.error ?? undefined).toMatchObject({
      ok: true,
      bytes: png.length,
      mimeType: "image/png",
    });
    expect(pngResult.filePath?.endsWith(".png")).toBe(true);
    expect(await readFile(pngResult.filePath!)).toEqual(png);
  });

  it("returns an actionable error when no daemon PNG rasterizer is available", async () => {
    const outDir = await makeTempDir();
    vi.stubEnv("PATH", outDir);
    const handler = createTestExportHandler(outDir);
    const result = await handler({ format: "png", title: "Pipeline", ...makeGraphExport() });

    expect(result).toMatchObject({ ok: false, filePath: null, bytes: 0, mimeType: "image/png" });
    expect(result.error).toContain("no rasterizer available");
    expect(await readdir(outDir)).toEqual([]);
  });

  // Run with PASEO_TEST_DAEMON_RASTERIZER=1 and a working rsvg-convert, magick, or macOS qlmanage on PATH.
  it.skipIf(process.env.PASEO_TEST_DAEMON_RASTERIZER !== "1")(
    "rasterizes graph and all 6 chart kinds without a browser",
    async () => {
      const outDir = await makeTempDir();
      const handler = createTestExportHandler(outDir);
      const charts = CHART_VARIANTS.map(({ kind, curve, stacked }, index) => ({
        title: `${kind} ${index + 1}`,
        ...exportChartToSvg({ kind, curve, stacked, data: CHART_DATA, colors: PALETTE }),
      }));
      const exports = [{ title: "Pipeline", ...makeGraphExport() }, ...charts];

      for (const { title, svg, width, height } of exports) {
        const result = await handler({ format: "png", title, svg, width, height });
        expect(result, `${title}: ${result.error ?? "unknown error"}`).toMatchObject({
          ok: true,
          mimeType: "image/png",
        });
        const png = await readFile(result.filePath!);
        expect(result.bytes).toBe(png.length);
        expect(png.length).toBeGreaterThan(100);
        expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(png.readUInt32BE(16)).toBeGreaterThan(100);
        expect(png.readUInt32BE(20)).toBeGreaterThan(100);
      }
    },
    30_000,
  );
});
