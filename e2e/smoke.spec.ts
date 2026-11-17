import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// #568/#569 (central): the smoke test every app has. The first screen loads, the API answers,
// nothing throws in the browser, and axe finds no critical accessibility problem.
test('the first screen loads, the API is healthy, and nothing breaks in the browser', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);

  const { violations } = await new AxeBuilder({ page }).analyze();
  const critical = violations.filter((violation) => violation.impact === 'critical');
  expect(critical.map((violation) => violation.id)).toEqual([]);
});
