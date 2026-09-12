import type { InteractionResponseInput } from "@hark/contracts";
import * as SecureStore from "expo-secure-store";
import { ApiError, api } from "./api";
import { getCookie } from "./auth";

export { DEVICE_ID_KEY } from "./device-keys";

import { DEVICE_ID_KEY } from "./device-keys";

const RETRY_QUEUE_KEY = "hark.interaction.responseQueue.v1";
const MAX_QUEUED_RESPONSES = 20;

export type InteractionActionInput =
  | { action: "approve" | "deny" | "yes" | "no"; actionDigest: string }
  | { action: "reply"; response: string; actionDigest: string };

interface QueuedResponse {
  interactionId: string;
  input: InteractionActionInput;
}

let queueMutation = Promise.resolve();
let flushing: Promise<void> | null = null;
let flushRequested = false;

function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueMutation.then(operation, operation);
  queueMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readQueue(): Promise<QueuedResponse[]> {
  try {
    const value = await SecureStore.getItemAsync(RETRY_QUEUE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedResponse =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as QueuedResponse).interactionId === "string" &&
        typeof (item as QueuedResponse).input === "object" &&
        (item as QueuedResponse).input !== null &&
        typeof (item as QueuedResponse).input.actionDigest === "string",
    );
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedResponse[]): Promise<void> {
  if (queue.length === 0) {
    await SecureStore.deleteItemAsync(RETRY_QUEUE_KEY);
    return;
  }
  await SecureStore.setItemAsync(
    RETRY_QUEUE_KEY,
    JSON.stringify(queue.slice(-MAX_QUEUED_RESPONSES)),
  );
}

async function enqueue(response: QueuedResponse): Promise<void> {
  flushRequested = true;
  await withQueueLock(async () => {
    const queue = await readQueue();
    if (queue.some((item) => item.interactionId === response.interactionId)) return;
    queue.push(response);
    await writeQueue(queue);
  });
}

function isTerminalApiError(error: unknown): boolean {
  return error instanceof ApiError && [400, 404, 409].includes(error.status);
}

async function submitOrQueue(response: QueuedResponse): Promise<void> {
  await enqueue(response);
  await flushInteractionResponses();
}

export async function submitInteractionResponse(
  interactionId: string,
  input: InteractionActionInput,
): Promise<void> {
  await submitOrQueue({ interactionId, input });
}

export async function flushInteractionResponses(): Promise<void> {
  if (flushing) {
    flushRequested = true;
    return flushing;
  }
  const task = (async () => {
    while (true) {
      flushRequested = false;
      const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (!deviceId) return;
      const queue = await withQueueLock(readQueue);
      if (queue.length === 0) {
        if (flushRequested) continue;
        return;
      }
      const completed = new Set<string>();
      for (const response of queue) {
        try {
          if (!getCookie()) continue;
          const input: InteractionResponseInput = { ...response.input, deviceId };
          await api.respondToInteraction(response.interactionId, input);
          completed.add(response.interactionId);
        } catch (error) {
          if (isTerminalApiError(error)) completed.add(response.interactionId);
        }
      }
      if (completed.size === 0) return;
      await withQueueLock(async () => {
        const current = await readQueue();
        await writeQueue(current.filter((response) => !completed.has(response.interactionId)));
      });
      // Continue immediately so work enqueued during this pass cannot be stranded.
    }
  })();
  flushing = task;
  try {
    await task;
  } finally {
    if (flushing === task) flushing = null;
  }
}

export async function clearInteractionResponses(): Promise<void> {
  await withQueueLock(async () => {
    await SecureStore.deleteItemAsync(RETRY_QUEUE_KEY);
  });
}
