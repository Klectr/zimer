import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { resourcePath } from "./paths.ts";

const STATIC_DIR = resourcePath("static", resolve(import.meta.dir, "../static"));
const versions = new Map<string, { key: string; version: string }>();

export function servedVersion(path: string): string {
  let st;
  try {
    st = statSync(path, { bigint: true });
  } catch {
    return "";
  }
  const key = `${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  const hit = versions.get(path);
  if (hit && hit.key === key) return hit.version;
  let version = "";
  try {
    version = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
  } catch {
    version = "";
  }
  versions.set(path, { key, version });
  return version;
}

export function assetVersion(name: string): string {
  return servedVersion(join(STATIC_DIR, name));
}

export function staticUrl(name: string): string {
  const v = assetVersion(name);
  return v ? `/static/${name}?v=${v}` : `/static/${name}`;
}
