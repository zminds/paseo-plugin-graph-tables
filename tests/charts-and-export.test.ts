import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, describe, expect, it } from "vitest";
import { parseChartData } from "../client/format";
import { createExportViewHandler } from "../server/export";
import { ViewStore } from "../server/view-store";
import { rowsToCsv, rowsToMarkdownTable, sanitizeExportFilename } from "../shared/export-format";
import { applyGraphOffsets, layoutGraph } from "../shared/graph-layout";
import { inferColumns } from "../shared/query-engine";
import { DEFAULT_SETTINGS } from "../shared/settings";
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

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-gt-export-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
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

    const csv = rowsToCsv(inferColumns(rows, cols), rows);
    expect(csv).toContain("Core | API,12400,0.75,\"line1\nline2\"");
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
    const data: ChartExportData = {
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

    const variants: Array<{
      kind: "bar" | "line" | "area" | "pie" | "donut" | "scatter";
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

    for (const v of variants) {
      const { svg, width, height } = exportChartToSvg({
        kind: v.kind,
        title: `Chart ${v.kind}`,
        summary: "Test summary",
        data,
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
      data,
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

  it("writes md, svg, client PNG, and daemon-rasterized PNG via views.export handler", async () => {
    const outDir = await makeTempDir();
    const store = new ViewStore({ storeDir: outDir });
    const handler = createExportViewHandler(store, () => ({
      ...DEFAULT_SETTINGS,
      exportDirectory: outDir,
    }));

    const mdRes = await handler({
      format: "markdown",
      title: "Metrics Table",
      content: "| a | b |\n| :--- | ---: |\n| x | 1 |\n",
    });
    expect(mdRes.ok).toBe(true);
    expect(mdRes.filePath?.endsWith(".md")).toBe(true);
    expect(await readFile(mdRes.filePath!, "utf8")).toContain("| x | 1 |");

    const graph = layoutGraph({
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "Finish" },
      ],
      edges: [{ from: "a", to: "b", label: "next" }],
    });
    const { svg, width, height } = exportGraphToSvg({
      layout: graph,
      title: "Pipeline",
      colors: PALETTE,
    });

    const svgRes = await handler({ format: "svg", title: "Pipeline", svg });
    expect(svgRes.ok).toBe(true);
    expect(svgRes.filePath?.endsWith(".svg")).toBe(true);

    // Client-supplied PNG base64 write
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const clientPngRes = await handler({
      format: "png",
      title: "Client Shot",
      pngBase64: `data:image/png;base64,${fakePng.toString("base64")}`,
    });
    expect(clientPngRes.ok).toBe(true);
    expect((await readFile(clientPngRes.filePath!)).subarray(0, 8)).toEqual(fakePng.subarray(0, 8));

    // Daemon-side SVG -> PNG fallback (uses qlmanage on macOS)
    if (process.platform === "darwin") {
      const daemonPngRes = await handler({
        format: "png",
        title: "Daemon Raster",
        svg,
        width,
        height,
      });
      expect(daemonPngRes.ok).toBe(true);
      expect(daemonPngRes.bytes).toBeGreaterThan(100);
      const header = (await readFile(daemonPngRes.filePath!)).subarray(0, 8);
      expect(header).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });
});
