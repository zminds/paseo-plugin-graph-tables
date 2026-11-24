import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { Icon, Markdown, Modal, StreamedText } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { DataRow } from "../shared/query-engine";
import { pluginSettings } from "../shared/settings";
import type { ColumnSpec, ViewSpec } from "../shared/view-schema";
import type {
  dataViewSegmentSchema,
  markdownSegmentSchema,
  toolBadgeSchema,
} from "./timeline-transform";
import { ViewCard } from "./view-card";

type MarkdownSegmentData = z.output<typeof markdownSegmentSchema>;
type DataViewSegmentData = z.output<typeof dataViewSegmentSchema>;
type ToolBadgeData = z.output<typeof toolBadgeSchema>;

export function MarkdownSegmentRenderer({
  item,
}: PluginTimelineItemProps<MarkdownSegmentData>) {
  const { text, phase, isTail } = item.data;
  if (!text.trim()) return null;
  if (phase === "streaming" && isTail) {
    return <StreamedText text={text} phase="streaming" />;
  }
  return <Markdown>{text}</Markdown>;
}

function GfmTableRenderer({
  rawMarkdown,
  columns,
  rows,
  theme,
  compact,
}: {
  rawMarkdown: string;
  columns: ColumnSpec[];
  rows: DataRow[];
  theme: PluginTimelineItemProps["theme"];
  compact: boolean;
}) {
  const settings = useSettings(pluginSettings);
  const upgradeTables =
    settings.status === "ready" ? settings.values.upgradeMarkdownTables : true;

  if (!upgradeTables) {
    return <Markdown>{rawMarkdown}</Markdown>;
  }
  return (
    <ViewCard
      input={{
        kind: "gfm-table",
        columns,
        rows,
      }}
      theme={theme}
      compact={compact}
    />
  );
}

export function DataViewRenderer({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<DataViewSegmentData>) {
  const data = item.data;

  if (data.mode === "streaming") {
    return (
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          padding: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginVertical: 4,
        }}
      >
        <Icon name="ChartNoAxesColumn" size={15} color={theme.colors.accent} />
        <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>
          Building {data.fenceKind.endsWith("graph") ? "diagram" : "data view"}...
        </Text>
      </View>
    );
  }

  if (data.mode === "invalid") {
    return (
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.statusDanger,
          backgroundColor: theme.colors.surface1,
          padding: 12,
          gap: 6,
          marginVertical: 4,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.statusDanger }}>
          Invalid view specification: {data.error}
        </Text>
        <Text
          selectable
          style={{ fontSize: 11.5, fontFamily: "monospace", color: theme.colors.foregroundMuted }}
        >
          {data.raw}
        </Text>
      </View>
    );
  }

  if (data.mode === "gfm-table") {
    return (
      <GfmTableRenderer
        rawMarkdown={data.rawMarkdown}
        columns={data.columns as unknown as ColumnSpec[]}
        rows={data.rows as DataRow[]}
        theme={theme}
        compact={layout.compact}
      />
    );
  }

  if (data.mode === "token") {
    return (
      <ViewCard
        input={{ kind: "token", viewId: data.viewId }}
        theme={theme}
        compact={layout.compact}
      />
    );
  }

  return (
    <ViewCard
      input={{ kind: "inline", spec: data.spec as unknown as ViewSpec }}
      theme={theme}
      compact={layout.compact}
    />
  );
}

export function ToolBadgeRenderer({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<ToolBadgeData>) {
  const [modalOpen, setModalOpen] = useState(false);
  const { status, viewId, title, viewType, rowCount, error } = item.data;

  const styles = useMemo(
    () => ({
      pill: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor:
          status === "failed" ? theme.colors.statusDanger : theme.colors.border,
        backgroundColor: theme.colors.surface1,
        marginVertical: 2,
      },
      left: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      text: {
        fontSize: 12,
        color:
          status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted,
        flexShrink: 1,
      },
      openBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      openText: {
        fontSize: 11.5,
        fontWeight: "600" as const,
        color: theme.colors.foreground,
      },
    }),
    [theme, status],
  );

  const label =
    status === "running"
      ? "Preparing view..."
      : status === "failed"
        ? `View failed${error ? `: ${error}` : ""}`
        : status === "canceled"
          ? "View canceled"
          : `${title ? `"${title}"` : viewType ?? "View"}${rowCount !== undefined ? ` (${rowCount} rows)` : ""}`;

  return (
    <View>
      <View style={styles.pill}>
        <View style={styles.left}>
          <Icon
            name="ChartNoAxesColumn"
            size={14}
            color={status === "failed" ? theme.colors.statusDanger : theme.colors.accent}
          />
          <Text numberOfLines={1} style={styles.text}>
            {label}
          </Text>
        </View>
        {viewId && status === "completed" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setModalOpen(true)}
            style={styles.openBtn}
          >
            <Text style={styles.openText}>Open view</Text>
          </Pressable>
        ) : null}
      </View>

      {viewId ? (
        <Modal
          title={title ?? "View preview"}
          icon={<Icon name="ChartNoAxesColumn" size={16} color={theme.colors.foreground} />}
          open={modalOpen}
          onOpenChange={setModalOpen}
        >
          <Modal.Content style={{ backgroundColor: theme.colors.surface1 }}>
            <ViewCard
              input={{ kind: "token", viewId }}
              theme={theme}
              compact={layout.compact}
            />
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}
