/** #519: resource-dir resolution for compiled binaries.
 *
 * In a `bun build --compile` binary, `import.meta.dir` is the virtual
 * `/$bunfs/root`, so anything resolved off import.meta (static assets,
 * VERSION, CHANGELOG.md) breaks. The desktop bundle ships a `resources/`
 * dir next to the binary holding those files.
 *
 * Resolution order:
 *   1. `TIMEKEEP_RESOURCES` env override, when set (points at the
 *      resources dir itself, holding static/, VERSION, CHANGELOG.md)
 *   2. `<dirname(process.execPath)>/resources/<name>`, when that path
 *      exists (compiled binary; a dev bun install has no resources dir
 *      next to it, so dev runs fall through)
 *   3. `devPath` — the current import.meta-relative path, unchanged
 *      dev/tarball behavior
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Resolve one resource (e.g. "static", "VERSION", "CHANGELOG.md").
 *  `devPath` is the import.meta-relative path used outside compiled runs.
 *  `execPath` is injectable for tests; callers leave it defaulted. */
export function resourcePath(
  name: string,
  devPath: string,
  execPath: string = process.execPath,
): string {
  const env = (process.env.TIMEKEEP_RESOURCES || "").trim();
  if (env) return join(env, name);
  const exeRelative = join(dirname(execPath), "resources", name);
  return existsSync(exeRelative) ? exeRelative : devPath;
}
