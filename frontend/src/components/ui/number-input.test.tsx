// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { NumberInput, NumberValueInput } from './number-input';
import { optionalNumber, stepValue } from './number-step';

function Weight({
  initial = '100',
  step = 2.5,
  min = 0,
  max,
}: {
  initial?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      label="Weight"
      value={value}
      onValueChange={setValue}
      step={step}
      min={min}
      max={max}
    />
  );
}

const field = () => screen.getByRole('textbox', { name: 'Weight' });
const down = () => screen.getByRole('button', { name: 'Decrease weight' });
const up = () => screen.getByRole('button', { name: 'Increase weight' });

test('the buttons change the value by the step', () => {
  render(<Weight />);
  fireEvent.click(up());
  expect(field()).toHaveValue('102.5');
  fireEvent.click(down());
  fireEvent.click(down());
  expect(field()).toHaveValue('97.5');
});

test('typing keeps the text as written', () => {
  render(<Weight />);
  fireEvent.change(field(), { target: { value: '12.' } });
  expect(field()).toHaveValue('12.');
});

test('only the button at the limit stops, and it keeps keyboard focus', () => {
  render(<Weight initial="2.5" min={0} max={5} />);
  fireEvent.click(down());
  expect(field()).toHaveValue('0');
  expect(down()).toHaveAttribute('aria-disabled', 'true');
  expect(down()).toBeEnabled();
  expect(up()).not.toHaveAttribute('aria-disabled');
  fireEvent.click(down());
  expect(field()).toHaveValue('0');

  fireEvent.click(up());
  fireEvent.click(up());
  expect(field()).toHaveValue('5');
  expect(up()).toHaveAttribute('aria-disabled', 'true');
  expect(down()).not.toHaveAttribute('aria-disabled');
});

test('a read-only or disabled field cannot be changed with the buttons', () => {
  const onValueChange = vi.fn();
  const { rerender } = render(
    <NumberInput label="Weight" value="10" onValueChange={onValueChange} readOnly />,
  );
  expect(field()).toHaveAttribute('readonly');
  fireEvent.click(up());
  rerender(<NumberInput label="Weight" value="10" onValueChange={onValueChange} disabled />);
  expect(field()).toBeDisabled();
  fireEvent.click(down());
  expect(onValueChange).not.toHaveBeenCalled();
});

test('an empty field can still be stepped from the minimum', () => {
  render(<Weight initial="" min={0} />);
  expect(down()).not.toHaveAttribute('aria-disabled');
  fireEvent.click(up());
  expect(field()).toHaveValue('2.5');
});

test('a whole-number step opens the numeric keypad, a fractional one the decimal keypad', () => {
  const { unmount } = render(<Weight step={1} />);
  expect(field()).toHaveAttribute('inputmode', 'numeric');
  unmount();
  render(<Weight step={0.25} />);
  expect(field()).toHaveAttribute('inputmode', 'decimal');
});

test('the keypad can be chosen, for kg in whole steps that may hold decimals', () => {
  render(
    <NumberInput label="Weight" value="10" onValueChange={() => {}} step={5} inputMode="decimal" />,
  );
  expect(field()).toHaveAttribute('inputmode', 'decimal');
});

test('stepValue rounds to the step, clamps, and treats an empty field as the minimum', () => {
  expect(stepValue('0.1', 0.2)).toBe('0.3');
  expect(stepValue('12.25', 1)).toBe('13.25');
  expect(stepValue('10', -2.5, 9)).toBe('9');
  expect(stepValue('10', 5, undefined, 12)).toBe('12');
  expect(stepValue('', 2.5, 0)).toBe('2.5');
  expect(stepValue('abc', 1)).toBe('1');
});

// #972: the stepper reads text the way the forms do.
test('optionalNumber keeps empty as null and refuses text that is not a plain decimal', () => {
  expect(optionalNumber('')).toBeNull();
  expect(optionalNumber('  ')).toBeNull();
  expect(optionalNumber(' 5.02 ')).toBe(5.02);
  expect(optionalNumber('1.')).toBe(1);
  expect(optionalNumber('.5')).toBe(0.5);
  expect(optionalNumber('-1')).toBe(-1);
  for (const text of ['0x10', '1e3', 'Infinity', '1,000', '1,5', '.', '-', '1..2']) {
    expect(optionalNumber(text)).toBeNaN();
  }
});

test('stepValue treats hex and thousands-separated text as unreadable, like the form reader', () => {
  expect(stepValue('0x10', 1)).toBe('1');
  expect(stepValue('1,000', 1)).toBe('1');
  expect(stepValue('0x10', 1, 5)).toBe('6');
});

