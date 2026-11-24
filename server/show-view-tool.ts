import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { inferColumns, type DataRow } from "../shared/query-engine";
import type { GraphTablesSettings } from "../shared/settings";
import { normalizeViewInput } from "../shared/view-schema";
import { executeSource } from "./sources";
import type { ViewStore } from "./view-store";

export function createShowViewTool(
  store: ViewStore,
  getSettings: () => GraphTablesSettings,
) {
  return defineAgentTool({
    name: "show_view",
    title: "Show interactive view",
    description:
      "Render an interactive table, chart, KPI stats, gantt, heatmap, calendar, colors, code, or diagram in the user's timeline. Pass a view JSON object with static data/nodes/items OR a live source (file, folder, sqlite, postgres, http, command, script). Returns a <<paseo-view:...>> token to place on its own line in your response.",
    input: z.object({
      view: z
        .union([z.record(z.string(), z.unknown()), z.string()])
        .describe(
          'View specification object (or JSON string): { "type": "table"|"chart"|"stats"|"gantt"|"heatmap"|"calendar"|"colors"|"code"|"graph", "title": "...", "data": [...] | "source": {...}, "controls": [...] }',
        ),
    }),
    async execute({ view }, { agent, signal }) {
      const normalized = normalizeViewInput(view);
      if (!normalized.ok) {
        return { isError: true, text: normalized.error };
      }

      const spec = normalized.spec;
      const settings = getSettings();
      let rows: DataRow[] = Array.isArray(spec.data)
        ? (spec.data as DataRow[]).slice(0, settings.maxRowsPerQuery)
        : [];

      if (spec.source) {
        try {
          rows = await executeSource(spec.source, {
            cwd: agent.cwd,
            settings,
            signal,
          });
        } catch (error) {
          return {
            isError: true,
            text: `Failed to execute ${spec.source.kind} source: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      }

      // Strip inline data copy from stored spec when sourced dynamically so metadata stays lean
      const storedSpec = spec.source ? { ...spec, data: undefined } : spec;
      const entry = await store.create({
        spec: storedSpec,
        rows,
        cwd: agent.cwd,
        agentId: agent.id,
      });

      const token = `<<paseo-view:${entry.viewId}>>`;
      const columns = inferColumns(rows, spec.columns);
      const preview = rows.slice(0, 5);
      const colList = columns.map((c) => `${c.key} (${c.type ?? "text"})`).join(", ");

      const summaryLines = [
        `Created ${spec.type} view${spec.title ? ` "${spec.title}"` : ""} (${rows.length} rows).`,
        `Put this exact token on its own line in your response where the view should appear:`,
        token,
      ];
      if (colList) summaryLines.push(`Columns: ${colList}`);
      if (preview.length > 0) {
        summaryLines.push(`Preview (first ${preview.length} rows):`);
        summaryLines.push(JSON.stringify(preview, null, 2));
      }

      return {
        text: summaryLines.join("\n"),
        structuredContent: {
          token,
          viewId: entry.viewId,
          type: spec.type,
          title: spec.title ?? null,
          rowCount: rows.length,
          columns,
          preview,
        },
      };
    },
  });
}
