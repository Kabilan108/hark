import type { EventDto } from "@hark/contracts";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { event, service } from "../db/schema";
import { type AuthedEnv, requireAuth } from "../middleware";

export const eventsRoute = new Hono<AuthedEnv>().use("*", requireAuth).get("/", async (c) => {
  const user = c.get("user");
  const requestedLimit = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;

  const rows = await db
    .select({
      id: event.id,
      serviceId: event.serviceId,
      serviceTitle: service.title,
      title: event.title,
      body: event.body,
      imageUrl: event.imageUrl,
      url: event.url,
      status: event.status,
      deliveredCount: event.deliveredCount,
      error: event.error,
      projectId: event.projectId,
      createdAt: event.createdAt,
    })
    .from(event)
    .innerJoin(service, eq(event.serviceId, service.id))
    .where(eq(service.userId, user.id))
    .orderBy(desc(event.createdAt))
    .limit(limit);

  const events: EventDto[] = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));

  return c.json({ events });
});
