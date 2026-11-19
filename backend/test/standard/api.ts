// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/test/standard/
// Starts an Express app on a port that fetch accepts and hands the test a `call` function (#680). Before this, each app
// kept its own copy of this helper, with two different fixes for the same "bad port" failure.
//
//   import { withApi } from './standard/api.js';
//   await withApi(createApp(pool), async (call) => {
//     const { status, data } = await call('/api/health');
//   });
//
// A random port from listen(0) is sometimes one the fetch standard refuses to connect to ("bad port", see the port
// blocking list in the Fetch spec); this helper closes such a listener and asks for another.
import { once } from 'node:events';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Ports fetch refuses to connect to. Windows and Linux can both hand them out for listen(0). */
export const fetchBlockedPorts: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** Listens on 127.0.0.1 and returns the port, trying again while the port is one fetch refuses. */
export async function listenLocally(server: Server, tries = 100) {
  for (let attempt = 0; attempt < tries; attempt++) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    if (!fetchBlockedPorts.has(port)) return port;
    server.close();
    await once(server, 'close');
  }
  throw new Error(`No local port that fetch accepts after ${tries} tries`);
}

export type ApiRequest = {
  method?: string;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as it is, with `contentType` (for example to test a malformed body). */
  rawBody?: string;
  form?: FormData;
  contentType?: string;
  headers?: Record<string, string>;
};

export type ApiResponse = {
  status: number;
  /** The parsed JSON body; `{}` when there is none (204) or it is not JSON. */
  data: Record<string, unknown>;
  headers: Headers;
  bytes: Buffer;
};

export type ApiCall = (path: string, init?: ApiRequest) => Promise<ApiResponse>;

/** Serves `app` (an Express app or any request listener) for the length of `run`, then closes the server. */
export async function withApi(app: RequestListener, run: (call: ApiCall) => Promise<void>) {
  const server = createServer(app);
  const port = await listenLocally(server);
  try {
    await run(async (path, init = {}) => {
      const headers: Record<string, string> = { ...init.headers };
      if (init.body !== undefined) headers['content-type'] = 'application/json';
      else if (init.contentType) headers['content-type'] = init.contentType;
      const body = init.form ?? (init.body === undefined ? init.rawBody : JSON.stringify(init.body));
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: init.method ?? 'GET', headers, body });
      const bytes = Buffer.from(await response.arrayBuffer());
      const text = bytes.toString('utf8');
      let data: Record<string, unknown> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        // Not JSON (a file download, an HTML error page): the test reads `bytes`.
      }
      return { status: response.status, data, headers: response.headers, bytes };
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}
