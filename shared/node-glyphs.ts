import type { GraphNodeType } from "./view-schema";

export type GlyphFill = "none" | "color";

export interface GlyphShape {
  tag: "path" | "rect" | "ellipse" | "circle" | "polygon" | "text";
  d?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  ry?: number;
  cx?: number;
  cy?: number;
  r?: number;
  points?: string;
  text?: string;
  fill: GlyphFill;
  fontSize?: number;
  italic?: boolean;
}

function n(value: number): number {
  return Math.round(value * 10) / 10;
}

function path(d: string, fill: GlyphFill = "none"): GlyphShape {
  return { tag: "path", d, fill };
}

export function safeGraphImageHref(value: string | undefined): string | null {
  if (!value) return null;
  const href = value.trim();
  if (!href || href.length > 200_000 || /[\s"<>]/.test(href)) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(href)) return href;
  if (/^(?:file:\/\/|\/|\.{1,2}\/)/.test(href)) return href;
  return null;
}

export function nodeGlyphShapes(
  type: GraphNodeType,
  cx: number,
  cy: number,
  label: string,
): GlyphShape[] {
  const x = n(cx);
  const y = n(cy);
  switch (type) {
    case "database":
      return [
        { tag: "ellipse", cx: x, cy: n(y - 3.5), rx: 5, ry: 2.2, fill: "none" },
        path(`M ${n(x - 5)} ${n(y - 3.5)} v 7 c 0 1.2 2.2 2.2 5 2.2 s 5 -1 5 -2.2 v -7`),
        path(`M ${n(x - 5)} ${y} c 0 1.2 2.2 2.2 5 2.2 s 5 -1 5 -2.2`),
      ];
    case "storage":
      return [
        { tag: "rect", x: n(x - 5.5), y: n(y - 5), width: 11, height: 10, rx: 1.5, fill: "none" },
        path(`M ${n(x - 5.5)} ${n(y - 1.2)} h 11`),
        { tag: "circle", cx: n(x + 2.4), cy: n(y + 2.2), r: 1.1, fill: "color" },
      ];
    case "queue":
      return [n(y - 4.5), n(y - 0.5), n(y + 3.5)].map((barY) => ({
        tag: "rect" as const,
        x: n(x - 5),
        y: barY,
        width: 10,
        height: 2.2,
        rx: 1,
        fill: "none" as const,
      }));
    case "file":
      return [
        path(`M ${n(x - 4)} ${n(y - 5.5)} h 5.5 l 2.5 2.5 v 8.5 h -8 z`),
        path(`M ${n(x + 1.2)} ${n(y - 5.5)} v 2.6 h 2.6`),
        path(`M ${n(x - 2)} ${y} h 4 M ${n(x - 2)} ${n(y + 2.8)} h 3`),
      ];
    case "note":
      return [
        path(`M ${n(x - 5)} ${n(y - 5)} h 7 l 3 3 v 7 h -10 z`),
        path(`M ${n(x + 2)} ${n(y - 5)} v 3 h 3`),
      ];
    case "function":
      return [{ tag: "text", x, y: n(y + 3.5), text: "</>", fill: "color", fontSize: 8.5 }];
    case "service":
      return [
        path(`M ${n(x - 5.5)} ${n(y - 2.2)} h 7.2 l 2.2 2.2 l -2.2 2.2 h -7.2 l -2.2 -2.2 z`),
        { tag: "circle", cx: n(x - 2.2), cy: y, r: 0.9, fill: "color" },
      ];
    case "worker":
      return [
        { tag: "rect", x: n(x - 3.8), y: n(y - 3.8), width: 7.6, height: 7.6, rx: 1.2, fill: "none" },
        path(`M ${n(x - 6)} ${y} h 2.2 M ${n(x + 3.8)} ${y} h 2.2 M ${x} ${n(y - 6)} v 2.2 M ${x} ${n(y + 3.8)} v 2.2`),
        { tag: "circle", cx: x, cy: y, r: 1.1, fill: "color" },
      ];
    case "decision":
      return [
        {
          tag: "polygon",
          points: `${x},${n(y - 5.5)} ${n(x + 5.5)},${y} ${x},${n(y + 5.5)} ${n(x - 5.5)},${y}`,
          fill: "none",
        },
      ];
    case "metric":
      return [path(`M ${n(x - 5.5)} ${n(y + 2)} l 3 -3.5 l 2.5 2 l 4.5 -5`)];
    case "external":
      return [
        { tag: "circle", cx: x, cy: y, r: 5, fill: "none" },
        path(`M ${n(x - 5)} ${y} h 10 M ${x} ${n(y - 5)} c 2 2 2 8 0 10 M ${x} ${n(y - 5)} c -2 2 -2 8 0 10`),
      ];
    case "client":
      return [
        { tag: "rect", x: n(x - 5.5), y: n(y - 4.5), width: 11, height: 7.2, rx: 1.2, fill: "none" },
        path(`M ${n(x - 1.6)} ${n(y + 2.7)} h 3.2 M ${x} ${n(y + 2.7)} v 2.2 M ${n(x - 2.2)} ${n(y + 4.9)} h 4.4`),
      ];
    case "actor":
      return [
        { tag: "circle", cx: x, cy: n(y - 2.6), r: 2.2, fill: "none" },
        path(`M ${n(x - 4.8)} ${n(y + 4.6)} c 0.6 -3 2.4 -4.2 4.8 -4.2 s 4.2 1.2 4.8 4.2`),
      ];
    case "person":
      return [
        {
          tag: "text",
          x,
          y: n(y + 4),
          text: (label.trim().charAt(0) || "P").toUpperCase(),
          fill: "color",
          fontSize: 12,
        },
      ];
    case "task":
      return [
        { tag: "rect", x: n(x - 5), y: n(y - 5), width: 10, height: 10, rx: 1.6, fill: "none" },
        path(`M ${n(x - 2.4)} ${n(y + 0.2)} l 1.8 1.8 l 3.4 -3.8`),
      ];
    case "milestone":
      return [path(`M ${n(x - 1)} ${n(y - 6)} v 12 M ${n(x - 1)} ${n(y - 6)} h 6.5 l -2 2.4 l 2 2.4 h -6.5`)];
    case "image":
      return [
        { tag: "rect", x: n(x - 5.5), y: n(y - 4.5), width: 11, height: 9, rx: 1.2, fill: "none" },
        { tag: "circle", cx: n(x - 2.4), cy: n(y - 1.6), r: 1, fill: "color" },
        path(`M ${n(x - 5.5)} ${n(y + 2.6)} l 3.2 -2.8 l 2 1.6 l 2.2 -2.4 l 3.6 3.6`),
      ];
    case "group":
      return [
        path(
          `M ${n(x - 5)} ${n(y - 2)} v -3 h 3 M ${n(x + 2)} ${n(y - 5)} h 3 v 3 M ${n(x + 5)} ${n(y + 2)} v 3 h -3 M ${n(x - 2)} ${n(y + 5)} h -3 v -3`,
        ),
      ];
  }
}

export function glyphSignature(type: GraphNodeType): string {
  return nodeGlyphShapes(type, 0, 0, "A")
    .map((shape) => `${shape.tag}:${shape.d ?? shape.points ?? shape.text ?? shape.width ?? ""}:${shape.fill}`)
    .join("|");
}

function attr(name: string, value: string | number | undefined): string {
  return value === undefined ? "" : ` ${name}="${value}"`;
}

function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function glyphShapesToSvg(shapes: readonly GlyphShape[], color: string): string {
  return shapes
    .map((shape) => {
      const fill = shape.fill === "color" ? color : "none";
      const stroke = shape.fill === "color" || shape.tag === "text" ? "none" : color;
      const common =
        `${attr("fill", fill)}${attr("stroke", stroke)}` +
        (shape.tag === "text" ? "" : ` stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`);
      if (shape.tag === "text") {
        const style = shape.italic ? ` font-style="italic"` : "";
        return `<text${attr("x", shape.x)}${attr("y", shape.y)} text-anchor="middle"${attr("font-size", shape.fontSize ?? 11)} font-weight="700"${style}${common}>${xmlText(shape.text ?? "")}</text>`;
      }
      if (shape.tag === "path") return `<path${attr("d", shape.d)}${common}/>`;
      if (shape.tag === "rect") {
        return `<rect${attr("x", shape.x)}${attr("y", shape.y)}${attr("width", shape.width)}${attr("height", shape.height)}${attr("rx", shape.rx)}${common}/>`;
      }
      if (shape.tag === "ellipse") {
        return `<ellipse${attr("cx", shape.cx)}${attr("cy", shape.cy)}${attr("rx", shape.rx)}${attr("ry", shape.ry)}${common}/>`;
      }
      if (shape.tag === "circle") {
        return `<circle${attr("cx", shape.cx)}${attr("cy", shape.cy)}${attr("r", shape.r)}${common}/>`;
      }
      return `<polygon${attr("points", shape.points)}${common}/>`;
    })
    .join("");
}

export function nodeGlyphSvg(type: GraphNodeType, color: string, label: string): string {
  return `<svg viewBox="0 0 16 16">${glyphShapesToSvg(nodeGlyphShapes(type, 8, 8, label), color)}</svg>`;
}
