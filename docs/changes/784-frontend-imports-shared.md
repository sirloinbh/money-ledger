# #784 money-ledger: the frontend imports shared/contract.ts directly

Part of project-standards#784. The Docker builds use the repo root (#770), so the frontend needs no copy.

## Change

| File                          | Content                         |
| ----------------------------- | ------------------------------- |
| `frontend/src/categories.tsx` | Imports `../../shared/contract` |
| `frontend/src/contract.ts`    | Deleted                         |

The managed `frontend/tsconfig.json` includes `../shared`, `scripts/contract.mjs` checks the backend copy only, and `knip.json` no longer ignores the frontend copy (all from the sync PR #220). The backend keeps `backend/src/contract.ts`.
