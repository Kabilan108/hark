import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.OWNER_EMAIL = "owner@example.com";

const authState = vi.hoisted(() => ({ userId: "owner" }));

vi.mock("./auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: {
          id: authState.userId,
          name: "Test user",
          email: `${authState.userId}@example.com`,
          image: null,
        },
      }),
    },
  },
}));

vi.mock("./lib/analytics", () => ({ trackUserActive: () => undefined }));

let requestSession: () => Promise<Response>;
let requestWithToken: (token: string) => Promise<Response>;
const OWNER_TOKEN = `hark_${"a".repeat(43)}`;
const INTRUDER_TOKEN = `hark_${"b".repeat(43)}`;

beforeAll(async () => {
  const { db } = await import("./db");
  const schema = await import("./db/schema");
  const { runMigrations } = await import("./db/migrate");
  const { hashApiToken } = await import("./lib/token");
  const { requireApiToken, requireAuth } = await import("./middleware");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "owner",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "intruder",
      name: "Intruder",
      email: "intruder@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.account).values([
    {
      id: "owner-account",
      accountId: "owner-google-subject",
      providerId: "google",
      userId: "owner",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "intruder-account",
      accountId: "intruder-google-subject",
      providerId: "google",
      userId: "intruder",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "owner-token",
      userId: "owner",
      name: "Owner token",
      tokenHash: hashApiToken(OWNER_TOKEN),
      prefix: OWNER_TOKEN.slice(0, 13),
      scopes: [],
      createdAt: now,
    },
    {
      id: "intruder-token",
      userId: "intruder",
      name: "Old token",
      tokenHash: hashApiToken(INTRUDER_TOKEN),
      prefix: INTRUDER_TOKEN.slice(0, 13),
      scopes: [],
      createdAt: now,
    },
  ]);

  const sessionApp = new Hono().use("*", requireAuth).get("/", (c) => c.json({ ok: true }));
  const agentApp = new Hono().use("*", requireApiToken).get("/", (c) => c.json({ ok: true }));
  requestSession = () => Promise.resolve(sessionApp.request("/"));
  requestWithToken = (token) =>
    Promise.resolve(
      agentApp.request("/", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
});

beforeEach(() => {
  authState.userId = "owner";
});

describe("private owner middleware", () => {
  it("rejects a stored session for a non-owner user", async () => {
    expect((await requestSession()).status).toBe(200);
    authState.userId = "intruder";
    expect((await requestSession()).status).toBe(401);
  });

  it("rejects an otherwise valid legacy API token owned by a non-owner", async () => {
    expect((await requestWithToken(OWNER_TOKEN)).status).toBe(200);
    expect((await requestWithToken(INTRUDER_TOKEN)).status).toBe(401);
  });
});
