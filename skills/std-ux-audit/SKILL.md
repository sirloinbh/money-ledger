---
name: std-ux-audit
description: Audit an app's screens for usability and accessibility by using them in task order, measuring set metrics at 390x844 and 1440x900, and recording improvements as issues. Use before or after a major screen structure change, when the main screens of a new app are first in place, or when the user asks for a UX or accessibility audit.
---

<!-- Managed file. Edit it in sirloinbh/project-standards templates/app/skills/std-ux-audit/ -->

# Money Ledger UX and Accessibility Audit

This is the procedure for using an app's screens yourself in the order of the user's tasks, measuring set metrics, and leaving improvements as issues. The screen rules themselves are in the [design system](https://github.com/sirloinbh/project-standards/blob/main/docs/design-system.md); this skill defines **how to audit against those rules and where to record it**.

Basis: workout-memo `docs/ux-audit/2026-10-21.md` (workout-memo #112). This method applies to all 8 apps.

## When to do it

- When a new app's main screens are first in place
- Before a major screen structure change (baseline measurement) and after it (comparison measurement)
- After first applying the design system or the shared layout to an app

The checks done for every PR (checking screens at 390×844 and 1440×900, and the axe check in e2e) continue separately from this audit.

## Audit items

### Per-page measurements

Measure every page at 390×844, and measure the first screen at 1440×900 too.

| Item | Criterion | How to measure |
|---|---|---|
| Horizontal overflow | None | `document.documentElement.scrollWidth > innerWidth` |
| Touch target size | Pressable elements are 44×44px or more | `getBoundingClientRect()` of buttons, links, and inputs |
| Input font size | 16px or more (to prevent iOS auto-zoom) | Computed `font-size` of `input`, `select`, `textarea` |
| Small text | No body text under 13px | Count of text elements by computed `font-size` |
| Vertical length | Record the length of pages and modals, and check whether the main action is within the first screen | `scrollHeight`, the `y` coordinate of the main button |
| Automated accessibility check | No axe violations | `@axe-core/playwright` or another tool the app already has |
| Keyboard | Menus, modals, and drawers open and close with the keyboard alone. `Escape` closes them. The focus indicator is visible | Manual operation |
| Light and dark | Text and background are distinguishable in both modes | Screenshots after switching modes |

### Task scenarios

For each app, pick the 4 to 6 most frequently used tasks and perform them from start to finish at 390×844. Write the scenario list in the audit document and reuse it as is in the next audit.

For each task, record the following.

- Success or failure
- Number of inputs and taps
- Amount of scrolling (how many screens' worth)
- Points where you got stuck or confused
- Whether empty states, save results, and error messages are visible

### Evaluation criteria

- Nielsen's 10 usability heuristics
- The responsive, accessibility, and loading indicator rules of the [design system](https://github.com/sirloinbh/project-standards/blob/main/docs/design-system.md)
- Mobile first: the apps are mainly used on phones

## Method

1. **Prepare the data.** Do not use a personal DB.
   - In the local test DB container, create an audit DB (`<db>_ux_audit`) and run `npm run db:migrate`.
   - Put in an amount of data similar to real use through the API (for example, the last 4 weeks of records). Write the seed composition in the audit document.
2. **Start the app.** Start the API and the screen the same way as e2e. Use the e2e port from the [project overview](https://github.com/sirloinbh/project-standards/blob/main/docs/projects.md), or pick an unused port and write it in the document.
3. **Measure.** With Playwright (installed Chrome), measure the per-page items above and take screenshots.
   - Screen sizes: 390×844 (mobile), 1440×900 (PC)
4. **Perform the scenarios.** Perform the task scenarios at 390×844 and record them.
5. **Supplement with a real device and Lighthouse.** Perform 1 or 2 scenarios on a real phone and write down the model and browser. Write down the accessibility and best-practices scores from Chrome DevTools Lighthouse (mobile).
6. **Write down what you could not do.** For items you could not run, write the reason and how you will do it next. Do not record a measurement you did not run as a pass.

If you need a new measurement tool or npm package, do not install it; follow the adoption procedure in the [dependency policy](https://github.com/sirloinbh/project-standards/blob/main/docs/dependency-policy.md).

## Improvements and severity

Give each improvement a number (`U-01`…) and a severity.

| Severity | Meaning |
|---|---|
| P1 | Seriously hinders a main task |
| P2 | Inconvenient or risks a wrong press |
| P3 | Polish |

- Register improvements as issues in the app repo and link the issue numbers in the audit document. Issue priority follows [std-backlog](../std-backlog/SKILL.md).
- For improvements shared by several apps (design system, shared layout, shared components), open an issue in the central repo.
- At the end of the audit document, write the order of changes.

## Where to record

Keep it in each app repo.

```
docs/ux-audit/
├─ YYYY-MM-DD.md          # audit document (audit date in Asia/Seoul)
└─ YYYY-MM-DD/            # screenshots
   ├─ <page>-390.png
   └─ <page>-1440.png
```

The audit document has the following sections, in this order.

1. Summary: related issues, baseline screen sizes
2. Method: target commit, data, tools, what could not be done
3. Per-page measurements (390px)
4. Task scenarios (390px)
5. Improvements: number, severity, description, linked issue
6. Screenshots
7. Order of changes
8. Re-measurement: the procedure for measuring again under the same conditions

- When auditing again, create a new dated document and compare with the previous one. Do not rewrite the previous document.
- Make sure screenshots show no personal data, `.env` values, or tokens. Use only the audit seed data.
