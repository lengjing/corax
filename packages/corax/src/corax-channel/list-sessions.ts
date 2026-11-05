import { getWorld } from "#internal/workflow/runtime.js";

/** Read the existing Workflow catalog; no parallel conversation database. */
export async function listSessions(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
    return Response.json({ ok: false, error: "Invalid session page" }, { status: 400 });
  }
  const world = await getWorld();
  const sessions = new Map<string, { id: string; title: string; updatedAt: number; createdAt: number }>();
  let cursor: string | undefined;
  do {
    const page = await world.runs.list({ resolveData: "none", pagination: { limit: 100, ...(cursor ? { cursor } : {}) } });
    for (const run of page.data) {
      const attributes = run.attributes ?? {};
      if (attributes["$corax.type"] !== "session" || attributes["$corax.parent"]) continue;
      const id = String(attributes["$corax.session"] ?? run.runId);
      const previous = sessions.get(id);
      const updatedAt = new Date(run.updatedAt).getTime();
      if (previous && previous.updatedAt >= updatedAt) continue;
      sessions.set(id, { id, title: String(attributes["$corax.title"] ?? previous?.title ?? "New session"),
        updatedAt, createdAt: previous?.createdAt ?? new Date(run.createdAt).getTime() });
    }
    cursor = page.hasMore && page.cursor ? page.cursor : undefined;
  } while (cursor);
  const sorted = [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
  return Response.json({ sessions: sorted.slice(offset, offset + limit), hasMore: offset + limit < sorted.length },
    { headers: { "cache-control": "no-store" } });
}
