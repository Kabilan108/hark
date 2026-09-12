import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import {
  isAllowedGoogleOwnerProfile,
  isAllowedOwnerAccount,
  isAllowedOwnerAccountDeletion,
  isAllowedOwnerUserRecord,
  isAuthorizedOwnerUser,
} from "./lib/owner";

function rejectUnauthorizedIdentity(): never {
  throw new APIError("FORBIDDEN", {
    message: "This Google account is not authorized for this Hark server.",
  });
}

export const auth = betterAuth({
  appName: "Hark",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  account: {
    encryptOAuthTokens: true,
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      disableDefaultScope: true,
      scope: ["openid", "email", "profile"],
      mapProfileToUser: async (profile) => {
        if (!(await isAllowedGoogleOwnerProfile(profile))) rejectUnauthorizedIdentity();
        return {};
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedOwnerUserRecord(user)) rejectUnauthorizedIdentity();
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          if (!isAllowedOwnerAccount(account)) rejectUnauthorizedIdentity();
        },
      },
      delete: {
        before: async (account) => {
          if (!isAllowedOwnerAccountDeletion(account)) rejectUnauthorizedIdentity();
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          if (!(await isAuthorizedOwnerUser(session.userId))) rejectUnauthorizedIdentity();
        },
      },
    },
  },
  plugins: [expo()],
  trustedOrigins: [env.APP_URL, "hark-android://", "hark-android://*"],
});

const PUBLIC_AUTH_PATHS = new Set([
  "/error",
  "/expo-authorization-proxy",
  "/ok",
  "/sign-in/social",
  "/sign-out",
]);

/**
 * Keeps Better Auth's own account endpoints behind the same owner policy as Hark APIs.
 * A stale non-owner session is removed when it is presented to this private server.
 */
export async function handleAuthRequest(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const authPath = pathname.startsWith("/api/auth") ? pathname.slice("/api/auth".length) : pathname;

  if (authPath === "/get-session") {
    const currentSession = await auth.api.getSession({ headers: request.headers });
    if (currentSession && !(await isAuthorizedOwnerUser(currentSession.user.id))) {
      await db.delete(schema.session).where(eq(schema.session.id, currentSession.session.id));
      return Response.json(null, {
        headers: { "cache-control": "no-store", pragma: "no-cache" },
      });
    }
  } else if (!PUBLIC_AUTH_PATHS.has(authPath) && authPath !== "/callback/google") {
    const currentSession = await auth.api.getSession({ headers: request.headers });
    if (!currentSession || !(await isAuthorizedOwnerUser(currentSession.user.id))) {
      if (currentSession) {
        await db.delete(schema.session).where(eq(schema.session.id, currentSession.session.id));
      }
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return auth.handler(request);
}

export type Session = typeof auth.$Infer.Session;
