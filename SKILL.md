---
name: paseo-graph-tables
description: Render interactive tables, charts, KPI stat tiles, gantt timelines, heatmaps, calendars, and auto-layout architecture diagrams in Paseo using `show_view` or `paseo-view` / `paseo-graph` fenced blocks. Inspired by Beluga (https://github.com/beluga-labs/beluga) and re-implemented via Paseo's plugin SDK.
---

# Data Views & Diagrams (Paseo Graph & Tables)

> Attribution: Re-implements [Beluga](https://github.com/beluga-labs/beluga)'s interactive `view` and `graph` visualization UX inside Paseo's plugin subprocess + cross-platform UI runtime.

Answer the user's question in words first. Add an interactive view only when the shape of your answer is naturally one of:
- Rows and records (`table`)
- Comparisons, trends, or distributions (`chart`)
- Key metrics with deltas and sparklines (`stats`)
- Architecture, pipelines, data models, or state flows (`graph`)
- Schedules over time (`gantt`), X-by-Y grids (`heatmap`), or daily activity (`calendar`)

Keep to 1 or 2 views per reply unless the user asks for more, and never add a view just to decorate.

## Option A: Tool-backed views (`show_view`)

Use `show_view` whenever data is large, needs server-side pagination/filtering, or comes from a live `source`.

Supported `source` shapes (all run on the daemon host; secrets in `.env` are never returned):
- `{"kind": "file", "path": "data/sales.csv", "format": "auto"|"json"|"jsonl"|"csv"|"tsv", "rows": "data.items"}`
- `{"kind": "folder", "path": "src", "glob": "**/*.ts"}`
- `{"kind": "sqlite", "path": "app.db", "query": "SELECT * FROM jobs LIMIT 500"}`
- `{"kind": "postgres", "query": "SELECT ...", "env": "DATABASE_URL"}` (requires opt-in in Settings)
- `{"kind": "http", "url": "https://api.example.com/items?region={{region}}", "rows": "data.items"}`
- `{"kind": "command", "command": "./report.sh --region {{region}}", "format": "json"}` (requires opt-in)
- `{"kind": "script", "language": "python"|"node"|"sh"|"bash"|"ruby"|"perl", "code": "...", "args": [...], "format": "json"}` (requires opt-in)

`show_view` runs the source once, caches rows on the daemon, and returns a token like `<<paseo-view:v_abc123>>` plus a preview. Put that **exact token on its own line** in your response where the view should appear. Never invent a token without calling `show_view`.

## Option B: Inline fenced blocks (`paseo-view` / `paseo-graph`)

For small static payloads, emit a fenced JSON block directly (`beluga-view` and `beluga-graph` aliases are also supported).

### Table & controls example
````markdown
```paseo-view
{
  "type": "table",
  "title": "Customers by revenue",
  "initial": { "sort": "-revenue" },
  "columns": [
    { "key": "name", "label": "Customer" },
    { "key": "region", "type": "badge" },
    { "key": "revenue", "type": "currency" }
  ],
  "controls": [
    {
      "id": "rank",
      "type": "buttons",
      "options": [
        { "label": "Top 5", "sort": "-revenue", "top": 5 },
        { "label": "Bottom 5", "sort": "revenue", "top": 5 },
        { "label": "All" }
      ]
    },
    { "id": "region", "type": "select", "column": "region" },
    { "id": "min", "type": "number", "label": "Min $", "column": "revenue", "op": "gte" },
    { "id": "q", "type": "search" }
  ],
  "data": [
    { "name": "Acme", "region": "NA", "revenue": 42000 },
    { "name": "Globex", "region": "EU", "revenue": 31500 }
  ]
}
```
````

### Chart example
Supported `chart` types: `line`, `area`, `bar`, `pie`, `donut`, `scatter`. Use one measure per chart (never dual Y-axes). Use `group` for long rows, `curve: "smooth"|"linear"|"step"`, `stacked: true`, `colors: [...]`.

### Export & Demo Gallery

Every interactive view includes built-in export controls in the client UI (saving to `~/Downloads/paseo-exports` by default, configurable in **Settings → Graph & Tables → Exports**):
- **Tables**: Copy or Save as `Markdown`, `CSV`, `TSV`, `JSON`, or `SQL Inserts` (with formatted vs raw value toggle) and copy view definition JSON.
- **Charts (`bar`, `line`, `area`, `pie`, `donut`, `scatter`)**: Interactive chart-type switcher, hover readouts, `Copy SVG`, `Save SVG`, and `Save PNG`.
- **Graphs (`paseo-graph` / `beluga-graph`)**: Draggable nodes and groups, pan/zoom, animated flow toggle, step playback, `Copy JSON`, `Copy SVG`, `Save SVG`, and `Save PNG`.
- **Demo Gallery (`/views`)**: The **Views** workspace panel includes a `Demo Gallery` tab to preview and test all view types and export workflows without an active agent session.

### Stats, Gantt, Heatmap, Calendar
- `stats`: `{"type": "stats", "items": [{"label": "p95", "value": 182, "unit": "ms", "delta": -12, "invert": true, "trend": [210, 195, 182]}]}`
- `gantt`: `{"type": "gantt", "data": [{"task": "Design", "start": "2026-11-02", "end": "2026-11-06", "group": "Web", "progress": 0.6, "status": "active", "milestone": false}]}`
- `heatmap`: `{"type": "heatmap", "x": "hour", "y": "day", "value": "errors", "data": [{"hour": "09", "day": "Mon", "errors": 4}]}`
- `calendar`: `{"type": "calendar", "data": [{"date": "2026-11-01", "value": 3}]}`

### Interactive Graph (`paseo-graph` / `beluga-graph`)
Strict JSON (no comments, no trailing commas, no manual coordinates). Use 4 to 25 nodes, concise 2-4 word labels, `"type": "group"` container boxes (`"group": "<id>"` on child nodes) whenever components belong to distinct layers, processes, or hosts, and `steps` when walking through a flow:

````markdown
```paseo-graph
{
  "title": "How login works",
  "summary": "Session flow across web, API, and Postgres",
  "direction": "down",
  "nodes": [
    { "id": "web", "type": "client", "label": "Web app", "sublabel": "React" },
    { "id": "backend", "type": "group", "label": "Backend" },
    {
      "id": "api",
      "type": "service",
      "label": "Auth API",
      "sublabel": "Express",
      "group": "backend",
      "status": "done",
      "emphasis": true,
      "details": "Validates credentials and mints session cookies."
    },
    {
      "id": "db",
      "type": "database",
      "label": "Postgres",
      "group": "backend",
      "fields": [{ "name": "id", "type": "uuid", "key": "pk" }]
    }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "POST /login", "kind": "call" },
    { "from": "api", "to": "web", "label": "Set-Cookie", "kind": "data" },
    { "from": "api", "to": "db", "label": "SELECT user", "kind": "data" }
  ],
  "steps": [
    { "title": "1. Sign in", "text": "Web posts credentials to Auth API.", "focus": ["web", "api"] },
    { "title": "2. Verify", "text": "Auth API looks up user and issues cookie.", "focus": ["api", "db"] }
  ]
}
```
````
