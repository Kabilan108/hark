import { describe, expect, it, vi } from "vitest";

describe("self-hosted billing", () => {
  it("enables routing and pro-only interactions without Autumn", async () => {
    process.env.NODE_ENV = "test";
    process.env.SELF_HOSTED_MODE = "true";
    delete process.env.AUTUMN_API_KEY;
    vi.resetModules();

    const { getBilling, hasAutumn } = await import("./billing");
    const billing = await getBilling({
      id: "owner",
      name: "Owner",
      email: "owner@example.com",
      image: null,
    });

    expect(hasAutumn()).toBe(false);
    expect(billing).toMatchObject({
      configured: false,
      plan: "pro",
      priceMonthly: 0,
      features: { deviceRouting: true },
      limits: { devices: null },
      usage: { notificationsRemaining: null },
    });
  });
});
