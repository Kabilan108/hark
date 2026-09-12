import { type HarkPushEnvelope, harkPushEnvelopeSchema } from "@hark/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://hark.test";

const fcmCalls = vi.hoisted(() => [] as Array<{ token: string; envelope: HarkPushEnvelope }>);
const fcmState = vi.hoisted(() => ({ rejectEnd: false }));
const billingState = vi.hoisted(() => ({ pro: true, deviceLimit: null as number | null }));

vi.mock("../auth", () => ({
  auth: { handler: () => new Response("not used"), api: { getSession: async () => null } },
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    plan: billingState.pro ? "pro" : "free",
    features: { deviceRouting: billingState.pro },
    limits: {
      devices: billingState.deviceLimit,
      servicePerMinute: 1000,
      accountPerMinute: 1000,
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
    const rejected = fcmState.rejectEnd
      ? messages.filter(({ envelope }) => envelope.kind === "activity" && envelope.event === "end")
      : [];
    return {
      accepted: messages.length - rejected.length,
      errors: rejected.length ? ["Unavailable"] : [],
      staleTokens: [],
      retryableFailures: rejected.length,
    };
  },
}));

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let hashWebhookToken: typeof import("../lib/token")["hashWebhookToken"];

const TOKEN = "whk_live-activity-abcdefghijklmnop";
const OTHER_TOKEN = "whk_live-activity-other-abcdefghij";

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ hashWebhookToken } = await import("../lib/token"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "hook_activity_user",
    name: "Hook Activity User",
    email: "hook-activity@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.service).values([
    {
      id: "hook_activity_service",
      userId: "hook_activity_user",
      title: "Deployments",
      tokenHash: hashWebhookToken(TOKEN),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "hook_activity_other_service",
      userId: "hook_activity_user",
      title: "Other",
      tokenHash: hashWebhookToken(OTHER_TOKEN),
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.device).values([
    {
      id: "hook_activity_device",
      userId: "hook_activity_user",
      expoPushToken: "fcm-hook-activity",
      fcmToken: "fcm-hook-activity",
      platform: "android",
      active: true,
      notificationSchemaVersion: 1,
      liveActivitySchemaVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    },
    {
      id: "hook_activity_incapable",
      userId: "hook_activity_user",
      expoPushToken: "fcm-hook-incapable",
      fcmToken: "fcm-hook-incapable",
      platform: "android",
      active: true,
      notificationSchemaVersion: 1,
      liveActivitySchemaVersion: null,
      createdAt: now,
      lastSeenAt: new Date(now.getTime() + 1000),
    },
  ]);
});

beforeEach(async () => {
  fcmCalls.length = 0;
  fcmState.rejectEnd = false;
  billingState.pro = true;
  billingState.deviceLimit = null;
  await db.delete(schema.liveActivity);
});

