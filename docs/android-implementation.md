# Android implementation

Approved scope: Android-only app, Google OAuth through existing Better Auth, private Node/SQLite backend initially served at https://sietch.sole-pierce.ts.net:8443, direct FCM, native Live Updates. Public Railway deployment remains a later option. No physical-phone testing before the user wakes.

Identity: application ID `dev.kabilan.hark`, app scheme `hark-android`, display name `Hark`. CLI name and webhook/activity endpoints remain compatible.

Backend origin is build configuration, never the upstream service fallback. Android registration uses `platform: android`, `fcmToken`, and explicit notification/activity capabilities. Old iOS devices are not delivery targets.

## FCM protocol v1

FCM messages are data-only. Native Android owns rendering and actions. Use one receiver integration so Expo cannot display a second copy. All FCM data values are strings. `hark` contains a JSON object with `v: 1` and `kind`:

- `notification`: existing notification data fields plus title/body; preserve eventId, serviceId, projectId, URL and interaction credentials.
- `notification.withdraw`: eventId.
- `activity`: activityId, sequence (monotonically increasing server number), event (`start`, `update`, `end`), state (full existing LiveActivityProps), expiresAt (ISO timestamp), optional dismissAfterSeconds. Include source title and deep link if appropriate.

Native persistence keys include backend origin and activityId. Store sequence, terminal, dismissed/unpinned state. End never becomes active again through an older update. Local dismissal prevents subsequent automatic promotion/reposting for that activity. A new explicit activity ID is a new lifecycle.

Activity promotion is user opt-in for watched tasks; native code must check OS support and promotion settings. Regular progress notifications remain functional when promotion is unavailable. No permanent foreground service solely for remote monitoring.

Interaction responses use existing backend actionDigest and scoped responseToken contracts. Never approve because of receipt, timeout, a retry or a network failure. Backend validates ownership, expiry and action identity.

## Integration

Coordinator owns Google Console, auth/owner restrictions, secrets, origin setup, repository workflows, final integration and verification. Backend core owns shared contracts, device schema/registration, FCM sender and entitlements. Backend activity worker owns activity transport and activity routes only, coordinating protocol with core. App worker owns Expo config, UI and JS client. Native worker owns local Android module/config plugin, receiver/rendering/actions and native tests. Environment worker owns flake/envrc and emulator startup scripts.

Acceptance: actual Google session and registration; webhook-to-emulator notification; approval round trip; start/update/end and ordering/dismissal probes; offline/restart behavior; signed standalone APK; persistent backend and restore-tested backup. Record partial verification honestly. Pixel tests are deferred.
