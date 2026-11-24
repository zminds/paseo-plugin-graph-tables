import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { memo, useMemo, useRef } from "react";
import {
  Image,
  PanResponder,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import type { GraphLayoutResult, PositionedEdge } from "../shared/graph-layout";
import { type GraphViewTransform, zoomAroundPoint } from "../shared/graph-viewport";
import { nodeGlyphSvg, safeGraphImageHref } from "../shared/node-glyphs";
import { visualTextUnits } from "../shared/query-engine";

interface GraphContentProps {
  layout: GraphLayoutResult;
  theme: PluginTheme;
  selectedNodeId: string | null;
  focusedIds: ReadonlySet<string> | null;
  onSelectNode(id: string | null): void;
}

interface NativeGraphProps extends GraphContentProps {
  height: number;
  expanded: boolean;
  transform: GraphViewTransform;
  onLayout(event: LayoutChangeEvent): void;
  onTransformChange(transform: GraphViewTransform): void;
}

function edgeDrawing({ svgPath, routePoints, edge, isBackEdge }: PositionedEdge) {
  const end = routePoints[routePoints.length - 1];
  const beforeEnd = routePoints[routePoints.length - 2];
  if (!end || !beforeEnd) return null;

  const dx = end.x - beforeEnd.x;
  const dy = end.y - beforeEnd.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  const ux = dx / length;
  const uy = dy / length;
  const tipX = end.x - ux;
  const tipY = end.y - uy;
  const baseX = tipX - ux * 8;
  const baseY = tipY - uy * 8;
  const arrow = `M ${tipX} ${tipY} L ${baseX - uy * 3.5} ${baseY + ux * 3.5} L ${baseX + uy * 3.5} ${baseY - ux * 3.5} Z`;
  const xs = routePoints.map(({ x }) => x);
  const ys = routePoints.map(({ y }) => y);
  const x = Math.min(...xs) - 10;
  const y = Math.min(...ys) - 10;
  const size = Math.max(Math.max(...xs) - x, Math.max(...ys) - y) + 10;
  const dash =
    isBackEdge || edge.kind === "async" || edge.kind === "depends" ? ' stroke-dasharray="5 4"' : "";
  // Paseo's Icon draws SVG at a square size, so match the viewBox to keep graph coordinates at 1:1.
  const svg = `<svg viewBox="${x} ${y} ${size} ${size}"><path d="${svgPath}" fill="none" stroke="currentColor" stroke-width="1.8"${dash}/><path d="${arrow}" fill="currentColor"/></svg>`;
  return { x, y, size, icon: { svg } };
}

const NativeGraphContent = memo(function NativeGraphContent({
  layout,
  theme,
  selectedNodeId,
  focusedIds,
  onSelectNode,
}: GraphContentProps) {
  const { colors } = theme;
  const focus = focusedIds?.size ? new Set(focusedIds) : null;
  for (const { node, memberIds } of layout.groups) {
    if (focus?.has(node.id)) {
      for (const id of memberIds) focus.add(id);
    }
  }
  const subjectIds = focus ?? (selectedNodeId ? new Set([selectedNodeId]) : null);
  const edgeDrawings = useMemo(() => layout.edges.map(edgeDrawing), [layout.edges]);
  const statusColors = {
    done: colors.statusSuccess,
    active: colors.accent,
    review: colors.accent,
    blocked: colors.statusWarning,
    failed: colors.statusDanger,
    todo: colors.foregroundMuted,
    idle: colors.foregroundMuted,
  };

  return (
    <>
      {layout.groups.map(({ node, x, y, width, height, memberIds }) => {
        const highlighted = Boolean(
          subjectIds?.has(node.id) || memberIds.some((id) => subjectIds?.has(id)),
        );
        return (
          <View
            key={node.id}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: x,
              top: y,
              width,
              height,
              backgroundColor: colors.surface1,
              borderColor: highlighted ? colors.accent : colors.border,
              borderWidth: 1.5,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingTop: 10,
              opacity: focus && !highlighted ? 0.35 : 1,
            }}
          >
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: "700" }}
            >
              {node.label}
            </Text>
          </View>
        );
      })}
      {layout.edges.map(({ edge, index, labelX, labelY }, i) => {
        const drawing = edgeDrawings[i];
        if (!drawing) return null;
        const fromActive = subjectIds?.has(edge.from) ?? false;
        const toActive = subjectIds?.has(edge.to) ?? false;
        const highlighted = focus ? fromActive && toActive : fromActive || toActive;
        const color =
          edge.kind === "blocks"
            ? colors.statusDanger
            : highlighted
              ? colors.accent
              : colors.foregroundMuted;
        const labelWidth = Math.min(
          184,
          Math.max(28, visualTextUnits(edge.label ?? "") * 6.5 + 14),
        );
        return (
          <View
            key={index}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              opacity: subjectIds && !highlighted ? (fromActive || toActive ? 0.55 : 0.22) : 1,
            }}
          >
            <View style={{ position: "absolute", left: drawing.x, top: drawing.y }}>
              <Icon icon={drawing.icon} size={drawing.size} color={color} />
            </View>
            {edge.label ? (
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                style={{
                  position: "absolute",
                  left: labelX - labelWidth / 2,
                  top: labelY - 10,
                  width: labelWidth,
                  textAlign: "center",
                  fontSize: 11,
                  lineHeight: 19,
                  height: 20,
                  color,
                  backgroundColor: colors.surface0,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {edge.label}
              </Text>
            ) : null}
          </View>
        );
      })}
      {layout.nodes.map(({ node, x, y, width, height }) => {
        const selected = selectedNodeId === node.id;
        const focused = focus?.has(node.id) ?? false;
        return (
          <Pressable
            key={node.id}
            accessibilityRole="button"
            accessibilityLabel={node.label}
            accessibilityState={{ selected }}
            onPress={() => onSelectNode(selected ? null : node.id)}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width,
              height,
              borderRadius: 11,
              borderWidth: selected || focused ? 2 : 1.2,
              borderColor: selected || focused || node.emphasis ? colors.accent : colors.border,
              backgroundColor: selected || focused ? colors.surface2 : colors.surface0,
              opacity: focus && !focused && !selected ? 0.4 : 1,
              justifyContent: "flex-start",
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon
                icon={{ svg: nodeGlyphSvg(node.type, colors.accent, node.label) }}
                size={16}
                color={colors.accent}
              />
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "700" }}
              >
                {node.label}
              </Text>
              {node.status ? (
                <View
                  style={{
                    height: 8,
                    width: 8,
                    borderRadius: 4,
                    backgroundColor: statusColors[node.status],
                  }}
                />
              ) : null}
            </View>
            {node.sublabel ? (
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                style={{ color: colors.foregroundMuted, fontSize: 12 }}
              >
                {node.sublabel}
              </Text>
            ) : null}
            {node.value !== undefined ? (
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                style={{ color: colors.accent, fontSize: 15, fontWeight: "700" }}
              >
                {String(node.value)}
              </Text>
            ) : null}
            {safeGraphImageHref(node.image) ? (
              <Image
                source={{ uri: safeGraphImageHref(node.image)! }}
                resizeMode="cover"
                style={{ height: 40, marginTop: 6, borderRadius: 6, width: "100%" }}
              />
            ) : null}
            {(node.fields ?? []).slice(0, 6).map((field) => (
              <Text
                key={`${field.key ?? ""}-${field.name}`}
                numberOfLines={1}
                allowFontScaling={false}
                style={{ color: colors.foregroundMuted, fontSize: 11 }}
              >
                {`${field.key ? `${field.key.toUpperCase()} ` : ""}${field.name}${field.type ? `: ${field.type}` : ""}`}
              </Text>
            ))}
            {(node.items ?? []).slice(0, 6).map((item) => (
              <Text
                key={item.label}
                numberOfLines={1}
                allowFontScaling={false}
                style={{ color: colors.foregroundMuted, fontSize: 11 }}
              >
                {`${item.status === "done" ? "✓" : item.status === "failed" ? "✕" : "•"} ${item.label}`}
              </Text>
            ))}
          </Pressable>
        );
      })}
    </>
  );
});

