import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_inbox" as string | null }));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Inbox User",
                email: "inbox@example.com",
                image: null,
              },
            }
          : null,
    },
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "user_inbox",
      name: "Inbox User",
      email: "inbox@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "user_foreign",
      name: "Foreign User",
      email: "foreign@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values({
    id: "tok_inbox",
    userId: "user_inbox",
    name: "Release agent",
    tokenHash: "token-hash",
    prefix: "hark_inbox",
    scopes: ["notifications:send"],
    createdAt: now,
  });
  await db.insert(schema.project).values({
    id: "prj_inbox",
    userId: "user_inbox",
    name: "Inbox project",
    normalizedName: "inbox project",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values([
    {
      id: "svc_inbox",
      userId: "user_inbox",
      title: "Monitor",
      imageUrl: "https://example.com/monitor.png",
      tokenHash: "service-hash",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "svc_foreign",
      userId: "user_foreign",
      title: "Foreign",
      tokenHash: "foreign-service-hash",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const interactionBase = {
    userId: "user_inbox",
    requesterTokenId: "tok_inbox",
    title: "Production deploy",
    prompt: "Deploy version 2.4.1?",
    kind: "approval",
    choices: ["approve", "deny"],
    actionDigest: "a".repeat(64),
    acceptedCount: 1,
    createdAt: new Date(now.getTime() - 1_000),
  };
  await db.insert(schema.interaction).values([
    {
      ...interactionBase,
      id: "int_pending",
      status: "pending",
      imageUrl: "https://example.com/release.png",
      expiresAt: new Date(now.getTime() + 60_000),
    },
    {
      ...interactionBase,
      id: "int_expired",
      projectId: "prj_inbox",
      status: "pending",
      expiresAt: new Date(now.getTime() - 1_000),
    },
    {
      ...interactionBase,
      id: "int_answered",
      projectId: "prj_inbox",
      status: "approved",
      response: "approve",
      respondedAt: new Date(now.getTime() - 500),
      expiresAt: new Date(now.getTime() + 60_000),
    },
  ]);

  await db.insert(schema.event).values([
    ...Array.from({ length: 22 }, (_, index) => ({
      id: `evt_${index}`,
      serviceId: "svc_inbox",
      title: `Notification ${index}`,
      body: "Notification body",
      status: "accepted",
      deliveredCount: 1,
      createdAt: new Date(now.getTime() - 2_000 - index),
    })),
    {
      id: "evt_foreign",
      serviceId: "svc_foreign",
      title: "Foreign notification",
      body: "Must not be returned",
      status: "accepted",
      deliveredCount: 1,
      createdAt: now,
    },
  ]);
  await db.insert(schema.agentNotification).values({
    id: "ntf_inbox",
    userId: "user_inbox",
    requesterTokenId: "tok_inbox",
    projectId: "prj_inbox",
    title: "Build passed",
    body: "Integration tests passed",
    acceptedCount: 1,
    createdAt: new Date(now.getTime() - 1_500),
  });
  await db.insert(schema.liveActivity).values({
    id: "act_inbox",
    userId: "user_inbox",
    requesterTokenId: "tok_inbox",
    projectId: "prj_inbox",
    schemaVersion: 1,
    props: {
      schemaVersion: 1,
      activityId: "act_inbox",
      title: "Production deployment",
      status: "Running tests",
      updatedAt: now.toISOString(),
      symbol: "build",
      privacyMode: "standard",
    },
    status: "active",
    sequence: 1,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.liveActivityOperation).values({
    id: "op_inbox",
    activityId: "act_inbox",
    requesterTokenId: "tok_inbox",
    event: "update",
    sequence: 1,
    props: {
      title: "Production deployment",
      status: "Running tests",
    },
    createdAt: new Date(now.getTime() - 750),
  });
});

describe("mobile inbox", () => {
  it("requires a signed-in session", async () => {
    authState.userId = null;
    try {
      expect((await app.request("/api/interactions")).status).toBe(401);
      expect((await app.request("/api/activities")).status).toBe(401);
      expect((await app.request("/api/activity-feed")).status).toBe(401);
    } finally {
      authState.userId = "user_inbox";
    }
  });

  it("lists only the signed-in user's unexpired pending interactions", async () => {
    const response = await app.request("/api/interactions");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      interactions: Array<{
        id: string;
        sourceName: string;
        sourceImageUrl: string | null;
        projectId?: string | null;
      }>;
    };
    expect(body.interactions).toEqual([
      expect.objectContaining({
        id: "int_pending",
        sourceName: "Release agent",
        sourceImageUrl: "https://example.com/release.png",
        projectId: null,
      }),
    ]);
  });

  it("lists active Live Activities with source metadata", async () => {
    const response = await app.request("/api/activities");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      activities: Array<{ id: string; sourceName: string; sourceImageUrl: string | null }>;
    };
    expect(body.activities).toEqual([
      expect.objectContaining({
        id: "act_inbox",
        sourceName: "Release agent",
        sourceImageUrl: null,
      }),
    ]);
  });

  it("merges, filters, paginates, and isolates activity", async () => {
    const first = await app.request("/api/activity-feed");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: Array<{ kind: string; title: string }>;
      page: number;
      pageSize: number;
      total: number;
    };
    expect(firstBody).toMatchObject({ page: 0, pageSize: 20, total: 26 });
    expect(firstBody.items).toHaveLength(20);
    expect(firstBody.items.map((item) => item.kind)).toContain("response");
    expect(firstBody.items.map((item) => item.kind)).toContain("live_activity");
    expect(firstBody.items.some((item) => item.title === "Foreign notification")).toBe(false);

    const second = await app.request("/api/activity-feed?page=1");
    const secondBody = (await second.json()) as { items: unknown[]; total: number };
    expect(secondBody.items).toHaveLength(6);
    expect(secondBody.total).toBe(26);

    const notifications = await app.request("/api/activity-feed?filter=notification");
    const notificationBody = (await notifications.json()) as {
      items: Array<{ kind: string }>;
      total: number;
    };
    expect(notificationBody.total).toBe(23);
    expect(notificationBody.items.every((item) => item.kind === "notification")).toBe(true);
    expect((await app.request("/api/activity-feed?filter=unknown")).status).toBe(400);

    const projectFeed = await app.request("/api/activity-feed?project=prj_inbox");
    expect(projectFeed.status).toBe(200);
    const projectBody = (await projectFeed.json()) as {
      items: Array<{ id: string; projectId: string | null }>;
      total: number;
    };
    expect(projectBody.total).toBe(4);
    expect(projectBody.items.map((item) => item.id).sort()).toEqual([
      "live_activity:op_inbox",
      "notification:ntf_inbox",
      "response:int_answered",
      "response:int_expired",
    ]);
    expect(projectBody.items.every((item) => item.projectId === "prj_inbox")).toBe(true);
    expect(projectBody.items).toContainEqual(
      expect.objectContaining({ id: "response:int_expired", result: "Expired" }),
    );
    expect((await app.request("/api/activity-feed?project=prj_foreign")).status).toBe(404);
  });
});
