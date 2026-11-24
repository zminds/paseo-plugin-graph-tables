import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { formatCellValue, visualTextUnits, type DataRow } from "../shared/query-engine";
import type { ColumnSpec } from "../shared/view-schema";
import { rowsToCsv } from "./format";

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
}

const INDICATOR_COL_WIDTH = 30;

function estimateColumnWidth(col: ColumnSpec, rows: readonly DataRow[]): number {
  if (col.width) return col.width;
  const headerUnits = visualTextUnits(col.label ?? col.key) + 3;
  const maxCellUnits = rows.slice(0, 30).reduce((max, row) => {
    const formatted = formatCellValue(row[col.key], col.type);
    return Math.max(max, Math.min(44, visualTextUnits(formatted)));
  }, 0);
  const units = Math.max(headerUnits, maxCellUnits, 6);
  return Math.min(320, Math.max(88, Math.round(units * 8 + 24)));
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
}: TableViewProps) {
  const toast = useToast();
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
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
          ? Math.floor(w + extra - baseColWidths.slice(0, -1).reduce((s, bw) => s + Math.floor((extra * bw) / sum), 0))
          : w + Math.floor((extra * w) / sum),
      );
    }
    return baseColWidths;
  }, [baseColWidths, containerWidth]);

  const onLayout = (event: LayoutChangeEvent) => {
    const w = Math.floor(event.nativeEvent.layout.width);
    if (w > 0 && Math.abs(w - containerWidth) > 2) setContainerWidth(w);
  };

  const styles = useMemo(
    () => ({
      toolbar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      searchBox: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        maxWidth: 260,
      },
      searchInput: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.foreground,
        paddingVertical: 2,
      },
      csvButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      csvText: { fontSize: 11, color: theme.colors.foregroundMuted },
      headerRow: {
        flexDirection: "row" as const,
        backgroundColor: theme.colors.surface2,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      indicatorCell: {
        width: INDICATOR_COL_WIDTH,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        borderRightWidth: 1,
        borderRightColor: theme.colors.border,
      },
      headerCell: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRightWidth: 1,
        borderRightColor: theme.colors.border,
      },
      headerText: {
        fontSize: 11.5,
        fontWeight: "700" as const,
        color: theme.colors.foreground,
        flexShrink: 1,
      },
      row: {
        flexDirection: "row" as const,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      rowAlt: {
        backgroundColor: theme.colors.surface0,
      },
      rowSelected: {
        backgroundColor: theme.colors.surface2,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.accent,
      },
      cell: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        justifyContent: "center" as const,
        borderRightWidth: 1,
        borderRightColor: theme.colors.border,
      },
      cellText: {
        fontSize: 12.5,
        color: theme.colors.foreground,
      },
      monoText: {
        fontSize: 12,
        fontFamily: "monospace",
        color: theme.colors.foreground,
      },
      linkText: {
        fontSize: 12.5,
        color: theme.colors.accent,
        textDecorationLine: "underline" as const,
      },
      inspector: {
        margin: compact ? 8 : 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface0,
        overflow: "hidden" as const,
      },
      inspectorHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface2,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: 8,
      },
      inspectorTitle: {
        fontSize: 12,
        fontWeight: "700" as const,
        color: theme.colors.foreground,
      },
      inspectorBody: {
        padding: 10,
        gap: 8,
      },
      inspectorField: {
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: 4,
      },
      inspectorFieldHead: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
      },
      inspectorFieldLabel: {
        fontSize: 11,
        fontWeight: "700" as const,
        color: theme.colors.foregroundMuted,
      },
      inspectorFieldVal: {
        fontSize: 13,
        color: theme.colors.foreground,
      },
      footer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: compact ? 10 : 12,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface0,
      },
      metaText: { fontSize: 11.5, color: theme.colors.foregroundMuted },
      pagerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      pagerBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
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

  const handleCopyCsv = async () => {
    try {
      await copyText(rowsToCsv(columns, rows));
      toast.show("Copied visible rows as CSV", { variant: "success" });
    } catch {
      toast.error("Failed to copy CSV");
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

  const selectedRow =
    selectedRowIndex !== null && selectedRowIndex >= 0 && selectedRowIndex < rows.length
      ? rows[selectedRowIndex]
      : null;

  return (
    <View onLayout={onLayout}>
      <View style={styles.toolbar}>
        {!hasExplicitSearchControl ? (
          <View style={styles.searchBox}>
            <Icon name="Search" size={13} color={theme.colors.foregroundMuted} />
            <TextInput
              value={search}
              onChangeText={onSearchChange}
              placeholder="Filter rows..."
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.searchInput}
            />
            {search ? (
              <Pressable accessibilityRole="button" onPress={() => onSearchChange("")}>
                <Icon name="X" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View />
        )}
        <Pressable accessibilityRole="button" onPress={() => void handleCopyCsv()} style={styles.csvButton}>
          <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.csvText}>CSV</Text>
        </Pressable>
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
                      <Icon name="ArrowUp" size={12} color={theme.colors.accent} />
                    ) : isDesc ? (
                      <Icon name="ArrowDown" size={12} color={theme.colors.accent} />
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
                  <Pressable
                    key={`r-${rIdx}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Inspect row ${rIdx + 1}`}
                    onPress={() => setSelectedRowIndex(isSelected ? null : rIdx)}
                    style={[
                      styles.row,
                      rIdx % 2 === 1 ? styles.rowAlt : null,
                      isSelected ? styles.rowSelected : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.indicatorCell,
                        isSelected ? { width: INDICATOR_COL_WIDTH - 3 } : null,
                      ]}
                    >
                      <Icon
                        name={isSelected ? "ChevronDown" : "ChevronRight"}
                        size={13}
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
                                paddingVertical: 2,
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
                                width: 12,
                                height: 12,
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
                );
              })
            )}
          </View>
        </ScrollView>
      )}

      {selectedRow !== null && selectedRowIndex !== null ? (
        <View style={styles.inspector}>
          <View style={styles.inspectorHeader}>
            <Text style={styles.inspectorTitle}>
              Row {selectedRowIndex + 1} / {rows.length}
            </Text>
            <View style={styles.pagerRow}>
              <Pressable
                accessibilityRole="button"
                disabled={selectedRowIndex <= 0}
                onPress={() => setSelectedRowIndex(Math.max(0, selectedRowIndex - 1))}
                style={[styles.pagerBtn, selectedRowIndex <= 0 ? { opacity: 0.4 } : null]}
              >
                <Icon name="ChevronLeft" size={13} color={theme.colors.foreground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={selectedRowIndex >= rows.length - 1}
                onPress={() => setSelectedRowIndex(Math.min(rows.length - 1, selectedRowIndex + 1))}
                style={[
                  styles.pagerBtn,
                  selectedRowIndex >= rows.length - 1 ? { opacity: 0.4 } : null,
                ]}
              >
                <Icon name="ChevronRight" size={13} color={theme.colors.foreground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void handleCopyText("row JSON", JSON.stringify(selectedRow, null, 2))
                }
                style={styles.csvButton}
              >
                <Icon name="Copy" size={11} color={theme.colors.foregroundMuted} />
                <Text style={styles.csvText}>JSON</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedRowIndex(null)}
                style={styles.pagerBtn}
              >
                <Icon name="X" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          </View>
          <View style={styles.inspectorBody}>
            {columns.map((col, idx) => {
              const raw = selectedRow[col.key];
              const formatted = formatCellValue(raw, col.type);
              const isLast = idx === columns.length - 1;
              return (
                <View
                  key={`ins-${col.key}`}
                  style={[styles.inspectorField, isLast ? { borderBottomWidth: 0, paddingBottom: 0 } : null]}
                >
                  <View style={styles.inspectorFieldHead}>
                    <Text style={styles.inspectorFieldLabel}>{col.label ?? col.key}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void handleCopyText(col.label ?? col.key, formatted)}
                    >
                      <Icon name="Copy" size={11} color={theme.colors.foregroundMuted} />
                    </Pressable>
                  </View>
                  {col.type === "url" && typeof raw === "string" && /^https?:\/\//i.test(raw) ? (
                    <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(raw)}>
                      <Text style={styles.linkText}>{raw}</Text>
                    </Pressable>
                  ) : col.type === "color" && typeof raw === "string" ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: raw,
                        }}
                      />
                      <Text selectable style={styles.monoText}>
                        {raw}
                      </Text>
                    </View>
                  ) : (
                    <Text
                      selectable
                      style={
                        col.type === "code" || col.type === "path"
                          ? styles.monoText
                          : styles.inspectorFieldVal
                      }
                    >
                      {formatted}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.metaText}>
          {filteredRows === totalRows
            ? `${totalRows} rows (tap a row to inspect)`
            : `${filteredRows} of ${totalRows} rows (tap a row to inspect)`}
        </Text>
        {totalPages > 1 ? (
          <View style={styles.pagerRow}>
            <Pressable
              accessibilityRole="button"
              disabled={page <= 1}
              onPress={() => onPageChange(Math.max(1, page - 1))}
              style={[styles.pagerBtn, page <= 1 ? { opacity: 0.4 } : null]}
            >
              <Icon name="ChevronLeft" size={14} color={theme.colors.foreground} />
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
              <Icon name="ChevronRight" size={14} color={theme.colors.foreground} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
