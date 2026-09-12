import { describe, expect, it } from "vitest";
import {
  buildInteractionPushMessages,
  buildNotificationWithdrawalPushMessages,
  buildPushMessages,
  buildWelcomePushMessages,
  resolveNotification,
} from "./push";

const service = {
  title: "Acme CRM",
  imageUrl: "https://example.com/default.png",
  url: "https://example.com/app",
};

describe("Android push envelopes", () => {
  it("builds welcome notifications for the FCM token", () => {
    const messages = buildWelcomePushMessages({ token: "fcm-a", deviceId: "dev_a" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      token: "fcm-a",
      envelope: {
        v: 1,
        kind: "notification",
        targetDeviceId: "dev_a",
        eventId: "hark-welcome-1",
        title: "Hark",
        body: "Hark is connected to your backend. You're ready to receive notifications.",
        url: expect.stringMatching(/\/dashboard$/),
      },
    });
  });

  it("builds notification withdrawal commands", () => {
    const messages = buildNotificationWithdrawalPushMessages(
      [
        { token: "fcm-a", deviceId: "dev_a" },
        { token: "fcm-b", deviceId: "dev_b" },
      ],
      "evt_1",
    );
    expect(messages.map((message) => message.envelope)).toEqual([
      expect.objectContaining({ v: 1, kind: "notification.withdraw", eventId: "evt_1" }),
      expect.objectContaining({ v: 1, kind: "notification.withdraw", eventId: "evt_1" }),
    ]);
  });

  it("includes the fields Android needs to render without JavaScript", () => {
    const [message] = buildPushMessages({
      to: [{ token: "fcm-a", deviceId: "dev_a" }],
      eventId: "evt_1",
      serviceId: "svc_1",
      projectId: "prj_1",
      resolved: {
        title: "CI",
        body: "Build failed",
        imageUrl: "https://example.com/ci.png",
        url: "https://example.com/build/1",
      },
    });
    expect(message).toMatchObject({
      token: "fcm-a",
      envelope: {
        v: 1,
        kind: "notification",
        targetDeviceId: "dev_a",
        eventId: "evt_1",
        serviceId: "svc_1",
        projectId: "prj_1",
        title: "CI",
        body: "Build failed",
        avatarUrl: "https://example.com/ci.png",
        url: "https://example.com/build/1",
      },
    });
    expect(message?.envelope.backendOrigin).toMatch(/^https?:\/\//);
  });

  it("includes scoped interaction credentials, actions, expiry, and response URL", () => {
    const [message] = buildInteractionPushMessages({
      to: [{ token: "fcm-a", deviceId: "dev_a" }],
      interactionId: "int_1",
      eventId: "evt_1",
      kind: "approval",
      title: "Release",
      prompt: "Deploy production?",
      actionDigest: "a".repeat(64),
      responseToken: "r".repeat(43),
      expiresAt: "2026-09-12T09:00:00.000Z",
    });
    expect(message?.envelope).toMatchObject({
      kind: "notification",
      interaction: {
        id: "int_1",
        kind: "approval",
        actionDigest: "a".repeat(64),
        responseToken: "r".repeat(43),
        expiresAt: "2026-09-12T09:00:00.000Z",
        actions: [
          { id: "approve", title: "Approve" },
          { id: "deny", title: "Deny", destructive: true },
        ],
      },
    });
    if (message?.envelope.kind !== "notification" || !message.envelope.interaction) {
      throw new Error("Expected interaction envelope");
    }
    expect(message.envelope.interaction.responseUrl).toContain(
      "/api/interaction-responses/int_1/respond",
    );
  });

  it("uses summaries and fits multibyte bodies within FCM's data limit", () => {
    const [summary] = buildPushMessages({
      to: [{ token: "fcm-a", deviceId: "dev_a" }],
      eventId: "evt_summary",
      serviceId: "svc_1",
      resolved: { title: "T", body: "x".repeat(7_000), summary: "Deploy finished" },
    });
    expect(summary?.envelope).toMatchObject({ body: "Deploy finished" });

    const [long] = buildPushMessages({
      to: [{ token: "fcm-a", deviceId: "dev_a" }],
      eventId: "evt_long",
      serviceId: "svc_1",
      resolved: { title: "T", body: "気配り🚀".repeat(1_500) },
    });
    expect(
      Buffer.byteLength(JSON.stringify({ hark: JSON.stringify(long?.envelope) }), "utf8"),
    ).toBeLessThanOrEqual(4_096);
    expect(long?.envelope.kind === "notification" && long.envelope.body.endsWith("…")).toBe(true);
  });
});

describe("resolveNotification", () => {
  it("falls back to service defaults", () => {
    expect(resolveNotification(service, { body: "New sign-up" })).toEqual({
      title: "Acme CRM",
      body: "New sign-up",
      imageUrl: "https://example.com/default.png",
      url: "https://example.com/app",
    });
  });

  it("prefers webhook overrides", () => {
    expect(
      resolveNotification(service, {
        body: "Build failed",
        title: "CI",
        imageUrl: "https://example.com/ci.png",
        url: "https://example.com/build/1",
      }),
    ).toEqual({
      title: "CI",
      body: "Build failed",
      imageUrl: "https://example.com/ci.png",
      url: "https://example.com/build/1",
    });
  });
});
