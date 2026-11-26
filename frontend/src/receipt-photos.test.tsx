import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ReceiptPhotos } from './receipt-photos';

// #300 Attach, view and delete a receipt photo. The server (which strips the metadata) is faked.
let photos: { id: number; contentType: string; byteSize: number }[];
let enabled: boolean;
let calls: { method: string; url: string; type?: string }[];

beforeEach(() => {
  photos = [];
  enabled = true;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const type = (init?.headers as Record<string, string> | undefined)?.['content-type'];
      calls.push({ method, url, type });
      if (method === 'POST') {
        photos = [...photos, { id: 7, contentType: 'image/jpeg', byteSize: 3 }];
        return Promise.resolve(new Response(JSON.stringify({ photo: photos[0] }), { status: 201 }));
      }
      if (method === 'DELETE') {
        photos = [];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ photos, enabled })));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

test('opens the receipts, attaches a photo and sends its bytes with the image type', async () => {
  render(<ReceiptPhotos entryId={3} label="Cafe" />);
  fireEvent.click(screen.getByRole('button', { name: 'Receipts of Cafe' }));
  expect(await screen.findByText('No receipt photos yet.')).toBeTruthy();
  const file = new File(['abc'], 'receipt.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText('Attach a photo'), { target: { files: [file] } });
  const image = await screen.findByAltText('Receipt 1');
  expect(image.getAttribute('src')).toBe('/api/ledger/entries/3/photos/7');
  expect(screen.getByText('Photo attached')).toBeTruthy();
  const post = calls.find((call) => call.method === 'POST')!;
  expect(post.url).toBe('/api/ledger/entries/3/photos');
  expect(post.type).toBe('image/jpeg');
});

test('refuses a file that is not a JPEG or PNG, or too large, without sending it', async () => {
  render(<ReceiptPhotos entryId={3} label="Cafe" />);
  fireEvent.click(screen.getByRole('button', { name: 'Receipts of Cafe' }));
  await screen.findByText('No receipt photos yet.');
  const input = screen.getByLabelText('Attach a photo');
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
  expect(await screen.findByText('Choose a JPEG or PNG photo')).toBeTruthy();
  const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
  Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
  fireEvent.change(input, { target: { files: [big] } });
  expect(await screen.findByText('The photo is larger than 8 MB')).toBeTruthy();
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
});

test('deletes a photo after confirming', async () => {
  photos = [{ id: 7, contentType: 'image/jpeg', byteSize: 3 }];
  render(<ReceiptPhotos entryId={3} label="Cafe" />);
  fireEvent.click(screen.getByRole('button', { name: 'Receipts of Cafe' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete receipt photo 1 of Cafe' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.getByText('No receipt photos yet.')).toBeTruthy());
  expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/photos/7'))).toBe(
    true,
  );
});

test('says so when photo storage is not set up', async () => {
  enabled = false;
  render(<ReceiptPhotos entryId={3} label="Cafe" />);
  fireEvent.click(screen.getByRole('button', { name: 'Receipts of Cafe' }));
  expect(await screen.findByText('Photo storage is not set up on this server.')).toBeTruthy();
  expect(screen.queryByLabelText('Attach a photo')).toBeNull();
});
