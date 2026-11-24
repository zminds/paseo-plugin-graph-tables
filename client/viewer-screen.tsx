import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { ViewCard } from "./view-card";
import { getViewerEntry } from "./viewer-store";

export function FullViewerScreen({ theme, layout, params }: PluginScreenProps) {
  const entry = getViewerEntry(params.id);

  if (!entry) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface0,
          padding: layout.compact ? 16 : 24,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>
          This view is no longer in memory. Re-open it from the chat timeline or Views panel.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 10 : 18 }}
    >
      <ViewCard input={entry.input} theme={theme} compact={layout.compact} isFullScreen />
    </ScrollView>
  );
}
