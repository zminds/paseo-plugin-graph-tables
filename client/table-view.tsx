/**
 * Interactive data table view with sorting, filtering, inline accordion row details,
 * and Markdown/CSV/TSV/JSON/SQL export, adapted from Beluga (https://github.com/beluga-labs/beluga).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { formatCellValue, visualTextUnits, type DataRow } from "../shared/query-engine";
import { exportViewRpc } from "../shared/rpc";
import type { ColumnSpec } from "../shared/view-schema";
import { ActionPopoverMenu, IconPillButton } from "./action-menu";
import {
  rowsToCsv,
  rowsToJson,
  rowsToMarkdownTable,
  rowsToSqlInserts,
  rowsToTsv,
  type ExportValueMode,
} from "./format";

export interface TableViewProps {
  columns: readonly ColumnSpec[];
  rows: readonly DataRow[];
  totalRows: number;
  filteredRows: number;
  page: number;
  pageSize: number;
  sort?: string;
  search?: string;
  hasExplicitSearchControl?: boolean;
  onSortChange(nextSort: string | undefined): void;
  onSearchChange(nextSearch: string): void;
  onPageChange(nextPage: number): void;
  theme: PluginTheme;
  compact: boolean;
  title?: string;
  viewId?: string;
  onExpand?(): void;
  onToggleChart?(): void;
  showChartToggle?: boolean;
  specJson?: string;
}

const INDICATOR_COL_WIDTH = 22;

function estimateColumnWidth(col: ColumnSpec, rows: readonly DataRow[]): number {
  if (col.width) return col.width;
  const headerUnits = visualTextUnits(col.label ?? col.key) + 3;
  const maxCellUnits = rows.slice(0, 30).reduce((max, row) => {
    const formatted = formatCellValue(row[col.key], col.type);
    return Math.max(max, Math.min(44, visualTextUnits(formatted)));
  }, 0);
  const units = Math.max(headerUnits, maxCellUnits, 6);
  return Math.min(320, Math.max(88, Math.round(units * 7.8 + 22)));
}

function badgeToneColor(raw: string, theme: PluginTheme): string {
  const lower = raw.toLowerCase();
  if (/(fail|error|critical|blocked|down|high|danger)/.test(lower)) {
    return theme.colors.statusDanger;
  }
  if (/(warn|pending|hold|medium|slow|degraded)/.test(lower)) {
    return theme.colors.statusWarning;
  }
  if (/(ok|pass|done|success|active|healthy|ready|low|completed)/.test(lower)) {
    return theme.colors.statusSuccess;
  }
  return theme.colors.accent;
}

function buildRawSamplePreview(columns: readonly ColumnSpec[], rows: readonly DataRow[]): string {
  const first = rows[0];
  if (!first) return "保留原始字段值";
  const samples: string[] = [];
  for (const col of columns) {
    const raw = first[col.key];
    if (typeof raw === "number" || typeof raw === "boolean") {
      samples.push(String(raw));
      if (samples.length >= 2) break;
    }
  }
  if (samples.length === 0) return "保留数字与布尔原始值";
  return `原始值：${samples.join("、")}`;
}

export function TableView({
  columns,
  rows,
  totalRows,
  filteredRows,
  page,
  pageSize,
  sort,
  search = "",
  hasExplicitSearchControl = false,
  onSortChange,
  onSearchChange,
  onPageChange,
  theme,
  compact,
  title,
  viewId,
  onExpand,
  onToggleChart,
  showChartToggle = false,
  specJson,
}: TableViewProps) {
  const toast = useToast();
  const exportView = useRpc(exportViewRpc);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [valueMode, setValueMode] = useState<ExportValueMode>("formatted");
  const [exporting, setExporting] = useState<boolean>(false);
  const totalPages = Math.max(1, Math.ceil(filteredRows / Math.max(1, pageSize)));

  useEffect(() => {
    setSelectedRowIndex(null);
  }, [page, search, sort, rows]);

  const baseColWidths = useMemo(
    () => columns.map((col) => estimateColumnWidth(col, rows)),
    [columns, rows],
  );

  const colWidths = useMemo(() => {
    const available = containerWidth - INDICATOR_COL_WIDTH;
    const sum = baseColWidths.reduce((acc, w) => acc + w, 0);
    if (available > sum && sum > 0) {
      const extra = available - sum;
      return baseColWidths.map((w, idx) =>
        idx === baseColWidths.length - 1
          ? Math.floor(
              w +
                extra -
                baseColWidths.slice(0, -1).reduce((s, bw) => s + Math.floor((extra * bw) / sum), 0),
            )
          : w + Math.floor((extra * w) / sum),
      );
    }
    return baseColWidths;
  }, [baseColWidths, containerWidth]);

  const totalTableWidth = useMemo(
    () => INDICATOR_COL_WIDTH + colWidths.reduce((acc, w) => acc + w, 0),
    [colWidths],
  );

  const rawSamplePreview = useMemo(() => buildRawSamplePreview(columns, rows), [columns, rows]);

  const onLayout = (event: LayoutChangeEvent) => {
    const w = Math.floor(event.nativeEvent.layout.width);
    if (w > 0 && Math.abs(w - containerWidth) > 2) setContainerWidth(w);
  };

  const styles = useMemo(
    () => ({
      toolbar: {
        position: "relative" as const,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: 5,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      searchBox: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        height: 26,
        paddingHorizontal: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        maxWidth: 240,
      },
      searchInput: {
        flex: 1,
        fontSize: 11.5,
        color: theme.colors.foreground,
        paddingVertical: 0,
      },
      headerRow: {
        flexDirection: "row" as const,
        backgroundColor: theme.colors.surface0,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      indicatorCell: {
        width: INDICATOR_COL_WIDTH,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      headerCell: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      headerText: {
        fontSize: 11.5,
        fontWeight: "500" as const,
        color: theme.colors.foregroundMuted,
        flexShrink: 1,
      },
      row: {
        flexDirection: "row" as const,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      rowSelected: {
        backgroundColor: theme.colors.surface2,
      },
      cell: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        justifyContent: "center" as const,
      },
      cellText: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.foreground,
      },
      monoText: {
        fontSize: 11.5,
        fontFamily: "monospace",
        color: theme.colors.foreground,
      },
      linkText: {
        fontSize: 12,
        color: theme.colors.accent,
        textDecorationLine: "underline" as const,
      },
      inlineBand: {
        backgroundColor: theme.colors.surface1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        paddingHorizontal: compact ? 10 : 14,
        paddingVertical: 8,
      },
      inlineCard: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 5,
      },
      inlineRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 12,
      },
      inlineKey: {
        width: compact ? 84 : 132,
        fontSize: 11.5,
        lineHeight: 17,
        color: theme.colors.foregroundMuted,
      },
      inlineVal: {
        fontSize: 11.5,
        lineHeight: 17,
        color: theme.colors.foreground,
      },
      inlineMono: {
        fontSize: 11,
        lineHeight: 17,
        fontFamily: "monospace",
        color: theme.colors.foreground,
      },
      inlineLink: {
        fontSize: 11.5,
        lineHeight: 17,
        color: theme.colors.accent,
        textDecorationLine: "underline" as const,
      },
      footer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: compact ? 10 : 12,
        paddingVertical: 6,
        backgroundColor: theme.colors.surface0,
        borderBottomLeftRadius: 9,
        borderBottomRightRadius: 9,
      },
      metaText: { fontSize: 11, color: theme.colors.foregroundMuted },
      pagerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
      pagerBtn: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      empty: { padding: 20, alignItems: "center" as const },
    }),
    [theme, compact],
  );

  const toggleSort = (key: string) => {
    if (sort === key) onSortChange(`-${key}`);
    else if (sort === `-${key}`) onSortChange(undefined);
    else onSortChange(key);
  };

  const serializeFormat = (fmt: "markdown" | "csv" | "tsv" | "json" | "sql"): string => {
    switch (fmt) {
      case "markdown":
        return rowsToMarkdownTable(columns, rows, valueMode);
      case "csv":
        return rowsToCsv(columns, rows, valueMode);
      case "tsv":
        return rowsToTsv(columns, rows, valueMode);
      case "json":
        return rowsToJson(columns, rows, valueMode);
      case "sql":
        return rowsToSqlInserts(columns, rows, title ?? "exported_view", valueMode);
    }
  };

  const handleCopyFormat = async (fmt: "markdown" | "csv" | "tsv" | "json" | "sql", label: string) => {
    try {
      await copyText(serializeFormat(fmt));
      toast.show(`已拷贝为 ${label}`, { variant: "success" });
    } catch {
      toast.error(`拷贝 ${label} 失败`);
    }
  };

  const handleSaveFormat = async (fmt: "markdown" | "csv" | "tsv" | "json" | "sql", label: string) => {
    if (exporting) return;
    setExporting(true);
    try {
      const content = serializeFormat(fmt);
      const res = await exportView({
        format: fmt,
        title: title ?? "table",
        viewId,
        content,
      });
      if (res.ok && res.filePath) {
        await copyText(res.filePath).catch(() => {});
        toast.show(`已保存 ${res.filePath}`, { variant: "success" });
      } else {
        toast.error(res.error ?? `保存 ${label} 失败`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleCopyText = async (label: string, text: string) => {
    try {
      await copyText(text);
      toast.show(`Copied ${label}`, { variant: "success" });
    } catch {
      toast.error(`Could not copy ${label}`);
    }
  };

  const showSearchInput = !hasExplicitSearchControl && (searchOpen || search.length > 0 || rows.length > 8);

  return (
    <View onLayout={onLayout} style={{ zIndex: menuOpen ? 40 : 1 }}>
      <View style={[styles.toolbar, { zIndex: menuOpen ? 60 : 2 }]}>
        {showSearchInput ? (
          <View style={styles.searchBox}>
            <Icon name="Search" size={12} color={theme.colors.foregroundMuted} />
            <TextInput
              value={search}
              onChangeText={onSearchChange}
              placeholder="Filter rows..."
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.searchInput}
            />
            {search ? (
              <Pressable accessibilityRole="button" onPress={() => onSearchChange("")}>
                <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
              </Pressable>
            ) : rows.length <= 8 ? (
              <Pressable accessibilityRole="button" onPress={() => setSearchOpen(false)}>
                <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View />
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {!hasExplicitSearchControl && !showSearchInput ? (
            <IconPillButton
              icon="Search"
              tooltip="筛选行"
              theme={theme}
              onPress={() => setSearchOpen(true)}
            />
          ) : null}
          {showChartToggle && onToggleChart ? (
            <IconPillButton
              icon="ChartNoAxesColumn"
              tooltip="切换为图表"
              theme={theme}
              onPress={onToggleChart}
            />
          ) : null}
          <IconPillButton
            icon="Copy"
            tooltip="拷贝表格 (Markdown)"
            theme={theme}
            onPress={() => void handleCopyFormat("markdown", "Markdown")}
          />
          {onExpand ? (
            <IconPillButton
              icon="Maximize2"
              tooltip="在完整窗口中打开"
              theme={theme}
              onPress={onExpand}
            />
          ) : null}
          <View style={{ position: "relative" }}>
            <IconPillButton
              icon="MoreHorizontal"
              active={menuOpen}
              tooltip="更多操作"
              tooltipAlign="right"
              theme={theme}
              onPress={() => setMenuOpen((o) => !o)}
            />
            <ActionPopoverMenu
              open={menuOpen}
              compact={compact}
              theme={theme}
              onClose={() => setMenuOpen(false)}
              entries={[
                ...(onExpand
                  ? [
                      {
                        id: "expand",
                        icon: "Maximize2",
                        label: "在完整窗口中打开",
                        onPress: onExpand,
                      },
                    ]
                  : []),
                {
                  id: "copy-table",
                  icon: "Copy",
                  label: "拷贝表格",
                  onPress: () => void handleCopyFormat("markdown", "Markdown"),
                },
                {
                  kind: "submenu" as const,
                  id: "copy-as",
                  icon: "Copy",
                  label: "拷贝为",
                  children: [
                    { id: "c-md", label: "Markdown", onPress: () => void handleCopyFormat("markdown", "Markdown") },
                    { id: "c-csv", label: "CSV", onPress: () => void handleCopyFormat("csv", "CSV") },
                    { id: "c-tsv", label: "TSV", onPress: () => void handleCopyFormat("tsv", "TSV") },
                    { id: "c-json", label: "JSON", onPress: () => void handleCopyFormat("json", "JSON") },
                    { id: "c-sql", label: "SQL Inserts", onPress: () => void handleCopyFormat("sql", "SQL Inserts") },
                  ],
                  footerToggle: {
                    label: "按显示的值",
                    subtitle: rawSamplePreview,
                    checked: valueMode === "formatted",
                    onToggle: () => setValueMode((m) => (m === "formatted" ? "raw" : "formatted")),
                  },
                },
                {
                  kind: "submenu" as const,
                  id: "save-as",
                  icon: "Download",
                  label: "保存为",
                  children: [
                    { id: "s-md", label: "Markdown...", onPress: () => void handleSaveFormat("markdown", "Markdown") },
                    { id: "s-csv", label: "CSV...", onPress: () => void handleSaveFormat("csv", "CSV") },
                    { id: "s-tsv", label: "TSV...", onPress: () => void handleSaveFormat("tsv", "TSV") },
                    { id: "s-json", label: "JSON...", onPress: () => void handleSaveFormat("json", "JSON") },
                    { id: "s-sql", label: "SQL Inserts...", onPress: () => void handleSaveFormat("sql", "SQL Inserts") },
                  ],
                  footerToggle: {
                    label: "按显示的值",
                    subtitle: rawSamplePreview,
                    checked: valueMode === "formatted",
                    onToggle: () => setValueMode((m) => (m === "formatted" ? "raw" : "formatted")),
                  },
                },
                ...(specJson
                  ? [
                      { kind: "divider" as const, id: "div-spec" },
                      {
                        id: "copy-spec",
                        icon: "Code",
                        label: "拷贝视图定义",
                        onPress: () => void handleCopyText("视图定义", specJson),
                      },
                    ]
                  : []),
              ]}
            />
          </View>
        </View>
      </View>

      {columns.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.metaText}>No columns to display.</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={styles.headerRow}>
              <View style={styles.indicatorCell} />
              {columns.map((col, idx) => {
                const isAsc = sort === col.key;
                const isDesc = sort === `-${col.key}`;
                return (
                  <Pressable
                    key={col.key}
                    accessibilityRole="button"
                    onPress={() => toggleSort(col.key)}
                    style={[
                      styles.headerCell,
                      {
                        width: colWidths[idx],
                        justifyContent: col.align === "right" ? "flex-end" : "flex-start",
                      },
                    ]}
                  >
                    <Text numberOfLines={1} style={styles.headerText}>
                      {col.label ?? col.key}
                    </Text>
                    {isAsc ? (
                      <Icon name="ArrowUp" size={11} color={theme.colors.accent} />
                    ) : isDesc ? (
                      <Icon name="ArrowDown" size={11} color={theme.colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {rows.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.metaText}>No matching rows.</Text>
              </View>
            ) : (
              rows.map((row, rIdx) => {
                const isSelected = selectedRowIndex === rIdx;
                return (
                  <View key={`r-${rIdx}`}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Inspect row ${rIdx + 1}`}
                      onPress={() => {
                        setMenuOpen(false);
                        setSelectedRowIndex(isSelected ? null : rIdx);
                      }}
                      style={[
                        styles.row,
                        isSelected ? styles.rowSelected : null,
                        isSelected ? { borderBottomWidth: 0 } : null,
                      ]}
                    >
                      <View style={styles.indicatorCell}>
                        <Icon
                          name={isSelected ? "ChevronDown" : "ChevronRight"}
                          size={11}
                          color={isSelected ? theme.colors.accent : theme.colors.foregroundMuted}
                        />
                      </View>
                      {columns.map((col, cIdx) => {
                        const raw = row[col.key];
                        const formatted = formatCellValue(raw, col.type);
                        const alignStyle = {
                          width: colWidths[cIdx],
                          alignItems:
                            col.align === "right"
                              ? ("flex-end" as const)
                              : col.align === "center"
                                ? ("center" as const)
                                : ("flex-start" as const),
                        };

                        if (
                          col.type === "badge" &&
                          raw !== null &&
                          raw !== undefined &&
                          formatted !== "—"
                        ) {
                          const tone = badgeToneColor(formatted, theme);
                          return (
                            <View key={col.key} style={[styles.cell, alignStyle]}>
                              <View
                                style={{
                                  paddingHorizontal: 7,
                                  paddingVertical: 1.5,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: tone,
                                  backgroundColor: theme.colors.surface2,
                                }}
                              >
                                <Text
                                  numberOfLines={1}
                                  style={{ fontSize: 11, fontWeight: "600", color: tone }}
                                >
                                  {formatted}
                                </Text>
                              </View>
                            </View>
                          );
                        }

                        if (col.type === "color" && typeof raw === "string") {
                          return (
                            <View
                              key={col.key}
                              style={[
                                styles.cell,
                                alignStyle,
                                { flexDirection: "row", alignItems: "center", gap: 6 },
                              ]}
                            >
                              <View
                                style={{
                                  width: 11,
                                  height: 11,
                                  borderRadius: 3,
                                  borderWidth: 1,
                                  borderColor: theme.colors.border,
                                  backgroundColor: raw,
                                }}
                              />
                              <Text numberOfLines={1} style={styles.monoText}>
                                {raw}
                              </Text>
                            </View>
                          );
                        }

                        if (col.type === "url" && typeof raw === "string" && /^https?:\/\//i.test(raw)) {
                          return (
                            <View key={col.key} style={[styles.cell, alignStyle]}>
                              <Pressable
                                accessibilityRole="link"
                                onPress={() => void openExternalUrl(raw)}
                              >
                                <Text numberOfLines={1} style={styles.linkText}>
                                  {raw}
                                </Text>
                              </Pressable>
                            </View>
                          );
                        }

                        if (col.type === "bool") {
                          const truthy = raw === true || raw === "true";
                          return (
                            <View key={col.key} style={[styles.cell, alignStyle]}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: "600",
                                  color: truthy
                                    ? theme.colors.statusSuccess
                                    : theme.colors.foregroundMuted,
                                }}
                              >
                                {formatted}
                              </Text>
                            </View>
                          );
                        }

                        const isMono = col.type === "code" || col.type === "path";
                        return (
                          <View key={col.key} style={[styles.cell, alignStyle]}>
                            <Text
                              numberOfLines={2}
                              style={[
                                isMono ? styles.monoText : styles.cellText,
                                col.align === "right" ? { textAlign: "right" as const } : null,
                              ]}
                            >
                              {formatted}
                            </Text>
                          </View>
                        );
                      })}
                    </Pressable>
                    {isSelected ? (
                      <View style={[styles.inlineBand, { width: totalTableWidth }]}>
                        <View
                          style={[
                            styles.inlineCard,
                            {
                              width:
                                containerWidth > 0
                                  ? Math.max(
                                      220,
                                      Math.min(totalTableWidth, containerWidth) -
                                        (compact ? 20 : 28),
                                    )
                                  : undefined,
                            },
                          ]}
                        >
                          {columns.map((col) => {
                            const raw = row[col.key];
                            const formatted = formatCellValue(raw, col.type);
                            return (
                              <View key={`ins-${col.key}`} style={styles.inlineRow}>
                                <Text numberOfLines={1} style={styles.inlineKey}>
                                  {col.label ?? col.key}
                                </Text>
                                <View style={{ flex: 1 }}>
                                  {col.type === "url" &&
                                  typeof raw === "string" &&
                                  /^https?:\/\//i.test(raw) ? (
                                    <Pressable
                                      accessibilityRole="link"
                                      onPress={() => void openExternalUrl(raw)}
                                    >
                                      <Text style={styles.inlineLink}>{raw}</Text>
                                    </Pressable>
                                  ) : col.type === "color" && typeof raw === "string" ? (
                                    <View
                                      style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                                    >
                                      <View
                                        style={{
                                          width: 12,
                                          height: 12,
                                          borderRadius: 3,
                                          borderWidth: 1,
                                          borderColor: theme.colors.border,
                                          backgroundColor: raw,
                                        }}
                                      />
                                      <Text selectable style={styles.inlineMono}>
                                        {raw}
                                      </Text>
                                    </View>
                                  ) : (
                                    <Text
                                      selectable
                                      style={
                                        col.type === "code" || col.type === "path"
                                          ? styles.inlineMono
                                          : styles.inlineVal
                                      }
                                    >
                                      {formatted}
                                    </Text>
                                  )}
                                </View>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Copy ${col.label ?? col.key}`}
                                  onPress={() =>
                                    void handleCopyText(col.label ?? col.key, formatted)
                                  }
                                  style={{ padding: 2, opacity: 0.55 }}
                                >
                                  <Icon
                                    name="Copy"
                                    size={11}
                                    color={theme.colors.foregroundMuted}
                                  />
                                </Pressable>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Text style={styles.metaText}>
          {filteredRows === totalRows
            ? `${totalRows} rows`
            : `${filteredRows} of ${totalRows} rows`}
        </Text>
        {totalPages > 1 ? (
          <View style={styles.pagerRow}>
            <Pressable
              accessibilityRole="button"
              disabled={page <= 1}
              onPress={() => onPageChange(Math.max(1, page - 1))}
              style={[styles.pagerBtn, page <= 1 ? { opacity: 0.4 } : null]}
            >
              <Icon name="ChevronLeft" size={13} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.metaText}>
              {page} / {totalPages}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={page >= totalPages}
              onPress={() => onPageChange(Math.min(totalPages, page + 1))}
              style={[styles.pagerBtn, page >= totalPages ? { opacity: 0.4 } : null]}
            >
              <Icon name="ChevronRight" size={13} color={theme.colors.foreground} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
