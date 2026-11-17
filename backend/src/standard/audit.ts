// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// The audit log (#553): one audit_log row for each change a user or an AI tool makes, so the owner can see what
// happened and undo it. The table is the app's migration NNN_audit_log.sql (docs/audit-log.md); this file writes it.
// It imports only types, so it runs in every app whatever pg or Express version it uses.
//
//   await writeAudit(client, { ...auditContext(req, res), action: 'create', entity: 'workout', entityId: row.id, after: row });
//
// Write the row with the same client and in the same transaction as the change, so a change never lands without it.
import type { Request, Response } from 'express';

/** Anything with pg's `query`: a Pool, or the PoolClient of an open transaction. */
export type AuditDb = { query: (text: string, values?: unknown[]) => Promise<unknown> };

export type AuditActor = {
  type: 'user' | 'ai-tool' | 'system';
  /** The shared sign-in user ID; null for a system job. */
  id: string | null;
  /** For an AI tool: `ai-shell`, the MCP client ID, or `stdio` (ADR-0017). */
  client?: string | null;
  /** For an AI tool: the tool name in the app, e.g. `add_workout`. */
  tool?: string | null;
};

export type AuditEntry = {
  actor: AuditActor;
  action: 'read' | 'create' | 'update' | 'delete';
  /** The kind of record, singular snake_case: `workout`, `study_log`. */
  entity: string;
  entityId?: string | number | null;
  result?: 'ok' | 'denied' | 'error';
  /** Small summaries of the record before and after the change, not whole rows with large text. */
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

// Rows older than this are deleted by the nightly backup (deploy/backup.sh); the dumps keep them 14 more days.
export const AUDIT_RETENTION_DAYS = 365;

/** The signed-in user (set on `req.user` by the shared sign-in) and the request ID, for a change made in a route. */
export function auditContext(req: Request, res: Response): Pick<AuditEntry, 'actor' | 'requestId'> {
  const user: unknown = (req as { user?: unknown }).user;
  const id =
    typeof user === 'object' && user !== null && 'id' in user && typeof user.id === 'string' ? user.id : null;
  // Set by requestLog in http.ts (#552).
  const requestId: unknown = res.locals.requestId;
  return { actor: { type: 'user', id }, requestId: typeof requestId === 'string' ? requestId : null };
}

export async function writeAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
  const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
  await db.query(
    `INSERT INTO audit_log (actor_type, actor_id, client, tool, action, entity, entity_id, result, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      entry.actor.type,
      entry.actor.id,
      entry.actor.client ?? null,
      entry.actor.tool ?? null,
      entry.action,
      entry.entity,
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      entry.result ?? 'ok',
      json(entry.before),
      json(entry.after),
      entry.requestId ?? null,
    ],
  );
}
