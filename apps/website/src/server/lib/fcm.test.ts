import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFcmSender } from "./fcm";

function testServiceAccount() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    client_email: "hark@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    token_uri: "https://oauth.example/token",
  };
}

const envelope = {
  v: 1 as const,
  kind: "notification" as const,
  backendOrigin: "https://sietch.sole-pierce.ts.net:8443",
  targetDeviceId: "dev_a",
  eventId: "evt_1",
  title: "Build",
  body: "Finished",
};

describe("FCM HTTP v1 sender", () => {
  it("exchanges a service-account JWT once and sends data-only messages", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-1", expires_in: 3600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "projects/hark/messages/1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "projects/hark/messages/2" })));
    const send = createFcmSender({
      projectId: "hark-project",
      serviceAccount: testServiceAccount(),
      fetch,
      now: () => 1_800_000_000_000,
    });

    const result = await send([
      { token: "fcm-a", envelope },
      { token: "fcm-b", envelope: { ...envelope, eventId: "evt_2" } },
    ]);

    expect(result).toEqual({
      accepted: 2,
      errors: [],
      staleTokens: [],
      retryableFailures: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    const request = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)) as {
      message: Record<string, unknown>;
    };
    expect(request.message).toMatchObject({ token: "fcm-a", android: { priority: "HIGH" } });
    expect(JSON.parse((request.message.data as { hark: string }).hark)).toEqual(envelope);
    expect(request.message).not.toHaveProperty("notification");
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: "Bearer access-1",
    });
  });

  it("marks only provider-identified invalid registration tokens as stale", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-1" })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              status: "NOT_FOUND",
              message: "Requested entity was not found.",
              details: [
                {
                  "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                  errorCode: "UNREGISTERED",
                },
              ],
            },
          }),
          { status: 404 },
        ),
      );
    const send = createFcmSender({
      projectId: "hark-project",
      serviceAccount: testServiceAccount(),
      fetch,
    });

    const result = await send([{ token: "dead-fcm-token", envelope }]);

    expect(result.accepted).toBe(0);
    expect(result.staleTokens).toEqual(["dead-fcm-token"]);
    expect(result.retryableFailures).toBe(0);
    expect(result.errors[0]).toContain("NOT_FOUND");
    expect(result.errors[0]).not.toContain("dead-fcm-token");
  });

  it("rejects malformed envelopes before calling the provider", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-1" })));
    const send = createFcmSender({
      projectId: "hark-project",
      serviceAccount: testServiceAccount(),
      fetch,
    });

    const result = await send([
      {
        token: "fcm-a",
        envelope: { ...envelope, backendOrigin: "not a URL" },
      },
    ]);

    expect(result).toEqual({
      accepted: 0,
      errors: ["Invalid Hark FCM envelope"],
      staleTokens: [],
      retryableFailures: 0,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries transient provider failures with bounded backoff", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-1" })))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("throttled", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "projects/hark/messages/1" })));
    const sleep = vi.fn(async () => undefined);
    const send = createFcmSender({
      projectId: "hark-project",
      serviceAccount: testServiceAccount(),
      fetch,
      sleep,
    });

    await expect(send([{ token: "fcm-a", envelope }])).resolves.toEqual({
      accepted: 1,
      errors: [],
      staleTokens: [],
      retryableFailures: 0,
    });
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("reports exhausted transient failures separately", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-1" })))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const send = createFcmSender({
      projectId: "hark-project",
      serviceAccount: testServiceAccount(),
      fetch,
      sleep: async () => undefined,
    });

    const result = await send([{ token: "fcm-a", envelope }]);
    expect(result).toMatchObject({ accepted: 0, retryableFailures: 1 });
    expect(result.errors).toEqual(["network unavailable"]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
