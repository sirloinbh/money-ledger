// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { FieldError } from './field';
import { fieldErrorId, invalidProps } from './field-props';
import { Input } from './input';

test('a message is linked to its control and the control is invalid', () => {
  render(
    <>
      <label>
        Weight
        <Input {...invalidProps('sets.0.weight', 'Enter a number')} />
      </label>
      <FieldError name="sets.0.weight">Enter a number</FieldError>
    </>,
  );
  const input = screen.getByLabelText('Weight');
  expect(input).toBeInvalid();
  expect(input).toHaveAccessibleDescription('Enter a number');
  expect(screen.getByText('Enter a number')).toHaveAttribute('id', 'issue-sets-0-weight');
});

test('without a message the control is not marked and nothing renders', () => {
  const { container } = render(<FieldError name="weight" />);
  expect(container).toBeEmptyDOMElement();
  expect(invalidProps('weight')).toEqual({});
  expect(fieldErrorId('a.b.c')).toBe('issue-a-b-c');
});
