import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: "session" as string | undefined,
  store: new Map<string, string>(),
  submissions: [] as Array<{ id: string; input: Record<string, unknown> }>,
  submit: undefined as
    | ((id: string, input: Record<string, unknown>) => Promise<unknown>)
    | undefined,
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => state.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    state.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    state.store.delete(key);
  },
}));

vi.mock("./auth", () => ({ getCookie: () => state.cookie }));
vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number) {
      super("API error");
      this.status = status;
    }
  },
  api: {
    respondToInteraction: async (id: string, input: Record<string, unknown>) => {
      state.submissions.push({ id, input });
      return state.submit?.(id, input);
    },
    respondToInteractionWithToken: async (id: string, input: Record<string, unknown>) => {
      state.submissions.push({ id, input });
      return state.submit?.(id, input);
    },
  },
}));

import {
  clearInteractionResponses,
  DEVICE_ID_KEY,
  flushInteractionResponses,
  submitInteractionResponse,
} from "./interactions";

const QUEUE_KEY = "hark.interaction.responseQueue.v1";
const DIGEST = "a".repeat(64);

afterEach(async () => {
  vi.clearAllMocks();
  state.cookie = "session";
  state.submit = undefined;
  state.submissions.length = 0;
  await clearInteractionResponses();
  state.store.clear();
});

describe("interaction response queue", () => {
  it("uses the durable queue for an in-app response", async () => {
    await submitInteractionResponse("int_inbox", {
      action: "reply",
      response: "Ship it",
      actionDigest: DIGEST,
    });
    expect(state.submissions).toHaveLength(0);
    expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toEqual([
      {
        interactionId: "int_inbox",
        input: { action: "reply", response: "Ship it", actionDigest: DIGEST },
      },
    ]);
  });

  it("preserves a response until registration provides a device ID", async () => {
    await submitInteractionResponse("int_upgrade", { action: "approve", actionDigest: DIGEST });
    expect(state.submissions).toHaveLength(0);
    expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toEqual([
      {
        interactionId: "int_upgrade",
        input: { action: "approve", actionDigest: DIGEST },
      },
    ]);

    state.store.set(DEVICE_ID_KEY, "dev_registered");
    await flushInteractionResponses();
    expect(state.submissions).toEqual([
      {
        id: "int_upgrade",
        input: { action: "approve", actionDigest: DIGEST, deviceId: "dev_registered" },
      },
    ]);
    expect(state.store.has(QUEUE_KEY)).toBe(false);
  });

  it("automatically drains a response enqueued during a flush", async () => {
    state.store.set(DEVICE_ID_KEY, "dev_1");
    let releaseFirst: (() => void) | undefined;
    state.submit = (id) =>
      id === "int_first"
        ? new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve();

    const first = submitInteractionResponse("int_first", {
      action: "approve",
      actionDigest: DIGEST,
    });
    await vi.waitFor(() => expect(state.submissions).toHaveLength(1));
    const second = submitInteractionResponse("int_second", {
      action: "approve",
      actionDigest: DIGEST,
    });
    await vi.waitFor(() => expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toHaveLength(2));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(state.submissions.map(({ id }) => id)).toEqual(["int_first", "int_second"]);
    expect(state.store.has(QUEUE_KEY)).toBe(false);
  });

  it("coalesces concurrent flushes", async () => {
    state.cookie = undefined;
    await submitInteractionResponse("int_once", { action: "approve", actionDigest: DIGEST });
    state.cookie = "session";
    state.store.set(DEVICE_ID_KEY, "dev_1");

    await Promise.all([flushInteractionResponses(), flushInteractionResponses()]);
    expect(state.submissions.map(({ id }) => id)).toEqual(["int_once"]);
  });
});
