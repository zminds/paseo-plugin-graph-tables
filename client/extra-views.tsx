import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { DataRow } from "../shared/query-engine";
import type { ViewSpec } from "../shared/view-schema";
import { normalizeColorItem } from "./format";

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return Number.isFinite(r + g + b) ? [r, g, b] : null;
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return Number.isFinite(r + g + b) ? [r, g, b] : null;
  }
  return null;
}

function interpolateColor(t: number, lowHex: string, highHex: string): string {
  const ratio = Math.max(0, Math.min(1, t));
  const a = hexToRgb(lowHex);
  const b = hexToRgb(highHex);
  if (!a || !b) return highHex;
  const r = Math.round(a[0] + (b[0] - a[0]) * ratio);
  const g = Math.round(a[1] + (b[1] - a[1]) * ratio);
  const bl = Math.round(a[2] + (b[2] - a[2]) * ratio);
  return `rgb(${r}, ${g}, ${bl})`;
}

export function GanttView({
  rows,
  theme,
  compact,
}: {
  rows: readonly DataRow[];
  theme: PluginTheme;
  compact: boolean;
}) {
  const items = useMemo(() => {
    return rows
      .map((row) => {
        const startMs = Date.parse(String(row.start ?? ""));
        const endMs = Date.parse(String(row.end ?? row.start ?? ""));
        if (Number.isNaN(startMs)) return null;
        return {
          task: String(row.task ?? row.name ?? row.label ?? "Task"),
          group: row.group ? String(row.group) : undefined,
          startMs,
          endMs: Number.isNaN(endMs) ? startMs : Math.max(startMs, endMs),
          startLabel: String(row.start ?? ""),
          endLabel: String(row.end ?? row.start ?? ""),
          progress: typeof row.progress === "number" ? Math.max(0, Math.min(1, row.progress)) : 1,
          status: typeof row.status === "string" ? row.status : "active",
          milestone: row.milestone === true,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }, [rows]);

  if (items.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
          No valid gantt dates found.
        </Text>
      </View>
    );
  }

  const minMs = Math.min(...items.map((i) => i.startMs));
  const maxMs = Math.max(...items.map((i) => i.endMs));
  const spanMs = Math.max(86_400_000, maxMs - minMs + 86_400_000);
  const trackWidth = compact ? 220 : 380;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ padding: compact ? 10 : 12, gap: 8 }}>
        {items.map((item, idx) => {
          const leftPct = (item.startMs - minMs) / spanMs;
          const widthPct = Math.max(0.03, (item.endMs - item.startMs + 86_400_000) / spanMs);
          const leftPx = Math.round(leftPct * trackWidth);
          const barPx = item.milestone ? 12 : Math.max(12, Math.round(widthPct * trackWidth));
          const barColor =
            item.status === "done"
              ? theme.colors.statusSuccess
              : item.status === "blocked" || item.status === "failed"
                ? theme.colors.statusDanger
                : theme.colors.accent;

          return (
            <View
              key={`g-${idx}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <View style={{ width: compact ? 110 : 150 }}>
                <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>
                  {item.task}
                </Text>
                {item.group ? (
                  <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.colors.foregroundMuted }}>
                    {item.group}
                  </Text>
                ) : null}
              </View>
              <View
                style={{
                  width: trackWidth,
                  height: 20,
                  borderRadius: 4,
                  backgroundColor: theme.colors.surface2,
                  justifyContent: "center",
                }}
              >
                {item.milestone ? (
                  <View
                    style={{
                      position: "absolute",
                      left: Math.min(trackWidth - 12, leftPx),
                      width: 11,
                      height: 11,
                      backgroundColor: barColor,
                      transform: [{ rotate: "45deg" }],
                    }}
                  />
                ) : (
                  <View
                    style={{
                      position: "absolute",
                      left: leftPx,
                      width: Math.min(trackWidth - leftPx, barPx),
                      height: 14,
                      borderRadius: 4,
                      backgroundColor: theme.colors.surface0,
                      borderWidth: 1,
                      borderColor: barColor,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.round(item.progress * 100)}%`,
                        height: "100%",
                        backgroundColor: barColor,
                      }}
                    />
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 10.5, color: theme.colors.foregroundMuted, minWidth: 96 }}>
                {item.startLabel.slice(0, 10)} → {item.endLabel.slice(0, 10)}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function HeatmapView({
  spec,
  rows,
  theme,
  compact,
}: {
  spec: Partial<ViewSpec>;
  rows: readonly DataRow[];
  theme: PluginTheme;
  compact: boolean;
}) {
  const [selected, setSelected] = useState<{ x: string; y: string; value: number } | null>(null);
  const customPalette = (spec.colors ?? [])
    .map((c) => normalizeColorItem(c)?.value)
    .filter((v): v is string => Boolean(v));
  const lowColor = customPalette[0] ?? theme.colors.surface2;
  const highColor = customPalette[1] ?? theme.colors.accent;

  const grid = useMemo(() => {
    if (rows.length === 0) return { xs: [] as string[], ys: [] as string[], cells: new Map<string, number>(), min: 0, max: 1 };
    const xKey = spec.x ?? Object.keys(rows[0] ?? {})[0] ?? "x";
    const yKey =
      (typeof spec.y === "string" ? spec.y : undefined) ??
      Object.keys(rows[0] ?? {})[1] ??
      "y";
    const valKey = spec.value ?? Object.keys(rows[0] ?? {})[2] ?? "value";

    const xs: string[] = [];
    const ys: string[] = [];
    const xSet = new Set<string>();
    const ySet = new Set<string>();
    const cells = new Map<string, number>();

    // Long format if xKey and yKey and valKey exist on row
    if (rows[0]?.[xKey] !== undefined && rows[0]?.[yKey] !== undefined && rows[0]?.[valKey] !== undefined) {
      for (const row of rows) {
        const xv = String(row[xKey] ?? "");
        const yv = String(row[yKey] ?? "");
        const num = Number(row[valKey] ?? 0);
        if (!xSet.has(xv)) {
          xSet.add(xv);
          xs.push(xv);
        }
        if (!ySet.has(yv)) {
          ySet.add(yv);
          ys.push(yv);
        }
        cells.set(`${xv}::${yv}`, Number.isFinite(num) ? num : 0);
      }
    } else {
      // Wide format: yKey is row label, numeric keys are columns
      const keys = Object.keys(rows[0] ?? {}).filter((k) => k !== yKey);
      xs.push(...keys);
      for (const row of rows) {
        const yv = String(row[yKey] ?? "");
        if (!ySet.has(yv)) {
          ySet.add(yv);
          ys.push(yv);
        }
        for (const k of keys) {
          const num = Number(row[k] ?? 0);
          cells.set(`${k}::${yv}`, Number.isFinite(num) ? num : 0);
        }
      }
    }

    const vals = [...cells.values()];
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 1;
    return { xs, ys, cells, min, max };
  }, [rows, spec.x, spec.y, spec.value]);

  const span = Math.max(1e-9, grid.max - grid.min);
  const cellSize = compact ? 28 : 34;

  return (
    <View style={{ padding: compact ? 10 : 12, gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ gap: 3 }}>
          <View style={{ flexDirection: "row", paddingLeft: 76, gap: 3 }}>
            {grid.xs.map((x) => (
              <Text
                key={`hx-${x}`}
                numberOfLines={1}
                style={{
                  width: cellSize,
                  textAlign: "center",
                  fontSize: 10,
                  color: theme.colors.foregroundMuted,
                }}
              >
                {x}
              </Text>
            ))}
          </View>
          {grid.ys.map((y) => (
            <View key={`hy-${y}`} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text
                numberOfLines={1}
                style={{ width: 73, fontSize: 11, color: theme.colors.foregroundMuted }}
              >
                {y}
              </Text>
              {grid.xs.map((x) => {
                const v = grid.cells.get(`${x}::${y}`) ?? 0;
                const ratio = (v - grid.min) / span;
                return (
                  <Pressable
                    key={`hc-${x}-${y}`}
                    onPress={() => setSelected({ x, y, value: v })}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 4,
                      backgroundColor: interpolateColor(ratio, lowColor, highColor),
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.foreground }}>
                      {v}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {selected ? (
        <Text style={{ fontSize: 11.5, color: theme.colors.foregroundMuted }}>
          Selected ({selected.x}, {selected.y}): {selected.value}
        </Text>
      ) : null}
    </View>
  );
}

export function CalendarView({
  spec,
  rows,
  theme,
  compact,
}: {
  spec: Partial<ViewSpec>;
  rows: readonly DataRow[];
  theme: PluginTheme;
  compact: boolean;
}) {
  const [selected, setSelected] = useState<{ date: string; value: number } | null>(null);
  const customPalette = (spec.colors ?? [])
    .map((c) => normalizeColorItem(c)?.value)
    .filter((v): v is string => Boolean(v));
  const lowColor = customPalette[0] ?? theme.colors.surface2;
  const highColor = customPalette[1] ?? theme.colors.statusSuccess;

  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const dateStr = String(row.date ?? row.day ?? "").slice(0, 10);
      if (!dateStr) continue;
      const val = typeof row.value === "number" ? row.value : 1;
      counts.set(dateStr, (counts.get(dateStr) ?? 0) + val);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }, [rows]);

  const maxVal = Math.max(1, ...days.map((d) => d.value));

  return (
    <View style={{ padding: compact ? 10 : 12, gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {days.map((d) => (
          <Pressable
            key={d.date}
            onPress={() => setSelected(d)}
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              borderWidth: 1,
              borderColor: selected?.date === d.date ? theme.colors.accent : theme.colors.border,
              backgroundColor: interpolateColor(d.value / maxVal, lowColor, highColor),
            }}
          />
        ))}
      </View>
      {selected ? (
        <Text style={{ fontSize: 11.5, color: theme.colors.foregroundMuted }}>
          {selected.date}: {selected.value}
        </Text>
      ) : (
        <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
          {days.length} active days (tap a cell to inspect)
        </Text>
      )}
    </View>
  );
}

export function ColorsView({
  spec,
  rows,
  theme,
  compact,
}: {
  spec: Partial<ViewSpec>;
  rows: readonly DataRow[];
  theme: PluginTheme;
  compact: boolean;
}) {
  const toast = useToast();
  const swatches = useMemo(() => {
    const fromSpec = (spec.colors ?? [])
      .map((item) => normalizeColorItem(item))
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (fromSpec.length > 0) return fromSpec;
    return rows
      .map((row) => normalizeColorItem(row))
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }, [spec.colors, rows]);

  const copyHex = async (val: string) => {
    try {
      await copyText(val);
      toast.show(`Copied ${val}`, { variant: "success" });
    } catch {
      toast.error("Could not copy color");
    }
  };

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: compact ? 10 : 12 }}>
      {swatches.map((swatch, idx) => (
        <Pressable
          key={`sw-${idx}`}
          accessibilityRole="button"
          onPress={() => void copyHex(swatch.value)}
          style={{
            minWidth: 108,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface0,
            overflow: "hidden",
          }}
        >
          <View style={{ height: 36, backgroundColor: swatch.value }} />
          <View style={{ padding: 8, gap: 2 }}>
            {swatch.label ? (
              <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.colors.foreground }}>
                {swatch.label}
              </Text>
            ) : null}
            <Text style={{ fontSize: 11, fontFamily: "monospace", color: theme.colors.foregroundMuted }}>
              {swatch.value}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export function CodeView({
  spec,
  theme,
  compact,
}: {
  spec: Partial<ViewSpec>;
  theme: PluginTheme;
  compact: boolean;
}) {
  const toast = useToast();
  const codeText = spec.code ?? "";
  const lines = codeText.split("\n");

  const handleCopy = async () => {
    try {
      await copyText(codeText);
      toast.show("Copied code", { variant: "success" });
    } catch {
      toast.error("Could not copy code");
    }
  };

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: compact ? 10 : 12,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
          {spec.language ?? "text"}
          {spec.note ? ` · ${spec.note}` : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void handleCopy()}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
          <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>Copy</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator style={{ backgroundColor: theme.colors.surface0 }}>
        <View style={{ padding: 10 }}>
          {lines.map((line, idx) => (
            <View key={`cl-${idx}`} style={{ flexDirection: "row", gap: 10 }}>
              <Text
                style={{
                  width: 28,
                  textAlign: "right",
                  fontSize: 11.5,
                  fontFamily: "monospace",
                  color: theme.colors.foregroundMuted,
                }}
              >
                {idx + 1}
              </Text>
              <Text
                selectable
                style={{ fontSize: 12, fontFamily: "monospace", color: theme.colors.foreground }}
              >
                {line || " "}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
