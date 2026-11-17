// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// AI tools of the app (ADR-0017, #559): the shared-ai service lists them with GET /internal/tools and calls one with
// POST /internal/tools/<name>. Every call carries a short-lived EdDSA JWT signed by shared-ai (owner, client, scopes);
// the app checks it with shared-ai's public key, checks the scope, and writes one audit_log row per call. A write tool
// runs in a transaction with its audit row. Input is any Standard Schema (the app's Zod 4 schemas), so this file
// imports no validation library. Docs: docs/ai-tools.md in project-standards.
//
//   app.use(express.json({ limit: '256kb' }));
//   registerToolRoutes(app, { app: 'workout-memo', tools, pool, publicKey: process.env.AI_TOOLS_PUBLIC_KEY });
import { createPublicKey, type KeyObject, verify } from 'node:crypto';

import type { Express, NextFunction, Request, Response } from 'express';

import { type AuditDb, type AuditEntry, writeAudit } from './audit.js';

type StandardResult<T> = { value: T; issues?: undefined } | { issues: readonly { message: string }[] };
/** The Standard Schema interface (standardschema.dev) with its optional JSON Schema part, which Zod 4 implements. */
export type ToolInput<T = unknown> = {
  readonly '~standard': {
    validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>;
    jsonSchema?: { input: (options: { target: 'draft-2020-12' }) => Record<string, unknown> };
    types?: { readonly input: unknown; readonly output: T };
  };
};
type Output<S> = S extends ToolInput<infer T> ? T : never;

/** Who is calling, from the verified JWT. */
export type ToolCaller = { owner: string; client: string; scopes: readonly string[] };

export type ToolOutcome = {
  /** The JSON answer for the AI. */
  result: unknown;
  /** For the audit row: the record the tool read or changed, and small before/after summaries. */
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
};

/** `D` is the app's database type (its `Db`), so `run` can call the app's own query functions. */
export type Tool<S extends ToolInput = ToolInput, D extends AuditDb = AuditDb> = {
  /** `<verb>_<noun>` in snake_case: `list_workouts`, `add_workout`. */
  name: string;
  description: string;
  input: S;
  /** `read` needs `<app>:read`, `write` needs `<app>:write`. */
  access: 'read' | 'write';
  /** The audit action and entity of the call. */
  action: AuditEntry['action'];
  entity: string;
  /** Marks a tool that deletes or overwrites data; clients ask before running it. */
  destructive?: boolean;
  /** `db` is the transaction client for a write tool and the pool for a read tool. */
  run: (input: Output<S>, context: { db: D; caller: ToolCaller }) => Promise<ToolOutcome>;
};

/**
 * Keeps the tool's input type for `run`; the list passed to registerToolRoutes holds any tools. Annotate the
 * context to get the app's database type: `run: async (input, { db }: { db: Db }) => …`.
 */
export function defineTool<S extends ToolInput, D extends AuditDb = AuditDb>(tool: Tool<S, D>): Tool<ToolInput, D> {
  return tool;
}

/** A pg Pool: `query` for read tools and audit rows, `connect` for a write tool's transaction. */
export type ToolPool<D extends AuditDb = AuditDb> = D & { connect: () => Promise<D & { release: () => void }> };

// shared-ai signs a token for one call; a token valid for longer than this is rejected.
export const MAX_TOKEN_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;
const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

class CallError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function base64url(part: string) {
  return Buffer.from(part, 'base64url');
}

/** Checks a compact EdDSA JWT from shared-ai for this app and returns the caller, or throws a 401 CallError. */
export function verifyCallToken(token: string, key: KeyObject, app: string, now = Date.now()): ToolCaller {
  const parts = token.split('.');
  if (parts.length !== 3) throw new CallError(401, 'Invalid call token');
  const [header, payload, signature] = parts as [string, string, string];
  let head: { alg?: unknown };
  let claims: Record<string, unknown>;
  try {
    head = JSON.parse(base64url(header).toString('utf8')) as { alg?: unknown };
    claims = JSON.parse(base64url(payload).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new CallError(401, 'Invalid call token');
  }
  if (typeof head !== 'object' || head === null || typeof claims !== 'object' || claims === null) {
    throw new CallError(401, 'Invalid call token');
  }
  if (head.alg !== 'EdDSA') throw new CallError(401, 'Invalid call token');
  let valid = false;
  try {
    valid = verify(null, Buffer.from(`${header}.${payload}`), key, base64url(signature));
  } catch {
    // A malformed signature is a bad token, not a server error.
  }
  if (!valid) throw new CallError(401, 'Invalid call token');
  const seconds = Math.floor(now / 1000);
  const { iss, aud, sub, client, scope, iat, exp } = claims;
  if (iss !== 'shared-ai' || aud !== app) throw new CallError(401, 'Call token is not for this app');
  if (typeof iat !== 'number' || typeof exp !== 'number' || iat > seconds + CLOCK_SKEW_SECONDS) {
    throw new CallError(401, 'Invalid call token');
  }
  if (exp <= seconds - CLOCK_SKEW_SECONDS || exp - iat > MAX_TOKEN_SECONDS) {
    throw new CallError(401, 'Call token expired');
  }
  if (typeof sub !== 'string' || !sub || typeof client !== 'string' || !client || typeof scope !== 'string') {
    throw new CallError(401, 'Invalid call token');
  }
  return { owner: sub, client, scopes: scope.split(' ').filter(Boolean) };
}

function caller(req: Request, key: KeyObject, app: string) {
  const match = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '');
  if (!match?.[1]) throw new CallError(401, 'Call token missing');
  return verifyCallToken(match[1], key, app);
}

