import { afterEach, expect } from 'vitest';

// #183 A test fake answers only the requests it expects. A fake cannot fail the test from inside `fetch`: the
// screen catches the error and shows it, and the test may still pass. So any other request is recorded here, and
// the test fails when it ends, naming each request no fake answered (a misspelled path, a new call, a wrong method).

const unexpected: string[] = [];

afterEach(() => {
  const found = unexpected.splice(0);
  expect(found, 'requests that no test fake answers').toEqual([]);
});

/** Records a request the fake does not answer and rejects it like a failed connection. */
export function unexpectedRequest(method: string, url: string): Promise<Response> {
  unexpected.push(`${method} ${url}`);
  return Promise.reject(new TypeError(`The test fake does not answer ${method} ${url}`));
}
