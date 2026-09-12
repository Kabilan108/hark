# Android fork verification

Verified on sietch on 2026-09-12. The physical Pixel 9 has not been accessed.

## Running deployment

- Backend: `https://sietch.sole-pierce.ts.net:8443`, systemd user service `hark`.
- API listener: `127.0.0.1:8787`. Existing Tailscale Serve mappings, including T3 on port 443, were compared with the original snapshot and preserved.
- Database: `/vault/userdata/hark/hark.sqlite`. An online backup was opened independently and passed SQLite integrity checking.
- Google OAuth: owner sign-in tested in the web dashboard and the Android app. Emulator sign-in used the original Expo authorization proxy in the already authenticated desktop browser, then returned its real native callback to the emulator. OAuth state checking remained enabled.
- FCM: dedicated sender service account. Token exchange and validation-only send returned HTTP 200. Real sends also reached the emulator.

## Android build

- Application: `dev.kabilan.hark`, version 1.2.0, version code 1.
- Emulator: `hark-pixel9-api37`, Android 17/API 37, `emulator-5554`.
- Standalone release contains ARM64 and x86_64 native libraries. APK v2 signature verified. Metro was stopped for final application testing.
- Download: `https://sietch.sole-pierce.ts.net:8443/downloads/hark-android.apk`.
- Artifact: `/vault/userdata/hark/builds/hark-1.2.0-android-release.apk`.
- SHA-256: `54546aa703ca674b480a5a97744509e125093aa47a5876e4099224249e7bddeb`.
- Rebuild and signing instructions: [android-running.md](android-running.md).

## Automated checks

Passed 230 website tests, 39 Expo tests, 40 contract tests, 54 CLI tests, and 8 native unit tests. Type checks, integrated Biome lint, website production build, release APK build, Compose configuration, and staged diff checks passed. A staged-content scan found no actual OAuth/private-key/backend-secret values or generated native artifacts.

Review fixes cover late FCM results overwriting a terminal activity, expired interaction actions remaining visible, and the Expo native configuration method returning an unserializable renderer instance.

## Device checks

Normal app sign-in, notification permission, and backend registration succeeded. A real CLI approval was delivered to the registered emulator, displayed in Android System UI, and approved by tapping its action. An independent backend read confirmed the response and the exact responding device. In airplane mode, tapping Approve left the backend pending; after reconnection, WorkManager submitted the response successfully.

A separate fixture exercised the production native receiver through real FCM with temporary native preferences. It passed notification delivery and withdrawal, activity start/update, rejection of older sequences, terminal display and delayed removal, and process-death delivery. Fixture dismissal invoked the native receiver synthetically and proved persisted suppression of later reposting; this alone does not prove the System UI dismissal affordance.

Real backend activity start/update/end also passed with the app in the background. The status-bar chip was visible and Android dumpsys reported `PROMOTED_ONGOING` with `android.requestPromotedOngoing=true`. A terminal update displayed and disappeared after its configured two-second delay. Promotion was confirmed from this specific background test, not inferred from FCM acceptance or from the earlier empty notification-shade capture.

A final real System UI Unpin check also passed. Unpin persisted the activity's dismissed state, and a subsequent backend update was accepted without reposting its notification. Test activities were ended, the temporary CLI authorization was revoked, and temporary OAuth material was removed. The emulator remains signed in with notifications allowed.

## Remaining phone coverage

Pixel 9 installation, Google sign-in on the physical phone, manufacturer presentation of Live Updates, lock-screen behavior, and battery/Doze behavior need user-assisted testing. Android renders activities using its standard progress layout; Apple-specific visual skins, source avatars, and native service threading are not ported.

## Dark mode update, version 1.2.1

Version code 2 follows the Android system theme across app screens, status bars, and the native root background, with a dark splash background. Expo type checking, scoped Biome checks, and the signed dual-ABI release build passed. Installing over the previous emulator release preserved login. Dark inbox and settings were inspected, and switching an open settings screen back to light mode updated its colors and status bar without restarting the app.

The download now serves `/vault/userdata/hark/builds/hark-1.2.1-android-release.apk`, SHA-256 `9db6ce72f13eb1fc7170ffbaa5de03713987f5ab1a5e0266ebe2c56beeeb0969`. The earlier 1.2.0 artifact remains archived.
