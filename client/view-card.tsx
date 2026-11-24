import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { applyQuery, inferColumns, type DataRow } from "../shared/query-engine";
import { queryViewRpc } from "../shared/rpc";
import type { ColumnSpec, ControlSpec, ViewSpec, WhereClause } from "../shared/view-schema";
import { ChartView } from "./chart-view";
import { ControlsBar } from "./controls-bar";
import { CalendarView, CodeView, ColorsView, GanttView, HeatmapView } from "./extra-views";
import { hasNumericColumn } from "./format";
import { GraphView } from "./graph-view";
import { StatsView } from "./stats-view";
import { TableView } from "./table-view";
import { openViewInFullScreen, type ViewCardInput } from "./viewer-store";

export type { ViewCardInput } from "./viewer-store";

export interface ViewCardProps {
  input: ViewCardInput;
  theme: PluginTheme;
  compact: boolean;
  isFullScreen?: boolean;
}

function resolveInlineControls(
  controls: readonly ControlSpec[] | undefined,
  values: Readonly<Record<string, unknown>>,
) {
  const where: WhereClause[] = [];
  let sort: string | undefined;
  let top: number | undefined;
  let search: string | undefined;

  for (const ctrl of controls ?? []) {
    const val = values[ctrl.id];
    if (val === undefined || val === null || val === "") continue;
    if (ctrl.type === "buttons") {
      const opt = ctrl.options.find(
        (o) => (o.value ?? o.label) === String(val) || o.label === String(val),
      );
      if (opt) {
        if (opt.where) where.push(...opt.where);
        if (opt.sort !== undefined) sort = opt.sort;
        if (opt.top !== undefined) top = opt.top;
        if (opt.search !== undefined) search = opt.search;
      }
    } else if (ctrl.type === "select") {
      const optObjs = (ctrl.options ?? []).filter(
        (o): o is Exclude<typeof o, string> => typeof o !== "string",
      );
      const matched = optObjs.find((o) => (o.value ?? o.label) === String(val));
      if (matched) {
        if (matched.where) where.push(...matched.where);
        if (matched.sort !== undefined) sort = matched.sort;
        if (matched.top !== undefined) top = matched.top;
      } else if (ctrl.column && String(val) !== "__all__") {
        where.push({ key: ctrl.column, op: "eq", value: val });
      }
    } else if (ctrl.type === "toggle" && val === true) {
      if (ctrl.where) where.push(...ctrl.where);
      if (ctrl.sort !== undefined) sort = ctrl.sort;
      if (ctrl.top !== undefined) top = ctrl.top;
      if (ctrl.search !== undefined) search = ctrl.search;
    } else if (ctrl.type === "number" && ctrl.column) {
      const num = Number(val);
      if (Number.isFinite(num)) {
        where.push({ key: ctrl.column, op: ctrl.op ?? "gte", value: num });
      }
    } else if (ctrl.type === "search") {
      search = String(val);
    }
  }
  return { where, sort, top, search };
}

