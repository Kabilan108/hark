import {
  normalizeProjectName,
  type ProjectDto,
  type ProjectItemType,
  type ProjectListItemDto,
  projectItemTypeSchema,
  projectListQuerySchema,
  projectMoveItemSchema,
  projectUpdateSchema,
} from "@hark/contracts";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { db } from "../db";
import {
  agentNotification,
  event,
  interaction,
  liveActivity,
  project,
  service,
} from "../db/schema";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";

function toProjectDto(row: typeof project.$inferSelect): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface ProjectCountRow {
  id: string;
  notificationCount: number;
  interactionCount: number;
  activityCount: number;
  unreadCount: number;
  pendingInteractionCount: number;
  activeActivityCount: number;
}

async function listProjects(c: Context, userId: string): Promise<Response> {
  const parsed = projectListQuerySchema.safeParse({ archived: c.req.query("archived") });
  if (!parsed.success) return c.json({ error: "Invalid archived filter" }, 400);

  const archiveCondition =
    parsed.data.archived === "include"
      ? sql`1 = 1`
      : parsed.data.archived === "only"
        ? sql`p.archived_at is not null`
        : sql`p.archived_at is null`;
  const now = Date.now();
  const rows = db.all(sql`
    select
      p.id,
      (
        select count(*) from event e where e.project_id = p.id
      ) + (
        select count(*) from agent_notification n where n.project_id = p.id
      ) as notificationCount,
      (
        select count(*) from event e where e.project_id = p.id and e.read_at is null
      ) + (
        select count(*) from agent_notification n where n.project_id = p.id and n.read_at is null
      ) as unreadCount,
      (
        select count(*) from interaction i
        where i.project_id = p.id and i.event_id is null
      ) as interactionCount,
      (
        select count(*) from interaction i
        where i.project_id = p.id
          and i.event_id is null
          and i.status = 'pending'
          and i.expires_at > ${now}
      ) as pendingInteractionCount,
      (
        select count(*) from live_activity a
        where a.project_id = p.id and a.interaction_id is null
      ) as activityCount,
      (
        select count(*) from live_activity a
        where a.project_id = p.id
          and a.interaction_id is null
          and a.status in ('starting', 'active', 'partial')
          and a.expires_at > ${now}
      ) as activeActivityCount
    from project p
    where p.user_id = ${userId} and ${archiveCondition}
  `) as ProjectCountRow[];
  const counts = new Map(rows.map((row) => [row.id, row]));
  const projects = await db
    .select()
    .from(project)
    .where(
      and(
        eq(project.userId, userId),
        ...(parsed.data.archived === "exclude"
          ? [isNull(project.archivedAt)]
          : parsed.data.archived === "only"
            ? [isNotNull(project.archivedAt)]
            : []),
      ),
    )
    .orderBy(sql`${project.updatedAt} desc`);
  const result: ProjectListItemDto[] = projects.map((row) => {
    const count = counts.get(row.id);
    return {
      ...toProjectDto(row),
      notificationCount: count?.notificationCount ?? 0,
      interactionCount: count?.interactionCount ?? 0,
      activityCount: count?.activityCount ?? 0,
      unreadCount: count?.unreadCount ?? 0,
      pendingInteractionCount: count?.pendingInteractionCount ?? 0,
      activeActivityCount: count?.activeActivityCount ?? 0,
    };
  });
  return c.json({ projects: result });
}

async function updateProject(c: Context, userId: string): Promise<Response> {
  const parsed = projectUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: "Invalid project update", issues: parsed.error.issues }, 400);

  const id = c.req.param("id");
  if (!id) return c.json({ error: "Project not found" }, 404);
  const [owned] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.userId, userId)))
    .limit(1);
  if (!owned) return c.json({ error: "Project not found" }, 404);

  const now = new Date();
  try {
    const [updated] = await db
      .update(project)
      .set({
        ...(parsed.data.name !== undefined
          ? {
              name: parsed.data.name.normalize("NFC"),
              normalizedName: normalizeProjectName(parsed.data.name),
            }
          : {}),
        ...(parsed.data.archived !== undefined
          ? { archivedAt: parsed.data.archived ? now : null }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(project.id, owned.id), eq(project.userId, userId)))
      .returning();
    return c.json({ project: toProjectDto(updated ?? owned) });
  } catch (error) {
    if (parsed.data.name !== undefined) {
      const [conflict] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.userId, userId),
            eq(project.normalizedName, normalizeProjectName(parsed.data.name)),
          ),
        )
        .limit(1);
      if (conflict && conflict.id !== owned.id) {
        return c.json({ error: "A project with this name already exists" }, 409);
      }
    }
    throw error;
  }
}

