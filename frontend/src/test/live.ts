import { screen, waitFor, within } from '@testing-library/react';

// The shared Notice keeps its live regions (role="alert" and role="status") in the page, empty until there is a
// message (#684). So tests look for the region that has text, not for the role alone.

type Role = 'alert' | 'status';

const queryWithText = (role: Role, container?: HTMLElement) => {
  const found = (container ? within(container) : screen)
    .queryAllByRole(role)
    .filter((element) => (element.textContent ?? '').trim() !== '');
  if (found.length > 1) throw new Error(`Found ${found.length} ${role} regions with text`);
  return found[0] ?? null;
};

/** The one region of this role that has text now, or null. */
export const queryLive = (role: Role, container?: HTMLElement) => queryWithText(role, container);

/** Like getByRole: the one region with text, or an error. */
export const getLive = (role: Role, container?: HTMLElement) => {
  const element = queryWithText(role, container);
  if (!element) throw new Error(`No ${role} region has text`);
  return element;
};

/** Like findByRole: waits until the one region with text appears. */
export const findLive = (role: Role, container?: HTMLElement) =>
  waitFor(() => getLive(role, container));
