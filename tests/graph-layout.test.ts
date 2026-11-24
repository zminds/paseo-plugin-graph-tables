import { describe, expect, it } from "vitest";
import { DEMO_VIEW_ITEMS } from "../client/demo-views";
import { applyGraphOffsets, layoutGraph } from "../shared/graph-layout";
import { computeFittedTransform, zoomAroundPoint } from "../shared/graph-viewport";
import { glyphSignature } from "../shared/node-glyphs";
import { exportGraphToSvg, type SvgThemePalette } from "../shared/svg-export";
import { graphEdgeKindSchema, graphNodeTypeSchema } from "../shared/view-schema";

describe("layoutGraph", () => {
  it("defaults to left-to-right layers and generates routed edges", () => {
    const res = layoutGraph({
      title: "Architecture",
      nodes: [
        { id: "web", type: "client", label: "Web App", sublabel: "React" },
        { id: "api", type: "service", label: "API", sublabel: "Express" },
        { id: "db", type: "database", label: "Postgres" },
      ],
      edges: [
        { from: "web", to: "api", label: "POST /login", kind: "call" },
        { from: "api", to: "db", label: "Query", kind: "data" },
      ],
    });

    expect(res.direction).toBe("right");
    expect(res.nodes).toHaveLength(3);
    const web = res.nodes.find((n) => n.node.id === "web")!;
    const api = res.nodes.find((n) => n.node.id === "api")!;
    const db = res.nodes.find((n) => n.node.id === "db")!;

    expect(web.x + web.width).toBeLessThan(api.x);
    expect(api.x + api.width).toBeLessThan(db.x);
    expect(res.edges[0]?.svgPath.startsWith("M ")).toBe(true);
    expect(res.edges[0]?.labelX).toBeGreaterThan(0);
    expect(res.edges[0]?.labelY).toBeGreaterThan(0);
  });

  it("separates the arms of a branching graph and keeps disconnected nodes", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "start", label: "Request" },
        { id: "auth", label: "Authorize" },
        { id: "data", label: "Load data" },
        { id: "end", label: "Respond" },
        { id: "report", label: "Report" },
        { id: "archive", label: "Archive" },
        { id: "idle", label: "Idle" },
      ],
      edges: [
        { from: "start", to: "auth" },
        { from: "start", to: "data" },
        { from: "auth", to: "end" },
        { from: "data", to: "end" },
        { from: "report", to: "archive" },
      ],
    });
    const boxes = new Map(layout.nodes.map((box) => [box.node.id, box]));

    expect(boxes.size).toBe(7);
    expect(boxes.get("idle")?.node.label).toBe("Idle");
    expect(layout.edges).toHaveLength(5);
    for (const { edge, x1, x2 } of layout.edges) {
      const source = boxes.get(edge.from)!;
      const target = boxes.get(edge.to)!;
      expect(x1).toBe(source.x + source.width);
      expect(x2).toBe(target.x);
      expect(x1).toBeLessThan(x2);
    }
    expect(boxes.get("auth")!.x).toBe(boxes.get("data")!.x);
    for (const [index, a] of layout.nodes.entries()) {
      for (const b of layout.nodes.slice(index + 1)) {
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("handles cycles with back-edge routing outside intervening nodes", () => {
    const res = layoutGraph({
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "Middle" },
        { id: "c", label: "Retry" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a", label: "loop", kind: "async" },
      ],
    });

    expect(res.edges.some((e) => e.isBackEdge)).toBe(true);
    const back = res.edges.find((e) => e.isBackEdge)!;
    expect(back.svgPath).toContain("Q ");
    const b = res.nodes.find((n) => n.node.id === "b")!;
    // Bypass label/lane must sit outside middle node bounding box vertically
    const insideMiddleY = back.labelY > b.y && back.labelY < b.y + b.height;
    expect(insideMiddleY).toBe(false);
  });

  it("separates bidirectional edges cleanly without overlapping labels", () => {
    const res = layoutGraph({
      direction: "down",
      nodes: [
        { id: "agent", type: "actor", label: "Coding Agent", sublabel: "Claude / Codex" },
        { id: "tool", type: "function", label: "show_view", sublabel: "defineAgentTool" },
      ],
      edges: [
        { from: "agent", to: "tool", label: "show_view(view)", kind: "call" },
        { from: "tool", to: "agent", label: "<<view:id>> + preview", kind: "data" },
      ],
    });

    expect(res.edges).toHaveLength(2);
    const [e1, e2] = res.edges;
    expect(e1!.isBidirectional).toBe(true);
    expect(e2!.isBidirectional).toBe(true);
    expect(e1!.x1).not.toBe(e2!.x2);
    expect(Math.hypot(e1!.labelX - e2!.labelX, e1!.labelY - e2!.labelY)).toBeGreaterThan(15);
  });

  it.each([
    ["right", "y"],
    ["down", "x"],
  ] as const)("keeps parallel edges and a self-loop distinct when flowing %s", (direction, crossAxis) => {
    const layout = layoutGraph({
      direction,
      nodes: [
        { id: "worker", label: "Worker" },
        { id: "queue", label: "Queue" },
      ],
      edges: [
        { from: "worker", to: "queue", label: "Enqueue" },
        { from: "worker", to: "queue", label: "Schedule" },
        { from: "worker", to: "worker", label: "Retry" },
      ],
    });
    const worker = layout.nodes.find(({ node }) => node.id === "worker")!;
    const [first, second, loop] = layout.edges;

    expect(layout.edges).toHaveLength(3);
    expect(first!.svgPath).not.toBe(second!.svgPath);
    expect(first!.routePoints[0]![crossAxis]).not.toBe(second!.routePoints[0]![crossAxis]);
    expect(first!.routePoints.at(-1)![crossAxis]).not.toBe(second!.routePoints.at(-1)![crossAxis]);
    expect(Math.hypot(first!.labelX - second!.labelX, first!.labelY - second!.labelY)).toBeGreaterThan(15);
    expect(loop!.isBackEdge).toBe(true);
    expect(loop!.y1).toBe(worker.y);
    expect(loop!.y2).toBe(worker.y);
    expect(loop!.x1).toBeLessThan(worker.x + worker.width);
    expect(loop!.x2).toBeGreaterThan(worker.x);
    expect(loop!.x1).toBeGreaterThan(loop!.x2);
    expect(loop!.labelY).toBeLessThan(worker.y);
    expect(loop!.svgPath).toContain("Q ");
  });

  it("wraps group containers cleanly around members without overlapping outsiders or sibling groups", () => {
    const res = layoutGraph({
      direction: "down",
      nodes: [
        { id: "agent", type: "actor", label: "Coding Agent" },
        { id: "app", type: "group", label: "App Client" },
        { id: "daemon", type: "group", label: "Daemon Process" },
        { id: "tx", type: "function", label: "Transformer", group: "app" },
        { id: "rx", type: "service", label: "Renderer", group: "app" },
        { id: "sv", type: "function", label: "show_view Tool", group: "daemon" },
        { id: "db", type: "database", label: "View Cache", group: "daemon" },
      ],
      edges: [
        { from: "agent", to: "tx" },
        { from: "tx", to: "rx" },
        { from: "agent", to: "sv" },
        { from: "sv", to: "db" },
        { from: "rx", to: "sv" },
      ],
    });

    expect(res.groups).toHaveLength(2);
    const appGroup = res.groups.find((g) => g.node.id === "app")!;
    const daemonGroup = res.groups.find((g) => g.node.id === "daemon")!;
    expect(appGroup.memberIds.sort()).toEqual(["rx", "tx"]);
    expect(daemonGroup.memberIds.sort()).toEqual(["db", "sv"]);

    // Verify member containment
    for (const id of appGroup.memberIds) {
      const node = res.nodes.find((n) => n.node.id === id)!;
      expect(node.x).toBeGreaterThanOrEqual(appGroup.x);
      expect(node.y).toBeGreaterThanOrEqual(appGroup.y + 30);
      expect(node.x + node.width).toBeLessThanOrEqual(appGroup.x + appGroup.width);
      expect(node.y + node.height).toBeLessThanOrEqual(appGroup.y + appGroup.height);
    }

    // Sibling groups must not overlap
    const groupsOverlap =
      appGroup.x < daemonGroup.x + daemonGroup.width &&
      appGroup.x + appGroup.width > daemonGroup.x &&
      appGroup.y < daemonGroup.y + daemonGroup.height &&
      appGroup.y + appGroup.height > daemonGroup.y;
    expect(groupsOverlap).toBe(false);

    // Outsider node must not overlap any group
    const agent = res.nodes.find((n) => n.node.id === "agent")!;
    for (const grp of res.groups) {
      const overlap =
        agent.x < grp.x + grp.width &&
        agent.x + agent.width > grp.x &&
        agent.y < grp.y + grp.height &&
        agent.y + agent.height > grp.y;
      expect(overlap).toBe(false);
    }
  });

  it("lays the grouped demo out left to right so a desktop viewport uses the width", () => {
    const demo = DEMO_VIEW_ITEMS.find(({ id }) => id === "demo-graph")?.spec;
    if (demo?.type !== "graph") throw new Error("Missing grouped graph demo");

    const layout = layoutGraph(demo);
    const phone = computeFittedTransform(layout, 356, 300, null);
    const desktop = computeFittedTransform(layout, 1100, 480, null);

    expect(demo.direction).toBeUndefined();
    expect(layout.direction).toBe("right");
    expect(layout.width).toBeGreaterThan(layout.height);
    expect(phone.scale).toBeGreaterThan(0.12);
    expect(desktop.scale).toBeGreaterThan(0.4);
  });

  it.each([
    ["default", undefined],
    ["right", "right"],
    ["down", "down"],
    ["left", "left"],
    ["up", "up"],
  ] as const)(
    "lays out nested groups and cross-group routes in the %s direction",
    (_, direction) => {
      const edges = [
        { from: "start", to: "parse" },
        { from: "parse", to: "render" },
        { from: "render", to: "store" },
        { from: "store", to: "start", label: "Retry" },
      ];
      const layout = layoutGraph({
        direction,
        nodes: [
          { id: "start", label: "Start" },
          { id: "app", type: "group", label: "App" },
          { id: "daemon", type: "group", label: "Daemon" },
          { id: "view", type: "group", label: "View", group: "app" },
          { id: "parse", label: "Parse", group: "view" },
          { id: "render", label: "Render", group: "view" },
          { id: "store", label: "Store", group: "daemon" },
        ],
        edges,
      });
      const boxes = new Map([...layout.nodes, ...layout.groups].map((box) => [box.node.id, box]));
      const expectedDirection = direction ?? "right";
      const [axis, extent] =
        expectedDirection === "right" || expectedDirection === "left"
          ? (["x", "width"] as const)
          : (["y", "height"] as const);

      expect(layout.direction).toBe(expectedDirection);
      for (const [source, target] of [
        ["start", "app"],
        ["app", "daemon"],
        ["parse", "render"],
      ] as const) {
        const [before, after] =
          expectedDirection === "left" || expectedDirection === "up" ? [target, source] : [source, target];
        expect(boxes.get(before)![axis] + boxes.get(before)![extent]).toBeLessThan(boxes.get(after)![axis]);
      }

      const appGroup = layout.groups.find(({ node }) => node.id === "app");
      expect(new Set(appGroup?.memberIds)).toEqual(new Set(["parse", "render"]));
      for (const [childId, parentId] of [
        ["view", "app"],
        ["parse", "view"],
        ["render", "view"],
        ["store", "daemon"],
      ] as const) {
        const child = boxes.get(childId)!;
        const parent = boxes.get(parentId)!;
        expect(child.x).toBeGreaterThan(parent.x);
        expect(child.y).toBeGreaterThan(parent.y);
        expect(child.x + child.width).toBeLessThan(parent.x + parent.width);
        expect(child.y + child.height).toBeLessThan(parent.y + parent.height);
      }

      for (const [aId, bId] of [
        ["start", "app"],
        ["start", "daemon"],
        ["app", "daemon"],
        ["parse", "render"],
      ] as const) {
        const a = boxes.get(aId)!;
        const b = boxes.get(bId)!;
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }

      expect(layout.edges.map(({ edge }) => edge)).toMatchObject(edges);
      expect(layout.edges.some(({ edge, isBackEdge }) => edge.label === "Retry" && isBackEdge)).toBe(true);
      for (const { edge, routePoints } of layout.edges) {
        for (const [id, point] of [
          [edge.from, routePoints[0]!],
          [edge.to, routePoints.at(-1)!],
        ] as const) {
          const { x, y, width, height } = boxes.get(id)!;
          expect(point.x).toBeGreaterThanOrEqual(x);
          expect(point.x).toBeLessThanOrEqual(x + width);
          expect(point.y).toBeGreaterThanOrEqual(y);
          expect(point.y).toBeLessThanOrEqual(y + height);
          expect(Math.min(point.x - x, x + width - point.x, point.y - y, y + height - point.y)).toBeCloseTo(0);
        }
      }
    },
  );

  it("keeps empty nested groups in place unless their ancestor is dragged", () => {
    const base = layoutGraph({
      direction: "up",
      nodes: [
        { id: "outer", type: "group", label: "Outer", group: "cycle" },
        { id: "cycle", type: "group", label: "Cycle", group: "outer" },
        { id: "empty", type: "group", label: "Empty", group: "outer" },
        { id: "member", label: "Member", group: "outer" },
        { id: "outside", label: "Outside", group: "unknown" },
      ],
    });
    const group = (layout: typeof base, id: string) =>
      layout.groups.find(({ node }) => node.id === id)!;
    const empty = group(base, "empty");
    const outer = group(base, "outer");
    expect(base.groups).toHaveLength(3);
    expect(empty.y).toBeGreaterThan(outer.y);
    expect(base.groups.some(({ node }) => node.group === undefined)).toBe(true);

    const offset = { dx: 50, dy: 70 };
    const outsideDragged = applyGraphOffsets(base, { outside: offset });
    expect(group(outsideDragged, "empty")).toEqual(empty);

    const groupDragged = applyGraphOffsets(base, { member: offset, empty: offset });
    expect(group(groupDragged, "empty")).toMatchObject({ x: empty.x + 50, y: empty.y + 70 });
    expect(group(groupDragged, "outer")).toMatchObject({
      x: outer.x + 50,
      y: outer.y + 70,
      width: outer.width,
      height: outer.height,
    });
  });

  it("applyGraphOffsets shifts nodes, expands parent groups, and re-routes edges dynamically", () => {
    const base = layoutGraph({
      direction: "right",
      nodes: [
        { id: "g1", type: "group", label: "Core" },
        { id: "a", label: "Alpha", group: "g1" },
        { id: "b", label: "Beta", group: "g1" },
      ],
      edges: [{ from: "a", to: "b", label: "call" }],
    });

    const beforeEdge = base.edges[0]!;
    const beforeGroup = base.groups[0]!;

    const updated = applyGraphOffsets(base, {
      b: { dx: 120, dy: 45 },
    });

    const afterB = updated.nodes.find((n) => n.node.id === "b")!;
    const origB = base.nodes.find((n) => n.node.id === "b")!;
    expect(afterB.x).toBeCloseTo(origB.x + 120, 4);
    expect(afterB.y).toBeCloseTo(origB.y + 45, 4);

    const afterGroup = updated.groups[0]!;
    expect(afterGroup.width).toBeGreaterThan(beforeGroup.width);
    expect(afterGroup.height).toBeGreaterThan(beforeGroup.height);

    const afterEdge = updated.edges[0]!;
    expect(afterEdge.svgPath).not.toBe(beforeEdge.svgPath);
    expect(afterEdge.x2).toBeCloseTo(afterB.x, 4);
  });
});

