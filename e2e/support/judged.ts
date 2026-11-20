// Managed file. Edit it in sirloinbh/project-standards templates/e2e/e2e/support/ (ADR-0028, #574).
// `expectJudged` asks Jev typed questions about a page region and checks the answers. See jev.ts for the rules:
// replay without a key, skip when there is no fixture, fail only on a confident wrong answer.
//
//   await expectJudged(page.getByRole('alert'), {
//     clear: { type: 'noul', instructions: 'Does the message tell the user what to fix?' },
//   }, { clear: true });
import { expect, type Locator, type Page, test } from '@playwright/test';

import { type JevExpected, type JevQuestion, judge } from './jev.js';

/** `target` is the region to judge (a Page means the whole body). The questions are in English; the text may be Korean. */
export async function expectJudged(
  target: Page | Locator,
  questions: Record<string, JevQuestion>,
  expected: JevExpected,
): Promise<void> {
  const region = 'goto' in target ? target.locator('body') : target;
  const state = await region.ariaSnapshot();
  const result = await judge({
    state,
    questions,
    expected,
    fixtureDir: `${process.cwd()}/e2e/fixtures/jev`,
    env: process.env,
  });
  const note = (type: string, description: string) =>
    test.info().annotations.push({ type, description });
  if (result.outcome === 'skipped') {
    note(result.reason.split(':')[0] ?? 'jev-skipped', result.reason);
    return;
  }
  if (result.outcome === 'invalid') throw new Error(result.message);
  for (const warning of result.warnings) note('jev-warning', warning);
  expect(result.failures, `Jev (${result.source}) disagrees with confidence`).toEqual([]);
}
