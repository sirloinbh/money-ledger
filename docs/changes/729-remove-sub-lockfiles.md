# #729 Remove the sub-repo CI files and sub-lockfiles

Part of project-standards#729. After #770 both images build from the repo root with the root `package-lock.json`, so the leftovers of the subtree layout (ADR-0022) have no user.

## Change

| File                                                                    | Content                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `frontend/.github/workflows/ci.yml`, `backend/.github/workflows/ci.yml` | Deleted: the workflows of the 24 sub-repos; GitHub only reads `.github/workflows` at the repo root |
| `frontend/package-lock.json`, `backend/package-lock.json`               | Deleted: CI and both Docker builds install from the root lockfile                                  |

Nothing else changes. Archiving the sub-repos is a user step in project-standards#729.
