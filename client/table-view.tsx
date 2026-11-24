import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
  const totalPages = Math.max(1, Math.ceil(filteredRows / Math.max(1, pageSize)));

  const colWidths = useMemo(
    () => columns.map((col) => estimateColumnWidth(col, rows)),
    [columns, rows],
  );

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

  return (
    <View>
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
        <Pressable accessibilityRole="button" onPress={handleCopyCsv} style={styles.csvButton}>
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
              rows.map((row, rIdx) => (
                <View key={`r-${rIdx}`} style={[styles.row, rIdx % 2 === 1 ? styles.rowAlt : null]}>
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

                    if (col.type === "badge" && raw !== null && raw !== undefined && formatted !== "—") {
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
                            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: tone }}>
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
                          <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(raw)}>
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
                          selectable
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
                </View>
              ))
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
