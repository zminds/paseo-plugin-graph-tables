import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_POSTGRES_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
];

export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const cleaned = content.replace(/^\uFEFF/, "");
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const line = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    }
    result[key] = value;
  }
  return result;
}

async function readEnvFiles(cwd: string): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const filename of [".env", ".env.local"]) {
    try {
      const content = await readFile(path.join(cwd, filename), "utf8");
      Object.assign(merged, parseDotEnv(content));
    } catch {
      // Missing or unreadable .env files are ignored
    }
  }
  return merged;
}

export async function resolvePostgresUrl(
  cwd: string,
  envKey?: string,
): Promise<{ ok: true; url: string; key: string } | { ok: false; error: string }> {
  const fileEnv = await readEnvFiles(cwd);
  const candidates = envKey ? [envKey] : DEFAULT_POSTGRES_ENV_KEYS;

  for (const key of candidates) {
    const fromFile = fileEnv[key]?.trim();
    if (fromFile) return { ok: true, url: fromFile, key };
    const fromProcess = process.env[key]?.trim();
    if (fromProcess) return { ok: true, url: fromProcess, key };
  }

  return {
    ok: false,
    error: envKey
      ? `Postgres connection variable "${envKey}" was not found in .env, .env.local, or environment.`
      : `No Postgres connection string found (checked ${DEFAULT_POSTGRES_ENV_KEYS.join(", ")} in .env, .env.local, and environment).`,
  };
}

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  let output = text.split(secret).join("[REDACTED]");
  try {
    const parsed = new URL(secret);
    if (parsed.password) {
      output = output.split(parsed.password).join("[REDACTED]");
    }
  } catch {
    // ignore invalid URL
  }
  return output;
}