export function ViewCard({ input, theme, compact, isFullScreen = false }: ViewCardProps) {
  const queryView = useRpc(queryViewRpc);

  const initialSort = input.kind === "inline" ? input.spec.initial?.sort : undefined;
  const [sort, setSort] = useState<string | undefined>(initialSort);
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [controlValues, setControlValues] = useState<Record<string, unknown>>({});
  const [viewModeOverride, setViewModeOverride] = useState<"table" | "chart" | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const isRemote = input.kind === "token";
  const remoteQuery = useQuery({
    queryKey: [
      "graph-tables",
      "view",
      isRemote ? input.viewId : "inline",
      sort ?? "",
      search,
      page,
      controlValues,
      refreshTick,
    ],
    enabled: isRemote,
    queryFn: () =>
      queryView({
        viewId: input.kind === "token" ? input.viewId : "",
        sort,
        search: search || undefined,
        page,
        controlValues,
        refresh: refreshTick > 0,
      }),
    refetchInterval: (query) => {
      const sec = Number((query.state.data?.spec as { refresh?: unknown } | undefined)?.refresh);
      return Number.isFinite(sec) && sec > 0 ? sec * 1000 : false;
    },
  });

  const resolvedSpec: Partial<ViewSpec> = useMemo(() => {
    if (input.kind === "token") {
      return (remoteQuery.data?.spec ?? { type: "table", title: "Loading view..." }) as Partial<ViewSpec>;
    }
    if (input.kind === "gfm-table") {
      return {
        type: "table",
        title: input.title ?? "Table",
        columns: input.columns,
        data: input.rows,
      };
    }
    return input.spec;
  }, [input, remoteQuery.data?.spec]);

  const inlineResult = useMemo(() => {
    if (input.kind === "token") return null;
    const rawRows: DataRow[] =
      input.kind === "gfm-table" ? input.rows : ((input.spec.data as DataRow[] | undefined) ?? []);
    const ctrl = resolveInlineControls(resolvedSpec.controls, controlValues);
    const mergedWhere = [...(resolvedSpec.initial?.where ?? []), ...ctrl.where];
    const pageSize =
      resolvedSpec.initial?.pageSize ?? (resolvedSpec.type === "table" ? 25 : 500);
    const result = applyQuery(rawRows, {
      where: mergedWhere,
      search: search || ctrl.search || resolvedSpec.initial?.search,
      sort: sort ?? ctrl.sort ?? resolvedSpec.initial?.sort,
      top: ctrl.top ?? resolvedSpec.initial?.top,
      page,
      pageSize,
    });
    const columns = inferColumns(rawRows, resolvedSpec.columns);
    return { ...result, columns };
  }, [input, resolvedSpec, controlValues, search, sort, page]);

  const rows: DataRow[] =
    input.kind === "token" ? remoteQuery.data?.rows ?? [] : inlineResult?.rows ?? [];
  const columns: ColumnSpec[] =
    input.kind === "token" ? remoteQuery.data?.columns ?? [] : inlineResult?.columns ?? [];
  const totalRows =
    input.kind === "token" ? remoteQuery.data?.totalRows ?? 0 : inlineResult?.totalRows ?? 0;
  const filteredRows =
    input.kind === "token" ? remoteQuery.data?.filteredRows ?? 0 : inlineResult?.filteredRows ?? 0;
  const activePage = input.kind === "token" ? remoteQuery.data?.page ?? 1 : inlineResult?.page ?? 1;
  const activePageSize =
    input.kind === "token" ? remoteQuery.data?.pageSize ?? 25 : inlineResult?.pageSize ?? 25;
  const facets =
    input.kind === "token" ? remoteQuery.data?.facets ?? {} : inlineResult?.facets ?? {};

  const effectiveType = viewModeOverride ?? resolvedSpec.type ?? "table";
  const canToggleTableChart =
    rows.length > 0 &&
    (resolvedSpec.type === "chart" ||
      (resolvedSpec.type === "table" && hasNumericColumn(rows, columns)));
  const hasExplicitSearch = (resolvedSpec.controls ?? []).some((c) => c.type === "search");
  const graphNodesCount =
    effectiveType === "graph"
      ? (resolvedSpec.nodes ?? []).filter((n) => n.type !== "group").length
      : 0;
  const graphStepsCount =
    effectiveType === "graph" ? (resolvedSpec.steps ?? []).length : 0;
  const graphMetaLabel =
    effectiveType === "graph" && graphNodesCount > 0
      ? `${graphNodesCount} ${graphNodesCount === 1 ? "part" : "parts"}${graphStepsCount > 0 ? ` · ${graphStepsCount} ${graphStepsCount === 1 ? "step" : "steps"}` : ""}`
      : null;

  const styles = useMemo(
    () => ({
      card: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
        marginVertical: 4,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 12,
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      headerLeft: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 7,
      },
      title: {
        fontSize: 13,
        fontWeight: "700" as const,
        color: theme.colors.foreground,
        flexShrink: 1,
      },
      summary: {
        fontSize: 11.5,
        color: theme.colors.foregroundMuted,
        paddingHorizontal: compact ? 10 : 12,
        paddingTop: 8,
        paddingBottom: 6,
      },
      actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      actionBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 7,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      actionText: { fontSize: 11, color: theme.colors.foreground },
      errorBox: { padding: 12, gap: 4 },
      errorText: { fontSize: 12, color: theme.colors.statusDanger },
      loadingBox: { padding: 20, alignItems: "center" as const },
      loadingText: { fontSize: 12, color: theme.colors.foregroundMuted },
    }),
    [theme, compact],
  );

  const handleControlChange = (id: string, value: unknown) => {
    setPage(1);
    setControlValues((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
  };

  const renderBody = (expanded: boolean) => {
    if (isRemote && remoteQuery.isLoading && !remoteQuery.data) {
      return (
        <View style={styles.loadingBox}>
          <Text style={styles.loadingText}>Loading view...</Text>
        </View>
      );
    }

    const errMsg =
      (isRemote && remoteQuery.error instanceof Error ? remoteQuery.error.message : null) ??
      remoteQuery.data?.error ??
      null;

    if (errMsg && rows.length === 0) {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errMsg}</Text>
        </View>
      );
    }

    return (
      <View>
        {errMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errMsg}</Text>
          </View>
        ) : null}
        {resolvedSpec.summary ? <Text style={styles.summary}>{resolvedSpec.summary}</Text> : null}
        {resolvedSpec.controls?.length ? (
          <ControlsBar
            controls={resolvedSpec.controls}
            values={controlValues}
            facets={facets}
            onChange={handleControlChange}
            theme={theme}
            compact={compact}
          />
        ) : null}

        {effectiveType === "table" ? (
          <TableView
            columns={columns}
            rows={rows}
            totalRows={totalRows}
            filteredRows={filteredRows}
            page={activePage}
            pageSize={activePageSize}
            sort={sort}
            search={search}
            hasExplicitSearchControl={hasExplicitSearch}
            onSortChange={(next) => {
              setPage(1);
              setSort(next);
            }}
            onSearchChange={(txt) => {
              setPage(1);
              setSearch(txt);
            }}
            onPageChange={setPage}
            theme={theme}
            compact={compact}
          />
        ) : effectiveType === "chart" ? (
          <ChartView
            spec={resolvedSpec}
            columns={columns}
            rows={rows}
            theme={theme}
            compact={compact}
            expanded={expanded}
          />
        ) : effectiveType === "stats" ? (
          <StatsView spec={resolvedSpec} rows={rows} theme={theme} compact={compact} />
        ) : effectiveType === "graph" ? (
          <GraphView spec={resolvedSpec} theme={theme} compact={compact} expanded={expanded} />
        ) : effectiveType === "gantt" ? (
          <GanttView rows={rows} theme={theme} compact={compact} />
        ) : effectiveType === "heatmap" ? (
          <HeatmapView spec={resolvedSpec} rows={rows} theme={theme} compact={compact} />
        ) : effectiveType === "calendar" ? (
          <CalendarView spec={resolvedSpec} rows={rows} theme={theme} compact={compact} />
        ) : effectiveType === "colors" ? (
          <ColorsView spec={resolvedSpec} rows={rows} theme={theme} compact={compact} />
        ) : effectiveType === "code" ? (
          <CodeView spec={resolvedSpec} theme={theme} compact={compact} />
        ) : (
          <TableView
            columns={columns}
            rows={rows}
            totalRows={totalRows}
            filteredRows={filteredRows}
            page={activePage}
            pageSize={activePageSize}
            sort={sort}
            search={search}
            hasExplicitSearchControl={hasExplicitSearch}
            onSortChange={setSort}
            onSearchChange={setSearch}
            onPageChange={setPage}
            theme={theme}
            compact={compact}
          />
        )}
      </View>
    );
  };

  const title =
    resolvedSpec.title ??
    (effectiveType === "graph"
      ? "Diagram"
      : effectiveType === "stats"
        ? "Metrics"
        : effectiveType === "chart"
          ? "Chart"
          : "Data view");

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon
            name={effectiveType === "graph" ? "Network" : effectiveType === "code" ? "Code" : "ChartNoAxesColumn"}
            size={15}
            color={theme.colors.accent}
          />
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        </View>
        <View style={styles.actions}>
          {graphMetaLabel ? (
            <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
              {graphMetaLabel}
            </Text>
          ) : null}
          {canToggleTableChart ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setViewModeOverride(effectiveType === "table" ? "chart" : "table")}
              style={styles.actionBtn}
            >
              <Text style={styles.actionText}>
                {effectiveType === "table" ? "Chart" : "Table"}
              </Text>
            </Pressable>
          ) : null}
          {isRemote && remoteQuery.data?.sourceKind ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setRefreshTick((t) => t + 1)}
              style={styles.actionBtn}
            >
              <Icon name="RotateCw" size={12} color={theme.colors.foreground} />
            </Pressable>
          ) : null}
          {!isFullScreen ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!openViewInFullScreen(title, input)) {
                  setModalOpen(true);
                }
              }}
              style={styles.actionBtn}
            >
              <Icon name="Maximize2" size={12} color={theme.colors.foreground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {renderBody(isFullScreen)}

      <Modal
        title={title}
        icon={<Icon name="ChartNoAxesColumn" size={16} color={theme.colors.foreground} />}
        open={modalOpen}
        onOpenChange={setModalOpen}
      >
        <Modal.Content style={{ backgroundColor: theme.colors.surface1 }}>
          {renderBody(true)}
        </Modal.Content>
      </Modal>
    </View>
  );
}
