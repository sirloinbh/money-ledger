# #368 Mark the Korean CSV parser and stored category names

The central check (sirloinbh/project-standards#1129) fails on Korean outside comments in `frontend/src`. Rule (user decision 2026-11-27): Korean stays only where it is truly needed, marked with `korean-ok: <reason>`; plain screen text is English; a stored Korean value shown on screen keeps its key and gets an English label (no data migration).

| File                              | Change                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `frontend/src/entry-csv-parse.ts` | `korean-ok-file`: recognizes Korean CSV and bank statement headers                                               |
| `frontend/src/fixed-costs.tsx`    | The three default category names the presets match (`주거`, `여가`, `통신`) are named constants with `korean-ok` |

No behavior change. The default categories are seeded in Korean (migration 002) and shown as stored on many screens; showing English labels through a key-to-label map is a separate card (see the issue notes).
