import { type DeviceDto, deviceRegisterSchema, deviceUnregisterSchema } from "@hark/contracts";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { device, liveActivityDelivery, user as userTable } from "../db/schema";
import { track } from "../lib/analytics";
import { getBilling } from "../lib/billing";
import { newId } from "../lib/id";
import { buildWelcomePushMessages, sendPushMessages } from "../lib/push";
import { type AuthedEnv, requireAuth } from "../middleware";

function toDto(row: typeof device.$inferSelect): DeviceDto {
  return {
    id: row.id,
    platform: "android",
    deviceName: row.deviceName,
    active: row.active,
    notificationsCapable: row.notificationSchemaVersion === 1,
    liveActivitiesCapable: row.liveActivitySchemaVersion === 1,
    interactiveLiveActivitiesCapable: row.liveActivityInteractionVersion === 1,
    promotedNotificationsCapable: row.promotedNotificationsCapable === true,
    liveActivityTokenEnvironment: null,
    liveActivityTokenUpdatedAt: null,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const devicesRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rows = await db
      .select()
      .from(device)
      .where(and(eq(device.userId, c.get("user").id), eq(device.platform, "android")))
      .orderBy(desc(device.lastSeenAt));
    return c.json({ devices: rows.map(toDto) });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const parsed = deviceRegisterSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid device registration", issues: parsed.error.issues }, 400);
    }

    const [existing, claimedDevice, activeDevices, billing] = await Promise.all([
      db
        .select({ id: device.id, userId: device.userId, active: device.active })
        .from(device)
        .where(eq(device.fcmToken, parsed.data.fcmToken))
        .limit(1),
      parsed.data.deviceId
        ? db
            .select({ id: device.id, userId: device.userId, active: device.active })
            .from(device)
            .where(eq(device.id, parsed.data.deviceId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({ id: device.id })
        .from(device)
        .where(and(eq(device.userId, user.id), eq(device.active, true))),
      getBilling(user),
    ]);
    if (parsed.data.deviceId && claimedDevice[0]?.userId !== user.id) {
      return c.json({ error: "Device not found" }, 404);
    }
    const isAlreadyActiveForUser =
      (existing[0]?.userId === user.id && existing[0].active) || claimedDevice[0]?.active === true;
    if (
      !isAlreadyActiveForUser &&
      billing.limits.devices !== null &&
      activeDevices.length >= billing.limits.devices
    ) {
      return c.json({ error: "This account has reached its active device limit." }, 402);
    }

    const now = new Date();
    const registration = db.transaction((tx) => {
      const previous = tx
        .select({ id: device.id, userId: device.userId })
        .from(device)
        .where(eq(device.fcmToken, parsed.data.fcmToken))
        .get();
      const ownerChanged = Boolean(previous && previous.userId !== user.id);
      const capabilities = {
        userId: user.id,
        platform: "android",
        deviceName: parsed.data.deviceName ?? null,
        notificationSchemaVersion: parsed.data.notificationSchemaVersion,
        interactionSchemaVersion: parsed.data.interactionSchemaVersion ?? null,
        liveActivitySchemaVersion: parsed.data.liveActivitySchemaVersion ?? null,
        liveActivityInteractionVersion: parsed.data.liveActivityInteractionVersion ?? null,
        promotedNotificationsCapable: parsed.data.promotedNotificationsCapable ?? false,
        active: true,
        lastSeenAt: now,
      } as const;
      let registered: typeof device.$inferSelect | undefined;
      if (parsed.data.deviceId) {
        if (previous && previous.id !== parsed.data.deviceId) {
          tx.update(device)
            .set({
              active: false,
              fcmToken: null,
              // The legacy column is unique and non-null until the table is rebuilt.
              expoPushToken: `retired:${previous.id}:${now.getTime()}`,
              lastSeenAt: now,
            })
            .where(eq(device.id, previous.id))
            .run();
        }
        registered = tx
          .update(device)
          .set({
            ...capabilities,
            expoPushToken: parsed.data.fcmToken,
            fcmToken: parsed.data.fcmToken,
          })
          .where(and(eq(device.id, parsed.data.deviceId), eq(device.userId, user.id)))
          .returning()
          .get();
      } else {
        if (ownerChanged && previous) {
          tx.update(device)
            .set({
              active: false,
              fcmToken: null,
              expoPushToken: `retired:${previous.id}:${now.getTime()}`,
              lastSeenAt: now,
            })
            .where(eq(device.id, previous.id))
            .run();
        }
        registered = tx
          .insert(device)
          .values({
            id: newId("dev"),
            ...capabilities,
            // Keep the legacy non-null column populated until a later table rebuild removes it.
            expoPushToken: parsed.data.fcmToken,
            fcmToken: parsed.data.fcmToken,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: device.fcmToken,
            set: capabilities,
          })
          .returning()
          .get();
      }
      if (ownerChanged && previous) {
        tx.update(liveActivityDelivery)
          .set({ status: "failed", lastApnsReason: "OwnerChanged", updatedAt: now })
          .where(
            and(
              eq(liveActivityDelivery.deviceId, previous.id),
              inArray(liveActivityDelivery.status, ["pending", "accepted", "active"]),
            ),
          )
          .run();
      }
      return registered;
    });
    const row = registration;
    if (!row) return c.json({ error: "Failed to register device" }, 500);

    track({
      name: "device_registered",
      userId: user.id,
      deviceId: row.id,
      plan: billing.plan,
      outcome: existing[0] || parsed.data.deviceId ? "reregistered" : "created",
    });
    return c.json({ device: toDto(row) }, 201);
  })
  .post("/:id/ready", async (c) => {
    const user = c.get("user");
    const [registeredDevice, billing] = await Promise.all([
      db
        .select()
        .from(device)
        .where(
          and(
            eq(device.id, c.req.param("id")),
            eq(device.userId, user.id),
            eq(device.active, true),
            eq(device.platform, "android"),
            isNotNull(device.fcmToken),
          ),
        )
        .limit(1),
      getBilling(user),
    ]);
    const target = registeredDevice[0];
    if (!target?.fcmToken) return c.json({ error: "Device not found" }, 404);

    const welcomeClaim = await db
      .update(userTable)
      .set({ welcomeNotificationSentAt: new Date() })
      .where(and(eq(userTable.id, user.id), isNull(userTable.welcomeNotificationSentAt)))
      .returning({ id: userTable.id });
    if (welcomeClaim.length === 0) return c.json({ ok: true, accepted: 0, idempotent: true });

    const messages = buildWelcomePushMessages({ token: target.fcmToken, deviceId: target.id });
    let accepted = 0;
    let retryableFailure = false;
    for (const [index, message] of messages.entries()) {
      if (index > 0) await wait(2_000);
      const result = await sendPushMessages([message]);
      accepted += result.accepted;
      retryableFailure ||= result.retryableFailures > 0;
      if (result.staleTokens.length > 0) {
        await db.update(device).set({ active: false }).where(eq(device.id, target.id));
        track({
          name: "device_deactivated_stale",
          userId: user.id,
          deviceId: target.id,
          plan: billing.plan,
          outcome: "onboarding",
          value: 1,
        });
        break;
      }
    }
    if (accepted === 0 && retryableFailure) {
      await db
        .update(userTable)
        .set({ welcomeNotificationSentAt: null })
        .where(eq(userTable.id, user.id));
    }
    track({
      name: "onboarding_welcome_sent",
      userId: user.id,
      deviceId: target.id,
      plan: billing.plan,
      outcome: accepted === messages.length ? "complete" : "partial",
      value: accepted,
    });
    return c.json({ ok: true, accepted });
  })
  .delete("/:id", async (c) => {
    const removed = await db
      .delete(device)
      .where(and(eq(device.userId, c.get("user").id), eq(device.id, c.req.param("id"))))
      .returning({ id: device.id });
    if (removed.length > 0) {
      track({
        name: "device_unregistered",
        userId: c.get("user").id,
        deviceId: removed[0]?.id ?? null,
        outcome: "by_id",
        value: removed.length,
      });
    }
    return c.json({ ok: true });
  })
  .delete("/", async (c) => {
    const parsed = deviceUnregisterSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const removed = await db
      .delete(device)
      .where(and(eq(device.userId, c.get("user").id), eq(device.fcmToken, parsed.data.fcmToken)))
      .returning({ id: device.id });
    if (removed.length > 0) {
      track({
        name: "device_unregistered",
        userId: c.get("user").id,
        deviceId: removed[0]?.id ?? null,
        outcome: "by_token",
        value: removed.length,
      });
    }
    return c.json({ ok: true });
  });
