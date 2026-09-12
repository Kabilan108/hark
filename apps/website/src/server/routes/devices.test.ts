import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () => ({
        user: {
          id: "welcome_user",
          name: "Welcome User",
          email: "welcome@example.com",
          image: null,
        },
      }),
    },
  },
}));

vi.mock("../lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: "pro",
    priceMonthly: 8,
    features: { deviceRouting: true },
    limits: {
      devices: null,
      notificationsPerMonth: 100_000,
      servicePerMinute: 300,
      accountPerMinute: 1500,
    },
    usage: { notificationsRemaining: 100_000 },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => undefined,
  hasAutumn: () => false,
  clearBillingCache: () => undefined,
  createCheckout: async () => "https://example.com/checkout",
  createBillingPortal: async () => "https://example.com/portal",
}));

vi.mock("../lib/fcm", () => {
  return {
    sendFcmMessages: async (messages: Array<Record<string, unknown>>) => {
      sent.push(...messages);
      return { accepted: messages.length, errors: [], staleTokens: [] };
    },
  };
});

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
  await db.insert(schema.user).values({
    id: "welcome_user",
    name: "Welcome User",
    email: "welcome@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
});

beforeEach(async () => {
  vi.useFakeTimers();
  sent.length = 0;
  await db.delete(schema.device);
  await db
    .update(schema.user)
    .set({ welcomeNotificationSentAt: null })
    .where(eq(schema.user.id, "welcome_user"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function register(fcmToken: string, deviceId?: string) {
  return app.request("/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(deviceId ? { deviceId } : {}),
      fcmToken,
      platform: "android",
      deviceName: "Pixel 9",
      notificationSchemaVersion: 1,
      interactionSchemaVersion: 1,
      liveActivitySchemaVersion: 1,
      promotedNotificationsCapable: true,
    }),
  });
}

async function ready(deviceId: string) {
  return app.request(`/api/devices/${deviceId}/ready`, { method: "POST" });
}

describe("POST /api/devices onboarding", () => {
  it("sends the welcome once for the account's first registered phone", async () => {
    const first = await register("fcm-welcome-a");
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { device: { id: string } };
    expect(sent).toHaveLength(0);

    const firstReadyRequest = ready(firstBody.device.id);
    await vi.advanceTimersByTimeAsync(4_000);
    const firstReady = await firstReadyRequest;
    expect(firstReady.status).toBe(200);
    expect(await firstReady.json()).toEqual({ ok: true, accepted: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      token: "fcm-welcome-a",
      envelope: {
        kind: "notification",
        targetDeviceId: firstBody.device.id,
        title: "Hark",
        body: "Hark is connected to your backend. You're ready to receive notifications.",
        url: expect.stringMatching(/\/dashboard$/),
      },
    });
    const refresh = await register("fcm-welcome-a");
    const secondPhone = await register("fcm-welcome-b");
    expect(refresh.status).toBe(201);
    expect(secondPhone.status).toBe(201);
    const secondBody = (await secondPhone.json()) as { device: { id: string } };
    expect(await ready(secondBody.device.id)).toMatchObject({ status: 200 });
    expect(sent).toHaveLength(1);

    const [account] = await db.select().from(schema.user);
    expect(account?.welcomeNotificationSentAt).toBeInstanceOf(Date);
  });

  it("reports Android notification and Live Update capabilities", async () => {
    const response = await register("fcm-capabilities");
    expect(await response.json()).toMatchObject({
      device: {
        platform: "android",
        deviceName: "Pixel 9",
        notificationsCapable: true,
        liveActivitiesCapable: true,
        interactiveLiveActivitiesCapable: false,
        promotedNotificationsCapable: true,
      },
    });
  });

  it("rotates an FCM token without creating a second device", async () => {
    const first = await register("fcm-before-rotation");
    const firstBody = (await first.json()) as { device: { id: string } };

    const rotated = await register("fcm-after-rotation", firstBody.device.id);
    expect(rotated.status).toBe(201);
    expect(await rotated.json()).toMatchObject({ device: { id: firstBody.device.id } });

    const rows = await db.select().from(schema.device);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: firstBody.device.id,
      fcmToken: "fcm-after-rotation",
      expoPushToken: "fcm-after-rotation",
      active: true,
    });
  });

  it("issues a fresh device ID when an FCM token changes account ownership", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "prior_owner",
      name: "Prior Owner",
      email: "prior@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_prior_owner",
      userId: "prior_owner",
      expoPushToken: "shared-token",
      fcmToken: "shared-token",
      platform: "android",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    const response = await register("shared-token");
    expect(response.status).toBe(201);
    const body = (await response.json()) as { device: { id: string } };
    expect(body.device.id).not.toBe("dev_prior_owner");

    const rows = await db.select().from(schema.device);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === "dev_prior_owner")).toMatchObject({
      active: false,
      fcmToken: null,
    });
    expect(rows.find((row) => row.id === body.device.id)).toMatchObject({
      userId: "welcome_user",
      active: true,
      fcmToken: "shared-token",
    });
  });

  it("does not allow claiming another account's device ID during rotation", async () => {
    const now = new Date();
    await db.insert(schema.user).values({
      id: "another_user",
      name: "Another User",
      email: "another@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.device).values({
      id: "dev_another",
      userId: "another_user",
      expoPushToken: "other-token",
      fcmToken: "other-token",
      platform: "android",
      active: true,
      createdAt: now,
      lastSeenAt: now,
    });

    const response = await register("attempted-token", "dev_another");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Device not found" });
  });
});
