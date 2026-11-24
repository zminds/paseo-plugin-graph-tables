import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { ControlSpec } from "../shared/view-schema";

export interface ControlsBarProps {
  controls: readonly ControlSpec[];
  values: Readonly<Record<string, unknown>>;
  facets: Readonly<Record<string, string[]>>;
  onChange(id: string, value: unknown): void;
  theme: PluginTheme;
  compact: boolean;
}

export function ControlsBar({
  controls,
  values,
  facets,
  onChange,
  theme,
  compact,
}: ControlsBarProps) {
  const styles = useMemo(
    () => ({
      container: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      group: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        flexWrap: "wrap" as const,
      },
      label: {
        fontSize: 11,
        fontWeight: "600" as const,
        color: theme.colors.foregroundMuted,
        marginRight: 2,
      },
      pillRow: {
        flexDirection: "row" as const,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden" as const,
      },
      pill: {
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: theme.colors.surface1,
      },
      pillActive: {
        backgroundColor: theme.colors.accent,
      },
      pillText: {
        fontSize: 12,
        color: theme.colors.foreground,
      },
      pillTextActive: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
      },
      toggleChip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      toggleChipActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      inputWrap: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        minWidth: 130,
      },
      input: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.foreground,
        paddingVertical: 2,
        minWidth: 70,
      },
      selectChip: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      selectChipActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
    }),
    [theme, compact],
  );

  if (controls.length === 0) return null;

  return (
    <View style={styles.container}>
      {controls.map((control) => {
        if (control.type === "buttons") {
          const activeVal = values[control.id];
          return (
            <View key={control.id} style={styles.group}>
              {control.label ? <Text style={styles.label}>{control.label}</Text> : null}
              <View style={styles.pillRow}>
                {control.options.map((opt) => {
                  const optVal = opt.value ?? opt.label;
                  const isActive = activeVal === optVal;
                  return (
                    <Pressable
                      key={optVal}
                      accessibilityRole="button"
                      onPress={() => onChange(control.id, isActive ? undefined : optVal)}
                      style={[styles.pill, isActive ? styles.pillActive : null]}
                    >
                      <Text style={[styles.pillText, isActive ? styles.pillTextActive : null]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        }

        if (control.type === "toggle") {
          const active = values[control.id] === true;
          return (
            <Pressable
              key={control.id}
              accessibilityRole="switch"
              accessibilityState={{ checked: active }}
              onPress={() => onChange(control.id, !active)}
              style={[styles.toggleChip, active ? styles.toggleChipActive : null]}
            >
              {active ? (
                <Icon name="Check" size={12} color={theme.colors.accentForeground} />
              ) : null}
              <Text style={[styles.pillText, active ? styles.pillTextActive : null]}>
                {control.label}
              </Text>
            </Pressable>
          );
        }

        if (control.type === "select") {
          const optionList: Array<{ label: string; value: string }> = (
            control.options && control.options.length > 0
              ? control.options.map((opt) =>
                  typeof opt === "string"
                    ? { label: opt, value: opt }
                    : { label: opt.label, value: opt.value ?? opt.label },
                )
              : (control.column ? facets[control.column] ?? [] : []).map((v) => ({
                  label: v,
                  value: v,
                }))
          );
          const current = typeof values[control.id] === "string" ? String(values[control.id]) : "__all__";
          return (
            <View key={control.id} style={styles.group}>
              <Text style={styles.label}>{control.label ?? control.column ?? control.id}:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onChange(control.id, undefined)}
                    style={[styles.selectChip, current === "__all__" ? styles.selectChipActive : null]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        current === "__all__" ? styles.pillTextActive : null,
                      ]}
                    >
                      All
                    </Text>
                  </Pressable>
                  {optionList.map((opt) => {
                    const active = current === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        accessibilityRole="button"
                        onPress={() => onChange(control.id, active ? undefined : opt.value)}
                        style={[styles.selectChip, active ? styles.selectChipActive : null]}
                      >
                        <Text style={[styles.pillText, active ? styles.pillTextActive : null]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          );
        }

        if (control.type === "number") {
          const current = values[control.id] !== undefined ? String(values[control.id]) : "";
          return (
            <View key={control.id} style={styles.inputWrap}>
              {control.label ? <Text style={styles.label}>{control.label}</Text> : null}
              <TextInput
                value={current}
                onChangeText={(txt) => {
                  const trimmed = txt.trim();
                  if (!trimmed) {
                    onChange(control.id, undefined);
                    return;
                  }
                  const num = Number(trimmed);
                  onChange(control.id, Number.isFinite(num) ? num : trimmed);
                }}
                keyboardType="numeric"
                placeholder={control.placeholder ?? "0"}
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
              />
            </View>
          );
        }

        if (control.type === "search") {
          const current = typeof values[control.id] === "string" ? String(values[control.id]) : "";
          return (
            <View key={control.id} style={[styles.inputWrap, { flex: 1, minWidth: 160 }]}>
              <Icon name="Search" size={13} color={theme.colors.foregroundMuted} />
              <TextInput
                value={current}
                onChangeText={(txt) => onChange(control.id, txt || undefined)}
                placeholder={control.placeholder ?? control.label ?? "Search..."}
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
              />
              {current ? (
                <Pressable accessibilityRole="button" onPress={() => onChange(control.id, undefined)}>
                  <Icon name="X" size={13} color={theme.colors.foregroundMuted} />
                </Pressable>
              ) : null}
            </View>
          );
        }

        return null;
      })}
    </View>
  );
}
