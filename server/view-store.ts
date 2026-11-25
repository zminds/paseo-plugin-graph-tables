import { randomBytes } from "node:crypto";
import type { DataRow } from "../shared/query-engine";
import type { ViewSpec } from "../shared/view-schema";

export interface StoredView {
  viewId: string;
  spec: ViewSpec;
  rows: DataRow[];
  cwd: string;
  agentId: string | null;
  createdAt: string;
  fetchedAt: string;
  sourceKind: string | null;
}

const DEFAULT_MAX_ENTRIES = 200;

export class ViewStore {
  private readonly entries = new Map<string, StoredView>();
  private readonly maxEntries: number;

  constructor({ maxEntries = DEFAULT_MAX_ENTRIES }: { maxEntries?: number } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError("maxEntries must be a non-negative safe integer");
    }
    this.maxEntries = maxEntries;
  }

  async create(input: {
    spec: ViewSpec;
    rows: DataRow[];
    cwd: string;
    agentId: string | null;
  }): Promise<StoredView> {
    const viewId = `v_${randomBytes(5).toString("hex")}`;
    const now = new Date().toISOString();
    const entry: StoredView = {
      viewId,
      spec: input.spec,
      rows: input.rows,
      cwd: input.cwd,
      agentId: input.agentId,
      createdAt: now,
      fetchedAt: now,
      sourceKind: input.spec.source?.kind ?? null,
    };
    this.entries.set(viewId, entry);
    if (this.entries.size > this.maxEntries) {
      const oldestId = this.entries.keys().next().value;
      if (oldestId !== undefined) this.entries.delete(oldestId);
    }
    return entry;
  }

  async get(viewId: string): Promise<StoredView | null> {
    const entry = this.entries.get(viewId);
    if (!entry) return null;
    // Touch LRU order
    this.entries.delete(viewId);
    this.entries.set(viewId, entry);
    return entry;
  }

  async updateRows(viewId: string, rows: DataRow[]): Promise<StoredView | null> {
    const existing = this.entries.get(viewId);
    if (!existing) return null;
    const updated: StoredView = {
      ...existing,
      rows,
      fetchedAt: new Date().toISOString(),
    };
    this.entries.delete(viewId);
    this.entries.set(viewId, updated);
    return updated;
  }

  async list(agentId?: string): Promise<StoredView[]> {
    const all = [...this.entries.values()].reverse();
    return agentId ? all.filter((entry) => entry.agentId === agentId) : all;
  }
}
