import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { execCommand } from "@getpaseo/plugin/server";
import { sanitizeExportFilename } from "../shared/export-format";
import type { exportViewRpc } from "../shared/rpc";
import type { GraphTablesSettings } from "../shared/settings";
import type { ViewStore } from "./view-store";

const MIME_BY_FORMAT: Record<RpcInput<typeof exportViewRpc>["format"], { ext: string; mime: string }> = {
  markdown: { ext: "md", mime: "text/markdown; charset=utf-8" },
  csv: { ext: "csv", mime: "text/csv; charset=utf-8" },
  tsv: { ext: "tsv", mime: "text/tab-separated-values; charset=utf-8" },
  json: { ext: "json", mime: "application/json; charset=utf-8" },
  sql: { ext: "sql", mime: "application/sql; charset=utf-8" },
  svg: { ext: "svg", mime: "image/svg+xml; charset=utf-8" },
  png: { ext: "png", mime: "image/png" },
};

async function resolveExportDirectory(
  rawDir: string,
  store: ViewStore,
  viewId: string | undefined,
): Promise<string> {
  if (rawDir === "workspace") {
    const entry = viewId ? await store.get(viewId) : null;
    if (entry?.cwd) {
      return path.join(entry.cwd, ".paseo-exports");
    }
    return path.join(os.homedir(), "Downloads", "paseo-exports");
  }
  if (rawDir === "~") return os.homedir();
  if (rawDir.startsWith("~/")) return path.join(os.homedir(), rawDir.slice(2));
  return rawDir;
}

async function rasterizeSvgOnDaemon(
  svg: string,
  width: number | undefined,
  height: number | undefined,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "paseo-gt-export-"));
  const svgPath = path.join(tempDir, "export.svg");
  const pngPath = path.join(tempDir, "export.png");
  const targetWidth = Math.min(2400, Math.max(400, (width ?? 800) * 2));
  const targetSize = Math.min(2400, Math.max(width ?? 900, height ?? 600) * 2);

  try {
    await writeFile(svgPath, svg, "utf8");

    const tryTool = async (cmd: string, args: string[], expectedFile: string): Promise<Buffer | null> => {
      try {
        await execCommand(cmd, args, { cwd: tempDir, timeout: 15_000 });
        const buf = await readFile(expectedFile);
        return buf.length > 0 ? buf : null;
      } catch {
        return null;
      }
    };

    const viaRsvg = await tryTool("rsvg-convert", ["-w", String(targetWidth), "-o", pngPath, svgPath], pngPath);
    if (viaRsvg) return { ok: true, bytes: viaRsvg };

    const viaMagick = await tryTool("magick", [svgPath, pngPath], pngPath);
    if (viaMagick) return { ok: true, bytes: viaMagick };

    if (process.platform === "darwin") {
      const viaQl = await tryTool(
        "qlmanage",
        ["-t", "-s", String(targetSize), "-o", tempDir, svgPath],
        path.join(tempDir, "export.svg.png"),
      );
      if (viaQl) return { ok: true, bytes: viaQl };
    }

    return {
      ok: false,
      error: "PNG export failed: no rasterizer available (requires browser canvas, rsvg-convert, magick, or macOS qlmanage).",
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function createExportViewHandler(
  store: ViewStore,
  getSettings: () => GraphTablesSettings,
) {
  return async (
    input: RpcInput<typeof exportViewRpc>,
  ): Promise<RpcOutput<typeof exportViewRpc>> => {
    const meta = MIME_BY_FORMAT[input.format];
    try {
      const settings = getSettings();
      const targetDir = await resolveExportDirectory(settings.exportDirectory, store, input.viewId);
      await mkdir(targetDir, { recursive: true });
      const fileName = sanitizeExportFilename(input.title, meta.ext);
      const outPath = path.join(targetDir, fileName);

      if (input.format === "png") {
        let pngBuffer: Buffer | null = null;
        if (input.pngBase64) {
          const clean = input.pngBase64.replace(/^data:image\/png;base64,/i, "").trim();
          const decoded = Buffer.from(clean, "base64");
          if (decoded.length > 0) pngBuffer = decoded;
        }
        if (!pngBuffer && input.svg) {
          const rasterized = await rasterizeSvgOnDaemon(input.svg, input.width, input.height);
          if (!rasterized.ok) {
            return {
              ok: false,
              filePath: null,
              bytes: 0,
              mimeType: meta.mime,
              error: rasterized.error,
            };
          }
          pngBuffer = rasterized.bytes;
        }
        if (!pngBuffer) {
          return {
            ok: false,
            filePath: null,
            bytes: 0,
            mimeType: meta.mime,
            error: "Missing pngBase64 or svg payload for PNG export.",
          };
        }
        await writeFile(outPath, pngBuffer);
        return {
          ok: true,
          filePath: outPath,
          bytes: pngBuffer.length,
          mimeType: meta.mime,
          error: null,
        };
      }

      const textPayload = input.format === "svg" ? (input.svg ?? input.content) : input.content;
      if (typeof textPayload !== "string" || textPayload.length === 0) {
        return {
          ok: false,
          filePath: null,
          bytes: 0,
          mimeType: meta.mime,
          error: `Missing content for ${input.format} export.`,
        };
      }

      const encoded = Buffer.from(textPayload, "utf8");
      await writeFile(outPath, encoded);
      return {
        ok: true,
        filePath: outPath,
        bytes: encoded.length,
        mimeType: meta.mime,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        filePath: null,
        bytes: 0,
        mimeType: meta.mime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
