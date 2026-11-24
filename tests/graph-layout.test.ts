import { describe, expect, it } from "vitest";
import { layoutGraph } from "../shared/graph-layout";

describe("layoutGraph", () => {
  it("computes layered positions, groups, and edges without overlaps", () => {
    const result = layoutGraph({
      title: "Login Flow",
      direction: "right",
      nodes: [
        { id: "web", type: "client", label: "Web App" },
        { id: "backend", type: "group", label: "Backend" },
        { id: "api", type: "service", label: "API", group: "backend" },
        {
          id: "db",
          type: "database",
          label: "Postgres",
          group: "backend",
          fields: [{ name: "id", type: "uuid", key: "pk" }],
        },
      ],
      edges: [
        { from: "web", to: "api", label: "POST /login", kind: "call" },
        { from: "api", to: "db", kind: "data" },
      ],
      steps: [],
    });

    expect(result.nodes).toHaveLength(3);
    expect(result.groups).toHaveLength(1);
    expect(result.edges).toHaveLength(2);

    const web = result.nodes.find((n) => n.node.id === "web")!;
    const api = result.nodes.find((n) => n.node.id === "api")!;
    const db = result.nodes.find((n) => n.node.id === "db")!;
    expect(web.x).toBeLessThan(api.x);
    expect(api.x).toBeLessThan(db.x);

    const grp = result.groups[0];
    expect(grp.x).toBeLessThan(api.x);
    expect(grp.x + grp.width).toBeGreaterThan(db.x + db.width);
  });

  it("handles cyclic graphs without hanging and marks back-edges", () => {
    const result = layoutGraph({
      direction: "down",
      nodes: [
        { id: "a", type: "service", label: "A" },
        { id: "b", type: "service", label: "B" },
      ],
      edges: [
        { from: "a", to: "b", kind: "flow" },
        { from: "b", to: "a", kind: "async" },
      ],
      steps: [],
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.edges.some((e) => e.isBackEdge)).toBe(true);
  });
});
