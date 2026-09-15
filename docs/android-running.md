# Running the Android fork

Hark uses a Node/Hono API and SQLite database on your own host. Android messages go directly through FCM HTTP v1. Google OAuth identifies the owner; Firebase is used for messaging. Expo builds locally without an Expo account or EAS.

## Local deployment

Enter the Nix environment with `direnv allow`, then run project commands with `direnv exec "$PWD" ...`. Install dependencies with `corepack pnpm install --frozen-lockfile` in that environment.

Copy `.env.example` to a private file and link it as `.env`. Set `OWNER_EMAIL` to the only Google account allowed to sign in. Set a random `BETTER_AUTH_SECRET`, Google OAuth web client credentials, `SELF_HOSTED_MODE=true`, and both FCM settings. Keep the FCM service-account JSON outside the repository. Grant its service account the Firebase Cloud Messaging API Admin role in the same project used by the Android app.

The Google OAuth redirect URI is `${APP_URL}/api/auth/callback/google`. Use the externally reachable HTTPS origin, including its port. Add the owner's email as a test user while the OAuth application is in testing mode.

Build the backend:

```sh
direnv exec "$PWD" corepack pnpm --filter @hark/website build
```

Start from `apps/website` with `node --env-file=/absolute/path/backend.env dist/server/index.js` inside the dev shell. This working directory is required for the static assets and migrations. The process runs migrations before listening. Its health endpoint is `/api/health`.

On sietch, Hark uses `https://hark.sole-pierce.ts.net`, proxied by Tailscale Services to `127.0.0.1:8787`. The base host port 443 belongs to T3. Preserve other Serve mappings. External webhook senders cannot reach this private endpoint; a public deployment or separately authorized ingress is needed for them.

Docker Compose mounts persistent SQLite data and the server-only FCM credential. It binds the host port to loopback, suitable for a local HTTPS proxy. A Railway deployment can use the Dockerfile with a persistent volume at `/data` and a securely mounted or provisioned credential file. Never use an ephemeral SQLite filesystem for deployment.

## Android configuration

Create the Android app `dev.kabilan.hark` in the same Firebase project and download its `google-services.json`. In `apps/expo/.env.local`, set `GOOGLE_SERVICES_JSON` to its absolute path and `EXPO_PUBLIC_API_URL` to the backend HTTPS origin. The Android configuration file is embedded in the application; the server service-account private key must never be included.

Use the repository's Android emulator scripts from the dev shell. Always give ADB an explicit emulator serial. Maintained native code lives in `apps/expo/modules/hark-android` and config plugins. Expo prebuild regenerates `apps/expo/android`.

Build a signed standalone APK with the maintained release script:

```sh
direnv exec "$PWD" env \
  HARK_ANDROID_SIGNING_PROPERTIES=/vault/userdata/hark/secrets/android-release-signing.properties \
  scripts/android-build-release
```

The signing properties file must remain outside the repository with mode `600`. It uses Java properties syntax and contains `HARK_RELEASE_STORE_FILE`, `HARK_RELEASE_STORE_PASSWORD`, `HARK_RELEASE_KEY_ALIAS`, and `HARK_RELEASE_KEY_PASSWORD`. The script runs a clean Expo Android prebuild, adds release signing to the generated Gradle project, builds `arm64-v8a` and `x86_64`, verifies the APK signature, and copies the APK to `/vault/userdata/hark/builds/hark-android-<version>.apk`. Set `HARK_ANDROID_RELEASE_APK` to override that destination. It passes Gradle the properties-file path without putting passwords on the command line. Keep the keystore and properties file together in a private backup. Losing the keystore prevents signing an upgrade for an installed release.

To regenerate and inspect the signed Gradle configuration without compiling an APK, use:

```sh
direnv exec "$PWD" env \
  HARK_ANDROID_SIGNING_PROPERTIES=/vault/userdata/hark/secrets/android-release-signing.properties \
  scripts/android-build-release --configure-only
```

After signing in, grant notification permission. Enable watched activities in settings for ongoing progress notifications. Android decides whether eligible notifications receive promoted Live Update presentation. Ordinary progress notifications remain the fallback.

## Verification boundaries

FCM accepting a message does not prove that Android displayed it. Test webhook receipt, system notification display, action responses, activity ordering and termination, dismissal, and process restart separately. Android force-stop prevents background delivery until the app is opened again.

Keep release signing material outside Git and retain it for future upgrades. Emulator debug builds are not Pixel installation artifacts. Pixel 9 needs an ARM64 standalone build.

## SQLite backups

Use SQLite's online backup operation while the process runs. Do not copy only the main database file while WAL writes are active. A clean shutdown checkpoints the WAL. Restore a backup to a separate path and run `PRAGMA integrity_check` before relying on it.

## NixOS service on sietch

The active system service is declared in `~/dotfiles/modules/nixos/selfhost/hark.nix`. It runs Node 24 against this checkout's built website, reads `/vault/userdata/hark/secrets/backend.env`, and uses the existing SQLite database. It does not build during boot. Keep the checkout, dependencies, built assets, and private environment file available. Secrets stay outside the Nix store.

Use `sudo systemctl restart hark` after backend builds and `journalctl -u hark` for logs. The former user service is disabled and inactive. Its old port-8443 Tailscale mapping has been removed. T3 and other Tailscale Services are unchanged.

The canonical origin, app API URL, CLI default, and Google OAuth callback now use `https://hark.sole-pierce.ts.net`. The Google redirect is `/api/auth/callback/google` on that origin. Existing webhook tokens remain valid with the new hostname; copy the updated URL from the dashboard.

After each website build, restore versioned APKs from `/vault/userdata/hark/builds/` to `apps/website/dist/client/downloads/`. The current download is `/downloads/hark-android-1.3.0.apk`.
