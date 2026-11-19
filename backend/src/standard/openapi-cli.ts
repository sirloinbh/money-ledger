// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// `npm run openapi -w backend`: writes docs/openapi.json from the app's operation table (backend/src/openapi.ts,
// which exports `document`, built with buildOpenApi from ./openapi.js). Nothing is started and no database is opened.
// The module is loaded at run time, so this file compiles in an app whose openapi.ts does not export `document` yet.
import { writeFile } from 'node:fs/promises';

const { document } = (await import('../openapi.js')) as { document?: { paths: Record<string, unknown> } };
if (!document) {
  console.error('backend/src/openapi.ts must export `document` (buildOpenApi from ./standard/openapi.js).');
  process.exit(1);
}

// backend/src/standard is three levels below the repository root.
const out = new URL('../../../docs/openapi.json', import.meta.url);
await writeFile(out, JSON.stringify(document, null, 2) + '\n');
console.log(`docs/openapi.json: ${Object.keys(document.paths).length} paths`);
