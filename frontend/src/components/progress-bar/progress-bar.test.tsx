// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/progress-bar/
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { ProgressBar } from './progress-bar';

test('it is a named progress bar with its values and a spoken value text', () => {
  render(<ProgressBar label="Storage used" value={40} max={100} valueText="40 of 100 GB" />);
  const bar = screen.getByRole('progressbar', { name: 'Storage used' });
  expect(bar).toHaveAttribute('aria-valuenow', '40');
  expect(bar).toHaveAttribute('aria-valuemin', '0');
  expect(bar).toHaveAttribute('aria-valuemax', '100');
  expect(bar).toHaveAttribute('aria-valuetext', '40 of 100 GB');
  expect(screen.getByText('40 of 100 GB')).toBeInTheDocument();
});

test('without a value text it reads as a percentage of max', () => {
  render(<ProgressBar label="Upload" value={3} max={12} />);
  const bar = screen.getByRole('progressbar', { name: 'Upload' });
  expect(bar).toHaveAttribute('aria-valuetext', '25%');
  expect(bar.firstElementChild).toHaveStyle({ width: '25%' });
});

test('a value outside the range is kept inside it', () => {
  const { rerender } = render(<ProgressBar label="Upload" value={150} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  rerender(<ProgressBar label="Upload" value={-5} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});

test('without a value the bar is indeterminate and has no valuenow', () => {
  render(<ProgressBar label="Loading" />);
  const bar = screen.getByRole('progressbar', { name: 'Loading' });
  expect(bar).not.toHaveAttribute('aria-valuenow');
  expect(bar).not.toHaveAttribute('aria-valuetext');
});

test('a hidden label still names the bar and the value text is not shown twice', () => {
  render(<ProgressBar label="Upload" value={50} hideLabel />);
  expect(screen.getByRole('progressbar', { name: 'Upload' })).toBeInTheDocument();
  expect(screen.queryByText('50%')).toBeNull();
});
