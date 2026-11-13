# #10 Move the screens to the shared design system

- Issue: [#10](https://github.com/sirloinbh/money-ledger/issues/10) (central tracking issue sirloinbh/project-standards#126)
- Branch: `feat/10-design-system`

## Purpose

All 8 apps agreed to use the same tokens, components, layout, and PWA settings (central ADR-0007 and ADR-0008). The method follows "Migrating an existing app" in the central `docs/design-system.md` (workout-memo#160 applied it first).

## Changes: 2026-10-26

### Packages

The user installed them directly. They are the packages in the central ADR-0007 table (pre-approved on 2026-10-22) plus react-router, vitest, jsdom, and Testing Library (approved on 2026-10-26). All are pinned versions, at least 14 days since release, with `--ignore-scripts`.

- dependencies: `@sirloinbh/design-tokens` 1.0.0, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `radix-ui` 1.7.0, `react-router` 8.4.0, `sonner` 2.0.8, `tailwind-merge` 3.7.0, `tw-animate-css` 1.4.0, `vaul` 1.1.2, `lucide-react` 0.468.0 → 1.52.0
- devDependencies: `tailwindcss` and `@tailwindcss/vite` 4.3.3, `vitest` 5.0.3, `jsdom` 30.1.2, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/jest-dom` 7.0.1
- Two lockfiles (root and `frontend/`): no packages removed, and `lucide-react` is the only one whose version changed. Every new entry comes from the official registry, has an integrity value, and has no install script. `ioc-scan`: no suspicious entries

### Shared files (centrally managed)

These are exactly what came out of a sync preview in which the central repo turned on this app's `features.ui` and `features.vitest`: the 15 files under `frontend/src/components/ui/` and their tests, `components/layout/`, `lib/utils.ts` and `theme.ts`, `public/theme-init.js`, and `frontend/vitest.config.ts`.

### App code

- **Screens:** replaced the own shell (sidebar and header) with `AppShell` and added page addresses (`/`, `/settings`). The own `style.css` was removed, and the shared tokens and `EmptyState` are used.
- **Entry points:** `app.tsx` (screens), `main.tsx` (rendering, and service worker registration only in production builds), and `index.css` (Tailwind, `tw-animate-css`, and the shared tokens).
- **PWA:** 4 icons (central `scripts/pwa-icons.mjs`), and in `index.html` the manifest, icons, light and dark `theme-color`, `viewport-fit=cover`, and the script that prevents flicker.
- **Tests and build:** added a `test` (vitest) script and `src/test/setup.ts` to `frontend`, and the root `npm test` now also runs the frontend tests. The production build excludes test files through `tsconfig.build.json`. The Tailwind plugin was added to `vite.config.ts`.
- **Removed the screen test in the backend:** `backend/test/app-ui.test.ts` was a temporary test that ran `main.tsx` with a fake React when Vitest was not available. The frontend Vitest test checks the same things (title, server status, error alert, menu navigation) with a real React, so we removed it.
- **Screen test (`app.test.tsx`):** server date display, server error alert, page navigation by menu and current page display, and handling of unknown addresses.

## Verification

- Prettier, ESLint, `tsc` (all), 40 frontend tests passed, `vite build`, `ioc-scan`
- Backend tests need a DB, so CI checks them.
