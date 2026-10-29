import { readdirSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const RELEASE_APK = /^hark-android-(\d+)\.(\d+)\.(\d+)\.apk$/;

/** Newest stable release by semantic version; pre-release and other files are ignored. */
export function latestApkName(names: readonly string[]): string | undefined {
  let latest: { name: string; version: number[] } | undefined;
  for (const name of names) {
    const match = RELEASE_APK.exec(name);
    if (!match) continue;
    const version = match.slice(1).map(Number);
    if (!latest || compareVersions(version, latest.version) > 0) latest = { name, version };
  }
  return latest?.name;
}

function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Serves published APKs from a directory outside the build output, so releases
 * survive redeploys of a read-only package. `/downloads/latest` always redirects
 * to the newest release, keeping its versioned filename for the installer.
 */
export function downloadsRoute(directory: string): Hono {
  const route = new Hono();
  route.get("/downloads/latest", (c) => {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      names = [];
    }
    const latest = latestApkName(names);
    if (!latest) return c.notFound();
    c.header("Cache-Control", "no-store");
    return c.redirect(`/downloads/${latest}`, 302);
  });
  route.use(
    "/downloads/*",
    serveStatic({
      root: directory,
      rewriteRequestPath: (path) => path.replace(/^\/downloads/, ""),
    }),
  );
  return route;
}