function readGesture({ nativeEvent }: GestureResponderEvent) {
  const [first, second] = nativeEvent.touches;
  if (!first) return null;
  return second
    ? {
        x: (first.pageX + second.pageX) / 2,
        y: (first.pageY + second.pageY) / 2,
        spread: Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY),
      }
    : { x: first.pageX, y: first.pageY, spread: 0 };
}

export function NativeGraph({
  height,
  expanded,
  transform,
  onLayout,
  onTransformChange,
  ...content
}: NativeGraphProps) {
  const viewport = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const previous = useRef<ReturnType<typeof readGesture>>(null);
  const current = useRef(transform);
  current.current = transform;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponderCapture: (event, gesture) =>
          event.nativeEvent.touches.length >= 2 ||
          (expanded && Math.hypot(gesture.dx, gesture.dy) >= 6),
        onPanResponderGrant: (event) => {
          previous.current = readGesture(event);
          viewport.current?.measure((_x, _y, _width, _height, pageX, pageY) => {
            origin.current = { x: pageX, y: pageY };
          });
        },
        onPanResponderStart: (event) => {
          previous.current = readGesture(event);
        },
        onPanResponderMove: (event) => {
          const before = previous.current;
          const next = readGesture(event);
          previous.current = next;
          if (
            !before ||
            !next ||
            Boolean(before.spread) !== Boolean(next.spread) ||
            (!expanded && !next.spread)
          )
            return;
          const zoomed =
            next.spread && before.spread
              ? zoomAroundPoint(
                  current.current,
                  next.spread / before.spread,
                  before.x - origin.current.x,
                  before.y - origin.current.y,
                )
              : current.current;
          current.current = {
            ...zoomed,
            x: zoomed.x + next.x - before.x,
            y: zoomed.y + next.y - before.y,
          };
          onTransformChange(current.current);
        },
        onPanResponderRelease: () => {
          previous.current = null;
        },
        onPanResponderTerminate: () => {
          previous.current = null;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [expanded, onTransformChange],
  );

  return (
    <View
      ref={viewport}
      collapsable={false}
      onLayout={onLayout}
      {...responder.panHandlers}
      style={{
        width: "100%",
        height,
        overflow: "hidden",
        backgroundColor: content.theme.colors.surface0,
      }}
    >
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: transform.x,
          top: transform.y,
          width: content.layout.width,
          height: content.layout.height,
          transformOrigin: "top left",
          transform: [{ scale: transform.scale }],
        }}
      >
        <NativeGraphContent {...content} />
      </View>
    </View>
  );
}
