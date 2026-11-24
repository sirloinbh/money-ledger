import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NEWS_QUEUE, NEWS_SCHEDULE, newsQueue } from '../src/news/jobs.js';
import {
  fakeNewsSource,
  naverNewsSource,
  newsSourceFromEnv,
  parseNaverNews,
  stripTags,
} from '../src/news/source.js';

// A recorded-shape Naver news response (fields as the API documents them).
const recorded = {
  lastBuildDate: 'Tue, 24 Nov 2026 07:00:00 +0900',
  total: 3,
  start: 1,
  display: 3,
  items: [
    {
      title: '<b>증시</b> 급등, 코스피 &quot;3,000&quot; 돌파',
      originallink: 'https://www.example-news.co.kr/a/1',
      link: 'https://n.news.naver.com/mnews/article/001/0000000001',
      description: '코스피가 <b>증시</b> 상승을 이끌며 &amp; 외국인 매수세 &lt;유입&gt;',
      pubDate: 'Tue, 24 Nov 2026 06:50:00 +0900',
    },
    { title: '', link: 'https://n.news.naver.com/x', pubDate: 'Tue, 24 Nov 2026 06:00:00 +0900' },
    {
      title: '날짜 오류',
      link: 'https://n.news.naver.com/y',
      description: '',
      pubDate: 'not a date',
    },
  ],
};

test('parses a recorded Naver response and drops unusable items', () => {
  const items = parseNaverNews(recorded);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '증시 급등, 코스피 "3,000" 돌파');
  assert.equal(items[0].summary, '코스피가 증시 상승을 이끌며 & 외국인 매수세 <유입>');
  assert.equal(items[0].link, 'https://n.news.naver.com/mnews/article/001/0000000001');
  assert.equal(items[0].originalLink, 'https://www.example-news.co.kr/a/1');
  assert.equal(items[0].publisher, 'example-news.co.kr');
  assert.equal(items[0].publishedAt.toISOString(), '2026-11-23T21:50:00.000Z');
});

test('a response that is not the expected shape is an error, not an empty day', () => {
  assert.throws(() => parseNaverNews({ errorMessage: 'x' }), /format is not valid/);
  assert.throws(() => parseNaverNews(null), /format is not valid/);
});

test('strips tags and decodes entities', () => {
  assert.equal(stripTags('<b>금리</b>  인하\n전망'), '금리 인하 전망');
  assert.equal(stripTags('A &amp;amp; B'), 'A &amp; B'); // decoded once, not twice
  assert.equal(stripTags('<script>x</script>'), 'x');
});

test('the Naver source sends the keys as headers and never leaks them in an error', async (t) => {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  t.mock.method(globalThis, 'fetch', (url: string, init: { headers: Record<string, string> }) => {
    seen = { url, headers: init.headers };
    return Promise.resolve(new Response(JSON.stringify(recorded)));
  });
  const source = naverNewsSource('the-id', 'the-secret');
  assert.equal((await source.search('증시')).length, 1);
  assert.equal(seen?.headers['X-Naver-Client-Id'], 'the-id');
  assert.equal(seen?.headers['X-Naver-Client-Secret'], 'the-secret');
  assert.ok(seen?.url.includes('sort=date'));
  assert.ok(!seen?.url.includes('the-secret'));

  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response('denied', { status: 401 })),
  );
  await assert.rejects(source.search('증시'), (error: Error) => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes('the-secret'));
    return true;
  });
});

test('the source comes from the environment', () => {
  assert.equal(newsSourceFromEnv({}), undefined);
  assert.equal(newsSourceFromEnv({ NAVER_CLIENT_ID: 'a' }), undefined);
  assert.equal(
    newsSourceFromEnv({ NAVER_CLIENT_ID: 'a', NAVER_CLIENT_SECRET: 'b' })?.name,
    'NAVER',
  );
  assert.equal(newsSourceFromEnv({ NEWS_SOURCE: 'fake' })?.name, 'FAKE');
  assert.throws(
    () => newsSourceFromEnv({ NEWS_SOURCE: 'fake', NODE_ENV: 'production' }),
    /cannot be used in production/,
  );
});

test('the fake source is deterministic per query', async () => {
  const at = new Date('2026-11-24T00:00:00Z');
  const source = fakeNewsSource(() => at);
  assert.deepEqual(await source.search('환율'), await source.search('환율'));
  assert.notEqual((await source.search('환율'))[0].link, (await source.search('금리'))[0].link);
});

test('the job runs at 07:30 Seoul time on weekdays', () => {
  assert.equal(NEWS_SCHEDULE, '30 7 * * 1-5');
  const queue = newsQueue({} as never, undefined, () => undefined);
  assert.equal(queue.name, NEWS_QUEUE);
  assert.equal(queue.schedule, NEWS_SCHEDULE);
});

test('the job does nothing, and says so, without a source', async () => {
  const lines: Record<string, unknown>[] = [];
  const queue = newsQueue({} as never, undefined, (line) => lines.push(line));
  await queue.handler({}, { id: '1', queue: NEWS_QUEUE, attempt: 1, requestId: null });
  assert.equal(lines[0].event, 'news_fetch_skipped');
});
