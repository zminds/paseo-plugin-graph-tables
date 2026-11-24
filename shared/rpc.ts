import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { columnSpecSchema, whereClauseSchema } from "./view-schema";

export const queryViewRpc = defineRpc({
  name: "views.query",
  input: z.object({
    viewId: z.string().min(1),
    sort: z.string().optional(),
    where: z.array(whereClauseSchema).optional(),
    search: z.string().optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
    top: z.number().int().positive().optional(),
    controlValues: z.record(z.string(), z.unknown()).optional(),
    refresh: z.boolean().optional(),
  }),
  output: z.object({
    viewId: z.string(),
    spec: z.record(z.string(), z.unknown()),
    rows: z.array(z.record(z.string(), z.unknown())),
    totalRows: z.number(),
    filteredRows: z.number(),
    page: z.number(),
    pageSize: z.number(),
    columns: z.array(columnSpecSchema),
    facets: z.record(z.string(), z.array(z.string())),
    fetchedAt: z.string(),
    sourceKind: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const listViewsRpc = defineRpc({
  name: "views.list",
  input: z.object({
    agentId: z.string().optional(),
  }),
  output: z.object({
    views: z.array(
      z.object({
        viewId: z.string(),
        type: z.string(),
        title: z.string(),
        rowCount: z.number(),
        createdAt: z.string(),
        agentId: z.string().nullable(),
        sourceKind: z.string().nullable(),
      }),
    ),
  }),
});

export const exportViewRpc = defineRpc({
  name: "views.export",
  input: z.object({
    format: z.enum(["markdown", "csv", "tsv", "json", "sql", "svg", "png"]),
    title: z.string().optional(),
    content: z.string().optional(),
    svg: z.string().optional(),
    pngBase64: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    viewId: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    filePath: z.string().nullable(),
    bytes: z.number(),
    mimeType: z.string(),
    error: z.string().nullable(),
  }),
});

export const syncSkillsRpc = defineRpc({
  name: "skills.sync",
  input: z.object({
    action: z.enum(["status", "install", "remove"]),
  }),
  output: z.object({
    targets: z.array(
      z.object({
        root: z.string(),
        skillPath: z.string(),
        status: z.enum(["installed", "linked", "missing", "user-modified", "error"]),
        error: z.string().nullable(),
      }),
    ),
  }),
});
