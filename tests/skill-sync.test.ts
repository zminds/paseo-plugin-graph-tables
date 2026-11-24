import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDefaultSkillRoots,
  getPluginSkillStatus,
  removePluginSkill,
  syncPluginSkill,
} from "../server/skill-sync";
import { SKILL_MARKDOWN, SKILL_NAME } from "../shared/skill-content";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-gt-skill-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("global SKILL.md auto-sync", () => {
  it("keeps bundled SKILL_MARKDOWN identical to repository SKILL.md", async () => {
    const repoSkill = await readFile(path.resolve(__dirname, "../SKILL.md"), "utf8");
    expect(SKILL_MARKDOWN).toBe(repoSkill);
    expect(repoSkill).toContain("https://github.com/beluga-labs/beluga");
  });

  it("targets ~/.agents/skills, ~/.claude/skills, and ~/.gemini/config/skills by default", () => {
    expect(getDefaultSkillRoots("/home/tester")).toEqual([
      "/home/tester/.agents/skills",
      "/home/tester/.claude/skills",
      "/home/tester/.gemini/config/skills",
    ]);
  });

  it("installs managed SKILL.md while preserving symlinks and user-modified files", async () => {
    const root = await makeTempDir();
    const freshRoot = path.join(root, "fresh");
    const linkedRoot = path.join(root, "linked");
    const customRoot = path.join(root, "custom");

    // Set up symlink in linkedRoot
    const externalTarget = path.join(root, "external-skill.md");
    await writeFile(externalTarget, "external symlink target", "utf8");
    await mkdir(path.join(linkedRoot, SKILL_NAME), { recursive: true });
    await symlink(externalTarget, path.join(linkedRoot, SKILL_NAME, "SKILL.md"));

    // Set up unmanaged custom SKILL.md in customRoot
    await mkdir(path.join(customRoot, SKILL_NAME), { recursive: true });
    await writeFile(path.join(customRoot, SKILL_NAME, "SKILL.md"), "user custom skill", "utf8");

    const roots = [freshRoot, linkedRoot, customRoot];
    const initial = await getPluginSkillStatus({ roots });
    expect(initial.map((r) => r.status)).toEqual(["missing", "linked", "user-modified"]);

    const synced = await syncPluginSkill({ roots });
    expect(synced.map((r) => r.status)).toEqual(["installed", "linked", "user-modified"]);

    expect(await readFile(path.join(freshRoot, SKILL_NAME, "SKILL.md"), "utf8")).toBe(
      SKILL_MARKDOWN,
    );
    expect(
      (await lstat(path.join(linkedRoot, SKILL_NAME, "SKILL.md"))).isSymbolicLink(),
    ).toBe(true);
    expect(await readFile(externalTarget, "utf8")).toBe("external symlink target");
    expect(await readFile(path.join(customRoot, SKILL_NAME, "SKILL.md"), "utf8")).toBe(
      "user custom skill",
    );

    // Removal cleans up managed install but preserves linked + user-modified
    const removed = await removePluginSkill({ roots });
    expect(removed.map((r) => r.status)).toEqual(["missing", "linked", "user-modified"]);
    await expect(readFile(path.join(freshRoot, SKILL_NAME, "SKILL.md"), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(customRoot, SKILL_NAME, "SKILL.md"), "utf8")).toBe(
      "user custom skill",
    );
  });
});
