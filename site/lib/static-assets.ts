import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { resourcePath } from "./paths.ts";

const STATIC_DIR = resourcePath("static", resolve(import.meta.dir, "../static"));
const versions = new Map<string, { size: number; mtime: number; version: string }>();

export function servedVersion(path: string, size: number, mtime: number): string {
  const hit = versions.get(path);
  if (hit && hit.size === size && hit.mtime === mtime) return hit.version;
  let version = "";
  try {
    version = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
  } catch {
    version = "";
  }
  versions.set(path, { size, mtime, version });
  return version;
}

export function assetVersion(name: string): string {
  const path = join(STATIC_DIR, name);
  try {
    const st = statSync(path);
    return servedVersion(path, st.size, Math.floor(st.mtimeMs));
  } catch {
    return "";
  }
}

export function staticUrl(name: string): string {
  const v = assetVersion(name);
  return v ? `/static/${name}?v=${v}` : `/static/${name}`;
}
