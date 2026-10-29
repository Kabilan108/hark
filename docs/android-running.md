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

Start from `apps/website` with `node --env-file=/absolute/path/backend.env dist/server/index.js` inside the dev shell. From that directory the server finds `drizzle/` and `dist/client/`; elsewhere, set `HARK_MIGRATIONS_DIR` and `HARK_CLIENT_DIR`. `HARK_DOWNLOADS_DIR` holds published APKs and defaults to `dist/client/downloads/`. The process runs migrations before listening. Its health endpoint is `/api/health`.

A development backend for an emulator build runs from the checkout with `direnv exec "$PWD" corepack pnpm --filter @hark/website dev:api`. It listens on port 8788 and reads the repository's `.env`. Link `.env` to a development environment file that leaves `DATABASE_URL` unset, so the database is `apps/website/data/hark.sqlite`; never link it to production settings. Google sign-in against it needs its own registered redirect URI.

On sietch, Hark uses `https://hark.sole-pierce.ts.net`, proxied by Tailscale Services to `127.0.0.1:8787`. The base host port 443 belongs to T3. Preserve other Serve mappings. External webhook senders cannot reach this private endpoint; a public deployment or separately authorized ingress is needed for them.

Docker Compose mounts persistent SQLite data and the server-only FCM credential. It binds the host port to loopback, suitable for a local HTTPS proxy. A Railway deployment can use the Dockerfile with a persistent volume at `/data` and a securely mounted or provisioned credential file. Never use an ephemeral SQLite filesystem for deployment.

## Android configuration

Create the Android app `dev.kabilan.hark` in the same Firebase project and download its `google-services.json`. In `apps/expo/.env.local`, set `GOOGLE_SERVICES_JSON` to its absolute path and `EXPO_PUBLIC_API_URL` to the backend HTTPS origin. The Android configuration file is embedded in the application; the server service-account private key must never be included.

Use the repository's Android emulator scripts from the dev shell. Always give ADB an explicit emulator serial. Maintained native code lives in `apps/expo/modules/hark-android` and config plugins. Expo prebuild regenerates `apps/expo/android`.

Build a signed standalone APK with the maintained release script:

```sh
direnv exec "$PWD" scripts/android-build-release
```

The signing properties default to `/run/agenix/hark-android-signing-properties`, decrypted from dotfiles on sietch; set `HARK_ANDROID_SIGNING_PROPERTIES` to use another file. The file must remain outside the repository and must not be readable by group or other users. It uses Java properties syntax and contains `HARK_RELEASE_STORE_FILE`, `HARK_RELEASE_STORE_PASSWORD`, `HARK_RELEASE_KEY_ALIAS`, and `HARK_RELEASE_KEY_PASSWORD`. The script runs a clean Expo Android prebuild, adds release signing to the generated Gradle project, builds `arm64-v8a` and `x86_64`, verifies the APK signature, and publishes the APK as `/vault/userdata/hark-downloads/hark-android-<version>.apk`, which the backend serves immediately. Set `HARK_ANDROID_RELEASE_APK` to override that destination. It passes Gradle the properties-file path without putting passwords on the command line. The keystore and properties file are agenix secrets in dotfiles, with a copy in Vaultwarden. Losing the keystore prevents signing an upgrade for an installed release.

To regenerate and inspect the signed Gradle configuration without compiling an APK, use:

```sh
direnv exec "$PWD" scripts/android-build-release --configure-only
```

After signing in, grant notification permission. Enable watched activities in settings for ongoing progress notifications. Android decides whether eligible notifications receive promoted Live Update presentation. Ordinary progress notifications remain the fallback.

## Verification boundaries

FCM accepting a message does not prove that Android displayed it. Test webhook receipt, system notification display, action responses, activity ordering and termination, dismissal, and process restart separately. Android force-stop prevents background delivery until the app is opened again.

Keep release signing material outside Git and retain it for future upgrades. Emulator debug builds are not Pixel installation artifacts. Pixel 9 needs an ARM64 standalone build.

## SQLite backups

Use SQLite's online backup operation while the process runs. Do not copy only the main database file while WAL writes are active. A clean shutdown checkpoints the WAL. Restore a backup to a separate path and run `PRAGMA integrity_check` before relying on it.

On sietch the database belongs to the `hark` user, so run the backup as that user:

```sh
sudo -u hark sqlite3 /vault/userdata/hark-server/hark.sqlite \
  ".backup /vault/userdata/hark-server/backups/hark-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

Scheduled off-host backups of `/vault/userdata/hark-server/` and the Android release material in `/vault/userdata/hark/` belong to the fleet-wide backup setup in dotfiles.

## NixOS service on sietch

The flake exports `packages.hark-server`, `overlays.default` (adding `hark-server` and `harkctl`) and `nixosModules.default` (`services.hark`). dotfiles imports the module in `modules/nixos/selfhost/hark.nix` and runs a pinned build of this repository from its `hark` input, as the `hark` system user. The checkout is not used at runtime.

- State: `/vault/userdata/hark-server/hark.sqlite`, owned by `hark` with mode 0700. The unit refuses to start if the database is missing, so an unmounted volume cannot start an empty instance.
- Secrets: agenix `selfhost-hark-env` (environment) and `selfhost-hark-fcm-service-account` (passed as a systemd credential). The unit itself sets `HOST`, `PORT`, `DATABASE_URL`, `NODE_ENV` and `FCM_SERVICE_ACCOUNT_FILE`; keep them out of the environment file, which would override them.
- Downloads: `/vault/userdata/hark-downloads/`, read-only to the service. `/downloads/latest` redirects to the newest release.

To deploy a change, merge it to `main`, run `nix flake update hark` in dotfiles, and rebuild sietch. Use `journalctl -u hark` for logs. `nix build .#checks.x86_64-linux.hark-vm` runs the module in a NixOS VM.

The canonical origin, app API URL, CLI default, and Google OAuth callback use `https://hark.sole-pierce.ts.net`, proxied by Tailscale Services to `127.0.0.1:8787`. The Google redirect is `/api/auth/callback/google` on that origin.