// #105: a set's weight is a number in the editor state.
function NumericWeight({ initial = 100 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberValueInput label="Weight" value={value} onValueChange={setValue} step={2.5} min={0} />
      <output>{String(value)}</output>
      <button type="button" onClick={() => setValue(60)}>
        Restore draft
      </button>
    </>
  );
}
const stored = () => screen.getByRole('status').textContent;

test('a number field keeps typed text while it reads as the stored number', () => {
  render(<NumericWeight />);
  fireEvent.change(field(), { target: { value: '12.' } });
  expect(field()).toHaveValue('12.');
  expect(stored()).toBe('12');
  fireEvent.change(field(), { target: { value: '' } });
  expect(field()).toHaveValue('');
  expect(stored()).toBe('0');
});

test('a number field shows a value set from outside and steps from it', () => {
  render(<NumericWeight />);
  fireEvent.click(up());
  expect(field()).toHaveValue('102.5');
  expect(stored()).toBe('102.5');
  fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
  expect(field()).toHaveValue('60');
  fireEvent.click(down());
  expect(stored()).toBe('57.5');
});

test('the field name is on the input only, so a label lookup finds one element', () => {
  render(<Weight />);
  expect(screen.getAllByLabelText('Weight')).toEqual([field()]);
});

test('a decimal comma reads as a point and unreadable text is not taken', () => {
  render(<NumericWeight />);
  fireEvent.change(field(), { target: { value: '12,5' } });
  expect(field()).toHaveValue('12.5');
  expect(stored()).toBe('12.5');
  for (const typed of ['12.5a', '-', '1..', 'Infinity', '0x10', '1e3', ' 5']) {
    fireEvent.change(field(), { target: { value: typed } });
    expect(field()).toHaveValue('12.5');
    expect(stored()).toBe('12.5');
  }
});

test('a value can start with the decimal point', () => {
  render(<NumericWeight />);
  fireEvent.change(field(), { target: { value: '.' } });
  expect(field()).toHaveValue('.');
  expect(stored()).toBe('0');
  fireEvent.change(field(), { target: { value: '.5' } });
  expect(field()).toHaveValue('.5');
  expect(stored()).toBe('0.5');
});

// #972: a field that may be left empty, like a set's weight before it is typed.
function OptionalWeight({ initial }: { initial?: number }) {
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <>
      <NumberValueInput
        label="Weight"
        allowEmpty
        value={value}
        onValueChange={setValue}
        step={2.5}
        min={0}
        max={1000}
      />
      <output>{value === undefined ? 'empty' : String(value)}</output>
      <button type="button" onClick={() => setValue(undefined)}>
        Clear draft
      </button>
    </>
  );
}

test('with allowEmpty an emptied field stays empty instead of 0', () => {
  render(<OptionalWeight initial={100} />);
  fireEvent.change(field(), { target: { value: '' } });
  expect(field()).toHaveValue('');
  expect(stored()).toBe('empty');
});

test('with allowEmpty an empty value shows an empty field that steps from the minimum', () => {
  render(<OptionalWeight />);
  expect(field()).toHaveValue('');
  expect(stored()).toBe('empty');
  fireEvent.click(up());
  expect(field()).toHaveValue('2.5');
  expect(stored()).toBe('2.5');
  fireEvent.click(screen.getByRole('button', { name: 'Clear draft' }));
  expect(field()).toHaveValue('');
});

test('with allowEmpty a partly typed number keeps its text', () => {
  render(<OptionalWeight />);
  fireEvent.change(field(), { target: { value: '1.' } });
  expect(field()).toHaveValue('1.');
  expect(stored()).toBe('1');
  fireEvent.change(field(), { target: { value: '1.5' } });
  expect(stored()).toBe('1.5');
});

test('a typed number out of range is kept for the form to report, and − brings it back into range', () => {
  render(<OptionalWeight />);
  fireEvent.change(field(), { target: { value: '1500' } });
  expect(field()).toHaveValue('1500');
  expect(stored()).toBe('1500');
  expect(up()).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(down());
  expect(stored()).toBe('1000');
});

test('without allowEmpty the value stays a number', () => {
  const onValueChange = (value: number) => value;
  // @ts-expect-error: an empty value needs allowEmpty.
  void (<NumberValueInput label="Weight" value={undefined} onValueChange={onValueChange} />);
  // @ts-expect-error: with allowEmpty the callback must accept undefined.
  void (<NumberValueInput label="Weight" allowEmpty value={1} onValueChange={onValueChange} />);
});
