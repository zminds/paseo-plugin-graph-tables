Graph & Tables renders interactive tables, charts, KPI stat tiles, Gantt timelines, heatmaps, activity calendars, color palettes, code views, and auto-layout workflow diagrams directly inside Paseo agent timelines and workspace panels.

Adapted and re-implemented from [Beluga](https://github.com/beluga-labs/beluga)'s graph and view architecture for Paseo's plugin subprocess and cross-platform UI runtime, it works through two output modes:

1. Inline fenced blocks and Markdown table upgrades: agents output `paseo-view`, `beluga-view`, `paseo-graph`, or `beluga-graph` JSON code blocks in replies, and multi-row Markdown tables automatically upgrade to sortable, searchable interactive tables with inline row inspection.
2. Tool-backed views: for large datasets or live queries, the `show_view` agent tool executes a data source on the daemon, caches rows in the plugin subprocess memory, and returns a short `<<paseo-view:...>>` token so the client can sort, filter, search, paginate, switch between table and chart views, and refresh data without inflating timeline payloads.

## Automatic rendering via skills (do not disable skills)

Automatic rendering of diagrams, charts, and interactive views depends on the synced `paseo-graph-tables` skill. When enabled, the plugin automatically writes `paseo-graph-tables/SKILL.md` to the host's global agent skill directories:

- `~/.agents/skills/paseo-graph-tables/SKILL.md`
- `~/.claude/skills/paseo-graph-tables/SKILL.md`
- `~/.gemini/config/skills/paseo-graph-tables/SKILL.md`

Interactive agents read this skill (together with prompt injection on providers that support `agent.open.before`) to know when and how to emit `paseo-view` / `paseo-graph` blocks or call `show_view`. ACP providers that do not receive `appendSystemPrompt` rely entirely on this skill for automatic rendering.

To keep automatic rendering working, do not disable skills:

- Keep **Install global agent SKILL.md** enabled in **Settings -> Graph & Tables** (turning it off removes the plugin-managed `SKILL.md` files). You can click **Sync now** in settings to verify each target reports `installed`.
- Do not disable skills or turn off `paseo-graph-tables` inside Codex, Claude Code, Gemini CLI, Pi, or other agent provider settings.
- If skills are disabled, agents will not receive the visualization schema and replies will fall back to plain text instead of automatically rendering interactive charts or workflow diagrams.

## Supported views and controls

- Tables (`table`): sortable, searchable, paginated tables with typed badges and links, inline row accordion preview with per-field copy, CSV/Markdown export, one-click table-to-chart switching, and automatic upgrades for Markdown tables in replies.
- Charts (`chart`): `bar`, `line`, `area` (including stacked bar and stacked area), `pie`, `donut`, and `scatter`, with one-click chart type switching, legend series toggles, hover and tap readouts, and SVG/PNG export.
- Diagrams (`graph`): layered DAG auto-layout with group containers, 18 node types (including `client`, `service`, `worker`, `queue`, `database` schema fields, `decision` branches, `task` checklists, and `metric` values), semantic edge kinds, drag-to-arrange, step walkthroughs, clickable Markdown node details, vertical layout toggle, and SVG/PNG export.
- Additional views: `stats` (KPI tiles with polarity deltas and sparklines), `gantt` (release timelines and milestones), `heatmap`, `calendar`, `colors`, and `code`.
- Interactive controls: `buttons`, `select`, `number`, `toggle`, and `search`, with safe `{{controlId}}` parameter substitution into source queries, URLs, commands, and scripts.
- Workspace panel: the **Views** panel lists live views held by the running plugin and includes a built-in **Demo Gallery** covering every view type, including a multi-group pipeline workflow.

## Setup and source permissions

Open **Settings -> Graph & Tables** to manage skill synchronization, prompt injection, the `show_view` tool, automatic Markdown table upgrades, row limits, export folder, and dynamic data source switches.

File, folder, and HTTP sources stay off until you enable them. SQLite is on by default and runs through Node's read-only SQL interface, accepting one SQL statement and rejecting sqlite3 client commands such as `.shell` or `.read`. PostgreSQL (`psql`, resolving connection strings from `.env` or the environment), shell commands, and inline scripts (`python`, `node`, `sh`, `bash`, `ruby`, `perl`) stay off until you enable them.

`show_view` returns a short row preview to the agent and its model provider with the rest of the turn. The plugin keeps up to 200 view definitions, including source settings such as HTTP headers, and their loaded rows in memory on the daemon host. The least recently used views are removed when the cache fills. Reloading or stopping the plugin clears the cache, including when the daemon restarts. Run `show_view` again to recreate an expired view. Saving an export writes a separate file to your configured export folder.

Earlier versions may have left a `paseo-graph-tables-views` directory in the daemon's system temporary directory. After stopping the older version, the daemon owner can remove that directory to clear its old snapshots.

## Compatibility and platform notes

- Requires Paseo `0.14.0` or later for `agent.open.before` prompt/tool hooks and `Markdown` UI rendering.
- Registered under plugin ID `agent-graph-tables` so its selective view and diagram transformers run before general timeline plugins such as `better-paseo`, while leaving ordinary messages and unrelated tool calls unchanged.
- Existing symbolic links in global skill directories are preserved during sync; note that Codex requires either a regular `SKILL.md` file or a directory symlink rather than a standalone `SKILL.md` file symlink.
- On web and desktop, charts and diagrams render as interactive SVG; on iOS and Android, views render with React Native primitives.
