import { describe, expect, it } from "vitest";
import {
  applyQuery,
  formatCellValue,
  inferColumns,
  parseDelimitedRows,
  parseStructuredRows,
  substituteTemplate,
} from "../shared/query-engine";

describe("query-engine", () => {
  it("parses RFC-4180 CSV with quoted commas and escaped quotes", () => {
    const csv = 'name,region,revenue\n"Acme, Inc.","NA",12000\n"Bob ""The Builder""",EU,4500.5\n';
    const rows = parseDelimitedRows(csv);
    expect(rows).toEqual([
      { name: "Acme, Inc.", region: "NA", revenue: 12000 },
      { name: 'Bob "The Builder"', region: "EU", revenue: 4500.5 },
    ]);
  });

  it("extracts nested JSON arrays via dot-path and JSONL", () => {
    const json = JSON.stringify({ data: { items: [{ id: 1, ok: true }, { id: 2, ok: false }] } });
    expect(parseStructuredRows(json, "json", "data.items")).toEqual([
      { id: 1, ok: true },
      { id: 2, ok: false },
    ]);

    const jsonl = '{"id":1}\n{"id":2}\n';
    expect(parseStructuredRows(jsonl, "auto")).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("infers column types and formats cell values", () => {
    const rows = [
      {
        name: "Alpha",
        revenue: 4200,
        size_bytes: 2048,
        win_rate: 0.75,
        status: "active",
        color: "#3b82f6",
        homepage: "https://example.com",
      },
    ];
    const cols = inferColumns(rows);
    const byKey = new Map(cols.map((c) => [c.key, c]));
    expect(byKey.get("revenue")?.type).toBe("currency");
    expect(byKey.get("size_bytes")?.type).toBe("bytes");
    expect(byKey.get("win_rate")?.type).toBe("percent");
    expect(byKey.get("status")?.type).toBe("badge");
    expect(byKey.get("color")?.type).toBe("color");
    expect(byKey.get("homepage")?.type).toBe("url");

    expect(formatCellValue(2048, "bytes")).toBe("2.0 KB");
    expect(formatCellValue(0.75, "percent")).toBe("75%");
    expect(formatCellValue(4200, "currency")).toBe("$4,200");
  });

  it("filters, searches, sorts, tops, and paginates deterministically", () => {
    const rows = [
      { name: "A", region: "US", revenue: 100 },
      { name: "B", region: "EU", revenue: 500 },
      { name: "C", region: "US", revenue: 300 },
      { name: "D", region: "US", revenue: 200 },
    ];
    const result = applyQuery(rows, {
      where: [{ key: "region", op: "eq", value: "US" }],
      sort: "-revenue",
      top: 2,
      page: 1,
      pageSize: 1,
    });
    expect(result.totalRows).toBe(4);
    expect(result.filteredRows).toBe(2);
    expect(result.rows).toEqual([{ name: "C", region: "US", revenue: 300 }]);
    expect(result.facets.region).toEqual(["EU", "US"]);
  });

  it("safely substitutes template variables for shell, sql, and url modes", () => {
    const values = { region: "a'b; rm -rf /", min: 10 };
    expect(substituteTemplate("./run.sh --r {{region}}", values, "shell")).toBe(
      "./run.sh --r 'a'\\''b; rm -rf /'",
    );
    expect(substituteTemplate("SELECT * FROM t WHERE r={{region}} AND v>={{min}}", values, "sql")).toBe(
      "SELECT * FROM t WHERE r='a''b; rm -rf /' AND v>=10",
    );
    expect(substituteTemplate("https://api.test/q?r={{region}}", values, "url")).toBe(
      "https://api.test/q?r=a'b%3B%20rm%20-rf%20%2F",
    );
  });
});
