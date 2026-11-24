import type { DataRow } from "../shared/query-engine";
import type { ColumnSpec, ViewSpec } from "../shared/view-schema";

export type ViewCardInput =
  | { kind: "inline"; spec: ViewSpec }
  | { kind: "token"; viewId: string }
  | { kind: "gfm-table"; columns: ColumnSpec[]; rows: DataRow[]; title?: string };

export interface ViewerEntry {
  id: string;
  title: string;
  input: ViewCardInput;
}

const MAX_ENTRIES = 50;
const entries = new Map<string, ViewerEntry>();
let nextId = 1;
let opener: ((id: string) => void) | null = null;

export function registerFullScreenOpener(nextOpener: ((id: string) => void) | null): void {
  opener = nextOpener;
}

export function openViewInFullScreen(title: string, input: ViewCardInput): boolean {
  if (!opener) return false;
  const id = `view-${nextId++}`;
  entries.set(id, { id, title, input });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  opener(id);
  return true;
}

export function getViewerEntry(id: string | undefined): ViewerEntry | undefined {
  if (!id) return undefined;
  return entries.get(id);
}
