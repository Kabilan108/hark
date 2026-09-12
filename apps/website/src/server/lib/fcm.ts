import { readFileSync } from "node:fs";
import type { HarkPushEnvelope } from "@hark/contracts";
import { harkPushEnvelopeSchema } from "@hark/contracts";
import { importPKCS8, SignJWT } from "jose";
import { env } from "../env";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
}

export interface FcmMessage {
  token: string;
  envelope: HarkPushEnvelope;
}

export interface FcmSendResult {
  /** Messages accepted by FCM. This is not proof that a device displayed them. */
  accepted: number;
  errors: string[];
  staleTokens: string[];
  /** Targets that still failed with a retryable provider/network error after bounded retries. */
  retryableFailures: number;
}

export interface FcmSenderConfig {
  projectId: string;
  serviceAccount: GoogleServiceAccount;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5_000);
  }
  return Math.min(250 * 2 ** attempt, 2_000);
}

function parseServiceAccount(path: string): GoogleServiceAccount {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read FCM service account file: ${error instanceof Error ? error.message : "invalid JSON"}`,
    );
  }
  if (!value || typeof value !== "object") throw new Error("FCM service account must be an object");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.client_email !== "string" || typeof candidate.private_key !== "string") {
    throw new Error("FCM service account is missing client_email or private_key");
  }
  return {
    client_email: candidate.client_email,
    private_key: candidate.private_key,
    ...(typeof candidate.token_uri === "string" ? { token_uri: candidate.token_uri } : {}),
    ...(typeof candidate.project_id === "string" ? { project_id: candidate.project_id } : {}),
  };
}

function providerError(body: unknown, fallback: string): { message: string; stale: boolean } {
  if (!body || typeof body !== "object") return { message: fallback, stale: false };
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return { message: fallback, stale: false };
  const record = error as { status?: unknown; message?: unknown; details?: unknown };
  const details = Array.isArray(record.details) ? record.details : [];
  const fcmErrorCode = details
    .filter((detail): detail is Record<string, unknown> =>
      Boolean(detail && typeof detail === "object"),
    )
    .find((detail) =>
      String(detail["@type"] ?? "").endsWith("google.firebase.fcm.v1.FcmError"),
    )?.errorCode;
  const stale = fcmErrorCode === "UNREGISTERED" || fcmErrorCode === "INVALID_ARGUMENT";
  const status = typeof record.status === "string" ? record.status : fallback;
  const message = typeof record.message === "string" ? record.message : status;
  return { message: `${status}: ${message}`.slice(0, 500), stale };
}

export function createFcmSender(config: FcmSenderConfig) {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? defaultSleep;
  let accessToken: { value: string; expiresAt: number } | undefined;
  let accessTokenRequest: Promise<string> | undefined;

  async function getAccessToken(): Promise<string> {
    if (accessToken && accessToken.expiresAt - 60_000 > now()) return accessToken.value;
    if (accessTokenRequest) return accessTokenRequest;
    accessTokenRequest = (async () => {
      const tokenUri = config.serviceAccount.token_uri ?? GOOGLE_TOKEN_URI;
      const issuedAt = Math.floor(now() / 1000);
      const key = await importPKCS8(config.serviceAccount.private_key, "RS256");
      const assertion = await new SignJWT({ scope: FCM_SCOPE })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(config.serviceAccount.client_email)
        .setAudience(tokenUri)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 3600)
        .sign(key);
      const response = await fetchImpl(tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        access_token?: unknown;
        expires_in?: unknown;
      } | null;
      if (!response.ok || typeof body?.access_token !== "string") {
        throw new Error(`FCM OAuth token exchange failed with HTTP ${response.status}`);
      }
      const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
      accessToken = { value: body.access_token, expiresAt: now() + expiresIn * 1000 };
      return body.access_token;
    })();
    try {
      return await accessTokenRequest;
    } finally {
      accessTokenRequest = undefined;
    }
  }

  return async (messages: readonly FcmMessage[]): Promise<FcmSendResult> => {
    const result: FcmSendResult = {
      accepted: 0,
      errors: [],
      staleTokens: [],
      retryableFailures: 0,
    };
    if (messages.length === 0) return result;

    let bearer: string;
    try {
      bearer = await getAccessToken();
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "FCM authorization failed");
      return result;
    }

    const outcomes = await Promise.all(
      messages.map(async ({ token, envelope }) => {
        const checked = harkPushEnvelopeSchema.safeParse(envelope);
        if (!checked.success) return { accepted: false, error: "Invalid Hark FCM envelope" };
        for (let attempt = 0; attempt < 3; attempt += 1) {
          let response: Response | undefined;
          try {
            response = await fetchImpl(
              `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${bearer}`,
                  "content-type": "application/json",
                },
                signal: AbortSignal.timeout(15_000),
                body: JSON.stringify({
                  message: {
                    token,
                    data: { hark: JSON.stringify(checked.data) },
                    android: { priority: "HIGH" },
                  },
                }),
              },
            );
            const body = await response.json().catch(() => null);
            if (response.ok) return { accepted: true } as const;
            const failure = providerError(body, `FCM HTTP ${response.status}`);
            const retryable =
              response.status === 408 || response.status === 429 || response.status >= 500;
            if (retryable && attempt < 2) {
              await sleep(retryDelay(response, attempt));
              continue;
            }
            return {
              accepted: false,
              error: failure.message,
              stale: failure.stale,
              retryable,
              token,
            } as const;
          } catch (error) {
            if (attempt < 2) {
              await sleep(retryDelay(response, attempt));
              continue;
            }
            return {
              accepted: false,
              error: error instanceof Error ? error.message : "FCM request failed",
              retryable: true,
            } as const;
          }
        }
        return { accepted: false, error: "FCM request failed", retryable: true } as const;
      }),
    );

    for (const outcome of outcomes) {
      if (outcome.accepted) result.accepted += 1;
      else {
        result.errors.push(outcome.error);
        if ("stale" in outcome && outcome.stale && outcome.token) {
          result.staleTokens.push(outcome.token);
        }
        if ("retryable" in outcome && outcome.retryable) result.retryableFailures += 1;
      }
    }
    return result;
  };
}

let configuredSender: ReturnType<typeof createFcmSender> | undefined;

export async function sendFcmMessages(messages: readonly FcmMessage[]): Promise<FcmSendResult> {
  if (!env.FCM_PROJECT_ID || !env.FCM_SERVICE_ACCOUNT_FILE) {
    return {
      accepted: 0,
      errors: ["FCM is not configured"],
      staleTokens: [],
      retryableFailures: 0,
    };
  }
  if (!configuredSender) {
    try {
      const serviceAccount = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_FILE);
      if (serviceAccount.project_id && serviceAccount.project_id !== env.FCM_PROJECT_ID) {
        throw new Error("FCM service account project_id does not match FCM_PROJECT_ID");
      }
      configuredSender = createFcmSender({ projectId: env.FCM_PROJECT_ID, serviceAccount });
    } catch (error) {
      return {
        accepted: 0,
        errors: [error instanceof Error ? error.message : "FCM configuration is invalid"],
        staleTokens: [],
        retryableFailures: 0,
      };
    }
  }
  return configuredSender(messages);
}