describe("graph viewport", () => {
  it("fits a 150-node, 300-edge graph and every route within a phone-width viewport", () => {
    const lanes = Array.from({ length: 10 }, (_, lane) =>
      Array.from({ length: 15 }, (_, stage) => ({
        id: `${lane}-${stage}`,
        label: `Stage ${stage}`,
      })),
    );
    const nodes = lanes.flat();
    const edges = lanes.flatMap((lane) => [
      ...lane.slice(1).flatMap(({ id }, index) => [
        { from: lane[index]!.id, to: id, label: "Run" },
        { from: lane[index]!.id, to: id, label: "Track" },
      ]),
      { from: lane[0]!.id, to: lane[2]!.id, label: "Skip" },
      { from: lane.at(-1)!.id, to: lane[0]!.id, label: "Retry" },
    ]);
    const layout = layoutGraph({ nodes, edges });
    const width = 320;
    const height = 300;
    const { x, y, scale } = computeFittedTransform(layout, width, height, null);

    expect(layout.direction).toBe("right");
    expect(layout.nodes).toHaveLength(150);
    expect(layout.edges).toHaveLength(300);
    expect(layout.edges.map(({ edge }) => edge)).toMatchObject(edges);
    expect(layout.edges.filter(({ isBackEdge }) => isBackEdge)).toHaveLength(10);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(0.35);
    for (const node of layout.nodes) {
      expect(x + node.x * scale).toBeGreaterThan(0);
      expect(x + (node.x + node.width) * scale).toBeLessThan(width);
      expect(y + node.y * scale).toBeGreaterThan(0);
      expect(y + (node.y + node.height) * scale).toBeLessThan(height);
    }
    for (const edge of layout.edges) {
      expect(edge.routePoints.length).toBeGreaterThanOrEqual(2);
      for (const point of edge.routePoints) {
        expect(x + point.x * scale).toBeGreaterThan(0);
        expect(x + point.x * scale).toBeLessThan(width);
        expect(y + point.y * scale).toBeGreaterThan(0);
        expect(y + point.y * scale).toBeLessThan(height);
      }
    }
  });

  it("zooms in and out around the same graph point at phone fit scales", () => {
    const current = { x: 40, y: 70, scale: 0.08 };
    const anchor = { x: 115, y: 190 };
    const next = zoomAroundPoint(current, 1.2, anchor.x, anchor.y);

    expect(next.scale).toBeGreaterThan(current.scale);
    expect(next.scale).toBeLessThan(0.35);
    expect((anchor.x - next.x) / next.scale).toBeCloseTo((anchor.x - current.x) / current.scale);
    expect((anchor.y - next.y) / next.scale).toBeCloseTo((anchor.y - current.y) / current.scale);
    expect(zoomAroundPoint(next, 1 / 1.2, anchor.x, anchor.y).scale).toBeCloseTo(current.scale);
  });
});

