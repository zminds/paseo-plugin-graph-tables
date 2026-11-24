/**
 * View & Graph Zod schemas adapted from Beluga's (https://github.com/beluga-labs/beluga)
 * visualization specification for Paseo plugin RPCs and timeline renderers.
 */
import { z } from "zod";

export const columnTypeSchema = z.enum([
  "text",
  "number",
  "percent",
  "currency",
  "bytes",
  "date",
  "datetime",
  "bool",
  "url",
  "path",
  "color",
  "image",
  "code",
  "badge",
]);

export type ColumnType = z.infer<typeof columnTypeSchema>;

export const columnSpecSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  type: columnTypeSchema.optional(),
  width: z.number().positive().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});

export type ColumnSpec = z.infer<typeof columnSpecSchema>;

export const whereOpSchema = z.enum([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
]);

export type WhereOp = z.infer<typeof whereOpSchema>;

export const whereClauseSchema = z.object({
  key: z.string().min(1),
  op: whereOpSchema.optional().default("eq"),
  value: z.unknown(),
});

export type WhereClause = z.infer<typeof whereClauseSchema>;

export const sourceSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string().min(1),
    format: z.enum(["auto", "json", "jsonl", "csv", "tsv"]).optional(),
    rows: z.string().optional(),
  }),
  z.object({
    kind: z.literal("folder"),
    path: z.string().min(1),
    glob: z.string().optional(),
  }),
  z.object({
    kind: z.literal("sqlite"),
    path: z.string().min(1),
    query: z.string().min(1),
  }),
  z.object({
    kind: z.literal("postgres"),
    query: z.string().min(1),
    env: z.string().optional(),
  }),
  z.object({
    kind: z.literal("http"),
    url: z.string().min(1),
    method: z.enum(["GET", "POST"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    rows: z.string().optional(),
    format: z.enum(["auto", "json", "csv"]).optional(),
  }),
  z.object({
    kind: z.literal("command"),
    command: z.string().min(1),
    format: z.enum(["auto", "json", "jsonl", "csv", "tsv"]).optional(),
  }),
  z.object({
    kind: z.literal("script"),
    language: z.enum(["python", "node", "sh", "bash", "ruby", "perl"]),
    code: z.string().min(1),
    args: z.array(z.string()).optional(),
    format: z.enum(["auto", "json", "jsonl", "csv", "tsv"]).optional(),
  }),
]);

export type SourceSpec = z.infer<typeof sourceSpecSchema>;

export const controlOptionSchema = z.object({
  label: z.string(),
  value: z.string().optional(),
  sort: z.string().optional(),
  top: z.number().int().positive().optional(),
  where: z.array(whereClauseSchema).optional(),
  search: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  source: sourceSpecSchema.optional(),
});

export type ControlOption = z.infer<typeof controlOptionSchema>;

export const controlSpecSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("buttons"),
    label: z.string().optional(),
    options: z.array(controlOptionSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("select"),
    label: z.string().optional(),
    column: z.string().optional(),
    options: z.array(z.union([z.string(), controlOptionSchema])).optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("number"),
    label: z.string().optional(),
    column: z.string().optional(),
    op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]).optional().default("gte"),
    placeholder: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("toggle"),
    label: z.string(),
    where: z.array(whereClauseSchema).optional(),
    sort: z.string().optional(),
    top: z.number().int().positive().optional(),
    search: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    source: sourceSpecSchema.optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("search"),
    label: z.string().optional(),
    placeholder: z.string().optional(),
  }),
]);

export type ControlSpec = z.infer<typeof controlSpecSchema>;

export const graphNodeTypeSchema = z.enum([
  "client",
  "service",
  "database",
  "queue",
  "storage",
  "external",
  "actor",
  "person",
  "function",
  "file",
  "decision",
  "note",
  "task",
  "milestone",
  "image",
  "metric",
  "group",
]);

export type GraphNodeType = z.infer<typeof graphNodeTypeSchema>;

export const graphStatusSchema = z.enum([
  "todo",
  "active",
  "review",
  "done",
  "blocked",
  "failed",
  "idle",
]);

export type GraphStatus = z.infer<typeof graphStatusSchema>;

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  type: graphNodeTypeSchema.optional().default("service"),
  label: z.string().max(80),
  sublabel: z.string().max(120).optional(),
  group: z.string().optional(),
  status: graphStatusSchema.optional(),
  emphasis: z.boolean().optional(),
  details: z.string().max(4000).optional(),
  links: z
    .array(
      z.object({
        label: z.string(),
        href: z.string(),
      }),
    )
    .optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().optional(),
        key: z.string().optional(),
      }),
    )
    .optional(),
  items: z
    .array(
      z.object({
        label: z.string(),
        status: graphStatusSchema.optional(),
      }),
    )
    .optional(),
  value: z.union([z.string(), z.number()]).optional(),
  image: z.string().optional(),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeKindSchema = z.enum([
  "flow",
  "call",
  "data",
  "async",
  "depends",
  "blocks",
]);

