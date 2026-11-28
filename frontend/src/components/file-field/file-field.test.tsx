// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/file-field/
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { downloadBlob } from './download-blob';
import { FileField } from './file-field';

afterEach(() => vi.restoreAllMocks());

function pick(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

test('the English label names the file input, and the input stays in the page for the keyboard', () => {
  render(<FileField onFiles={() => {}}>Import file</FileField>);
  const input = screen.getByLabelText<HTMLInputElement>('Import file');
  expect(input.type).toBe('file');
  expect(input).toHaveClass('sr-only');
  expect(screen.getByText('Import file').closest('label')).toHaveClass(
    'cursor-pointer',
    'min-h-10',
    'pointer-coarse:min-h-12',
  );
});

test('the default label is English', () => {
  render(<FileField onFiles={() => {}} />);
  expect(screen.getByLabelText('Choose file')).toBeInTheDocument();
});

test('onFiles gets the chosen files and the input is cleared so the same file can be chosen again', () => {
  const onFiles = vi.fn();
  render(<FileField onFiles={onFiles} accept=".json" multiple />);
  const input = screen.getByLabelText<HTMLInputElement>('Choose file');
  expect(input).toHaveAttribute('accept', '.json');
  expect(input.multiple).toBe(true);
  const file = new File(['{}'], 'backup.json', { type: 'application/json' });
  pick(input, [file]);
  expect(onFiles).toHaveBeenCalledWith([file]);
  expect(input.value).toBe('');
});

test('no files chosen calls nothing, and a disabled field disables the input and keeps the not-allowed cursor', () => {
  const onFiles = vi.fn();
  const { rerender } = render(<FileField onFiles={onFiles} />);
  pick(screen.getByLabelText<HTMLInputElement>('Choose file'), []);
  expect(onFiles).not.toHaveBeenCalled();
  rerender(<FileField onFiles={onFiles} disabled />);
  expect(screen.getByLabelText('Choose file')).toBeDisabled();
  expect(screen.getByText('Choose file').closest('label')?.className).toContain(
    'has-disabled:cursor-not-allowed',
  );
});

test('downloadBlob downloads data under the given name and releases the address', () => {
  const create = vi.fn(() => 'blob:test');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('backup.json');
    expect(this.href).toBe('blob:test');
  });
  downloadBlob('backup.json', 'application/json', '{"a":1}');
  expect(click).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  const blob = (create.mock.calls[0] as unknown as [Blob])[0];
  expect(blob.type).toBe('application/json');
  expect(revoke).toHaveBeenCalledWith('blob:test');
  expect(document.querySelector('a[download]')).toBeNull();
});
