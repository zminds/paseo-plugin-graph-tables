/**
 * Global Agent SKILL.md synchronizer inspired by Paseo's orchestration-skills mechanism
 * and carrying the visualization skill derived from Beluga (https://github.com/beluga-labs/beluga).
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SKILL_MARKDOWN, SKILL_NAME } from "../shared/skill-content";

const MANAGED_MANIFEST = ".paseo-plugin-managed.json";

export type SkillTargetStatusValue =
  | "installed"
  | "linked"
  | "missing"
  | "user-modified"
  | "error";

export interface SkillTargetStatus {
  root: string;
  skillPath: string;
  status: SkillTargetStatusValue;
  error: string | null;
}

interface ManagedManifest {
  version: 1;
  sha256: string;
}

export interface SkillSyncOptions {
  roots?: readonly string[];
  homeDir?: string;
}

export function getDefaultSkillRoots(homeDir = os.homedir()): string[] {
  return [
    path.join(homeDir, ".agents", "skills"),
    path.join(homeDir, ".claude", "skills"),
    path.join(homeDir, ".gemini", "config", "skills"),
  ];
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function safeLstat(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch {
    return null;
  }
}

async function readManagedManifest(manifestPath: string): Promise<ManagedManifest | null> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManagedManifest>;
    if (parsed.version === 1 && typeof parsed.sha256 === "string" && parsed.sha256.length > 0) {
      return { version: 1, sha256: parsed.sha256 };
    }
    return null;
  } catch {
    return null;
  }
}

async function inspectTarget(root: string): Promise<{
  skillDir: string;
  skillFile: string;
  manifestFile: string;
  isLinked: boolean;
  existingContent: string | null;
  manifest: ManagedManifest | null;
}> {
  const skillDir = path.join(root, SKILL_NAME);
  const skillFile = path.join(skillDir, "SKILL.md");
  const manifestFile = path.join(skillDir, MANAGED_MANIFEST);

  const [dirStat, fileStat] = await Promise.all([safeLstat(skillDir), safeLstat(skillFile)]);
  const isLinked = Boolean(dirStat?.isSymbolicLink() || fileStat?.isSymbolicLink());
  if (isLinked) {
    return {
      skillDir,
      skillFile,
      manifestFile,
      isLinked: true,
      existingContent: null,
      manifest: null,
    };
  }

  const [existingContent, manifest] = await Promise.all([
    fileStat?.isFile() ? readFile(skillFile, "utf8").catch(() => null) : Promise.resolve(null),
    readManagedManifest(manifestFile),
  ]);

  return {
    skillDir,
    skillFile,
    manifestFile,
    isLinked: false,
    existingContent,
    manifest,
  };
}

export async function getPluginSkillStatus(
  options?: SkillSyncOptions,
): Promise<SkillTargetStatus[]> {
  const roots = options?.roots ?? getDefaultSkillRoots(options?.homeDir);
  return Promise.all(
    roots.map(async (root): Promise<SkillTargetStatus> => {
      try {
        const info = await inspectTarget(root);
        if (info.isLinked) {
          return { root, skillPath: info.skillFile, status: "linked", error: null };
        }
        if (info.existingContent === null) {
          return { root, skillPath: info.skillFile, status: "missing", error: null };
        }
        if (info.manifest && info.manifest.sha256 === sha256(info.existingContent)) {
          return { root, skillPath: info.skillFile, status: "installed", error: null };
        }
        return { root, skillPath: info.skillFile, status: "user-modified", error: null };
      } catch (error) {
        return {
          root,
          skillPath: path.join(root, SKILL_NAME, "SKILL.md"),
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export async function syncPluginSkill(
  options?: SkillSyncOptions,
): Promise<SkillTargetStatus[]> {
  const roots = options?.roots ?? getDefaultSkillRoots(options?.homeDir);
  const desiredHash = sha256(SKILL_MARKDOWN);

  return Promise.all(
    roots.map(async (root): Promise<SkillTargetStatus> => {
      try {
        const info = await inspectTarget(root);
        if (info.isLinked) {
          return { root, skillPath: info.skillFile, status: "linked", error: null };
        }

        if (info.existingContent !== null) {
          const currentHash = sha256(info.existingContent);
          if (!info.manifest || info.manifest.sha256 !== currentHash) {
            return { root, skillPath: info.skillFile, status: "user-modified", error: null };
          }
          if (currentHash === desiredHash) {
            return { root, skillPath: info.skillFile, status: "installed", error: null };
          }
        }

        await mkdir(info.skillDir, { recursive: true });
        await writeFile(info.skillFile, SKILL_MARKDOWN, "utf8");
        const nextManifest: ManagedManifest = { version: 1, sha256: desiredHash };
        await writeFile(info.manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

        return { root, skillPath: info.skillFile, status: "installed", error: null };
      } catch (error) {
        return {
          root,
          skillPath: path.join(root, SKILL_NAME, "SKILL.md"),
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export async function removePluginSkill(
  options?: SkillSyncOptions,
): Promise<SkillTargetStatus[]> {
  const roots = options?.roots ?? getDefaultSkillRoots(options?.homeDir);

  return Promise.all(
    roots.map(async (root): Promise<SkillTargetStatus> => {
      try {
        const info = await inspectTarget(root);
        if (info.isLinked) {
          return { root, skillPath: info.skillFile, status: "linked", error: null };
        }
        if (info.existingContent === null) {
          await rm(info.manifestFile, { force: true }).catch(() => {});
          await rmdir(info.skillDir).catch(() => {});
          return { root, skillPath: info.skillFile, status: "missing", error: null };
        }

        const currentHash = sha256(info.existingContent);
        if (!info.manifest || info.manifest.sha256 !== currentHash) {
          return { root, skillPath: info.skillFile, status: "user-modified", error: null };
        }

        await rm(info.skillFile, { force: true });
        await rm(info.manifestFile, { force: true });
        await rmdir(info.skillDir).catch(() => {});
        return { root, skillPath: info.skillFile, status: "missing", error: null };
      } catch (error) {
        return {
          root,
          skillPath: path.join(root, SKILL_NAME, "SKILL.md"),
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
