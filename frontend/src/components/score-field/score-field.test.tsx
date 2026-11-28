// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/score-field/
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { ScoreField } from './score-field';
import { scoreValues } from './score-values';

test('scoreValues lists the steps without drift', () => {
  expect(scoreValues(1, 5, 1)).toEqual([1, 2, 3, 4, 5]);
  expect(scoreValues(0.5, 5, 0.5)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  expect(scoreValues(0, 1, 0.1)).toHaveLength(11);
});

test('it is a named group of native radios that share one name, and the chosen one is checked', () => {
  render(<ScoreField label="Mood" value={3} onChange={() => {}} />);
  const group = screen.getByRole('group', { name: 'Mood' });
  const radios = screen.getAllByRole('radio');
  expect(group).toBeInTheDocument();
  expect(radios).toHaveLength(5);
  expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
  expect(screen.getByRole('radio', { name: '3' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '4' })).not.toBeChecked();
});

test('choosing a value calls onChange with the number, and Clear returns to no rating', () => {
  function Example() {
    const [value, setValue] = useState<number | null>(null);
    return (
      <>
        <ScoreField label="Mood" value={value} onChange={setValue} />
        <p>{`current: ${value === null ? 'none' : value}`}</p>
      </>
    );
  }
  render(<Example />);
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: '4' }));
  expect(screen.getByText('current: 4')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByText('current: none')).toBeInTheDocument();
  expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
});

test('min, max and step set the choices, and half steps report decimals', () => {
  const onChange = vi.fn();
  render(
    <ScoreField label="Score" value={null} onChange={onChange} min={0.5} max={2} step={0.5} />,
  );
  expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
    '0.5',
    '1',
    '1.5',
    '2',
  ]);
  fireEvent.click(screen.getByRole('radio', { name: '1.5' }));
  expect(onChange).toHaveBeenCalledWith(1.5);
});

test('the end captions describe the group, and allowClear false hides Clear', () => {
  render(
    <ScoreField
      label="Mood"
      value={2}
      onChange={() => {}}
      lowLabel="Poor"
      highLabel="Great"
      allowClear={false}
    />,
  );
  const group = screen.getByRole('group', { name: 'Mood' });
  expect(group).toHaveAccessibleDescription('Poor Great');
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
});

test('a disabled field disables every radio, and the choices keep the touch height', () => {
  render(<ScoreField label="Mood" value={null} onChange={() => {}} disabled className="mt-2" />);
  for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  expect(screen.getByRole('group')).toHaveClass('mt-2');
  expect(screen.getByRole('radio', { name: '1' }).closest('label')).toHaveClass(
    'min-h-10',
    'pointer-coarse:min-h-12',
    'cursor-pointer',
  );
});
