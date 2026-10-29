import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadsRoute, latestApkName } from "./downloads";

describe("latestApkName", () => {
  it("picks the highest semantic version, not the last name alphabetically", () => {
    expect(
      latestApkName([
        "hark-android-1.9.0.apk",
        "hark-android-1.10.0.apk",
        "hark-android-1.2.2.apk",
      ]),
    ).toBe("hark-android-1.10.0.apk");
  });

  it("ignores pre-releases and unrelated files", () => {
    expect(
      latestApkName(["hark-android-2.0.0-rc1.apk", "notes.txt", "hark-android-1.3.0.apk"]),
    ).toBe("hark-android-1.3.0.apk");
    expect(latestApkName(["notes.txt"])).toBeUndefined();
  });
});

describe("downloadsRoute", () => {
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "hark-downloads-test-"));
    writeFileSync(join(directory, "hark-android-1.2.2.apk"), "old");
    writeFileSync(join(directory, "hark-android-1.3.0.apk"), "new");
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("redirects latest to the newest versioned release", async () => {
    const response = await downloadsRoute(directory).request("/downloads/latest");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/downloads/hark-android-1.3.0.apk");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves files from the downloads directory", async () => {
    const response = await downloadsRoute(directory).request("/downloads/hark-android-1.2.2.apk");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("old");
  });

  it("returns 404 for latest when no release exists", async () => {
    const empty = mkdtempSync(join(tmpdir(), "hark-downloads-empty-"));
    try {
      const response = await downloadsRoute(empty).request("/downloads/latest");
      expect(response.status).toBe(404);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
