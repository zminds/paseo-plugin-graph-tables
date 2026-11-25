Graph & Tables adds interactive tables, charts, KPI stat tiles, timelines, heatmaps, activity calendars, color palettes, code views, and auto-layout architecture diagrams directly inside Paseo agent timelines.

Adapted and re-implemented from [Beluga](https://github.com/beluga-labs/beluga)'s graph and view architecture to run natively inside Paseo's plugin subprocess and cross-platform UI runtime, using two mechanisms:

1. Inline fenced blocks: agents can output `paseo-view`, `beluga-view`, `paseo-graph`, or `beluga-graph` JSON code blocks in replies, and multi-row Markdown tables can optionally upgrade to sortable, searchable interactive tables.
2. Tool-backed views: for large datasets or live queries, the `show_view` agent tool executes a data source on the daemon, caches rows in the plugin subprocess, and returns a short `<<paseo-view:...>>` token so the client can sort, filter, search, paginate, toggle between table and chart views, and refresh data without inflating timeline payloads.

## Supported views and controls

- Views: `table`, `chart` (`bar`, `line`, `area`, `pie`, `donut`, `scatter`), `stats`, `graph` (layered DAG layout with groups, edge kinds, step walkthroughs, and clickable Markdown details), `gantt`, `heatmap`, `calendar`, `colors`, and `code`.
- Interactive controls: `buttons`, `select`, `number`, `toggle`, and `search`, including safe `{{controlId}}` parameter substitution into source queries, URLs, commands, and scripts.
- Workspace panel: the Views panel lists views held by the running plugin so you can inspect and refresh them side-by-side.

## Setup and source permissions

Open **Settings -> Graph & Tables** to configure prompt injection, the `show_view` tool, automatic Markdown table upgrades, and which dynamic data sources may run.

File, folder, and HTTP sources are off until you enable them. SQLite is on by default and runs through Node's read-only SQL interface. That interface accepts one SQL statement and does not accept sqlite3 client commands such as `.shell` or `.read`. PostgreSQL (`psql`, with the connection string resolved from `.env` or the environment), shell commands, and inline scripts (`python`, `node`, `sh`, `bash`, `ruby`, `perl`) stay off until you enable them.

`show_view` returns a short row preview to the agent and its model provider with the rest of the turn. The plugin keeps up to 200 view definitions, including source settings such as HTTP headers, and their loaded rows in memory on the daemon host. The least recently used views are removed when the cache fills. Reloading or stopping the plugin clears the cache, including when the daemon restarts. Run `show_view` again to recreate an expired view. Saving an export writes a separate file to your configured export folder.

Earlier versions may have left a `paseo-graph-tables-views` directory in the daemon's system temporary directory. After stopping the older version, the daemon owner can remove that directory to clear its old snapshots.

## Compatibility and platform notes

- Requires Paseo `0.14.0` or later for `agent.open.before` prompt/tool hooks and `Markdown` UI rendering.
- Registered under plugin ID `agent-graph-tables` so its selective view and diagram transformers run before general timeline plugins such as `better-paseo`, while leaving ordinary messages and unrelated tool calls unchanged.
- ACP providers do not receive `appendSystemPrompt` hooks; load the included `SKILL.md` in those agents when needed.
- On web and desktop, charts and diagrams render as interactive SVG; on iOS and Android, views render with React Native primitives.
