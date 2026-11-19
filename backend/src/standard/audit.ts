// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// The audit log (#553, ADR-0024): one audit_log row for each call an AI tool makes (read, create, update, delete,
// denied, or error), so the owner can see what a non-human client did. `defineTool` writes those rows; a route may
// write one too, but it does not have to and nothing reads the rows back except the owner's psql query. The table is
// the app's migration NNN_audit_log.sql (docs/audit-log.md); this file writes it.
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
  /**
   * Small summaries of the record before and after the change, not whole rows with large text. A value whose JSON
   * is longer than AUDIT_VALUE_LIMIT is stored as `{ truncated: true, length, preview }` (see auditValue).
   */
  before?: unknown;
  after?: unknown;
  /** Keys to drop from `before` and `after` at any depth, e.g. `['body', 'note']` for private text. */
  omit?: readonly string[];
  requestId?: string | null;
};

/** The longest JSON text (in characters) kept for `before` or `after`; the log is kept for a year. */
export const AUDIT_VALUE_LIMIT = 2048;

/**
 * The JSON text to store for `before` or `after`: null for undefined, the value without the `omit` keys, or, when that
 * is longer than AUDIT_VALUE_LIMIT, a valid JSON summary `{ truncated, length, preview }` with the start of the text.
 */
export function auditValue(value: unknown, omit: readonly string[] = []): string | null {
  if (value === undefined) return null;
  const text: string | undefined = JSON.stringify(
    value,
    omit.length ? (key, item: unknown) => (omit.includes(key) ? undefined : item) : undefined,
  );
  // JSON.stringify gives undefined for a function or symbol; the column stays null.
  if (text === undefined) return null;
  if (text.length <= AUDIT_VALUE_LIMIT) return text;
  let preview = text.slice(0, AUDIT_VALUE_LIMIT);
  // Do not cut a surrogate pair in half: PostgreSQL rejects a lone surrogate in jsonb.
  const last = preview.charCodeAt(preview.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) preview = preview.slice(0, -1);
  return JSON.stringify({ truncated: true, length: text.length, preview });
}

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
      auditValue(entry.before, entry.omit),
      auditValue(entry.after, entry.omit),
      entry.requestId ?? null,
    ],
  );
}
