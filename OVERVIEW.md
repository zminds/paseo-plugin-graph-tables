Graph & Tables adds interactive tables, charts, KPI stat tiles, timelines, heatmaps, activity calendars, color palettes, code views, and auto-layout architecture diagrams directly inside Paseo agent timelines.

It replicates the Beluga view and graph visualization workflow for Paseo agents using two mechanisms:

1. Inline fenced blocks: agents can output `paseo-view`, `beluga-view`, `paseo-graph`, or `beluga-graph` JSON code blocks in replies, and multi-row Markdown tables can optionally upgrade to sortable, searchable interactive tables.
2. Tool-backed views: for large datasets or live queries, the `show_view` agent tool executes a data source on the daemon, caches rows in the plugin subprocess, and returns a short `<<paseo-view:...>>` token so the client can sort, filter, search, paginate, toggle between table and chart views, and refresh data without inflating timeline payloads.

## Supported views and controls

- Views: `table`, `chart` (`bar`, `line`, `area`, `pie`, `donut`, `scatter`), `stats`, `graph` (layered DAG layout with groups, edge kinds, step walkthroughs, and clickable Markdown details), `gantt`, `heatmap`, `calendar`, `colors`, and `code`.
- Interactive controls: `buttons`, `select`, `number`, `toggle`, and `search`, including safe `{{controlId}}` parameter substitution into source queries, URLs, commands, and scripts.
- Workspace panel: the Views panel lists views created during the daemon session so you can inspect and refresh them side-by-side.

## Setup and source permissions

Open **Settings -> Graph & Tables** to configure prompt injection, the `show_view` tool, automatic Markdown table upgrades, and allowed dynamic data sources. File/folder, read-only SQLite, and HTTP sources are enabled by default. PostgreSQL (`psql` with connection strings resolved from `.env` or environment variables), shell commands, and inline scripts (`python`, `node`, `sh`, `bash`, `ruby`, `perl`) are disabled by default and require explicit opt-in.

## Compatibility and platform notes

- Requires Paseo `0.14.0` or later for `agent.open.before` prompt/tool hooks and `Markdown` UI rendering.
- Registered under plugin ID `agent-graph-tables` so its selective view and diagram transformers run before general timeline plugins such as `better-paseo`, while leaving ordinary messages and unrelated tool calls unchanged.
- ACP providers do not receive `appendSystemPrompt` hooks; load the included `SKILL.md` in those agents when needed.
- On web and desktop, charts and diagrams render as interactive SVG; on iOS and Android, views render with React Native primitives.
