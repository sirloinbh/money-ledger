// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Label } from './label';
import { Textarea } from './textarea';

test('a label names the textarea and typing updates the value', () => {
  render(
    <>
      <Label htmlFor="memo">Memo</Label>
      <Textarea id="memo" />
    </>,
  );
  const field = screen.getByLabelText('Memo');
  fireEvent.change(field, { target: { value: 'Felt strong' } });
  expect(field).toHaveValue('Felt strong');
  expect(field).toHaveClass('border-input', 'pointer-coarse:min-h-24');
});

test('without a limit there is no counter', () => {
  render(<Textarea aria-label="Memo" />);
  expect(document.querySelector('[data-slot="textarea-counter"]')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Memo' })).not.toHaveAttribute('aria-describedby');
});

test('the counter is linked to the field and follows an uncontrolled value', () => {
  render(<Textarea aria-label="Memo" limit={10} defaultValue="abc" aria-describedby="hint" />);
  const field = screen.getByRole('textbox', { name: 'Memo' });
  expect(field).toHaveAccessibleDescription(/3\/10/);
  expect(field.getAttribute('aria-describedby')).toMatch(/^hint /);
  fireEvent.change(field, { target: { value: 'abcdef' } });
  expect(field).toHaveAccessibleDescription(/6\/10/);
  expect(field).not.toBeInvalid();
});

test('past the limit the counter says so in words and the field is invalid', () => {
  const { rerender } = render(<Textarea aria-label="Memo" limit={5} value="12345" onChange={() => {}} />);
  const field = screen.getByRole('textbox', { name: 'Memo' });
  expect(field).not.toBeInvalid();
  rerender(<Textarea aria-label="Memo" limit={5} value="12345678" onChange={() => {}} />);
  expect(field).toBeInvalid();
  expect(field).toHaveAccessibleDescription('8/5 · 3 over the limit');
  // Typing is not blocked, so pasted text is not cut off silently.
  expect(field).not.toHaveAttribute('maxlength');
});
