import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { applyQuery, inferColumns } from "../shared/query-engine";
import type { listViewsRpc, queryViewRpc } from "../shared/rpc";
import type { GraphTablesSettings } from "../shared/settings";
import type { SourceSpec, ViewSpec, WhereClause } from "../shared/view-schema";
import { executeSource } from "./sources";
import type { ViewStore } from "./view-store";

interface ResolvedControls {
  where: WhereClause[];
  sort?: string;
  top?: number;
  search?: string;
  params: Record<string, unknown>;
  sourceOverride?: SourceSpec;
}

function resolveControls(
  spec: ViewSpec,
  controlValues: Readonly<Record<string, unknown>> | undefined,
): ResolvedControls {
  const result: ResolvedControls = {
    where: [],
    params: { ...(controlValues ?? {}) },
  };
  if (!spec.controls || !controlValues) return result;

  for (const control of spec.controls) {
    const rawValue = controlValues[control.id];
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;

    if (control.type === "buttons") {
      const selected = String(rawValue);
      const option = control.options.find(
        (opt) => (opt.value ?? opt.label) === selected || opt.label === selected,
      );
      if (option) {
        if (option.where) result.where.push(...option.where);
        if (option.sort !== undefined) result.sort = option.sort;
        if (option.top !== undefined) result.top = option.top;
        if (option.search !== undefined) result.search = option.search;
        if (option.params) Object.assign(result.params, option.params);
        if (option.source) result.sourceOverride = option.source;
      }
      continue;
    }

    if (control.type === "select") {
      const selected = String(rawValue);
      if (selected === "__all__") continue;
      const optionObjects = (control.options ?? []).filter(
        (opt): opt is Exclude<typeof opt, string> => typeof opt !== "string",
      );
      const matched = optionObjects.find(
        (opt) => (opt.value ?? opt.label) === selected || opt.label === selected,
      );
      if (matched) {
        if (matched.where) result.where.push(...matched.where);
        if (matched.sort !== undefined) result.sort = matched.sort;
        if (matched.top !== undefined) result.top = matched.top;
        if (matched.search !== undefined) result.search = matched.search;
        if (matched.params) Object.assign(result.params, matched.params);
        if (matched.source) result.sourceOverride = matched.source;
      } else if (control.column) {
        result.where.push({ key: control.column, op: "eq", value: selected });
      }
      continue;
    }

    if (control.type === "toggle") {
      if (rawValue === true || rawValue === "true") {
        if (control.where) result.where.push(...control.where);
        if (control.sort !== undefined) result.sort = control.sort;
        if (control.top !== undefined) result.top = control.top;
        if (control.search !== undefined) result.search = control.search;
        if (control.params) Object.assign(result.params, control.params);
        if (control.source) result.sourceOverride = control.source;
      }
      continue;
    }

    if (control.type === "number") {
      const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (Number.isFinite(num) && control.column) {
        result.where.push({ key: control.column, op: control.op ?? "gte", value: num });
      }
      continue;
    }

    if (control.type === "search") {
      const text = String(rawValue).trim();
      if (text) result.search = text;
    }
  }

  return result;
}

function sourceUsesTemplate(source: SourceSpec): boolean {
  const serialize = JSON.stringify(source);
  return /\{\{\s*[a-zA-Z0-9_-]+\s*\}\}/.test(serialize);
}

export function createQueryViewHandler(
  store: ViewStore,
  getSettings: () => GraphTablesSettings,
) {
  return async (
    input: RpcInput<typeof queryViewRpc>,
  ): Promise<RpcOutput<typeof queryViewRpc>> => {
    const entry = await store.get(input.viewId);
    if (!entry) {
      return {
        viewId: input.viewId,
        spec: { type: "table", title: "View unavailable" },
        rows: [],
        totalRows: 0,
        filteredRows: 0,
        page: 1,
        pageSize: 25,
        columns: [],
        facets: {},
        fetchedAt: new Date().toISOString(),
        sourceKind: null,
        error: `View "${input.viewId}" was not found in the daemon store (it may have expired).`,
      };
    }

    const settings = getSettings();
    const resolvedControls = resolveControls(entry.spec, input.controlValues);
    const activeSource = resolvedControls.sourceOverride ?? entry.spec.source;

    let rows = entry.rows;
    let fetchedAt = entry.fetchedAt;
    let sourceError: string | null = null;

    const refreshSec = entry.spec.refresh;
    const isStale =
      typeof refreshSec === "number" &&
      refreshSec > 0 &&
      Date.now() - Date.parse(entry.fetchedAt) >= refreshSec * 1000;

    const shouldRequerySource =
      Boolean(activeSource) &&
      (input.refresh === true ||
        isStale ||
        resolvedControls.sourceOverride !== undefined ||
        (activeSource !== undefined &&
          sourceUsesTemplate(activeSource) &&
          input.controlValues !== undefined));

    if (shouldRequerySource && activeSource) {
      try {
        rows = await executeSource(activeSource, {
          cwd: entry.cwd,
          settings,
          controlValues: resolvedControls.params,
        });
        fetchedAt = new Date().toISOString();
        if (!resolvedControls.sourceOverride && !sourceUsesTemplate(activeSource)) {
          await store.updateRows(entry.viewId, rows);
        }
      } catch (error) {
        sourceError = error instanceof Error ? error.message : String(error);
      }
    }

    const combinedWhere: WhereClause[] = [
      ...(entry.spec.initial?.where ?? []),
      ...resolvedControls.where,
      ...(input.where ?? []),
    ];

    const queryResult = applyQuery(rows, {
      where: combinedWhere,
      search: input.search ?? resolvedControls.search ?? entry.spec.initial?.search,
      sort: input.sort ?? resolvedControls.sort ?? entry.spec.initial?.sort,
      top: input.top ?? resolvedControls.top ?? entry.spec.initial?.top,
      page: input.page ?? 1,
      pageSize:
        input.pageSize ??
        entry.spec.initial?.pageSize ??
        (entry.spec.type === "table" ? settings.defaultPageSize : 500),
    });

    const columns = inferColumns(rows, entry.spec.columns);

    return {
      viewId: entry.viewId,
      spec: entry.spec as Record<string, unknown>,
      rows: queryResult.rows,
      totalRows: queryResult.totalRows,
      filteredRows: queryResult.filteredRows,
      page: queryResult.page,
      pageSize: queryResult.pageSize,
      columns,
      facets: queryResult.facets,
      fetchedAt,
      sourceKind: activeSource?.kind ?? null,
      error: sourceError,
    };
  };
}

export function createListViewsHandler(store: ViewStore) {
  return async (
    input: RpcInput<typeof listViewsRpc>,
  ): Promise<RpcOutput<typeof listViewsRpc>> => {
    const entries = await store.list(input.agentId);
    return {
      views: entries.map((entry) => ({
        viewId: entry.viewId,
        type: entry.spec.type,
        title: entry.spec.title ?? `${entry.spec.type} view`,
        rowCount: entry.rows.length,
        createdAt: entry.createdAt,
        agentId: entry.agentId,
        sourceKind: entry.sourceKind,
      })),
    };
  };
}
