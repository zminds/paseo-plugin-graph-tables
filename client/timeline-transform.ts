import type { PluginTimelineData, PluginTimelineItem } from "@getpaseo/plugin";
import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import { parseAssistantMessage } from "../shared/parser";

export const markdownSegmentSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
  isTail: z.boolean(),
});

export const dataViewSegmentSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("inline"),
    spec: z.record(z.string(), z.unknown()),
  }),
  z.object({
    mode: z.literal("token"),
    viewId: z.string(),
  }),
  z.object({
    mode: z.literal("streaming"),
    fenceKind: z.string(),
  }),
  z.object({
    mode: z.literal("invalid"),
    error: z.string(),
    raw: z.string(),
  }),
  z.object({
    mode: z.literal("gfm-table"),
    rawMarkdown: z.string(),
    columns: z.array(z.record(z.string(), z.unknown())),
    rows: z.array(z.record(z.string(), z.unknown())),
  }),
]);

export const toolBadgeSchema = z.object({
  status: z.enum(["running", "completed", "failed", "canceled"]),
  viewId: z.string().optional(),
  title: z.string().optional(),
  viewType: z.string().optional(),
  rowCount: z.number().optional(),
  error: z.string().nullable().optional(),
});

type AssistantTransformer = PluginTimelineTransformerContribution<"assistant_message">["transform"];
type ToolCallTransformer = PluginTimelineTransformerContribution<"tool_call">["transform"];

export const transformAssistantMessage: AssistantTransformer = ({ item, phase }) => {
  const parsed = parseAssistantMessage(item.text, phase);
  if (!parsed.hasSpecialContent) return;

  const lastIndex = parsed.segments.length - 1;
  const output: PluginTimelineItem[] = parsed.segments.map((seg, idx): PluginTimelineItem => {
    const id = `seg-${idx}`;
    if (seg.kind === "markdown") {
      return {
        type: "plugin",
        id,
        kind: "gt-markdown",
        version: 1,
        data: {
          text: seg.text,
          phase,
          isTail: phase === "streaming" && idx === lastIndex,
        },
      };
    }

    if (seg.kind === "token") {
      return {
        type: "plugin",
        id,
        kind: "gt-view",
        version: 1,
        data: { mode: "token", viewId: seg.viewId },
      };
    }

    if (seg.kind === "streaming-view") {
      return {
        type: "plugin",
        id,
        kind: "gt-view",
        version: 1,
        data: { mode: "streaming", fenceKind: seg.fenceKind },
      };
    }

    if (seg.kind === "inline-view") {
      return {
        type: "plugin",
        id,
        kind: "gt-view",
        version: 1,
        data: { mode: "inline", spec: seg.spec as PluginTimelineData },
      };
    }

    if (seg.kind === "gfm-table") {
      return {
        type: "plugin",
        id,
        kind: "gt-view",
        version: 1,
        data: {
          mode: "gfm-table",
          rawMarkdown: seg.rawMarkdown,
          columns: seg.columns as unknown as PluginTimelineData,
          rows: seg.rows as unknown as PluginTimelineData,
        },
      };
    }

    return {
      type: "plugin",
      id,
      kind: "gt-view",
      version: 1,
      data: { mode: "invalid", error: seg.error, raw: seg.raw },
    };
  });

  return { items: output };
};

export const transformShowViewToolCall: ToolCallTransformer = ({ item }) => {
  if (item.name !== "show_view" && !item.name.endsWith("__show_view")) {
    return;
  }

  let viewId: string | undefined;
  let title: string | undefined;
  let viewType: string | undefined;
  let rowCount: number | undefined;

  if (item.detail.type === "unknown") {
    const output = item.detail.output;
    if (output && typeof output === "object" && !Array.isArray(output)) {
      const sc = Reflect.get(output, "structuredContent") ?? output;
      if (sc && typeof sc === "object") {
        const vid = Reflect.get(sc, "viewId");
        const ttl = Reflect.get(sc, "title");
        const vt = Reflect.get(sc, "type");
        const rc = Reflect.get(sc, "rowCount");
        if (typeof vid === "string") viewId = vid;
        if (typeof ttl === "string") title = ttl;
        if (typeof vt === "string") viewType = vt;
        if (typeof rc === "number") rowCount = rc;
      }
    }
    if (!viewId && typeof output === "string") {
      const match = output.match(/<<(?:paseo-)?view:([a-zA-Z0-9_-]+)>>/);
      if (match) viewId = match[1];
    }
  }

  const errorText =
    typeof item.error === "string"
      ? item.error
      : item.error != null
        ? JSON.stringify(item.error)
        : null;

  return {
    items: [
      {
        type: "plugin",
        kind: "gt-tool-badge",
        version: 1,
        data: {
          status: item.status,
          ...(viewId ? { viewId } : {}),
          ...(title ? { title } : {}),
          ...(viewType ? { viewType } : {}),
          ...(rowCount !== undefined ? { rowCount } : {}),
          error: errorText,
        },
      },
    ],
  };
};
