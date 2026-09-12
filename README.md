# Hark

https://github.com/user-attachments/assets/74fd0670-2106-4af5-93c8-d31f99b33908

This fork of Hark targets Android and runs on your own Node and SQLite backend. It turns webhooks
from CI jobs, agents, scripts, and monitors into Android notifications delivered directly through
Firebase Cloud Messaging.

[Run the Android fork](./docs/android-running.md) | [API documentation](https://sietch.sole-pierce.ts.net:8443/docs)

## Quick Start

Start with [Running the Android fork](./docs/android-running.md). It covers the backend, Google
OAuth, Firebase credentials, local Expo build, signed APK, and verification boundaries. Expo Push
Service and EAS are not used.

Run the fork's CLI with Node.js 22 or newer and point it at your backend when needed:

```sh
HARK_API_URL=https://sietch.sole-pierce.ts.net:8443 \
  node packages/harkctl/bin/harkctl.mjs auth login
```

The backend Google OAuth and direct FCM path have been validated, and a signed release APK exists.
The full webhook, notification, response, and Live Update flow still needs an emulator end-to-end
pass before it is considered verified.

## What Hark Does

- Sends Android notifications from a simple webhook through direct FCM.
- Gives each service its own title, destination URL, and secret endpoint.
- Tracks delivery attempts and registered devices in a web dashboard.
- Supports approvals and text replies for agent workflows.
- Shows stateful task progress as ongoing notifications and requests promoted Live Updates on
  supported Android devices.
- Enables interactive responses, callbacks, multiple devices, and targeted delivery in self-hosted
  mode without a Hark subscription.

## Webhook Setup

1. Start your backend and sign in with the owner Google account.
2. Build and install the Android app, then sign in to register the device.
3. Create a service and copy its secret webhook URL.
4. Send it a JSON request.

## Send a Notification

```sh
curl -X POST 'https://sietch.sole-pierce.ts.net:8443/hooks/whk_your_token' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "GitHub",
    "body": "Production deployed successfully.",
    "url": "https://github.com/acme/app/actions"
  }'
```

Only `body` is required.

| Field | Description |
| --- | --- |
| `body` | Notification text, up to 8,000 characters (16 KiB of UTF-8). |
| `title` | Optional sender-name override. |
| `imageUrl` | Optional public HTTPS service image stored as event metadata. The current Android system notification does not display it. |
| `url` | Optional web URL or app deep link opened when tapped. |
| `deviceIds` | Optional routing to specific Android devices. |
| `project` | Optional project name that groups the notification in the app inbox. |
| `summary` | Optional short digest used for the push banner and list previews. |
| `bodyFormat` | Optional `text` or `markdown` metadata for the stored body. |

Successful requests return an event ID and the number of push requests accepted for delivery:

```json
{
  "ok": true,
  "eventId": "evt_...",
  "delivered": 1
}
```

Use an `Idempotency-Key` header when retrying requests to prevent duplicate notifications.

### Withdraw a Delivered Notification

Use the returned event ID to request removal of a notification from registered Android devices:

```sh
curl -X POST \
  'https://sietch.sole-pierce.ts.net:8443/hooks/whk_your_token/events/evt_your_event/withdraw'
```

Hark sends a data-only FCM command to each active device and cancels any pending interactive
response for the event. FCM acceptance does not prove device delivery. Connectivity, battery
policy, and device settings can delay or skip the command.

Tap destinations support HTTPS app links and custom app schemes such as
`your-app://incidents/INC-42`. Android opens a destination only after the recipient taps the
notification.

## Live Updates

Start a stateful progress update using the stable Activity API route:

```sh
curl -X POST 'https://sietch.sole-pierce.ts.net:8443/hooks/whk_your_token/live-activities' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Deploy #184",
    "status": "Building",
    "progress": 0.25,
    "symbol": "build",
    "accentColor": "#FF9F0A"
  }'
```

The response includes an `activityId`. Use it to update or end the activity:

```text
PATCH /hooks/:token/live-activities/:activityId
POST  /hooks/:token/live-activities/:activityId/end
```

Updates accept partial state such as `status`, `detail`, `progress`, `symbol`, and `accentColor`.
Hark allows one active task update per device. Pass `replace: true` on start to end the task that
occupies the device and take its slot. Android displays a silent ongoing progress notification. On
supported Android versions, Hark requests promoted Live Update treatment when the user enables
watched activities. The regular ongoing notification remains the fallback.

## Agent Workflows

The [`harkctl`](./packages/harkctl) CLI can send one-shot notifications, ask for approvals or short
replies, and manage Live Updates from scripts or AI agents.

```sh
HARK_API_URL=https://sietch.sole-pierce.ts.net:8443 \
  node packages/harkctl/bin/harkctl.mjs auth login
node packages/harkctl/bin/harkctl.mjs notify "Deploy finished ✅" --title "Deploy bot"
node packages/harkctl/bin/harkctl.mjs notify ask "Deploy production?" --approval --wait
node packages/harkctl/bin/harkctl.mjs notify ask "Send the email?" --approval --live-activity \
  --primary-label Send --secondary-label Deny --wait
node packages/harkctl/bin/harkctl.mjs activity start \
  --title "Release" --status "Building" --progress 0.1
```

The installable [`hark` agent skill](./skills/hark/SKILL.md) follows the open Agent Skills format
used by [skills.sh](https://skills.sh/r44vc0rp/hark/hark) and supports OpenCode, Claude Code, Codex,
Cursor, and other compatible agents.

`harkctl` can route permission requests from Claude Code, Codex, OpenCode V1, and OpenCode V2 to
Hark with one setup command:

```sh
node packages/harkctl/bin/harkctl.mjs auth login --client-name "Coding agent permissions"
node packages/harkctl/bin/harkctl.mjs permissions setup all
```

See the [coding-agent permission setup guide](https://sietch.sole-pierce.ts.net:8443/docs#cli-permissions) for
Claude Code, Codex, OpenCode V1, and OpenCode V2 details.

Only an explicit phone approval allows a request. Other outcomes deny it, and raw commands, patches,
prompts, file contents, and absolute paths are not sent to Hark.

## License

Hark is source-available under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without a
separate license from the licensor.