function activityRequest(
  token: string,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  idempotencyKey?: string,
) {
  return app.request(`/hooks/${token}/live-activities${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function start(token = TOKEN, idempotencyKey?: string) {
  return activityRequest(
    token,
    "",
    "POST",
    {
      title: "Deploy #184",
      status: "Building",
      progress: 0,
      symbol: "build",
      accentColor: "#FF9F0A",
      deviceIds: ["hook_activity_device"],
    },
    idempotencyKey,
  );
}

describe("Android activity webhook routes", () => {
  it("retains start, update, read, and end semantics over FCM", async () => {
    const started = await start();
    expect(started.status).toBe(201);
    const startBody = (await started.json()) as { activityId: string };
    expect(startBody).toMatchObject({
      ok: true,
      sequence: 0,
      status: "active",
      accepted: 1,
      state: { progress: 0, style: "standard" },
    });
    expect(fcmCalls[0]).toMatchObject({
      token: "fcm-hook-activity",
      envelope: {
        backendOrigin: "https://hark.test",
        targetDeviceId: "hook_activity_device",
        activityId: startBody.activityId,
        sequence: 0,
        event: "start",
        state: { title: "Deploy #184", status: "Building", progress: 0 },
      },
    });
    expect(harkPushEnvelopeSchema.safeParse(fcmCalls[0]?.envelope).success).toBe(true);

    const updated = await activityRequest(
      TOKEN,
      `/${startBody.activityId}`,
      "PATCH",
      { status: "Testing", progress: 0.5, ifSequence: 0 },
      "deploy-update",
    );
    expect(await updated.json()).toMatchObject({
      ok: true,
      sequence: 1,
      state: { title: "Deploy #184", status: "Testing", progress: 0.5 },
    });
    expect(fcmCalls[1]?.envelope).toMatchObject({ sequence: 1, event: "update" });

    expect(
      await (await activityRequest(TOKEN, `/${startBody.activityId}`, "GET")).json(),
    ).toMatchObject({ ok: true, sequence: 1 });
    const ended = await activityRequest(TOKEN, `/${startBody.activityId}/end`, "POST", {
      status: "Deployed",
      progress: 1,
      dismissAfterSeconds: 20,
      ifSequence: 1,
    });
    expect(await ended.json()).toMatchObject({ ok: true, sequence: 2, status: "ended" });
    expect(fcmCalls[2]?.envelope).toMatchObject({
      sequence: 2,
      event: "end",
      dismissAfterSeconds: 20,
    });
  });

  it("replays idempotent requests without sending duplicate messages", async () => {
    const first = await start(TOKEN, "deploy-start");
    const firstBody = (await first.json()) as { activityId: string };
    expect(await (await start(TOKEN, "deploy-start")).json()).toMatchObject({
      ok: true,
      activityId: firstBody.activityId,
      idempotent: true,
    });
    expect(fcmCalls).toHaveLength(1);
  });

  it("retries a transient end failure on an idempotent replay", async () => {
    const started = await start();
    const { activityId } = (await started.json()) as { activityId: string };
    const endBody = { status: "Done", dismissAfterSeconds: 5 };
    fcmState.rejectEnd = true;
    const failed = await activityRequest(
      TOKEN,
      `/${activityId}/end`,
      "POST",
      endBody,
      "hook-retry-end",
    );
    expect(await failed.json()).toMatchObject({
      accepted: 0,
      failed: 1,
      status: "ended",
      sequence: 1,
    });

    fcmState.rejectEnd = false;
    const retried = await activityRequest(
      TOKEN,
      `/${activityId}/end`,
      "POST",
      endBody,
      "hook-retry-end",
    );
    expect(await retried.json()).toMatchObject({
      accepted: 1,
      failed: 0,
      idempotent: true,
      status: "ended",
      sequence: 1,
    });
    expect(fcmCalls.slice(-2).map(({ envelope }) => envelope)).toMatchObject([
      { event: "end", sequence: 1 },
      { event: "end", sequence: 1 },
    ]);
  });

  it("replaces a blocker atomically and does not disclose another service's activity", async () => {
    const foreign = await start(OTHER_TOKEN);
    const foreignBody = (await foreign.json()) as { activityId: string };
    fcmCalls.length = 0;
    const replacement = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy #185",
      status: "Building",
      replace: true,
      deviceIds: ["hook_activity_device"],
    });
    expect(replacement.status).toBe(201);
    const raw = await replacement.text();
    expect(raw).not.toContain(foreignBody.activityId);
    expect(JSON.parse(raw)).toMatchObject({ ok: true, replaced: 1, accepted: 1 });
    expect(fcmCalls.map(({ envelope }) => envelope)).toMatchObject([
      { activityId: foreignBody.activityId, sequence: 1, event: "end" },
      { sequence: 0, event: "start" },
    ]);
  });

  it("keeps webhook ownership and self-hosted entitlement checks", async () => {
    expect((await start("whk_unknown")).status).toBe(404);
    const created = await start();
    const body = (await created.json()) as { activityId: string };
    expect((await activityRequest(OTHER_TOKEN, `/${body.activityId}`, "GET")).status).toBe(404);
    billingState.pro = false;
    await db.delete(schema.liveActivity);
    const denied = await start();
    expect(denied.status).toBe(402);
  });

  it("applies the device limit after filtering for live update capability", async () => {
    billingState.deviceLimit = 1;
    const created = await activityRequest(TOKEN, "", "POST", {
      title: "Deploy #limit",
      status: "Building",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ accepted: 1, failed: 0 });
    expect(fcmCalls).toHaveLength(1);
    expect(fcmCalls[0]).toMatchObject({ token: "fcm-hook-activity" });
  });
});
