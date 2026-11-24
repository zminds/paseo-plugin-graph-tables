import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export interface IconPillButtonProps {
  icon: string;
  label?: string;
  size?: number;
  iconSize?: number;
  active?: boolean;
  disabled?: boolean;
  tooltip?: string;
  tooltipAlign?: "center" | "right" | "left";
  theme: PluginTheme;
  onPress(): void;
}

export function IconPillButton({
  icon,
  label,
  size = 24,
  iconSize = 13,
  active = false,
  disabled = false,
  tooltip,
  tooltipAlign = "center",
  theme,
  onPress,
}: IconPillButtonProps) {
  const [hovered, setHovered] = useState(false);
  const bgColor = active
    ? theme.colors.surface2
    : hovered
      ? theme.colors.surface2
      : "transparent";
  const fgColor = active ? theme.colors.accent : hovered ? theme.colors.foreground : theme.colors.foregroundMuted;

  return (
    <View style={{ position: "relative" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tooltip ?? label ?? icon}
        disabled={disabled}
        onPress={() => {
          setHovered(false);
          onPress();
        }}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={{
          minWidth: size,
          height: size,
          paddingHorizontal: label ? 7 : 0,
          borderRadius: label ? 7 : 999,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          backgroundColor: bgColor,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Icon name={icon} size={iconSize} color={fgColor} />
        {label ? (
          <Text style={{ fontSize: 11, fontWeight: "500", color: fgColor }}>{label}</Text>
        ) : null}
      </Pressable>

      {hovered && tooltip && !disabled ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: size + 6,
            ...(tooltipAlign === "right"
              ? { right: 0 }
              : tooltipAlign === "left"
                ? { left: 0 }
                : { left: -32, right: -32, alignItems: "center" }),
            zIndex: 90,
          }}
        >
          <View
            style={{
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              shadowColor: "#000",
              shadowOpacity: 0.1,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ fontSize: 11, fontWeight: "500", color: theme.colors.foreground }}
            >
              {tooltip}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export interface ActionSubItem {
  id: string;
  label: string;
  onPress(): void;
}

export type ActionMenuEntry =
  | {
      kind?: "item";
      id: string;
      icon?: string;
      label: string;
      subtitle?: string;
      active?: boolean;
      onPress(): void;
    }
  | {
      kind: "submenu";
      id: string;
      icon?: string;
      label: string;
      children: readonly ActionSubItem[];
      footerToggle?: {
        label: string;
        subtitle?: string;
        checked: boolean;
        onToggle(): void;
      };
    }
  | { kind: "divider"; id: string };

export interface ActionPopoverMenuProps {
  open: boolean;
  entries: readonly ActionMenuEntry[];
  theme: PluginTheme;
  compact: boolean;
  onClose(): void;
  minWidth?: number;
}

export function ActionPopoverMenu({
  open,
  entries,
  theme,
  compact,
  onClose,
  minWidth = 176,
}: ActionPopoverMenuProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openSubId, setOpenSubId] = useState<string | null>(null);

  if (!open) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 5,
        minWidth,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        paddingVertical: 4,
        shadowColor: "#000",
        shadowOpacity: 0.14,
        shadowRadius: 14,
        elevation: 8,
        zIndex: 85,
      }}
    >
      {entries.map((entry) => {
        if (entry.kind === "divider") {
          return (
            <View
              key={entry.id}
              style={{
                height: 1,
                backgroundColor: theme.colors.border,
                marginVertical: 4,
              }}
            />
          );
        }

        if (entry.kind === "submenu") {
          const isOpen = openSubId === entry.id;
          const isHovered = hoveredId === entry.id || isOpen;
          return (
            <View
              key={entry.id}
              style={{ position: "relative" }}
              onPointerLeave={() => {
                if (!compact && openSubId === entry.id) setOpenSubId(null);
              }}
            >
              <Pressable
                accessibilityRole="button"
                onHoverIn={() => {
                  setHoveredId(entry.id);
                  if (!compact) setOpenSubId(entry.id);
                }}
                onHoverOut={() => {
                  if (hoveredId === entry.id) setHoveredId(null);
                }}
                onPress={() => setOpenSubId(isOpen ? null : entry.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginHorizontal: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: isHovered ? theme.colors.surface2 : "transparent",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {entry.icon ? (
                    <Icon name={entry.icon} size={13} color={theme.colors.foregroundMuted} />
                  ) : null}
                  <Text style={{ fontSize: 12, color: theme.colors.foreground }}>
                    {entry.label}
                  </Text>
                </View>
                <Icon name="ChevronRight" size={12} color={theme.colors.foregroundMuted} />
              </Pressable>

              {isOpen ? (
                <View
                  style={
                    compact
                      ? {
                          marginLeft: 18,
                          marginRight: 6,
                          marginTop: 2,
                          marginBottom: 4,
                          borderLeftWidth: 1,
                          borderLeftColor: theme.colors.border,
                          paddingLeft: 6,
                        }
                      : {
                          position: "absolute",
                          top: -4,
                          right: "100%",
                          marginRight: 4,
                          minWidth: 180,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surface0,
                          paddingVertical: 4,
                          shadowColor: "#000",
                          shadowOpacity: 0.14,
                          shadowRadius: 14,
                          elevation: 9,
                          zIndex: 95,
                        }
                  }
                >
                  {entry.children.map((sub) => {
                    const subHover = hoveredId === sub.id;
                    return (
                      <Pressable
                        key={sub.id}
                        accessibilityRole="button"
                        onHoverIn={() => setHoveredId(sub.id)}
                        onHoverOut={() => {
                          if (hoveredId === sub.id) setHoveredId(null);
                        }}
                        onPress={() => {
                          setOpenSubId(null);
                          onClose();
                          sub.onPress();
                        }}
                        style={{
                          marginHorizontal: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 6,
                          backgroundColor: subHover ? theme.colors.accent : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            color: subHover
                              ? theme.colors.accentForeground
                              : theme.colors.foreground,
                          }}
                        >
                          {sub.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {entry.footerToggle ? (
                    <>
                      <View
                        style={{
                          height: 1,
                          backgroundColor: theme.colors.border,
                          marginVertical: 4,
                        }}
                      />
                      <Pressable
                        accessibilityRole="button"
                        onHoverIn={() => setHoveredId(`${entry.id}-toggle`)}
                        onHoverOut={() => setHoveredId(null)}
                        onPress={entry.footerToggle.onToggle}
                        style={{
                          marginHorizontal: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 6,
                          backgroundColor:
                            hoveredId === `${entry.id}-toggle`
                              ? theme.colors.surface2
                              : "transparent",
                          gap: 2,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <Text style={{ fontSize: 12, color: theme.colors.foreground }}>
                            {entry.footerToggle.label}
                          </Text>
                          {entry.footerToggle.checked ? (
                            <Icon name="Check" size={12} color={theme.colors.accent} />
                          ) : null}
                        </View>
                        {entry.footerToggle.subtitle ? (
                          <Text
                            numberOfLines={1}
                            style={{ fontSize: 10.5, color: theme.colors.foregroundMuted }}
                          >
                            {entry.footerToggle.subtitle}
                          </Text>
                        ) : null}
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        }

        const isHovered = hoveredId === entry.id;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            onHoverIn={() => {
              setHoveredId(entry.id);
              setOpenSubId(null);
            }}
            onHoverOut={() => {
              if (hoveredId === entry.id) setHoveredId(null);
            }}
            onPress={() => {
              setOpenSubId(null);
              onClose();
              entry.onPress();
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginHorizontal: 4,
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: 6,
              backgroundColor: isHovered ? theme.colors.accent : "transparent",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {entry.icon ? (
                <Icon
                  name={entry.icon}
                  size={13}
                  color={isHovered ? theme.colors.accentForeground : theme.colors.foregroundMuted}
                />
              ) : null}
              <Text
                style={{
                  fontSize: 12,
                  color: isHovered ? theme.colors.accentForeground : theme.colors.foreground,
                }}
              >
                {entry.label}
              </Text>
            </View>
            {entry.active ? (
              <Icon
                name="Check"
                size={12}
                color={isHovered ? theme.colors.accentForeground : theme.colors.accent}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
