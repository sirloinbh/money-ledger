// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// OpenAPI 3.1 document builder shared by every app (#679). The app keeps only its operation table in
// backend/src/openapi.ts; this file turns Zod schemas into JSON Schema with z.toJSONSchema() (no walking of Zod
// internals) and adds what every guarded route has: the shared sign-in security scheme and the 401, 413 and 429
// answers. Which routes exist is not read from Express: a test compares the table with the registered routes
// (scaffold backend/test/openapi.test.ts), so this file does not depend on Express.
//
//   export const operations = { 'GET /api/items': { summary: 'List items', status: [200, 500] }, ... };
//   buildOpenApi({ title: 'Items API', description: '...', operations });
import { toJSONSchema, type ZodType } from 'zod/v4';

type Json = Record<string, unknown>;

export type Operation = {
  summary: string;
  /** The request body: its component name and Zod schema. */
  body?: [name: string, schema: ZodType];
  /**
   * Path parameters by name, as Zod schemas (for example `{ kind: z.enum(['a', 'b']), start: z.iso.date() }`). A name that is
   * not listed is an integer id when it is `id` or ends in `Id`, and a string otherwise.
   */
  params?: Record<string, ZodType>;
  /** Request headers the route reads, by name (for example `{ 'Idempotency-Key': { description: '...', schema: z.uuid() } }`). */
  headers?: Record<string, { description: string; schema?: ZodType; required?: boolean }>;
  /** Query parameters as one Zod object. */
  query?: ZodType;
  /** The success status first, then the error statuses this route documents on its own. */
  status: number[];
  /** The content type of a success body that is not JSON (for example `text/csv`), documented as a string. */
  produces?: string;
  /** Needs no sign-in (only GET /api/health): no security requirement, no default 401 or 429. */
  public?: boolean;
};

export type OpenApiOptions = {
  title: string;
  /** The `info.description`: formats, time zone, the error shape. */
  description: string;
  /** `'GET /api/items/:id'` → operation. */
  operations: Record<string, Operation>;
  /** The description of the `error` field of the shared Error schema. */
  errorDescription?: string;
  /**
   * The app registers `createErrorHandler({ fields: true })` (standard/http.ts), so a validation 400 also lists the invalid
   * fields: the Error schema then documents the optional `fields: [{ path, message }]` (#999).
   */
  errorFields?: boolean;
  /** Replaces the default text of a status, e.g. `{ 409: 'The name is taken' }`. */
  statusText?: Record<number, string>;
};

const defaultStatusText: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No content',
  400: 'Invalid input',
  401: 'Sign-in required',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Duplicate or conflict',
  413: 'Request body too large',
  429: 'Too many requests',
  500: 'Server error',
  503: 'Sign-in service unavailable',
};

/** The cookie the shared sign-in sets (ADR-0015); a `__Secure-` prefix is added on HTTPS. */
const SESSION_COOKIE = 'sirloinbh.session_token';

/** A Zod schema as OpenAPI 3.1 (JSON Schema 2020-12). A type JSON Schema cannot express throws. */
export function schemaOf(schema: ZodType): Json {
  const json = toJSONSchema(schema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'throw' }) as Json;
  delete json.$schema;
  return json;
}

/** `id` and names like `workoutId` are integer ids unless the operation lists a schema for them. */
const isIdName = (name: string) => name === 'id' || /[a-z0-9]Id$/.test(name);

// The `fields` list of a validation 400 with createErrorHandler({ fields: true }) (standard/http.ts FieldError).
const errorFieldsSchema = {
  type: 'array',
  description: 'Only on a validation 400: each invalid field with its message',
  items: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Where the field is in the input, joined by dots (items.0.name)' },
      message: { type: 'string', description: 'The message for this field' },
    },
    required: ['path', 'message'],
  },
};
const errorRef = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };

