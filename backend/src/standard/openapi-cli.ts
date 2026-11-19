// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// `npm run openapi -w backend`: writes docs/openapi.json from the app's operation table (backend/src/openapi.ts,
// which exports `document`). Nothing is started and no database is opened.
import { writeFile } from 'node:fs/promises';

import { document } from '../openapi.js';

// backend/src/standard is three levels below the repository root.
const out = new URL('../../../docs/openapi.json', import.meta.url);
await writeFile(out, JSON.stringify(document, null, 2) + '\n');
console.log(`docs/openapi.json: ${Object.keys(document.paths).length} paths`);
