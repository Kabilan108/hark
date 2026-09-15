import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "projects_user_1" as string | null }));
vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Projects User",
                email: "projects@example.com",
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

const READ_SECRET = `hark_${"r".repeat(43)}`;
const WRITE_SECRET = `hark_${"w".repeat(43)}`;
const NO_SCOPE_SECRET = `hark_${"x".repeat(43)}`;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { hashApiToken } = await import("../lib/token");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "projects_user_1",
      name: "Projects User",
      email: "projects@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "projects_user_2",
      name: "Foreign User",
      email: "foreign-projects@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "projects_token_read",
      userId: "projects_user_1",
      name: "Read projects",
      tokenHash: hashApiToken(READ_SECRET),
      prefix: READ_SECRET.slice(0, 13),
      scopes: ["projects:read"],
      createdAt: now,
    },
    {
      id: "projects_token_write",
      userId: "projects_user_1",
      name: "Write projects",
      tokenHash: hashApiToken(WRITE_SECRET),
      prefix: WRITE_SECRET.slice(0, 13),
      scopes: ["projects:read", "projects:write"],
      createdAt: now,
    },
    {
      id: "projects_token_none",
      userId: "projects_user_1",
      name: "No project scopes",
      tokenHash: hashApiToken(NO_SCOPE_SECRET),
      prefix: NO_SCOPE_SECRET.slice(0, 13),
      scopes: ["events:read"],
      createdAt: now,
    },
    {
      id: "projects_token_foreign",
      userId: "projects_user_2",
      name: "Foreign",
      tokenHash: hashApiToken(`hark_${"f".repeat(43)}`),
      prefix: "hark_ffffffff",
      scopes: ["projects:read", "projects:write"],
      createdAt: now,
    },
  ]);
  await db.insert(schema.project).values([
    {
      id: "prj_active",
      userId: "projects_user_1",
      name: "Active",
      normalizedName: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prj_archived",
      userId: "projects_user_1",
      name: "Archived",
      normalizedName: "archived",
      archivedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prj_foreign",
      userId: "projects_user_2",
      name: "Foreign",
      normalizedName: "foreign",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.service).values([
    {
      id: "projects_service",
      userId: "projects_user_1",
      title: "Owned service",
      tokenHash: "projects-service-hash",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "projects_service_foreign",
      userId: "projects_user_2",
      title: "Foreign service",
      tokenHash: "projects-service-foreign-hash",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.event).values([
    {
      id: "evt_owned",
      serviceId: "projects_service",
      title: "Event",
      body: "Body",
      status: "accepted",
      projectId: "prj_active",
      createdAt: now,
    },
    {
      id: "evt_foreign",
      serviceId: "projects_service_foreign",
      title: "Foreign event",
      body: "Body",
      status: "accepted",
      projectId: "prj_foreign",
      createdAt: now,
    },
  ]);
  await db.insert(schema.agentNotification).values({
    id: "anot_owned",
    userId: "projects_user_1",
    requesterTokenId: "projects_token_write",
    title: "Notification",
    body: "Body",
    projectId: "prj_active",
    createdAt: now,
  });
  await db.insert(schema.interaction).values({
    id: "int_owned",
    userId: "projects_user_1",
    requesterTokenId: "projects_token_write",
    title: "Decision",
    prompt: "Approve?",
    kind: "approval",
    choices: ["approve", "deny"],
    actionDigest: "a".repeat(64),
    projectId: "prj_active",
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
  });
  await db.insert(schema.liveActivity).values({
    id: "act_owned",
    userId: "projects_user_1",
    requesterTokenId: "projects_token_write",
    projectId: "prj_active",
    schemaVersion: 1,
    props: {},
    status: "active",
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
});

function agent(path: string, secret: string, init?: RequestInit) {
  return app.request(`/api/agent/projects${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

describe("project API", () => {
  it("lists owner projects with lifecycle filters and aggregate counts", async () => {
    const response = await app.request("/api/projects");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toEqual([
      expect.objectContaining({
        id: "prj_active",
        archivedAt: null,
        notificationCount: 2,
        unreadCount: 2,
        pendingInteractionCount: 1,
        activeActivityCount: 1,
      }),
    ]);

    const included = await (await app.request("/api/projects?archived=include")).json();
    expect(included.projects.map((item: { id: string }) => item.id).sort()).toEqual([
      "prj_active",
      "prj_archived",
    ]);
    expect(JSON.stringify(included)).not.toContain("prj_foreign");

    const inbox = await (await app.request("/api/inbox/projects")).json();
    expect(inbox.projects).toContainEqual(
      expect.objectContaining({
        projectId: "prj_active",
        totalCount: 4,
        unreadCount: 2,
        pendingInteractionCount: 1,
        activeActivityCount: 1,
      }),
    );
    expect(JSON.stringify(inbox)).not.toContain("prj_archived");
  });

  it("enforces dedicated agent scopes", async () => {
    expect((await agent("", NO_SCOPE_SECRET)).status).toBe(403);
    expect((await agent("", READ_SECRET)).status).toBe(200);
    expect(
      (
        await agent("/prj_active", READ_SECRET, {
          method: "PATCH",
          body: JSON.stringify({ name: "Nope" }),
        })
      ).status,
    ).toBe(403);
  });

  it("renames, archives, and restores an owned project without exposing foreign projects", async () => {
    const renamed = await agent("/prj_active", WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed", archived: true }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      project: { id: "prj_active", name: "Renamed", archivedAt: expect.any(String) },
    });
    const pending = await (await app.request("/api/interactions")).json();
    expect(pending.interactions).toContainEqual(expect.objectContaining({ id: "int_owned" }));

    const restored = await agent("/prj_active", WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ archived: false }),
    });
    expect(await restored.json()).toMatchObject({ project: { archivedAt: null } });
    expect(
      (
        await agent("/prj_foreign", WRITE_SECRET, {
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        })
      ).status,
    ).toBe(404);
  });

  it.each([
    ["event", "evt_owned"],
    ["notification", "anot_owned"],
    ["interaction", "int_owned"],
    ["activity", "act_owned"],
  ] as const)("moves an owned %s to Other", async (type, id) => {
    const response = await agent(`/items/${type}/${id}/move`, WRITE_SECRET, {
      method: "POST",
      body: JSON.stringify({ projectId: null }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ item: { type, id, projectId: null } });
    const { eq } = await import("drizzle-orm");
    if (type === "event") {
      const [row] = await db.select().from(schema.event).where(eq(schema.event.id, id));
      expect(row?.projectId).toBeNull();
    } else if (type === "notification") {
      const [row] = await db
        .select()
        .from(schema.agentNotification)
        .where(eq(schema.agentNotification.id, id));
      expect(row?.projectId).toBeNull();
    } else if (type === "interaction") {
      const [row] = await db.select().from(schema.interaction).where(eq(schema.interaction.id, id));
      expect(row?.projectId).toBeNull();
    } else {
      const [row] = await db
        .select()
        .from(schema.liveActivity)
        .where(eq(schema.liveActivity.id, id));
      expect(row?.projectId).toBeNull();
    }
  });

  it("rejects archived targets and hides foreign items", async () => {
    const archived = await agent("/items/event/evt_owned/move", WRITE_SECRET, {
      method: "POST",
      body: JSON.stringify({ projectId: "prj_archived" }),
    });
    expect(archived.status).toBe(409);
    const foreign = await agent("/items/event/evt_foreign/move", WRITE_SECRET, {
      method: "POST",
      body: JSON.stringify({ projectId: "prj_active" }),
    });
    expect(foreign.status).toBe(404);
  });

  it("moves an event, its interaction, and the interaction Live Activity atomically", async () => {
    const now = new Date();
    await db.insert(schema.event).values({
      id: "evt_linked",
      serviceId: "projects_service",
      title: "Linked event",
      body: "Body",
      status: "accepted",
      createdAt: now,
    });
    await db.insert(schema.interaction).values({
      id: "int_linked",
      userId: "projects_user_1",
      requesterTokenId: "projects_token_write",
      eventId: "evt_linked",
      title: "Linked decision",
      prompt: "Approve?",
      kind: "approval",
      choices: ["approve", "deny"],
      actionDigest: "b".repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });
    await db.insert(schema.liveActivity).values({
      id: "act_linked",
      userId: "projects_user_1",
      requesterTokenId: "projects_token_write",
      interactionId: "int_linked",
      schemaVersion: 1,
      props: {},
      status: "active",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });

    const { eq } = await import("drizzle-orm");
    for (const [type, id, projectId] of [
      ["event", "evt_linked", "prj_active"],
      ["interaction", "int_linked", null],
      ["activity", "act_linked", "prj_active"],
    ] as const) {
      const response = await agent(`/items/${type}/${id}/move`, WRITE_SECRET, {
        method: "POST",
        body: JSON.stringify({ projectId }),
      });
      expect(response.status).toBe(200);
      const [[eventRow], [interactionRow], [activityRow]] = await Promise.all([
        db.select().from(schema.event).where(eq(schema.event.id, "evt_linked")),
        db.select().from(schema.interaction).where(eq(schema.interaction.id, "int_linked")),
        db.select().from(schema.liveActivity).where(eq(schema.liveActivity.id, "act_linked")),
      ]);
      expect([eventRow?.projectId, interactionRow?.projectId, activityRow?.projectId]).toEqual([
        projectId,
        projectId,
        projectId,
      ]);
    }
    const listed = await (await app.request("/api/projects")).json();
    expect(listed.projects).toContainEqual(
      expect.objectContaining({
        id: "prj_active",
        notificationCount: 1,
        pendingInteractionCount: 0,
        activeActivityCount: 0,
      }),
    );
  });
});
