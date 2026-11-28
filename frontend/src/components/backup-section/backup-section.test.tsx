// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/backup-section/
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { BackupSection } from './backup-section';

afterEach(() => vi.restoreAllMocks());

function stubDownload() {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }),
  );
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
}

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

test('export downloads the data under the file name and announces it', async () => {
  const click = stubDownload();
  const onExport = vi.fn(() => '{"items":[]}');
  render(<BackupSection fileName="backup.json" onExport={onExport} onImport={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Export data' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backup downloaded.'));
  expect(onExport).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
});

test('a failed export shows the reason in the alert region', async () => {
  stubDownload();
  render(
    <BackupSection
      fileName="backup.json"
      onExport={() => Promise.reject(new Error('Could not read the data'))}
      onImport={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Export data' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read the data'),
  );
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

test('import asks first, then hands the file over only after the confirmation', async () => {
  const onImport = vi.fn(() => Promise.resolve());
  render(<BackupSection fileName="backup.json" onExport={() => ''} onImport={onImport} />);
  const file = new File(['{}'], 'backup.json', { type: 'application/json' });
  pick(screen.getByLabelText<HTMLInputElement>('Import data'), file);
  expect(await screen.findByRole('dialog', { name: 'Replace your data?' })).toBeInTheDocument();
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(onImport).toHaveBeenCalledWith(file));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backup imported.'));
});

test('cancelling the confirmation imports nothing', async () => {
  const onImport = vi.fn();
  render(<BackupSection fileName="backup.json" onExport={() => ''} onImport={onImport} />);
  pick(screen.getByLabelText<HTMLInputElement>('Import data'), new File(['{}'], 'b.json'));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onImport).not.toHaveBeenCalled();
});

test('the section is named by its title, and the texts can be overridden', () => {
  render(
    <BackupSection
      title="Your data"
      exportLabel="Save a copy"
      importLabel="Load a copy"
      fileName="b.json"
      onExport={() => ''}
      onImport={() => {}}
    />,
  );
  expect(screen.getByRole('region', { name: 'Your data' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save a copy' })).toBeInTheDocument();
  expect(screen.getByLabelText('Load a copy')).toBeInTheDocument();
});
