import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const pluginSettings = defineSettings({
  id: "graph-tables",
  scope: "host",
  version: 1,
  schema: z.object({
    enablePromptInjection: z.boolean().default(true),
    enableShowViewTool: z.boolean().default(true),
    upgradeMarkdownTables: z.boolean().default(true),
    allowFileSource: z.boolean().default(true),
    allowSqliteSource: z.boolean().default(true),
    allowHttpSource: z.boolean().default(true),
    allowPostgresSource: z.boolean().default(false),
    allowCommandSource: z.boolean().default(false),
    allowScriptSource: z.boolean().default(false),
    defaultPageSize: z.number().int().min(5).max(200).default(25),
    maxRowsPerQuery: z.number().int().min(100).max(50000).default(5000),
  }),
});

export type GraphTablesSettings = z.output<typeof pluginSettings.schema>;

export const DEFAULT_SETTINGS: GraphTablesSettings = pluginSettings.schema.parse({});
