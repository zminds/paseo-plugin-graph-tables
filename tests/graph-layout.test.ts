import { describe, expect, it } from "vitest";
import { applyGraphOffsets, layoutGraph } from "../shared/graph-layout";

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
