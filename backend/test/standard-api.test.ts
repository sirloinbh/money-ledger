// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/test/
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { fetchBlockedPorts, listenLocally, withApi } from './standard/api.js';

test('a test server listens again when it is given a port that fetch refuses', async (t) => {
  const server = createServer((_req, res) => res.end('ok'));
  t.after(() => server.close());
  const real = server.address.bind(server);
  const given = [6000, 6666];
  server.address = () => {
    const port = given.shift();
    return port ? { ...(real() as AddressInfo), port } : real();
  };

  const port = await listenLocally(server);

  assert.deepEqual(given, []);
  assert.equal(port, (real() as AddressInfo).port);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
});

test('fetch still refuses the ports the helper stays away from', async () => {
  assert.ok(fetchBlockedPorts.has(6000));
  await assert.rejects(fetch('http://127.0.0.1:6000/'), (error: TypeError) => (error.cause as Error).message === 'bad port');
});

test('withApi sends JSON, returns status, data, headers and bytes, and treats 204 and non-JSON as no data', async () => {
  const app: RequestListener = (req, res) => {
    if (req.url === '/echo') {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ method: req.method, type: req.headers['content-type'], raw, trace: req.headers['x-trace'] }));
      });
    } else if (req.url === '/empty') {
      res.statusCode = 204;
      res.end();
    } else {
      res.end('<html>plain</html>');
    }
  };
  await withApi(app, async (call) => {
    const echoed = await call('/echo', { method: 'POST', body: { a: 1 }, headers: { 'x-trace': 't1' } });
    assert.equal(echoed.status, 200);
    assert.deepEqual(echoed.data, { method: 'POST', type: 'application/json', raw: '{"a":1}', trace: 't1' });
    assert.equal(echoed.headers.get('content-type'), 'application/json');

    const raw = await call('/echo', { method: 'PUT', rawBody: '{bad', contentType: 'application/json' });
    assert.equal(raw.data.raw, '{bad');

    const empty = await call('/empty', { method: 'DELETE' });
    assert.deepEqual([empty.status, empty.data], [204, {}]);

    const page = await call('/page');
    assert.deepEqual(page.data, {});
    assert.equal(page.bytes.toString(), '<html>plain</html>');
  });
});

test('withApi closes the server when the test throws', async () => {
  let port = 0;
  const app: RequestListener = (req, res) => {
    port = Number(req.headers.host?.split(':')[1]);
    res.end('ok');
  };
  await assert.rejects(
    withApi(app, async (call) => {
      await call('/');
      throw new Error('test failed');
    }),
    /test failed/,
  );
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});
