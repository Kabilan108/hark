import type {
  DeviceDto,
  DeviceRegisterInput,
  DeviceUnregisterInput,
  EventDto,
  InboxActivityKind,
  InboxActivityPageDto,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxMarkAllReadInput,
  InboxNotificationDetailDto,
  InboxNotificationPageDto,
  InboxProjectsDto,
  InteractionDto,
  InteractionResponseInput,
  ProjectListItemDto,
} from "@hark/contracts";
import { apiErrorFromBody } from "./api-error";
import { API_URL, getCookie } from "./auth";

export type { NotificationDetailFailure } from "./api-error";
export { ApiError, classifyNotificationDetailFailure } from "./api-error";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = getCookie();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || body === null) {
    throw apiErrorFromBody(response.status, body);
  }
  return body;
}

export const api = {
  listDevices: () => request<{ devices: DeviceDto[] }>("/api/devices"),
  registerDevice: (input: DeviceRegisterInput) =>
    request<{ device: { id: string } }>("/api/devices", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unregisterDevice: (input: DeviceUnregisterInput) =>
    request<{ ok: true }>("/api/devices", {
      method: "DELETE",
      body: JSON.stringify(input),
    }),
  markDeviceReady: (deviceId: string) =>
    request<{ ok: true; accepted: number; idempotent?: true }>(
      `/api/devices/${encodeURIComponent(deviceId)}/ready`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ),
  listEvents: (limit = 20) => request<{ events: EventDto[] }>(`/api/events?limit=${limit}`),
  listPendingInteractions: () =>
    request<{ interactions: InboxInteractionDto[] }>("/api/interactions"),
  listActiveActivities: () => request<{ activities: InboxLiveActivityDto[] }>("/api/activities"),
  listActivityFeed: (filter: "all" | InboxActivityKind, page: number, project?: string) => {
    const query = new URLSearchParams({ filter, page: String(page) });
    if (project) query.set("project", project);
    return request<InboxActivityPageDto>(`/api/activity-feed?${query.toString()}`);
  },
  respondToInteraction: (id: string, input: InteractionResponseInput) =>
    request<{ interaction: InteractionDto }>(`/api/interactions/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Project inbox endpoints. Older or self-hosted servers 404 on these; the
  // app treats that as "no project inbox" and keeps the legacy behavior.
  listInboxProjects: () => request<InboxProjectsDto>("/api/inbox/projects"),
  listInboxNotifications: (params: {
    project?: string;
    unread?: boolean;
    cursor?: string;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.project) query.set("project", params.project);
    if (params.unread) query.set("unread", "1");
    if (params.cursor) query.set("cursor", params.cursor);
    query.set("limit", String(params.limit ?? 20));
    return request<InboxNotificationPageDto>(`/api/inbox/notifications?${query.toString()}`);
  },
  getInboxNotification: (id: string) =>
    request<{ notification: InboxNotificationDetailDto }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}`,
    ),
  markNotificationRead: (id: string) =>
    request<{ ok: true; readAt: string }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  markNotificationUnread: (id: string) =>
    request<{ ok: true; readAt: null }>(
      `/api/inbox/notifications/${encodeURIComponent(id)}/unread`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  markAllNotificationsRead: (input: InboxMarkAllReadInput) =>
    request<{ ok: true; updated: number }>("/api/inbox/notifications/read-all", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listProjects: (archived: "exclude" | "include" | "only" = "include") =>
    request<{ projects: ProjectListItemDto[] }>(`/api/projects?archived=${archived}`),
};
