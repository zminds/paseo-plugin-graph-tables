import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

const DEFAULT_STORE_DIR = path.join(os.tmpdir(), "paseo-graph-tables-views");
const DEFAULT_MAX_ENTRIES = 200;

export class ViewStore {
  private readonly entries = new Map<string, StoredView>();
  private readonly storePath: string | null;
  private readonly maxEntries: number;
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options?: { storeDir?: string | null; maxEntries?: number }) {
    const dir = options?.storeDir === undefined ? DEFAULT_STORE_DIR : options.storeDir;
    this.storePath = dir ? path.join(dir, "views.json") : null;
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.storePath) return;
    try {
      const content = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && typeof (item as StoredView).viewId === "string") {
            const view = item as StoredView;
            this.entries.set(view.viewId, view);
          }
        }
        this.trim();
      }
    } catch {
      // No prior store file or unreadable; start empty
    }
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  private schedulePersist(): void {
    if (!this.storePath) return;
    const storePath = this.storePath;
    const snapshot = [...this.entries.values()];
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(path.dirname(storePath), { recursive: true });
        const tmp = `${storePath}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(snapshot), "utf8");
        await rename(tmp, storePath);
      })
      .catch(() => {
        // Persistence is best-effort
      });
  }

  async create(input: {
    spec: ViewSpec;
    rows: DataRow[];
    cwd: string;
    agentId: string | null;
  }): Promise<StoredView> {
    await this.ensureLoaded();
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
    this.trim();
    this.schedulePersist();
    return entry;
  }

  async get(viewId: string): Promise<StoredView | null> {
    await this.ensureLoaded();
    const entry = this.entries.get(viewId);
    if (!entry) return null;
    // Touch LRU order
    this.entries.delete(viewId);
    this.entries.set(viewId, entry);
    return entry;
  }

  async updateRows(viewId: string, rows: DataRow[]): Promise<StoredView | null> {
    await this.ensureLoaded();
    const existing = this.entries.get(viewId);
    if (!existing) return null;
    const updated: StoredView = {
      ...existing,
      rows,
      fetchedAt: new Date().toISOString(),
    };
    this.entries.delete(viewId);
    this.entries.set(viewId, updated);
    this.schedulePersist();
    return updated;
  }

  async list(agentId?: string): Promise<StoredView[]> {
    await this.ensureLoaded();
    const all = [...this.entries.values()].reverse();
    return agentId ? all.filter((entry) => entry.agentId === agentId) : all;
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}
