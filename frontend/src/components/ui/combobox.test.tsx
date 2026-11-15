// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { Combobox } from './combobox';
import { type ComboboxGroup, filterComboboxGroups } from './combobox-filter';
import { Label } from './label';

const GROUPS: ComboboxGroup[] = [
  { label: 'Recently used', options: ['Bench press', 'Squat'] },
  { label: 'Frequently used', options: ['Deadlift', 'Bench dip'] },
];

function Exercise({ options = GROUPS, onSubmit = () => {}, emptyMessage }: { options?: readonly string[] | readonly ComboboxGroup[]; onSubmit?: () => void; emptyMessage?: string }) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Label htmlFor="exercise">Exercise</Label>
      <Combobox id="exercise" value={value} onValueChange={setValue} options={options} listLabel="Suggestions" emptyMessage={emptyMessage} />
    </form>
  );
}

const field = () => screen.getByRole('combobox', { name: 'Exercise' });

test('the field is a named combobox that points at its list', () => {
  render(<Exercise />);
  expect(field()).toHaveAttribute('aria-expanded', 'false');
  expect(field()).toHaveAttribute('aria-controls', 'exercise-listbox');
  expect(field()).toHaveAttribute('autocomplete', 'off');
});

test('typing filters the options, ignoring spaces and letter case, under their group titles', () => {
  render(<Exercise />);
  fireEvent.change(field(), { target: { value: 'BENCH' } });
  expect(field()).toHaveAttribute('aria-expanded', 'true');
  const list = screen.getByRole('listbox', { name: 'Suggestions' });
  expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Bench press', 'Bench dip']);
  expect(within(list).getByRole('group', { name: 'Recently used' })).toContainElement(screen.getByRole('option', { name: 'Bench press' }));
  expect(within(list).getByRole('group', { name: 'Frequently used' })).toContainElement(screen.getByRole('option', { name: 'Bench dip' }));
});

test('arrow keys move across groups, Enter picks without submitting the form', () => {
  const onSubmit = vi.fn();
  render(<Exercise onSubmit={onSubmit} />);
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(field()).toHaveAttribute('aria-activedescendant', 'exercise-listbox-0');
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: 'Deadlift' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(field()).toHaveValue('Squat');
  expect(field()).toHaveAttribute('aria-expanded', 'false');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('Esc closes the list, and free text stays as typed', () => {
  render(<Exercise options={['Bench press', 'Squat']} />);
  field().focus();
  fireEvent.change(field(), { target: { value: 'Pull' } });
  expect(field()).toHaveAttribute('aria-expanded', 'false');
  fireEvent.change(field(), { target: { value: 'S' } });
  expect(field()).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(field()).toHaveAttribute('aria-expanded', 'false');
  expect(field()).toHaveValue('S');
});

test('a click picks an option, and leaving the field closes the list', () => {
  render(<Exercise />);
  fireEvent.click(field());
  fireEvent.click(screen.getByRole('option', { name: 'Deadlift' }));
  expect(field()).toHaveValue('Deadlift');
  fireEvent.change(field(), { target: { value: 'Bench' } });
  expect(field()).toHaveAttribute('aria-expanded', 'true');
  fireEvent.blur(field());
  expect(field()).toHaveAttribute('aria-expanded', 'false');
});

test('the empty message is announced only when the typed text matches nothing', () => {
  render(<Exercise emptyMessage="No match. It is saved as a new name." />);
  const status = screen.getByRole('status');
  fireEvent.change(field(), { target: { value: 'Squ' } });
  expect(status).toBeEmptyDOMElement();
  fireEvent.change(field(), { target: { value: 'Pull-up' } });
  expect(status).toHaveTextContent('No match. It is saved as a new name.');
  fireEvent.blur(field());
  expect(status).toBeEmptyDOMElement();
});

test('options are 44px tall on touch screens', () => {
  render(<Exercise />);
  fireEvent.click(field());
  expect(screen.getByRole('option', { name: 'Squat' })).toHaveClass('pointer-coarse:min-h-11');
});

test('filterComboboxGroups caps the total, drops empty groups, and hides the exact value', () => {
  const many = [{ label: 'A', options: ['a1', 'a2', 'a3'] }, { label: 'B', options: ['b1', 'b2'] }, { label: 'C', options: ['c1'] }];
  expect(filterComboboxGroups(many, '', 4)).toEqual([{ label: 'A', options: ['a1', 'a2', 'a3'] }, { label: 'B', options: ['b1'] }]);
  expect(filterComboboxGroups(GROUPS, 'Squat')).toEqual([]);
  expect(filterComboboxGroups(GROUPS, 'dead lift')).toEqual([{ label: 'Frequently used', options: ['Deadlift'] }]);
});
