import { beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.OWNER_EMAIL = "owner@example.com";

let handleAuthRequest: typeof import("./auth")["handleAuthRequest"];

beforeAll(async () => {
  const { runMigrations } = await import("./db/migrate");
  runMigrations();
  ({ handleAuthRequest } = await import("./auth"));
});

describe("private Better Auth routes", () => {
  it("keeps anonymous session checks compatible with Better Auth clients", async () => {
    const response = await handleAuthRequest(
      new Request("http://localhost:5173/api/auth/get-session"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("rejects account endpoints without an authorized owner session", async () => {
    const response = await handleAuthRequest(
      new Request("http://localhost:5173/api/auth/delete-user", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not expose an Apple OAuth callback", async () => {
    const response = await handleAuthRequest(
      new Request("http://localhost:5173/api/auth/callback/apple"),
    );
    expect(response.status).toBe(401);
  });
});
