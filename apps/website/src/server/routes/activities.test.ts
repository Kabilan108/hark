import { type HarkPushEnvelope, harkPushEnvelopeSchema } from "@hark/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://hark.test";

const authState = vi.hoisted(() => ({ userId: "activity_user_1" as string | null }));
const fcmCalls = vi.hoisted(() => [] as Array<{ token: string; envelope: HarkPushEnvelope }>);
const fcmState = vi.hoisted(() => ({
  rejectEvent: null as string | null,
  stale: false,
  retryableFailure: false,
  pauseUpdates: false,
  updateStarted: null as (() => void) | null,
  releaseUpdate: null as (() => void) | null,
}));
const billingState = vi.hoisted(() => ({ pro: true, serviceRate: 1000, accountRate: 1000 }));

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: "Activity User",
                email: "activity@example.com",
                image: null,
              },
            }
          : null,
    },
  },
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    plan: billingState.pro ? "pro" : "free",
    features: { deviceRouting: billingState.pro },
    limits: {
      devices: billingState.pro ? null : 1,
      servicePerMinute: billingState.serviceRate,
      accountPerMinute: billingState.accountRate,
    },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.test",
  createBillingPortal: async () => "https://example.test",
}));

vi.mock("../lib/fcm", () => ({
  sendFcmMessages: async (
    messages: ReadonlyArray<{ token: string; envelope: HarkPushEnvelope }>,
  ) => {
    fcmCalls.push(...messages);
    if (
      fcmState.pauseUpdates &&
      messages.some(({ envelope }) => envelope.kind === "activity" && envelope.event === "update")
    ) {
      fcmState.updateStarted?.();
      await new Promise<void>((resolve) => {
        fcmState.releaseUpdate = resolve;
      });
    }
    const rejected = messages.filter(
      ({ envelope }) => envelope.kind === "activity" && envelope.event === fcmState.rejectEvent,
    );
    return {
      accepted: messages.length - rejected.length,
      errors: rejected.length > 0 ? ["Unavailable"] : [],
      staleTokens: fcmState.stale ? messages.map(({ token }) => token) : [],
      retryableFailures: fcmState.retryableFailure ? rejected.length : 0,
    };
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let hashApiToken: typeof import("../lib/token")["hashApiToken"];

const WRITE_SECRET = `hark_${"l".repeat(43)}`;
const READ_SECRET = `hark_${"m".repeat(43)}`;
const OTHER_SECRET = `hark_${"n".repeat(43)}`;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ hashApiToken } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "activity_user_1",
      name: "Activity User",
      email: "activity@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "activity_user_2",
      name: "Other User",
      email: "other@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values([
    {
      id: "activity_dev_1",
      userId: "activity_user_1",
      expoPushToken: "fcm-activity-1",
      fcmToken: "fcm-activity-1",
      platform: "android",
      active: true,
      notificationSchemaVersion: 1,
      liveActivitySchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "activity_dev_2",
      userId: "activity_user_1",
      expoPushToken: "fcm-activity-2",
      fcmToken: "fcm-activity-2",
      platform: "android",
      active: true,
      notificationSchemaVersion: 1,
      liveActivitySchemaVersion: 1,
      createdAt: now,
      lastSeenAt: new Date(now.getTime() - 1000),
    },
    {
      id: "activity_dev_incapable",
      userId: "activity_user_1",
      expoPushToken: "fcm-activity-incapable",
      fcmToken: "fcm-activity-incapable",
      platform: "android",
      active: true,
      notificationSchemaVersion: 1,
      liveActivitySchemaVersion: null,
      createdAt: now,
      lastSeenAt: new Date(now.getTime() + 1000),
    },
    {
      id: "activity_dev_foreign",
      userId: "activity_user_2",
      expoPushToken: "fcm-activity-foreign",
      fcmToken: "fcm-activity-foreign",
      platform: "android",
      active: true,
      notificationSchemaVersion: 1,
      liveActivitySchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    },
  ]);
  await db.insert(schema.apiToken).values([
    {
      id: "activity_tok_write",
      userId: "activity_user_1",
      name: "Activity write",
      tokenHash: hashApiToken(WRITE_SECRET),
      prefix: WRITE_SECRET.slice(0, 13),
      scopes: ["activities:read", "activities:write"],
      createdAt: now,
    },
    {
      id: "activity_tok_read",
      userId: "activity_user_1",
      name: "Activity read",
      tokenHash: hashApiToken(READ_SECRET),
      prefix: READ_SECRET.slice(0, 13),
      scopes: ["activities:read"],
      createdAt: now,
    },
    {
      id: "activity_tok_other",
      userId: "activity_user_1",
      name: "Other requester",
      tokenHash: hashApiToken(OTHER_SECRET),
      prefix: OTHER_SECRET.slice(0, 13),
      scopes: ["activities:read", "activities:write"],
      createdAt: now,
    },
  ]);
});

