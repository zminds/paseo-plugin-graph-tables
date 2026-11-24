import { describe, expect, it } from "vitest";
import { DEMO_VIEW_ITEMS } from "../client/demo-views";
import { applyGraphOffsets, layoutGraph } from "../shared/graph-layout";
import { computeFittedTransform, zoomAroundPoint } from "../shared/graph-viewport";

describe("layoutGraph", () => {
  it("lays out left-to-right layers without node overlap and generates SmoothStep svgPaths", () => {
    const res = layoutGraph({
      title: "Architecture",
      direction: "right",
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

  it("separates bidirectional and parallel edges cleanly without overlapping labels", () => {
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

  it("fits the grouped demo at a larger scale in a narrow portrait viewport", () => {
    const demo = DEMO_VIEW_ITEMS.find(({ id }) => id === "demo-graph")?.spec;
    if (demo?.type !== "graph") throw new Error("Missing grouped graph demo");

    const layout = layoutGraph(demo);
    const { scale } = computeFittedTransform(layout, 356, 300, null);

    expect.soft(layout.width).toBeLessThan(1000);
    expect(scale).toBeGreaterThan(0.32);
  });

  it.each(["right", "down", "left", "up"] as const)(
    "keeps nested groups and their cross-group routes intact when flowing %s",
    (direction) => {
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
  it("fits a long graph, including routed edges, within a phone-width viewport", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      label: `Stage ${index}`,
    }));
    const layout = layoutGraph({
      direction: "right",
      nodes,
      edges: [...nodes.slice(1).map((node, i) => ({ from: nodes[i]!.id, to: node.id })), {
        from: "11",
        to: "0",
        label: "Retry",
      }],
    });
    const width = 320;
    const height = 300;
    const { x, y, scale } = computeFittedTransform(layout, width, height, null);

    expect(scale).toBeLessThan(0.35);
    for (const node of layout.nodes) {
      expect(x + node.x * scale).toBeGreaterThan(0);
      expect(x + (node.x + node.width) * scale).toBeLessThan(width);
    }
    for (const edge of layout.edges) {
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
