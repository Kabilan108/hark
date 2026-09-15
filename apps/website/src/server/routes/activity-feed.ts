import {
  INBOX_ACTIVITY_KINDS,
  INBOX_UNFILED_PROJECT,
  type InboxActivityDto,
} from "@hark/contracts";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { project } from "../db/schema";
import { type AuthedEnv, requireAuth } from "../middleware";

const PAGE_SIZE = 20;
const MAX_PAGE = 1_000_000;
const FILTERS = ["all", ...INBOX_ACTIVITY_KINDS] as const;
type ActivityFilter = (typeof FILTERS)[number];

interface ActivityFeedRow {
  id: string;
  projectId: string | null;
  projectName: string | null;
  kind: "notification" | "live_activity" | "response";
  sourceName: string;
  sourceImageUrl: string | null;
  title: string;
  detail: string | null;
  url: string | null;
  result: string | null;
  createdAt: number;
  total: number;
}

export const activityFeedRoute = new Hono<AuthedEnv>().use("*", requireAuth).get("/", async (c) => {
  const requestedFilter = c.req.query("filter") ?? "all";
  if (!FILTERS.includes(requestedFilter as ActivityFilter)) {
    return c.json({ error: "Invalid activity filter" }, 400);
  }
  const filter = requestedFilter as ActivityFilter;
  const requestedPage = Number.parseInt(c.req.query("page") ?? "0", 10);
  if (!Number.isFinite(requestedPage) || requestedPage < 0 || requestedPage > MAX_PAGE) {
    return c.json({ error: "Invalid activity page" }, 400);
  }
  const userId = c.get("user").id;
  const projectParam = c.req.query("project");
  if (projectParam !== undefined && (projectParam.length === 0 || projectParam.length > 100)) {
    return c.json({ error: "Invalid project filter" }, 400);
  }
  if (projectParam && projectParam !== INBOX_UNFILED_PROJECT) {
    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectParam), eq(project.userId, userId)))
      .limit(1);
    if (!owned) return c.json({ error: "Project not found" }, 404);
  }
  const filterClause = filter === "all" ? sql`1 = 1` : sql`kind = ${filter}`;
  const projectClause =
    projectParam === undefined
      ? sql`1 = 1`
      : projectParam === INBOX_UNFILED_PROJECT
        ? sql`project_id is null`
        : sql`project_id = ${projectParam}`;
  const offset = requestedPage * PAGE_SIZE;

  const rows = db.all(sql`
    select
      id,
      project_id as projectId,
      (select p.name from project p where p.id = feed.project_id and p.user_id = ${userId}) as projectName,
      kind,
      source_name as sourceName,
      source_image_url as sourceImageUrl,
      title,
      detail,
      url,
      result,
      created_at as createdAt,
      count(*) over () as total
    from (
      select
        'event:' || e.id as id,
        e.project_id as project_id,
        'notification' as kind,
        s.title as source_name,
        coalesce(e.image_url, s.image_url) as source_image_url,
        e.title as title,
        -- Bounded for app builds that predate the project inbox: bodies at or
        -- under the legacy 2,000-character limit pass through unchanged, and
        -- larger bodies fall back to the sender summary or a bounded preview.
        coalesce(e.summary, substr(e.body, 1, 2000)) as detail,
        e.url as url,
        null as result,
        e.created_at as created_at
      from event e
      inner join service s on s.id = e.service_id
      where s.user_id = ${userId}

      union all

      select
        'notification:' || n.id as id,
        n.project_id as project_id,
        'notification' as kind,
        t.name as source_name,
        n.image_url as source_image_url,
        n.title as title,
        coalesce(n.summary, substr(n.body, 1, 2000)) as detail,
        n.url as url,
        null as result,
        n.created_at as created_at
      from agent_notification n
      inner join api_token t on t.id = n.requester_token_id
      where n.user_id = ${userId}

      union all

      select
        'response:' || i.id as id,
        i.project_id as project_id,
        'response' as kind,
        coalesce(s.title, t.name, i.title) as source_name,
        coalesce(i.image_url, s.image_url) as source_image_url,
        i.title as title,
        i.prompt as detail,
        i.url as url,
        case i.status
          when 'pending' then 'Expired'
          when 'approved' then 'Approved'
          when 'denied' then 'Denied'
          when 'yes' then 'Yes'
          when 'no' then 'No'
          when 'canceled' then 'Canceled'
          when 'expired' then 'Expired'
          else 'Replied'
        end as result,
        coalesce(i.responded_at, i.canceled_at, i.expires_at) as created_at
      from interaction i
      left join api_token t on t.id = i.requester_token_id
      left join service s on s.id = i.requester_service_id
      where i.user_id = ${userId}
        and (
          i.status in ('approved', 'denied', 'yes', 'no', 'replied', 'canceled', 'expired')
          or (i.status = 'pending' and i.expires_at <= ${Date.now()})
        )

      union all

      select
        'live_activity:' || o.id as id,
        a.project_id as project_id,
        'live_activity' as kind,
        coalesce(s.title, t.name, 'Hark') as source_name,
        s.image_url as source_image_url,
        coalesce(
          json_extract(o.props, '$.title'),
          json_extract(a.props, '$.title'),
          'Live Activity'
        ) as title,
        coalesce(
          json_extract(o.props, '$.status'),
          json_extract(a.props, '$.status')
        ) as detail,
        null as url,
        case o.event
          when 'start' then 'Started'
          when 'end' then 'Completed'
          else 'Updated'
        end as result,
        o.created_at as created_at
      from live_activity_operation o
      inner join live_activity a on a.id = o.activity_id
      left join api_token t on t.id = o.requester_token_id
      left join service s on s.id = o.requester_service_id
      where a.user_id = ${userId}
        and a.interaction_id is null
    ) feed
    where ${filterClause} and ${projectClause}
    order by created_at desc, id desc
    limit ${PAGE_SIZE}
    offset ${offset}
  `) as ActivityFeedRow[];

  const items: InboxActivityDto[] = rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    kind: row.kind,
    sourceName: row.sourceName,
    sourceImageUrl: row.sourceImageUrl,
    title: row.title,
    detail: row.detail,
    url: row.url,
    result: row.result,
    createdAt: new Date(row.createdAt).toISOString(),
  }));

  return c.json({
    items,
    page: requestedPage,
    pageSize: PAGE_SIZE,
    total: rows[0]?.total ?? 0,
  });
});
