import {
  type AndroidNotificationAction,
  type AndroidNotificationEnvelope,
  type HarkPushEnvelope,
  type InteractionKind,
  PUSH_SCHEMA_VERSION,
  truncateToUtf8Bytes,
  type WebhookRequest,
} from "@hark/contracts";
import { env } from "../env";
import { type FcmMessage, type FcmSendResult, sendFcmMessages } from "./fcm";

export interface ServiceDefaults {
  title: string;
  imageUrl: string | null;
  url: string | null;
}

export interface ResolvedNotification {
  title: string;
  body: string;
  imageUrl?: string;
  url?: string;
  /** Sender-supplied digest; when present it replaces the body in push text. */
  summary?: string;
}

/** Webhook overrides win; otherwise fall back to the service defaults. */
export function resolveNotification(
  service: ServiceDefaults,
  request: WebhookRequest,
): ResolvedNotification {
  return {
    title: request.title ?? service.title,
    body: request.body,
    imageUrl: request.imageUrl ?? service.imageUrl ?? undefined,
    url: request.url ?? service.url ?? undefined,
    ...(request.summary !== undefined ? { summary: request.summary } : {}),
  };
}

export interface BuildPushInput {
  to: PushTarget[];
  eventId: string;
  serviceId: string;
  /** Retained for call-site compatibility. Android groups notifications locally. */
  conversationKey?: string;
  projectId?: string;
  resolved: ResolvedNotification;
}

export interface PushTarget {
  token: string;
  deviceId: string;
}

const WELCOME_MESSAGES = [
  {
    body: "Hark is connected to your backend. You're ready to receive notifications.",
    url: `${env.APP_URL}/dashboard`,
  },
] as const;

const FCM_DATA_LIMIT_BYTES = 4_096;

function fcmDataSize(envelope: HarkPushEnvelope): number {
  return Buffer.byteLength(JSON.stringify({ hark: JSON.stringify(envelope) }), "utf8");
}

/** Keep the sole FCM data field within its 4 KiB limit without splitting UTF-8. */
function fitNotificationEnvelope(
  envelope: AndroidNotificationEnvelope,
): AndroidNotificationEnvelope {
  if (fcmDataSize(envelope) <= FCM_DATA_LIMIT_BYTES) return envelope;
  const characters = Array.from(envelope.body);
  let low = 0;
  let high = characters.length;
  let best = "…";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidateBody = `${characters.slice(0, middle).join("")}…`;
    const candidate = { ...envelope, body: candidateBody };
    if (fcmDataSize(candidate) <= FCM_DATA_LIMIT_BYTES) {
      best = candidateBody;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const fitted = { ...envelope, body: best };
  if (fcmDataSize(fitted) <= FCM_DATA_LIMIT_BYTES) return fitted;
  const minimal = { ...fitted, avatarUrl: undefined, url: undefined };
  if (fcmDataSize(minimal) <= FCM_DATA_LIMIT_BYTES) return minimal;
  return { ...minimal, body: truncateToUtf8Bytes(best, 512) };
}

function notificationMessage(
  target: PushTarget,
  envelope: AndroidNotificationEnvelope,
): FcmMessage {
  return { token: target.token, envelope: fitNotificationEnvelope(envelope) };
}

export function buildWelcomePushMessages(to: PushTarget): FcmMessage[] {
  return WELCOME_MESSAGES.map((message, index) =>
    notificationMessage(to, {
      v: PUSH_SCHEMA_VERSION,
      kind: "notification",
      backendOrigin: env.APP_URL,
      targetDeviceId: to.deviceId,
      eventId: `hark-welcome-${index + 1}`,
      title: "Hark",
      body: message.body,
      serviceId: "hark-welcome",
      url: message.url,
    }),
  );
}

export function buildPushMessages(input: BuildPushInput): FcmMessage[] {
  const { to, eventId, serviceId, projectId, resolved } = input;
  return to.map((target) =>
    notificationMessage(target, {
      v: PUSH_SCHEMA_VERSION,
      kind: "notification",
      backendOrigin: env.APP_URL,
      targetDeviceId: target.deviceId,
      eventId,
      serviceId,
      conversationId: `hark-${input.conversationKey ?? serviceId}`,
      title: resolved.title,
      body: resolved.summary ?? resolved.body,
      ...(projectId ? { projectId } : {}),
      ...(resolved.imageUrl ? { avatarUrl: resolved.imageUrl } : {}),
      ...(resolved.url ? { url: resolved.url } : {}),
    }),
  );
}

export function buildNotificationWithdrawalPushMessages(
  to: PushTarget[],
  eventId: string,
): FcmMessage[] {
  return to.map((target) => ({
    token: target.token,
    envelope: {
      v: PUSH_SCHEMA_VERSION,
      kind: "notification.withdraw",
      backendOrigin: env.APP_URL,
      targetDeviceId: target.deviceId,
      eventId,
    },
  }));
}

export interface BuildInteractionPushInput {
  to: PushTarget[];
  interactionId: string;
  kind: InteractionKind;
  title: string;
  prompt: string;
  actionDigest: string;
  responseToken: string;
  expiresAt?: string;
  eventId?: string;
  imageUrl?: string;
  url?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}

function interactionActions(input: BuildInteractionPushInput): AndroidNotificationAction[] {
  if (input.kind === "approval") {
    return [
      { id: "approve", title: input.primaryLabel ?? "Approve" },
      { id: "deny", title: input.secondaryLabel ?? "Deny", destructive: true },
    ];
  }
  if (input.kind === "yes_no") {
    return [
      { id: "yes", title: input.primaryLabel ?? "Yes" },
      { id: "no", title: input.secondaryLabel ?? "No" },
    ];
  }
  return [{ id: "reply", title: input.primaryLabel ?? "Reply" }];
}

export function buildInteractionPushMessages(input: BuildInteractionPushInput): FcmMessage[] {
  return input.to.map((target) =>
    notificationMessage(target, {
      v: PUSH_SCHEMA_VERSION,
      kind: "notification",
      backendOrigin: env.APP_URL,
      targetDeviceId: target.deviceId,
      eventId: input.eventId ?? input.interactionId,
      title: input.title,
      body: input.prompt,
      ...(input.imageUrl ? { avatarUrl: input.imageUrl } : {}),
      ...(input.url ? { url: input.url } : {}),
      interaction: {
        id: input.interactionId,
        kind: input.kind,
        actionDigest: input.actionDigest,
        responseToken: input.responseToken,
        responseUrl: `${env.APP_URL}/api/interaction-responses/${input.interactionId}/respond`,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        actions: interactionActions(input),
      },
    }),
  );
}

export type SendResult = FcmSendResult;

/** Compatibility name used by existing routes during the Android migration. */
export const sendPushMessages = sendFcmMessages;