/** The tool list entry shared-ai turns into an MCP tool (it adds the app prefix to the name). */
export function describeTool(tool: Tool<ToolInput, never>, app: string) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input['~standard'].jsonSchema?.input({ target: 'draft-2020-12' }) ?? { type: 'object' },
    scope: `${app}:${tool.access}`,
    annotations: { readOnlyHint: tool.access === 'read', destructiveHint: tool.destructive === true },
  };
}

/**
 * Serves the tools at /internal/tools when the shared-ai public key (PEM, Ed25519) is set; without it the routes are
 * not registered and the paths answer the app's JSON 404. Register it after express.json() and before notFound.
 */
export function registerToolRoutes<D extends AuditDb>(
  app: Express,
  options: { app: string; tools: readonly Tool<ToolInput, D>[]; pool: ToolPool<D>; publicKey: string | undefined },
) {
  if (!options.publicKey) return;
  const key = createPublicKey(options.publicKey.replace(/\\n/g, '\n'));
  const byName = new Map<string, Tool<ToolInput, D>>();
  for (const tool of options.tools) {
    if (!NAME.test(tool.name) || byName.has(tool.name)) throw new Error(`Invalid or repeated tool name: ${tool.name}`);
    byName.set(tool.name, tool);
  }
  // Built once, so an input schema JSON Schema cannot express fails at start, not on every list call.
  const listed = { app: options.app, tools: options.tools.map((tool) => describeTool(tool, options.app)) };
  const fail = (res: Response, err: unknown, next: NextFunction) => {
    if (err instanceof CallError) res.status(err.status).json({ error: err.message });
    else next(err);
  };

  app.get('/internal/tools', (req: Request, res: Response, next: NextFunction) => {
    try {
      caller(req, key, options.app);
      res.json(listed);
    } catch (err) {
      fail(res, err, next);
    }
  });

  app.post('/internal/tools/:name', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const who = caller(req, key, options.app);
      const tool = byName.get(String(req.params.name));
      if (!tool) throw new CallError(404, 'Tool not found');
      const requestId: unknown = res.locals.requestId;
      const audit = {
        actor: { type: 'ai-tool', id: who.owner, client: who.client, tool: tool.name },
        action: tool.action,
        entity: tool.entity,
        requestId: typeof requestId === 'string' ? requestId : null,
      } satisfies Partial<AuditEntry>;
      if (!who.scopes.includes(`${options.app}:${tool.access}`)) {
        await writeAudit(options.pool, { ...audit, result: 'denied' });
        throw new CallError(403, `Scope ${options.app}:${tool.access} is required`);
      }
      const checked = await tool.input['~standard'].validate(req.body ?? {});
      if (checked.issues) {
        await writeAudit(options.pool, { ...audit, result: 'error' });
        throw new CallError(400, checked.issues.map((issue) => issue.message).join(', ') || 'Invalid input');
      }
      if (tool.access === 'read') {
        let outcome: ToolOutcome;
        try {
          outcome = await tool.run(checked.value, { db: options.pool, caller: who });
        } catch (err) {
          await writeAudit(options.pool, { ...audit, result: 'error' });
          throw err;
        }
        await writeAudit(options.pool, { ...audit, entityId: outcome.entityId ?? null });
        res.json({ result: outcome.result });
        return;
      }
      const client = await options.pool.connect();
      let outcome: ToolOutcome;
      try {
        await client.query('BEGIN');
        outcome = await tool.run(checked.value, { db: client, caller: who });
        await writeAudit(client, {
          ...audit,
          entityId: outcome.entityId ?? null,
          before: outcome.before,
          after: outcome.after,
        });
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        // The change rolled back with its row; this row records the failed attempt.
        await writeAudit(options.pool, { ...audit, result: 'error' });
        throw err;
      } finally {
        client.release();
      }
      res.json({ result: outcome.result });
    } catch (err) {
      fail(res, err, next);
    }
  });
}