beforeEach(async () => {
  authState.userId = "activity_user_1";
  billingState.pro = true;
  billingState.serviceRate = 1000;
  billingState.accountRate = 1000;
  fcmCalls.length = 0;
  fcmState.rejectEvent = null;
  fcmState.stale = false;
  fcmState.retryableFailure = false;
  fcmState.pauseUpdates = false;
  fcmState.updateStarted = null;
  fcmState.releaseUpdate = null;
  await db.delete(schema.liveActivity);
  const { eq } = await import("drizzle-orm");
  await db
    .update(schema.device)
    .set({ userId: "activity_user_1", active: true, fcmToken: "fcm-activity-1" })
    .where(eq(schema.device.id, "activity_dev_1"));
  await db
    .update(schema.device)
    .set({ userId: "activity_user_1", active: true, fcmToken: "fcm-activity-2" })
    .where(eq(schema.device.id, "activity_dev_2"));
});

function agent(path: string, token = WRITE_SECRET, init?: RequestInit) {
  return app.request(`/api/agent/activities${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function start(
  body: Record<string, unknown> = { title: "Release", status: "Starting" },
  idempotency?: string,
) {
  return agent("", WRITE_SECRET, {
    method: "POST",
    headers: idempotency ? { "Idempotency-Key": idempotency } : undefined,
    body: JSON.stringify(body),
  });
}

describe("Android activity agent routes", () => {
  it("keeps write scope and requester ownership checks", async () => {
    const denied = await agent("", READ_SECRET, {
      method: "POST",
      body: JSON.stringify({ title: "No", status: "No" }),
    });
    expect(denied.status).toBe(403);
    const created = await start();
    const body = (await created.json()) as { activity: { id: string } };
    expect((await agent(`/${body.activity.id}`, OTHER_SECRET)).status).toBe(404);
  });

  it("sends full state and monotonic sequences without reactivating an ended activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T08:00:00.000Z"));
    try {
      const request = {
        title: "Release",
        status: "Building",
        project: "Archived replay activity",
        progress: 0.2,
        deviceIds: ["activity_dev_1"],
        expiresInSeconds: 600,
      };
      const created = await start(request, "release-start");
      expect(created.status).toBe(201);
      const body = (await created.json()) as { activity: { id: string; projectId: string } };
      expect(fcmCalls[0]).toMatchObject({
        token: "fcm-activity-1",
        envelope: {
          v: 1,
          kind: "activity",
          backendOrigin: "https://hark.test",
          targetDeviceId: "activity_dev_1",
          activityId: body.activity.id,
          sequence: 0,
          event: "start",
          state: { title: "Release", status: "Building", progress: 0.2 },
          expiresAt: "2026-09-12T08:10:00.000Z",
          deepLink: `hark-android://inbox?activityId=${body.activity.id}`,
        },
      });
      expect(harkPushEnvelopeSchema.safeParse(fcmCalls[0]?.envelope).success).toBe(true);

      const { eq } = await import("drizzle-orm");
      await db
        .update(schema.project)
        .set({ archivedAt: new Date() })
        .where(eq(schema.project.id, body.activity.projectId));

      expect(await (await start(request, "release-start")).json()).toMatchObject({
        idempotent: true,
      });
      const [project] = await db
        .select()
        .from(schema.project)
        .where(eq(schema.project.id, body.activity.projectId));
      expect(project?.archivedAt).not.toBeNull();
      expect(fcmCalls).toHaveLength(1);

      const updated = await agent(`/${body.activity.id}`, WRITE_SECRET, {
        method: "PATCH",
        body: JSON.stringify({ status: "Testing", progress: 0.7, ifSequence: 0 }),
      });
      expect(await updated.json()).toMatchObject({
        accepted: 1,
        activity: { sequence: 1, props: { title: "Release", status: "Testing", progress: 0.7 } },
      });
      expect(fcmCalls[1]?.envelope).toMatchObject({
        sequence: 1,
        event: "update",
        state: { title: "Release", status: "Testing", progress: 0.7 },
      });

      const stale = await agent(`/${body.activity.id}`, WRITE_SECRET, {
        method: "PATCH",
        body: JSON.stringify({ status: "Late", ifSequence: 0 }),
      });
      expect(stale.status).toBe(409);
      expect(fcmCalls).toHaveLength(2);

      const ended = await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
        method: "POST",
        body: JSON.stringify({ status: "Complete", progress: 1, dismissAfterSeconds: 30 }),
      });
      expect(await ended.json()).toMatchObject({
        accepted: 1,
        activity: { sequence: 2, status: "ended" },
      });
      expect(fcmCalls[2]?.envelope).toMatchObject({
        sequence: 2,
        event: "end",
        dismissAfterSeconds: 30,
        state: { title: "Release", status: "Complete", progress: 1 },
      });
      expect(harkPushEnvelopeSchema.safeParse(fcmCalls[2]?.envelope).success).toBe(true);
      expect(
        (
          await agent(`/${body.activity.id}`, WRITE_SECRET, {
            method: "PATCH",
            body: JSON.stringify({ status: "Resurrected" }),
          })
        ).status,
      ).toBe(409);
      expect(fcmCalls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the old lifecycle before replacing its device slot", async () => {
    const first = await start({
      title: "Old run",
      status: "Running",
      deviceIds: ["activity_dev_1"],
    });
    const firstBody = (await first.json()) as { activity: { id: string } };
    expect(
      (
        await start({
          title: "Blocked",
          status: "Starting",
          deviceIds: ["activity_dev_1"],
        })
      ).status,
    ).toBe(409);

    fcmCalls.length = 0;
    const replacementRequest = {
      title: "New run",
      status: "Starting",
      replace: true,
      deviceIds: ["activity_dev_1"],
    };
    const replacement = await start(replacementRequest, "replacement-once");
    const replacementBody = (await replacement.json()) as {
      activity: { id: string };
      replaced: number;
    };
    expect(replacementBody.replaced).toBe(1);
    expect(fcmCalls.map(({ envelope }) => envelope)).toMatchObject([
      { activityId: firstBody.activity.id, sequence: 1, event: "end", dismissAfterSeconds: 0 },
      { activityId: replacementBody.activity.id, sequence: 0, event: "start" },
    ]);
    expect(await (await start(replacementRequest, "replacement-once")).json()).toMatchObject({
      idempotent: true,
      activity: { id: replacementBody.activity.id },
    });
    expect(fcmCalls).toHaveLength(2);
  });

  it("does not send later updates to a delivery ended by replacement", async () => {
    const first = await start({ title: "Old run", status: "Running" });
    const firstBody = (await first.json()) as { activity: { id: string } };
    await start({
      title: "Replacement",
      status: "Starting",
      replace: true,
      deviceIds: ["activity_dev_1"],
    });

    fcmCalls.length = 0;
    const updated = await agent(`/${firstBody.activity.id}`, WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ status: "Still running elsewhere" }),
    });

    expect(await updated.json()).toMatchObject({ accepted: 1, failed: 0 });
    expect(fcmCalls).toHaveLength(1);
    expect(fcmCalls[0]).toMatchObject({
      token: "fcm-activity-2",
      envelope: { activityId: firstBody.activity.id, event: "update" },
    });
    const { and, eq } = await import("drizzle-orm");
    const endedDelivery = db
      .select()
      .from(schema.liveActivityDelivery)
      .where(
        and(
          eq(schema.liveActivityDelivery.activityId, firstBody.activity.id),
          eq(schema.liveActivityDelivery.deviceId, "activity_dev_1"),
        ),
      )
      .get();
    expect(endedDelivery).toMatchObject({ status: "ended", lastEvent: "end" });
  });

  it("clears a stale FCM token while keeping the activity terminal", async () => {
    const created = await start({
      title: "Stale device",
      status: "Running",
      deviceIds: ["activity_dev_1"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    fcmState.stale = true;
    fcmState.rejectEvent = "end";
    const ended = await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(await ended.json()).toMatchObject({
      accepted: 0,
      failed: 1,
      activity: { status: "ended", sequence: 1 },
    });
    const { eq } = await import("drizzle-orm");
    const registered = db
      .select({ fcmToken: schema.device.fcmToken })
      .from(schema.device)
      .where(eq(schema.device.id, "activity_dev_1"))
      .get();
    expect(registered?.fcmToken).toBeNull();
    expect(
      (
        await agent(`/${body.activity.id}`, WRITE_SECRET, {
          method: "PATCH",
          body: JSON.stringify({ status: "Must stay ended" }),
        })
      ).status,
    ).toBe(409);
  });

  it("retries a transient end failure with the same idempotency key", async () => {
    const created = await start({
      title: "Retry end",
      status: "Running",
      deviceIds: ["activity_dev_1"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    fcmState.rejectEvent = "end";
    fcmState.retryableFailure = true;
    const endBody = { status: "Done", dismissAfterSeconds: 10 };

    const failed = await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
      method: "POST",
      headers: { "Idempotency-Key": "retry-end" },
      body: JSON.stringify(endBody),
    });
    expect(await failed.json()).toMatchObject({
      accepted: 0,
      failed: 1,
      activity: { status: "ended", sequence: 1 },
    });
    const { eq } = await import("drizzle-orm");
    expect(
      db
        .select()
        .from(schema.liveActivityDelivery)
        .where(eq(schema.liveActivityDelivery.activityId, body.activity.id))
        .get(),
    ).toMatchObject({ status: "accepted", lastEvent: "end", lastSequence: 1, endedAt: null });

    fcmState.rejectEvent = null;
    fcmState.retryableFailure = false;
    const retried = await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
      method: "POST",
      headers: { "Idempotency-Key": "retry-end" },
      body: JSON.stringify(endBody),
    });
    expect(await retried.json()).toMatchObject({
      accepted: 1,
      failed: 0,
      idempotent: true,
      activity: { status: "ended", sequence: 1 },
    });
    expect(fcmCalls.slice(-2).map(({ envelope }) => envelope)).toMatchObject([
      { event: "end", sequence: 1 },
      { event: "end", sequence: 1 },
    ]);
    expect(
      db
        .select()
        .from(schema.liveActivityDelivery)
        .where(eq(schema.liveActivityDelivery.activityId, body.activity.id))
        .get(),
    ).toMatchObject({ status: "ended", lastEvent: "end", lastSequence: 1 });

    const sent = fcmCalls.length;
    await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
      method: "POST",
      headers: { "Idempotency-Key": "retry-end" },
      body: JSON.stringify(endBody),
    });
    expect(fcmCalls).toHaveLength(sent);
  });

  it("does not send activity state after a device changes owners", async () => {
    const created = await start({
      title: "Private task",
      status: "Running",
      deviceIds: ["activity_dev_1"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.device)
      .set({ userId: "activity_user_2" })
      .where(eq(schema.device.id, "activity_dev_1"));
    fcmCalls.length = 0;

    const updated = await agent(`/${body.activity.id}`, WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ status: "Sensitive update" }),
    });
    expect(await updated.json()).toMatchObject({ accepted: 0, failed: 1 });
    expect(fcmCalls).toHaveLength(0);
  });

  it("does not let a late update result reopen an ended activity or delivery", async () => {
    const created = await start({
      title: "Concurrent",
      status: "Running",
      deviceIds: ["activity_dev_1"],
    });
    const body = (await created.json()) as { activity: { id: string } };
    let signalStarted: (() => void) | undefined;
    const updateStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    fcmState.pauseUpdates = true;
    fcmState.updateStarted = signalStarted ?? null;
    const updateRequest = agent(`/${body.activity.id}`, WRITE_SECRET, {
      method: "PATCH",
      body: JSON.stringify({ status: "Almost done" }),
    });
    await updateStarted;

    const ended = await agent(`/${body.activity.id}/end`, WRITE_SECRET, {
      method: "POST",
      body: JSON.stringify({ status: "Done" }),
    });
    expect(ended.status).toBe(200);
    fcmState.releaseUpdate?.();
    const lateUpdate = await updateRequest;
    expect(lateUpdate.status).toBe(200);
    expect(await lateUpdate.json()).toMatchObject({ activity: { status: "ended", sequence: 2 } });

    const { eq } = await import("drizzle-orm");
    const activity = db
      .select()
      .from(schema.liveActivity)
      .where(eq(schema.liveActivity.id, body.activity.id))
      .get();
    expect(activity).toMatchObject({ status: "ended", sequence: 2 });
    const delivery = db
      .select()
      .from(schema.liveActivityDelivery)
      .where(eq(schema.liveActivityDelivery.activityId, body.activity.id))
      .get();
    expect(delivery).toMatchObject({ status: "ended", lastEvent: "end", lastSequence: 2 });
    const sent = fcmCalls.length;
    expect(
      (
        await agent(`/${body.activity.id}`, WRITE_SECRET, {
          method: "PATCH",
          body: JSON.stringify({ status: "Must stay ended" }),
        })
      ).status,
    ).toBe(409);
    expect(fcmCalls).toHaveLength(sent);
  });

  it("keeps device routing and rate limits", async () => {
    billingState.pro = false;
    expect(
      (
        await start({
          title: "Free",
          status: "Start",
          deviceIds: ["activity_dev_2"],
        })
      ).status,
    ).toBe(402);
    billingState.pro = true;
    billingState.serviceRate = 0;
    const limited = await start();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });

  it("applies the device limit after filtering for live update capability", async () => {
    billingState.pro = false;
    const created = await start({ title: "Free", status: "Start" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ accepted: 1, failed: 0 });
    expect(fcmCalls).toHaveLength(1);
    expect(fcmCalls[0]).toMatchObject({ token: "fcm-activity-1" });
  });
});
