import { expoClient } from "@better-auth/expo/client";
import type { BetterAuthClientPlugin } from "better-auth";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;
if (!configuredApiUrl) throw new Error("This build is missing EXPO_PUBLIC_API_URL");
export const API_URL = configuredApiUrl.replace(/\/$/, "");

// The cast works around a known @better-auth/expo type mismatch against
// better-auth's BetterAuthClientPlugin (see better-auth #2031); the plugin is
// correct at runtime.
const expoPlugin = expoClient({
  scheme: "hark-android",
  storagePrefix: "hark-android",
  storage: SecureStore,
}) as unknown as BetterAuthClientPlugin;

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [expoPlugin],
});

/** Session cookie header value managed by the Better Auth Expo plugin. */
export function getCookie(): string {
  return (authClient as unknown as { getCookie: () => string }).getCookie();
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/** Typed wrapper around useSession (plugin cast above erases inference). */
export function useSession(): { data: { user: SessionUser } | null; isPending: boolean } {
  return authClient.useSession() as unknown as {
    data: { user: SessionUser } | null;
    isPending: boolean;
  };
}
