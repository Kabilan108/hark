/**
 * The docs prose, as data.
 *
 * This module is the single source of truth for everything on `/docs`. Two
 * consumers read it and neither owns any prose of its own:
 *
 * - `src/client/pages/docs/blocks.tsx` renders it as React (browser + the
 *   build-time prerender that puts the same HTML in the initial response).
 * - `src/shared/docs/markdown.ts` serialises it for `/docs.md` and `/agents.md`.
 *
 * Inline formatting inside every string is a tiny markdown subset — `` `code` ``
 * and `[text](href)` — parsed by `./inline.ts` for the React renderer and passed
 * through verbatim by the markdown serialiser. Keeping the source markdown-ish
 * means the two outputs cannot drift, and adding a section is a data edit.
 *
 * Headings are *not* stored here: they come from `./nav.ts` by id, so the
 * sidebar, the in-page headings, and the markdown outline always agree.
 */
import type { DocItemId, DocSectionId } from "./nav";

/** Placeholder webhook URL used throughout the docs samples. */
export const EXAMPLE_ENDPOINT = "https://sietch.sole-pierce.ts.net:8443/hooks/whk_your_token";

export interface DocFieldRow {
  name: string;
  type: string;
  detail: string;
}

export interface DocRouteRow {
  method: string;
  path: string;
  detail: string;
}

export interface DocPlanRow {
  limit: string;
  free: string;
  pro: string;
}

export type DocTableBlock =
  | { kind: "table"; variant: "field"; caption: string; rows: DocFieldRow[] }
  /** Same shape as `field`, headed "Flag" for CLI options. */
  | { kind: "table"; variant: "flag"; caption: string; rows: DocFieldRow[] }
  | { kind: "table"; variant: "route"; caption: string; rows: DocRouteRow[] }
  | { kind: "table"; variant: "plan"; caption: string; rows: DocPlanRow[] };

export type DocBlock =
  | { kind: "p"; text: string }
  /** Callout for a caveat that would get lost in a paragraph. */
  | { kind: "note"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "code"; language: "bash" | "json"; code: string }
  /** A copyable single-line value, rendered as a code block in markdown. */
  | { kind: "copy"; label: string; value: string }
  /** Illustrated gallery of the Live Activity layout styles. */
  | { kind: "stylePreviews"; styles: DocStylePreview[] }
  | DocTableBlock;

export interface DocStylePreview {
  name: string;
  description: string;
  /** Maintainers remove this fallback after adding the native simulator capture. */
  nativeScreenshot?: false;
}

export interface DocSubsection {
  id: DocItemId;
  /** Marks a capability that requires a paid Hark Pro plan. */
  pro?: true;
  blocks: DocBlock[];
}

export interface DocSection {
  id: DocSectionId;
  pro?: true;
  /** Intro paragraph shown above the first subsection. */
  lead: string;
  subsections: DocSubsection[];
}

/** Page title, reused by the HTML `<h1>`, the prerendered `<title>`, and the markdown. */
export const DOCS_TITLE = "Webhooks to Android notifications";
export const DOCS_URL = "https://sietch.sole-pierce.ts.net:8443/docs";
export const DOCS_MARKDOWN_URL = "https://sietch.sole-pierce.ts.net:8443/docs.md";