/** Fails on a table entry the document cannot describe, naming the route, instead of writing a wrong document. */
function checkOperation(route: string, op: Operation) {
  const [method, path, ...extra] = route.split(' ');
  if (!method || !path || !path.startsWith('/') || extra.length) {
    throw new Error(`${route}: the key must be 'METHOD /path'`);
  }
  if (op.status.length === 0) throw new Error(`${route}: status needs at least the success status`);
  const names = [...path.matchAll(/:(\w+)/g)].map(([, name]) => name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated) throw new Error(`${route}: the path parameter :${repeated} appears twice`);
  for (const name of Object.keys(op.params ?? {})) {
    if (!names.includes(name)) throw new Error(`${route}: params lists '${name}', which is not a parameter of the path`);
  }
  const headers = Object.keys(op.headers ?? {}).map((name) => name.toLowerCase());
  const twice = headers.find((name, index) => headers.indexOf(name) !== index);
  if (twice) throw new Error(`${route}: the header '${twice}' is listed twice (header names ignore case)`);
}

export function buildOpenApi(options: OpenApiOptions) {
  const text = { ...defaultStatusText, ...options.statusText };
  const schemas: Json = {
    Error: {
      type: 'object',
      properties: {
        error: { type: 'string', description: options.errorDescription ?? 'A short message for the user' },
        ...(options.errorFields ? { fields: errorFieldsSchema } : {}),
      },
      required: ['error'],
    },
  };
  const paths: Record<string, Json> = {};
  for (const route of Object.keys(options.operations).sort()) {
    const [method, path] = route.split(' ') as [string, string];
    const op = options.operations[route];
    checkOperation(route, op);
    const parameters: Json[] =[...path.matchAll(/:(\w+)/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: op.params?.[name] ? schemaOf(op.params[name]) : isIdName(name) ? { type: 'integer', minimum: 1 } : { type: 'string' },
    }));
    if (op.query) {
      const query = schemaOf(op.query) as { type?: unknown; properties?: Json; required?: string[] };
      // A union or an intersection has no `properties`: its parameters would silently be left out of the document.
      if (query.type !== 'object' || typeof query.properties !== 'object') {
        throw new Error(`${route}: query must be a Zod object (a union or intersection cannot be listed as parameters)`);
      }
      for (const [name, schema] of Object.entries(query.properties)) {
        parameters.push({ name, in: 'query', required: !!query.required?.includes(name), schema });
      }
    }
    for (const [name, header] of Object.entries(op.headers ?? {})) {
      parameters.push({
        name,
        in: 'header',
        required: header.required ?? false,
        description: header.description,
        schema: header.schema ? schemaOf(header.schema) : { type: 'string' },
      });
    }
    if (op.body) schemas[op.body[0]] = schemaOf(op.body[1]);
    const [success, ...failures] = op.status as [number, ...number[]];
    // Every guarded route can answer 401 and 429; a route with a body can also answer 413. An own entry wins.
    const statuses = new Set([...failures, ...(op.public ? [] : [401, 429]), ...(op.body ? [413] : [])]);
    statuses.delete(success);
    const responses: Json = {
      [success]: {
        description: text[success] ?? String(success),
        ...(op.produces ? { content: { [op.produces]: { schema: { type: 'string' } } } } : {}),
      },
    };
    for (const status of [...statuses].sort((a, b) => a - b)) {
      responses[status] = { description: text[status] ?? String(status), ...errorRef };
    }
    const key = path.replace(/:(\w+)/g, '{$1}');
    paths[key] ??= {};
    paths[key][method.toLowerCase()] = {
      summary: op.summary,
      ...(op.public ? { security: [] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: `#/components/schemas/${op.body[0]}` } } },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: options.title, version: '1.0.0', description: options.description },
    servers: [{ url: '/' }],
    security: [{ session: [] }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: SESSION_COOKIE,
          description: 'The shared sign-in session cookie (ADR-0015).',
        },
      },
    },
  };
}
