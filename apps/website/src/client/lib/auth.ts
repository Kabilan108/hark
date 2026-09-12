import { createAuthClient } from "better-auth/react";
import { markAuthPending, trackWebEvent } from "./analytics";

export const authClient = createAuthClient();

export const { useSession, signOut } = authClient;

export function signInWithGoogle(callbackURL = "/dashboard"): Promise<unknown> {
  markAuthPending("google");
  trackWebEvent("auth_started", {
    path: window.location.pathname,
    properties: { provider: "google" },
  });
  return authClient.signIn.social({
    provider: "google",
    callbackURL,
  });
}