export const DOC_CONTENT: DocSection[] = [
  {
    id: "quickstart",
    lead: "Hark turns an HTTP request into an Android notification. Create a service, then POST JSON to its secret webhook URL.",
    subsections: [
      {
        id: "what-hark-is",
        blocks: [
          {
            kind: "p",
            text: "Anything that can send an HTTP request can notify your Android device: CI jobs, coding agents, cron scripts, and monitors. Each service has a title and optional tap destination, and Hark fills in fields omitted from a request using those service defaults.",
          },
          {
            kind: "p",
            text: "There are two APIs, both authenticated by the same webhook token. The Notification API sends one-shot pushes and optional response prompts. The Activity API drives a stateful ongoing progress notification and requests an Android Live Update when the device supports promotion and the user enables it.",
          },
        ],
      },
      {
        id: "create-a-service",
        blocks: [
          {
            kind: "steps",
            items: [
              "Sign in at your Hark deployment. The maintained instance is [sietch.sole-pierce.ts.net:8443](https://sietch.sole-pierce.ts.net:8443).",
              "Build and install the Android app for your Hark deployment, then sign in with Google to register the device.",
              "Create a service in the dashboard and give it a title and optional tap URL.",
              "Copy the secret webhook URL it returns.",
            ],
          },
        ],
      },
      {
        id: "webhook-url",
        blocks: [
          {
            kind: "p",
            text: "The plaintext token is shown when the service is created and whenever you rotate it. Treat it as a credential: anyone holding it can notify your devices.",
          },
          { kind: "copy", label: "Webhook URL", value: EXAMPLE_ENDPOINT },
          {
            kind: "p",
            text: 'An unknown or rotated token returns `404` with `{ "ok": false, "error": "Unknown webhook" }`.',
          },
        ],
      },
      {
        id: "first-notification",
        blocks: [
          {
            kind: "p",
            text: "Only `body` is required. Everything else falls back to the service defaults.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT} \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: deploy-184-production' \\
  -d '{
    "body": "Production deployed successfully.",
    "title": "GitHub",
    "imageUrl": "https://github.com/github.png",
    "url": "https://github.com/acme/app/actions"
  }'`,
          },
        ],
      },
      {
        id: "quickstart-response",
        blocks: [
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1
}`,
          },
          {
            kind: "p",
            text: "`eventId` identifies the event in the dashboard activity log and, for interactive notifications, is the handle used to read or cancel the pending response. `accepted` is the number of requests accepted by FCM. The compatibility field `delivered` has the same value. Neither field proves that Android displayed the notification.",
          },
          {
            kind: "note",
            text: "A request with no registered device still succeeds with `delivered: 0` and a `message` field, so an unpaired phone never fails your build.",
          },
        ],
      },
    ],
  },
  {
    id: "notification-api",
    lead: "One-shot pushes are sent through FCM to every registered Android device or to the devices you name. The webhook token in the URL is the only credential.",
    subsections: [
      {
        id: "notification-endpoint",
        blocks: [
          {
            kind: "table",
            variant: "route",
            caption: "Notification API routes",
            rows: [
              { method: "POST", path: "/hooks/:token", detail: "Send a notification." },
              {
                method: "GET",
                path: "/hooks/:token/events/:eventId",
                detail: "Read the state of an interactive response.",
              },
              {
                method: "POST",
                path: "/hooks/:token/events/:eventId/cancel",
                detail: "Withdraw a pending interactive response.",
              },
              {
                method: "POST",
                path: "/hooks/:token/events/:eventId/withdraw",
                detail: "Request removal of a delivered notification.",
              },
            ],
          },
          {
            kind: "p",
            text: "Send `Content-Type: application/json`. An unrecognised token returns `404`; a payload that fails validation returns `400` with an `issues` array describing each field.",
          },
        ],
      },
      {
        id: "notification-payload",
        blocks: [
          {
            kind: "table",
            variant: "field",
            caption: "Notification request fields",
            rows: [
              {
                name: "body",
                type: "string, required",
                detail:
                  "Notification message, 1 to 8,000 characters (at most 16 KiB of UTF-8) after trimming. Interactive requests with `response` keep the 2,000-character limit.",
              },
              {
                name: "title",
                type: "string",
                detail: "Sender-name override, up to 80 characters. Defaults to the service title.",
              },
              {
                name: "imageUrl",
                type: "string",
                detail:
                  "Public HTTPS service image URL, up to 2,048 characters. Hark stores it as event metadata, but the current Android system notification does not display remote images. localhost, .local, loopback, link-local and private IP ranges are rejected.",
              },
              {
                name: "url",
                type: "string",
                detail:
                  "Web URL or app deep link opened when the notification is tapped. Up to 2,048 characters.",
              },
              {
                name: "deviceIds",
                type: "string[]",
                detail:
                  "1 to 50 device IDs from the dashboard. Omit to notify every active device.",
              },
              {
                name: "response",
                type: "object",
                detail: "Turns the notification into an approval, yes/no, or text prompt.",
              },
              {
                name: "project",
                type: "string",
                detail:
                  "Project display name, up to 80 characters. Files the notification into that project in the Hark app inbox, creating it on first use.",
              },
              {
                name: "summary",
                type: "string",
                detail:
                  "Short digest, up to 500 characters. Replaces the body in the push banner and list previews; the full body stays readable in the app.",
              },
              {
                name: "bodyFormat",
                type: "enum",
                detail:
                  "`text` or `markdown`. Stored metadata describing the body; omitted means `text`.",
              },
            ],
          },
        ],
      },
      {
        id: "notification-projects",
        blocks: [
          {
            kind: "p",
            text: "Send an optional `project` display name to group notifications in the Hark app inbox. Project identity is case-insensitive and Unicode-normalized within your account, so `Acme App` and `acme app` are the same project; the first spelling you send becomes the display name. Notifications without a project land in a shared Other bucket.",
          },
          {
            kind: "p",
            text: "Long bodies stay intact in storage and in the app's notification detail, while the push banner and list rows show the `summary` when you provide one, or a bounded preview otherwise. Bodies render as plain text with tappable links; `bodyFormat` is recorded for future rendering and does not change V1 display.",
          },
          {
            kind: "note",
            text: "Accounts hold up to 500 projects. Once the cap is reached, a request naming a new project still delivers — the notification is stored without a project and the response carries an explanatory `message`. Existing project names keep resolving normally.",
          },
        ],
      },
      {
        id: "notification-withdrawal",
        blocks: [
          {
            kind: "p",
            text: "Keep the `eventId` returned when you send a notification, then use it to request removal of that notification from the account's registered Android devices.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST \\
  '${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq/withdraw'`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "status": "withdrawn",
  "accepted": 1
}`,
          },
          {
            kind: "note",
            text: "`accepted` means FCM accepted the data message. It does not guarantee that Android received or ran the removal command. Background delivery is best effort and may be delayed or skipped by connectivity, battery policy, device settings, or FCM. The same webhook token must own the event. Repeating a completed withdrawal is idempotent and does not send another command.",
          },
        ],
      },
      {
        id: "tap-destinations",
        blocks: [
          {
            kind: "p",
            text: "Set `url` per notification or as the service default. Hark opens it only after the recipient explicitly taps the notification; receiving a push does not launch an app or run background automation.",
          },
          {
            kind: "bullets",
            items: [
              "Use an `https://` app link when the destination app supports one. Android opens the associated app or the web page according to the device's link settings.",
              "Use the destination app's documented custom scheme for app-only routes, such as `your-app://incidents/INC-42`. If no installed app handles the scheme, Hark remains open.",
              "Percent-encode names, paths, and query values that contain spaces or reserved characters.",
            ],
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "Incident INC-42 needs attention.",
  "url": "your-app://incidents/INC-42"
}`,
          },
          {
            kind: "note",
            text: "The destination opens only after a tap. If no installed app handles a custom scheme, Hark stays open. Unsafe local or executable schemes such as `javascript:`, `data:`, `file:`, `blob:`, and `about:` are rejected.",
          },
        ],
      },
      {
        id: "notification-idempotency",
        blocks: [
          {
            kind: "p",
            text: "Send an optional `Idempotency-Key` header of 1 to 200 characters. Keys are scoped to a single service.",
          },
          {
            kind: "bullets",
            items: [
              "Same key and payload: the original event is returned with `idempotent: true`.",
              "Same key while the first request is still in flight: `202 Accepted`.",
              "Same key with a different payload: `409 Conflict`.",
              "Blank or over-length key: `400`.",
            ],
          },
        ],
      },
      {
        id: "device-routing",
        blocks: [
          {
            kind: "p",
            text: "By default a request fans out to every active Android device on the account, most recently seen first. Self-hosted deployments enable multi-device delivery.",
          },
          {
            kind: "p",
            text: "Pass a non-empty `deviceIds` array to target specific Android devices. Copy the stable device IDs from the dashboard. IDs that do not belong to the account return `400 Invalid device selection`; owned but inactive or non-Android devices in the list are skipped silently.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "The production deploy needs attention.",
  "deviceIds": ["dev_your_android_id"]
}`,
          },
          {
            kind: "p",
            text: "Self-hosted mode enables device routing for every account.",
          },
        ],
      },
      {
        id: "rate-limits",
        blocks: [
          {
            kind: "bullets",
            items: [
              "300 requests per minute per service by default.",
              "1,500 requests per minute per account by default.",
              "No Hark subscription quota on notifications.",
              "No Hark plan limit on active devices.",
            ],
          },
          {
            kind: "p",
            text: "The per-minute counters use a rolling 60-second window and are shared across notifications, interactive responses, and Activity API operations. A limited request returns `429` with a `Retry-After: 60` header and `retryAfterSeconds` in the body. Deployment operators can change the rate limits through server configuration.",
          },
        ],
      },
      {
        id: "notification-response",
        blocks: [
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1
}`,
          },
          {
            kind: "table",
            variant: "field",
            caption: "Notification status codes",
            rows: [
              { name: "200", type: "ok", detail: "Accepted, or an idempotent replay." },
              { name: "202", type: "ok", detail: "An identical request is still processing." },
              { name: "400", type: "error", detail: "Invalid payload, key, or device selection." },
              { name: "404", type: "error", detail: "Unknown webhook token." },
              { name: "409", type: "error", detail: "Idempotency key reused with a new payload." },
              { name: "429", type: "error", detail: "A configured rate limit was exhausted." },
              { name: "502", type: "error", detail: "Every push target was rejected by FCM." },
            ],
          },
          {
            kind: "p",
            text: "Provider errors can embed a device push token, so they are recorded in the dashboard activity log rather than returned to the caller. Use that log to find devices that are no longer registered.",
          },
        ],
      },
      {
        id: "interactive-responses",
        blocks: [
          {
            kind: "p",
            text: "Attach a fixed response type to any notification. Supported types are `approval` (Approve or Deny), `yes_no` (Yes or No), and `text` (a short free-form reply).",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "title": "Production deploy",
  "body": "Deploy commit 8e7fc2a?",
  "response": {
    "type": "approval",
    "expiresInSeconds": 900,
    "correlationId": "deploy-184",
    "callback": {
      "url": "https://ci.example.com/hark-response",
      "token": "private-callback-token"
    }
  }
}`,
          },
          {
            kind: "table",
            variant: "field",
            caption: "Interactive response fields",
            rows: [
              {
                name: "type",
                type: "string, required",
                detail: "`approval`, `yes_no`, or `text`.",
              },
              {
                name: "expiresInSeconds",
                type: "integer",
                detail: "30 to 86,400. Defaults to 900.",
              },
              {
                name: "correlationId",
                type: "string",
                detail: "Your own identifier, up to 100 characters. Echoed back on the callback.",
              },
              {
                name: "callback.url",
                type: "string",
                detail: "Public HTTPS URL that receives the answer.",
              },
              {
                name: "callback.token",
                type: "string",
                detail: "16 to 512 characters, sent back as a bearer token so you can verify Hark.",
              },
            ],
          },
          {
            kind: "p",
            text: "The response body gains a `response` object alongside the usual fields:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1,
  "response": { "status": "pending", "expiresAt": "2026-07-25T18:19:04.000Z" }
}`,
          },
        ],
      },
      {
        id: "response-status",
        blocks: [
          {
            kind: "p",
            text: "Poll the event with the `eventId` from the send response, or withdraw it while it is still pending.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl ${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq

curl -X POST ${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq/cancel`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "event": {
    "id": "evt_Cxns2IdbF4H0TJYq",
    "response": {
      "status": "approved",
      "action": "approve",
      "text": null,
      "correlationId": "deploy-184",
      "respondedAt": "2026-07-25T18:06:52.000Z",
      "expiresAt": "2026-07-25T18:19:04.000Z"
    }
  }
}`,
          },
          {
            kind: "bullets",
            items: [
              "`status` is one of `pending`, `approved`, `denied`, `yes`, `no`, `replied`, `expired`, or `canceled`.",
              "For `text` prompts, `action` becomes `reply` and `text` holds the answer. For the other types `action` holds the chosen option and `text` is `null`.",
              "Reading a pending request after `expiresAt` settles it as `expired`.",
              "Cancel returns `404` if the response is not pending, and events belonging to another service are never visible.",
            ],
          },
        ],
      },
      {
        id: "response-callbacks",
        blocks: [
          {
            kind: "p",
            text: "When a callback is configured, Hark POSTs the answer to your URL with `Authorization: Bearer <callback.token>`, `Content-Type: application/json`, and a `Hark-Callbacks/1` user agent. Redirects are not followed and the request times out after 10 seconds.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "type": "notification.response",
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "correlationId": "deploy-184",
  "kind": "approval",
  "status": "approved",
  "action": "approve",
  "text": null,
  "respondedAt": "2026-07-25T18:06:52.000Z"
}`,
          },
          {
            kind: "p",
            text: "`kind` is `approval`, `yes_no`, or `reply` — a `text` request arrives as `reply`.",
          },
          {
            kind: "p",
            text: "Any response outside the 2xx range is a failure. Hark makes up to five attempts: once immediately, then after 30 seconds, 2 minutes, 10 minutes, and 1 hour. After the last attempt the callback is marked failed and is not retried, so treat the callback as at-least-once and key your handler on `eventId`.",
          },
          {
            kind: "note",
            text: "Callbacks fire only when someone actually answers. Prompts that expire or are canceled never call back — poll the event route if you need to observe those outcomes.",
          },
        ],
      },
    ],
  },
  {
    id: "activity-api",
    lead: "A Hark activity is a stateful ongoing progress notification on Android. Start one, push partial updates as work progresses, then end it. The same webhook token authenticates its nested routes.",
    subsections: [
      {
        id: "activity-start",
        blocks: [
          {
            kind: "table",
            variant: "route",
            caption: "Activity API routes",
            rows: [
              {
                method: "POST",
                path: "/hooks/:token/live-activities",
                detail: "Start an activity. Returns 201.",
              },
              {
                method: "GET",
                path: "/hooks/:token/live-activities/:id",
                detail: "Read the current state.",
              },
              {
                method: "PATCH",
                path: "/hooks/:token/live-activities/:id",
                detail: "Apply a partial update.",
              },
              {
                method: "POST",
                path: "/hooks/:token/live-activities/:id/end",
                detail: "Settle and dismiss the activity.",
              },
            ],
          },
          { kind: "p", text: "Only `title` and `status` are required." },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT}/live-activities \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: deploy-184-start' \\
  -d '{
    "title": "Deploy #184",
    "status": "Building",
    "progress": 0,
    "symbol": "build",
    "accentColor": "#FF9F0A"
  }'`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "activityId": "act_9Rk2wQpLm4Tz",
  "sequence": 0,
  "status": "active",
  "accepted": 1,
  "failed": 0,
  "state": { "title": "Deploy #184", "status": "Building", "progress": 0, "symbol": "build" },
  "expiresAt": "2026-07-26T02:04:11.000Z",
  "staleAt": "2026-07-25T22:04:11.000Z",
  "endedAt": null
}`,
          },
          {
            kind: "p",
            text: "Use `activityId` in the update and end routes. If you pass your own `key` when starting, that value works in the URL too, so a script can address its activity without storing the generated ID. `Idempotency-Key` works on all three write routes and is scoped to the service: a replay returns `idempotent: true`, and reusing a key with a different payload returns `409`.",
          },
          {
            kind: "note",
            text: "Activities need an Android device running a compatible Hark build with notification permission. If no device qualifies, the start still returns `201` with `accepted: 0` and an explanatory `message`.",
          },
        ],
      },
      {
        id: "activity-update",
        blocks: [
          {
            kind: "p",
            text: "`PATCH` merges into the current state, so send only what changed. At least one field other than `ifSequence` is required. Each accepted update increments `sequence`.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X PATCH ${EXAMPLE_ENDPOINT}/live-activities/act_9Rk2wQpLm4Tz \\
  -H 'Content-Type: application/json' \\
  -d '{ "status": "Testing", "progress": 0.6, "accentColor": "#64D2FF" }'`,
          },
          {
            kind: "bullets",
            items: [
              "Pass `null` for `detail` or `progress` to clear the field.",
              "Pass `ifSequence` to make the write conditional. A mismatch returns `409 Sequence conflict` along with the current state so you can reconcile.",
              "Updating an activity that has already ended or expired returns `409 Live Activity is already terminal`. The error text keeps the stable API name.",
            ],
          },
        ],
      },
      {
        id: "activity-end",
        blocks: [
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT}/live-activities/act_9Rk2wQpLm4Tz/end \\
  -H 'Content-Type: application/json' \\
  -d '{ "status": "Deployed", "progress": 1, "symbol": "success" }'`,
          },
          {
            kind: "p",
            text: "The body is optional. `dismissAfterSeconds` (0 to 14,400, default 0) controls how long the finished Android notification remains before Hark removes it.",
          },
          {
            kind: "note",
            text: '`status` and `symbol` have defaults on this route, so omitting them overwrites the live values with `"Complete"` and `success`. Send them explicitly if you want the final card to read differently.',
          },
        ],
      },
      {
        id: "activity-fields",
        blocks: [
          {
            kind: "table",
            variant: "field",
            caption: "Activity API fields",
            rows: [
              {
                name: "title",
                type: "string, required",
                detail: "Up to 80 characters. Required on start, optional on updates.",
              },
              { name: "status", type: "string, required", detail: "Short state line, up to 60." },
              { name: "detail", type: "string", detail: "Secondary line, up to 240. Nullable." },
              { name: "progress", type: "number", detail: "0 to 1 inclusive. Nullable." },
              {
                name: "symbol",
                type: "enum",
                detail:
                  "`terminal`, `code`, `build`, `success`, or `warning`. Defaults to `terminal`.",
              },
              {
                name: "accentColor",
                type: "string",
                detail: "Six-digit hex, `#RRGGBB`. Defaults to `#5ED8B7`.",
              },
              {
                name: "style",
                type: "enum",
                detail:
                  "Compatibility field: `standard`, `ring`, `hero`, `terminal`, or `steps`. The current Android renderer uses the system progress-notification layout for every value.",
              },
              {
                name: "privacyMode",
                type: "enum",
                detail:
                  "`standard` or `private`. Private replaces the start alert text with a generic line so the title and status stay off a locked screen.",
              },
              {
                name: "key",
                type: "string, start only",
                detail:
                  "Your own alias, up to 100 characters, usable in place of the activity ID. A key becomes reusable once its activity ends.",
              },
              {
                name: "replace",
                type: "boolean, start only",
                detail:
                  "End any activity occupying a target device, and any of your own still holding the same `key`, before starting. Defaults to `false`. The response reports the displaced count as `replaced`.",
              },
              {
                name: "deviceIds",
                type: "string[]",
                detail: "1 to 50 device IDs. Omit to target every capable device.",
              },
            ],
          },
          {
            kind: "p",
            text: "Android renders the title, status, optional detail, progress, and actions with the system notification UI. It does not render the custom `style` layouts or remote service image in the notification.",
          },
        ],
      },
      {
        id: "activity-lifetime",
        blocks: [
          {
            kind: "p",
            text: "`expiresInSeconds` accepts 60 to 28,800 and defaults to 28,800 — eight hours. Once an activity passes its expiry it is marked `expired` and stops accepting updates.",
          },
          {
            kind: "p",
            text: "`staleAfterSeconds` accepts 0 to 28,800 and defaults to 14,400, or four hours. Hark keeps the value for API compatibility. Android continues to show and update the ongoing notification until the activity expires, ends, or the user unpins it. Every update rolls the deadline forward from now, clamped to the expiry.",
          },
        ],
      },
      {
        id: "activity-conflicts",
        blocks: [
          {
            kind: "p",
            text: "A device can host one active Hark progress update at a time. Starting another while one is active on a target device returns `409`:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": false,
  "error": "A Live Activity is already active on a target device",
  "code": "ACTIVE_ACTIVITY_CONFLICT",
  "activityId": "act_9Rk2wQpLm4Tz"
}`,
          },
          {
            kind: "p",
            text: "The `activityId` is included only when the blocking activity belongs to the same service, so you can update it instead of starting over. Branch on `code` rather than the message text.",
          },
          {
            kind: "p",
            text: "To take the slot instead, pass `replace: true` in the start payload. Hark silently ends whatever occupies each target device — the old card is dismissed immediately, showing its last state — and then starts your activity. The success response reports how many activities were displaced as `replaced`; with nothing to displace the start behaves normally and `replaced` is `0`.",
          },
          {
            kind: "p",
            text: "`replace` also displaces activities started by your other services or API tokens, so a stale card from another integration cannot deadlock a device, though a foreign `activityId` is never disclosed. When the start carries a `key`, your live activity holding that key is ended everywhere — even on devices the start does not target — so the key always transfers to the new run. The implicit ends are not billed against your notification allowance. Combined with reusable keys this makes `key` plus `replace: true` a fixed-key restart you can send on every run.",
          },
        ],
      },
      {
        id: "activity-alerts",
        blocks: [
          {
            kind: "p",
            text: "Hark sends activity starts, updates, and ends as data-only FCM messages. The Android renderer keeps activity notifications silent and only alerts once. FCM acceptance is not proof of device delivery, and Android may delay messages because of connectivity, battery policy, or device settings.",
          },
          {
            kind: "p",
            text: "Activity operations share the same per-minute limits as notifications. Throttle to meaningful state changes.",
          },
          {
            kind: "note",
            text: "Hark always falls back to an ongoing progress notification. On Android 16 and newer, it also requests promoted Live Update treatment when the device supports promotion, the system setting allows it, and watched activities are enabled in Hark. Promotion is controlled by Android and is not guaranteed.",
          },
        ],
      },
    ],
  },
  {
    id: "cli",
    lead: "`harkctl` wraps the agent API for terminals, scripts, and coding agents: one-shot notifications, questions with answers you can wait on, and Activity API updates. It needs Node.js 22 or newer.",
    subsections: [
      {
        id: "cli-install",
        blocks: [
          {
            kind: "p",
            text: "Run the CLI from this fork so its defaults match the Android backend. Set `HARK_API_URL` when your deployment uses a different origin. Signing in uses a browser device-authorization flow, so no token appears on the command line.",
          },
          {
            kind: "code",
            language: "bash",
            code: `HARK_API_URL=https://sietch.sole-pierce.ts.net:8443 \\
  node packages/harkctl/bin/harkctl.mjs auth login`,
          },
          {
            kind: "steps",
            items: [
              "The CLI prints a short code and opens the configured Hark server in your browser.",
              "Sign in and approve the requested scopes; every scope is shown before you approve.",
              "Credentials are written to an OS config file with mode `0600`, and the CLI polls until the approval lands.",
            ],
          },
          {
            kind: "p",
            text: "Each login appears under your dashboard's Services list as an agent connection, with its scopes, creation date, and last use. Revoking it there signs that agent out immediately. `harkctl auth status` shows the active connection; `harkctl auth logout` revokes and removes local credentials.",
          },
          {
            kind: "p",
            text: "Use repeatable `--scope` flags to narrow access, `--client-name` to label the connection, and `--expires-in` (default `90d`) to bound its lifetime. `HARK_TOKEN` and `HARK_API_URL` override the config file. Permission-hook subprocesses preserve `HARK_API_URL`, so agent approvals stay on the same self-hosted server.",
          },
        ],
      },
      {
        id: "cli-permissions",
        blocks: [
          {
            kind: "p",
            text: "Route permission requests from Claude Code, Codex, OpenCode V1, and OpenCode V2 to Hark with one setup command. Only an explicit phone approval grants a request, and it grants it once. Denial, timeout, malformed input, authentication failure, network failure, and no-device delivery deny.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl permissions setup all
harkctl permissions doctor`,
          },
          {
            kind: "p",
            text: "The default harkctl login includes the required `notifications:send`, `interactions:create`, and `interactions:read` scopes. A narrowed login must retain all three; setup and `doctor` report missing scopes before hooks are installed.",
          },
          {
            kind: "p",
            text: "Use `permissions setup claude`, `permissions setup codex`, or `permissions setup opencode` for one integration. After Codex setup, review and trust the hook through `/hooks`. OpenCode setup installs both a V1 plugin connector and the V2 background connector on macOS. `harkctl permissions uninstall all` removes only Hark-owned hooks and services.",
          },
          {
            kind: "p",
            text: "Phone prompts contain only the agent name, permission or tool name, project directory basename, and resource count. Raw commands, patches, prompts, file contents, URLs, environment variables, transcript paths, and absolute paths are not sent to Hark.",
          },
        ],
      },
      {
        id: "cli-service",
        blocks: [
          {
            kind: "p",
            text: "`harkctl services create` creates a persistent webhook endpoint for another tool or workflow. Its title, image, and tap URL become defaults, so the sender only needs to POST a `body`. The command prints the credential-bearing `webhookUrl` in its JSON response.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl services create \\
  --title "Release bot" \\
  --image https://example.com/bot.png \\
  --url https://ci.example.com/releases`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "service": {
    "id": "svc_...",
    "title": "Release bot",
    "imageUrl": "https://example.com/bot.png"
  },
  "webhookUrl": "https://sietch.sole-pierce.ts.net:8443/hooks/hook_..."
}`,
          },
          {
            kind: "p",
            text: "Use `--stdin` to provide the same fields as JSON. `services list` lists existing services without emitting their webhook credentials. Creation requires `services:write`; if your CLI login predates that scope, sign in again and approve the updated permissions.",
          },
          {
            kind: "note",
            text: "Treat `webhookUrl` as a secret. Anyone who has it can send notifications through that service.",
          },
        ],
      },
      {
        id: "cli-notify",
        blocks: [
          {
            kind: "p",
            text: "`harkctl notify <body>` sends a one-shot push to every active Android device on your account. The title becomes the Android notification title. The current native renderer does not group messages into service threads.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify "Build 48 passed" \\
  --title "CI" \\
  --image https://github.com/github.png \\
  --url https://ci.example.com/builds/48`,
          },
          {
            kind: "table",
            variant: "flag",
            caption: "notify flags",
            rows: [
              { name: "--title", type: "string", detail: "Sender name. Defaults to `Hark`." },
              {
                name: "--image",
                type: "url",
                detail:
                  "Public HTTPS service image URL, stored as metadata but not displayed in the Android system notification.",
              },
              {
                name: "--url",
                type: "url",
                detail: "Web URL or app deep link opened when tapped.",
              },
              {
                name: "--device",
                type: "id, repeatable",
                detail: "Target specific Android devices.",
              },
              {
                name: "--project",
                type: "string",
                detail: "File the notification into a named project in the Hark app inbox.",
              },
              {
                name: "--summary",
                type: "string",
                detail:
                  "Short push/preview text for a long body. Bodies can hold up to 8,000 characters.",
              },
              {
                name: "--markdown",
                type: "boolean",
                detail:
                  "Record the body as Markdown (same as `--body-format markdown`); V1 renders plain text.",
              },
              {
                name: "--idempotency-key",
                type: "string",
                detail: "Safe retries: replays return the original result without a second push.",
              },
              {
                name: "--stdin",
                type: "boolean",
                detail: "Merge a JSON object from stdin under the explicit flags.",
              },
            ],
          },
          {
            kind: "note",
            text: "Sends from one connection share the configured per-minute budgets. The requester counts like a service, and the account window spans every sender.",
          },
        ],
      },
      {
        id: "cli-ask",
        blocks: [
          {
            kind: "p",
            text: "`harkctl notify ask <prompt>` sends a push that elicits an answer. Pass exactly one response type: `--approval` (Approve/Deny), `--yes-no` (Yes/No), or `--text` (a short typed reply). The appearance flags from `notify` all apply.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify ask "Deploy 8e7fc2a to production?" \\
  --approval --title "Deploybot" --wait --timeout 15m`,
          },
          {
            kind: "p",
            text: "Add `--live-activity` to an approval or yes/no request to attach actions to an ongoing Android progress notification. `--primary-label` and `--secondary-label` customize visible verbs such as Send/Deny or Push/Cancel while the returned action remains canonical. The stable `--style` field is accepted for API compatibility, but Android uses its system notification layout. Interactive activity prompts are limited to 240 characters, action labels are 1 to 24 characters, expire within eight hours, and do not support text replies, images, or URLs.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify ask "Send the prepared release email?" \\
  --approval --live-activity --style signal \\
  --primary-label Send --secondary-label Deny \\
  --wait --timeout 15m`,
          },
          {
            kind: "p",
            text: "`--wait` blocks until the answer arrives or the timeout passes. `--poll` waits at most 20 seconds to catch an instant answer, for the case where someone is already looking at their phone. A timed-out poll or wait does not end the prompt — it stays answerable until it expires (default 15 minutes, `--expires-in` to change), and `harkctl interaction wait <id>` resumes waiting any time.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "interaction": {
    "id": "int_7MFuml-SqoUmpPLo",
    "kind": "reply",
    "status": "replied",
    "response": "ship it",
    "respondedAt": "2026-07-26T11:54:17.927Z"
  },
  "accepted": 1,
  "timedOut": false
}`,
          },
        ],
      },
      {
        id: "cli-activity",
        blocks: [
          {
            kind: "p",
            text: "The `activity` commands drive the Activity API end to end. Address an activity by the returned ID or by your own `--key`, and pick a layout with `--style`.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl activity start --key deploy --replace --style ring \\
  --title "Deploy #184" --status "Building" --progress 0.1

harkctl activity update deploy --status "Testing" --progress 0.6 --if-sequence 0

harkctl activity end deploy --status "Shipped" --progress 1 --dismiss-after 45s`,
          },
          {
            kind: "bullets",
            items: [
              "`--replace` takes the device slot and the key, ending whatever blocks them, so a fixed-key start works on every run.",
              "`--if-sequence` rejects stale writes: the update only applies if the activity is still at that sequence.",
              "`--style` selects `standard`, `ring`, `hero`, `terminal`, or `steps`, and can change mid-flight on `update`.",
              "`activity get <id|key>` reads current state; `activity list` shows recent activities.",
            ],
          },
        ],
      },
      {
        id: "cli-scripting",
        blocks: [
          {
            kind: "p",
            text: "Every successful command prints exactly one JSON object to stdout; diagnostics go to stderr. Exit codes make answers branchable without parsing:",
          },
          {
            kind: "bullets",
            items: [
              "`0` — success, approved, yes, or replied",
              "`4` — timed out, canceled, or expired",
              "`5` — denied or no",
              "`7` — no device accepted the push",
              "`1` API error · `2` usage error · `3` authentication or scope error · `6` network error",
            ],
          },
          {
            kind: "code",
            language: "bash",
            code: `if harkctl notify ask "Deploy to production?" --approval --wait --timeout 10m; then
  ./deploy.sh && harkctl notify "Deployed" --title "Deploybot"
else
  echo "Not approved" >&2
fi`,
          },
        ],
      },
    ],
  },
];
