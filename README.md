# paseo-plugin-graph-tables

A [Paseo](https://paseo.sh) plugin that brings Beluga-style interactive tables, charts, KPI stat tiles, timelines, heatmaps, calendars, and auto-layout architecture diagrams into Paseo agent timelines and workspace panels.

## Install

```bash
paseo plugin install github:zminds/paseo-plugin-graph-tables
```

Or install a local checkout:

```bash
git clone https://github.com/zminds/paseo-plugin-graph-tables.git
cd paseo-plugin-graph-tables
npm install
npm run typecheck
paseo plugin install "$(pwd)"
```

## Features

- **Agent prompt & `show_view` tool injection** via `agent.open.before` (`index.server.ts`).
- **Daemon-side view store & query engine** (`server/`) supporting:
  - 7 data sources: `file` (JSON/JSONL/CSV/TSV), `folder`, `sqlite` (read-only), `postgres` (opt-in via `.env`), `http`, `command` (opt-in), and `script` (opt-in).
  - Interactive `controls`: `buttons`, `select`, `number`, `toggle`, `search`, with safe `{{id}}` parameter interpolation.
  - `views.query` and `views.list` RPCs for sorting, filtering, searching, pagination, and live refresh.
- **Cross-platform timeline transformer & renderers** (`client/`):
  - Splits `assistant_message` replies containing ```` ```paseo-view ````, ```` ```beluga-view ````, ```` ```paseo-graph ````, ```` ```beluga-graph ````, `<<paseo-view:...>>` tokens, or multi-row GFM Markdown tables into interactive cards while preserving host `<Markdown>` and `<StreamedText>` for surrounding prose.
  - Supports `table` (sortable, searchable, paginated, typed cells, CSV copy, 1-click Table ↔ Chart switch), `chart` (`bar`, `line`, `area`, `pie`, `donut`, `scatter`), `stats`, `graph` (layered DAG layout, groups, clickable Markdown details, step-by-step walkthrough), `gantt`, `heatmap`, `calendar`, `colors`, `code`, and fullscreen `<Modal>` expansion.
  - Strictly isolates web SVG rendering in `client/web.ts` (`Platform.OS === "web"`) with React Native fallbacks on iOS and Android.
- **Workspace Panel & Settings**:
  - **Views** workspace/explorer panel (`/views` or Command Center) to browse and inspect all views from the session.
  - **Settings → Graph & Tables** to toggle prompt/tool injection, Markdown table auto-upgrade, query limits, and opt-in data sources.
- **Portable `SKILL.md`** included in the repository for ACP agents that do not receive `appendSystemPrompt`.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin reload graph-tables
```
