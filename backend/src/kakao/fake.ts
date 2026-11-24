import type { Template } from './api.js';
import type { Messenger } from './service.js';

/** #311 A Messenger for tests: records every message instead of sending it; `failNext` makes sends throw. */
export type FakeMessenger = Messenger & { sent: Template[]; failures: Error[] };

export function fakeMessenger(): FakeMessenger {
  const fake: FakeMessenger = {
    sent: [],
    failures: [],
    send(template) {
      const failure = fake.failures.shift();
      if (failure) return Promise.reject(failure);
      fake.sent.push(template);
      return Promise.resolve();
    },
  };
  return fake;
}