const EXPORT_COLORS: SvgThemePalette = {
  surface0: "#ffffff",
  surface1: "#f8fafc",
  surface2: "#f1f5f9",
  border: "#cbd5e1",
  foreground: "#0f172a",
  foregroundMuted: "#64748b",
  accent: "#2563eb",
  accentForeground: "#ffffff",
  statusSuccess: "#16a34a",
  statusWarning: "#d97706",
  statusDanger: "#dc2626",
};

describe("every graph node and edge", () => {
  const spec = DEMO_VIEW_ITEMS.find((item) => item.id === "demo-graph-types")?.spec;
  if (!spec || spec.type !== "graph") throw new Error("missing all-types graph demo");

  it("gives every node type its own glyph", () => {
    const seen = new Map<string, string>();
    for (const type of graphNodeTypeSchema.options) {
      const signature = glyphSignature(type);
      expect(signature.length).toBeGreaterThan(0);
      expect(seen.get(signature), `${type} duplicates ${seen.get(signature)}`).toBeUndefined();
      seen.set(signature, type);
    }
  });

  it("covers every node type and edge kind in a left-to-right drawing", () => {
    expect(spec.direction).toBeUndefined();
    const layout = layoutGraph(spec);
    const svg = exportGraphToSvg({ layout, title: spec.title, colors: EXPORT_COLORS }).svg;
    const boxes = new Map(layout.nodes.map((box) => [box.node.id, box]));

    expect(layout.direction).toBe("right");
    expect(layout.width).toBeGreaterThan(layout.height);
    expect(new Set(layout.nodes.map((box) => box.node.type))).toEqual(
      new Set(graphNodeTypeSchema.options.filter((type) => type !== "group")),
    );
    expect(new Set(layout.groups.map((group) => group.node.type))).toEqual(new Set(["group"]));
    expect(new Set(layout.edges.map((edge) => edge.edge.kind))).toEqual(
      new Set(graphEdgeKindSchema.options),
    );
    expect(svg).toContain("&lt;/&gt;");
    expect(svg).toContain("c 0 1.2 2.2 2.2 5 2.2");
    expect(svg).toContain("h 5.5 l 2.5 2.5");
    expect(svg).toContain("PK id: uuid");
    expect(svg).toContain("schema.sql");
    expect(svg).toContain("87%");
    expect(svg).toContain("✓ Tests");
    expect(svg).toContain("<image ");
    expect(svg).toContain("data:image/png;base64,");
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain(EXPORT_COLORS.statusDanger);

    for (const edge of layout.edges) {
      const source = boxes.get(edge.edge.from);
      const target = boxes.get(edge.edge.to);
      expect(source, edge.edge.from).toBeDefined();
      expect(target, edge.edge.to).toBeDefined();
      expect(edge.svgPath.startsWith("M ")).toBe(true);
      expect(edge.routePoints.length).toBeGreaterThanOrEqual(2);
    }
    for (const [index, a] of layout.nodes.entries()) {
      for (const b of layout.nodes.slice(index + 1)) {
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0);
      }
    }
    expect(boxes.get("client")!.x).toBeLessThan(boxes.get("api")!.x);
    expect(boxes.get("api")!.x).toBeLessThan(boxes.get("db")!.x);
  });
});