export const graphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  kind: graphEdgeKindSchema.optional().default("flow"),
});

export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphStepSchema = z.object({
  title: z.string(),
  text: z.string(),
  focus: z.array(z.string()).optional(),
});

export type GraphStep = z.infer<typeof graphStepSchema>;

export const graphSpecSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  direction: z.enum(["right", "down", "left", "up"]).optional().default("right"),
  nodes: z.array(graphNodeSchema).max(150),
  edges: z.array(graphEdgeSchema).max(300).optional().default([]),
  steps: z.array(graphStepSchema).max(30).optional().default([]),
});

export type GraphSpec = z.infer<typeof graphSpecSchema>;

export const statItemSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  delta: z.union([z.string(), z.number()]).optional(),
  invert: z.boolean().optional(),
  trend: z.array(z.number()).optional(),
});

export type StatItem = z.infer<typeof statItemSchema>;

export const initialQuerySchema = z.object({
  sort: z.string().optional(),
  top: z.number().int().positive().optional(),
  where: z.array(whereClauseSchema).optional(),
  search: z.string().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
});

export const viewTypeSchema = z.enum([
  "table",
  "chart",
  "stats",
  "gantt",
  "heatmap",
  "calendar",
  "colors",
  "code",
  "graph",
]);

export type ViewType = z.infer<typeof viewTypeSchema>;

export const chartKindSchema = z.enum([
  "line",
  "area",
  "bar",
  "pie",
  "donut",
  "scatter",
]);

export type ChartKind = z.infer<typeof chartKindSchema>;

export const colorItemSchema = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    label: z.string().optional(),
    value: z.string().optional(),
    color: z.string().optional(),
    hex: z.string().optional(),
  }),
]);

export const viewSpecSchema = z
  .object({
    type: viewTypeSchema,
    title: z.string().optional(),
    summary: z.string().optional(),
    data: z.array(z.record(z.string(), z.unknown())).optional(),
    source: sourceSpecSchema.optional(),
    columns: z.array(columnSpecSchema).optional(),
    initial: initialQuerySchema.optional(),
    controls: z.array(controlSpecSchema).optional(),
    refresh: z.number().positive().optional(),
    // Chart fields
    chart: chartKindSchema.optional(),
    x: z.string().optional(),
    y: z.union([z.string(), z.array(z.string())]).optional(),
    group: z.string().optional(),
    curve: z.enum(["smooth", "linear", "step"]).optional(),
    stacked: z.boolean().optional(),
    colors: z.array(colorItemSchema).optional(),
    // Stats fields
    items: z.array(statItemSchema).optional(),
    // Heatmap / Calendar fields
    value: z.string().optional(),
    // Code fields
    code: z.string().optional(),
    language: z.string().optional(),
    highlight: z.string().optional(),
    note: z.string().optional(),
    // Graph fields
    direction: z.enum(["right", "down", "left", "up"]).optional(),
    nodes: z.array(graphNodeSchema).max(150).optional(),
    edges: z.array(graphEdgeSchema).max(300).optional(),
    steps: z.array(graphStepSchema).max(30).optional(),
  })
  .passthrough();

export type ViewSpec = z.infer<typeof viewSpecSchema>;

export function normalizeViewInput(
  raw: unknown,
  defaultType?: ViewType,
): { ok: true; spec: ViewSpec } | { ok: false; error: string } {
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid view JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, error: "View payload must be a JSON object." };
  }

  const obj = { ...(candidate as Record<string, unknown>) };
  if (obj.type === undefined) {
    if (defaultType) {
      obj.type = defaultType;
    } else if (Array.isArray(obj.nodes)) {
      obj.type = "graph";
    } else if (Array.isArray(obj.items)) {
      obj.type = "stats";
    } else if (typeof obj.chart === "string") {
      obj.type = "chart";
    } else if (typeof obj.code === "string") {
      obj.type = "code";
    } else if (Array.isArray(obj.data) || obj.source !== undefined) {
      obj.type = "table";
    }
  }

  const parsed = viewSpecSchema.safeParse(obj);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const loc = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `Invalid view spec (${loc}${issue?.message ?? "validation failed"})` };
  }

  return { ok: true, spec: parsed.data };
}
