// `npm run openapi -w backend`: regenerates docs/openapi.json from the routes and schemas.
import { writeFile } from 'node:fs/promises';

import type { Pool } from 'pg';

import { createApp } from './app.js';
import { buildOpenApi } from './openapi.js';

// Routes are only registered, never called, so no database connection is opened.
const spec = buildOpenApi(createApp({} as Pool));
const out = new URL('../../docs/openapi.json', import.meta.url);
await writeFile(out, JSON.stringify(spec, null, 2) + '\n');
console.log(`docs/openapi.json: ${Object.keys(spec.paths).length} paths`);