async function moveItem(c: Context, userId: string): Promise<Response> {
  const typeResult = projectItemTypeSchema.safeParse(c.req.param("type"));
  const bodyResult = projectMoveItemSchema.safeParse(await c.req.json().catch(() => null));
  if (!typeResult.success || !bodyResult.success) {
    return c.json({ error: "Invalid project move" }, 400);
  }
  const type = typeResult.data;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Item not found" }, 404);
  const projectId = bodyResult.data.projectId;
  if (projectId) {
    const [target] = await db
      .select({ id: project.id, archivedAt: project.archivedAt })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.userId, userId)))
      .limit(1);
    if (!target) return c.json({ error: "Project not found" }, 404);
    if (target.archivedAt) return c.json({ error: "Archived projects cannot receive items" }, 409);
  }

  const moved = await moveOwnedItem(type, id, userId, projectId);
  if (!moved) return c.json({ error: "Item not found" }, 404);
  return c.json({ item: { type, id, projectId } });
}

async function moveOwnedItem(
  type: ProjectItemType,
  id: string,
  userId: string,
  projectId: string | null,
): Promise<boolean> {
  let eventId: string | null = null;
  let interactionIds: string[] = [];
  let activityIds: string[] = [];
  if (type === "event") {
    const [owned] = await db
      .select({ id: event.id })
      .from(event)
      .innerJoin(service, eq(event.serviceId, service.id))
      .where(and(eq(event.id, id), eq(service.userId, userId)))
      .limit(1);
    if (!owned) return false;
    eventId = owned.id;
    interactionIds = (
      await db
        .select({ id: interaction.id })
        .from(interaction)
        .where(and(eq(interaction.eventId, owned.id), eq(interaction.userId, userId)))
    ).map((row) => row.id);
  } else if (type === "notification") {
    const [updated] = await db
      .update(agentNotification)
      .set({ projectId })
      .where(and(eq(agentNotification.id, id), eq(agentNotification.userId, userId)))
      .returning({ id: agentNotification.id });
    return Boolean(updated);
  } else if (type === "interaction") {
    const [owned] = await db
      .select({ id: interaction.id, eventId: interaction.eventId })
      .from(interaction)
      .where(and(eq(interaction.id, id), eq(interaction.userId, userId)))
      .limit(1);
    if (!owned) return false;
    interactionIds = [owned.id];
    eventId = owned.eventId;
  } else {
    const [owned] = await db
      .select({ id: liveActivity.id, interactionId: liveActivity.interactionId })
      .from(liveActivity)
      .where(and(eq(liveActivity.id, id), eq(liveActivity.userId, userId)))
      .limit(1);
    if (!owned) return false;
    activityIds = [owned.id];
    if (owned.interactionId) {
      const [linked] = await db
        .select({ id: interaction.id, eventId: interaction.eventId })
        .from(interaction)
        .where(and(eq(interaction.id, owned.interactionId), eq(interaction.userId, userId)))
        .limit(1);
      if (linked) {
        interactionIds = [linked.id];
        eventId = linked.eventId;
      }
    }
  }

  if (interactionIds.length > 0) {
    const linkedActivities = await db
      .select({ id: liveActivity.id })
      .from(liveActivity)
      .where(
        and(
          eq(liveActivity.userId, userId),
          sql`${liveActivity.interactionId} in (${sql.join(
            interactionIds.map((interactionId) => sql`${interactionId}`),
            sql`, `,
          )})`,
        ),
      );
    activityIds = [...new Set([...activityIds, ...linkedActivities.map((row) => row.id)])];
  }

  db.transaction((tx) => {
    if (eventId) tx.update(event).set({ projectId }).where(eq(event.id, eventId)).run();
    for (const interactionId of interactionIds) {
      tx.update(interaction)
        .set({ projectId })
        .where(and(eq(interaction.id, interactionId), eq(interaction.userId, userId)))
        .run();
    }
    for (const activityId of activityIds) {
      tx.update(liveActivity)
        .set({ projectId })
        .where(and(eq(liveActivity.id, activityId), eq(liveActivity.userId, userId)))
        .run();
    }
  });
  return true;
}

export const projectsSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/", (c) => listProjects(c, c.get("user").id))
  .patch("/:id", (c) => updateProject(c, c.get("user").id))
  .post("/items/:type/:id/move", (c) => moveItem(c, c.get("user").id));

export const projectsAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/", requireScopes("projects:read"), (c) => listProjects(c, c.get("apiToken").userId))
  .patch("/:id", requireScopes("projects:write"), (c) => updateProject(c, c.get("apiToken").userId))
  .post("/items/:type/:id/move", requireScopes("projects:write"), (c) =>
    moveItem(c, c.get("apiToken").userId),
  );
