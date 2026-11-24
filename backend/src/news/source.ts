// Economy news sources (#306). The real one is the Naver News search API; fake.ts is the stand-in for tests and
// for running without keys. A source returns plain parsed items; storing them is store.ts.

export type NewsItem = {
  title: string;
  summary: string;
  link: string;
  originalLink: string | null;
  publisher: string | null;
  publishedAt: Date;
};

export type NewsSource = {
  name: string;
  /** Newest first. Throws a NewsSourceError when the request fails. */
  search(query: string): Promise<NewsItem[]>;
};

/** The economy queries fetched each day (#306). */
export const newsQueries = ['경제', '증시', '금리', '환율', '반도체'] as const;

/** A failed request. The message never holds the request URL or a key, so it can be logged as is. */
class NewsSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewsSourceError';
  }
}

const entities: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&amp;': '&',
};

/** Removes the HTML tags Naver puts in titles and descriptions (<b> around the query) and decodes its entities. */
export function stripTags(text: string) {
  // Repeated until nothing changes, so "<<b>script>" cannot leave a tag behind after one pass.
  let plain = text;
  for (let previous = ''; previous !== plain;) {
    previous = plain;
    plain = plain.replace(/<[^>]*>/g, '');
  }
  return plain
    .replace(/&(?:quot|apos|#39|lt|gt|nbsp|amp);/g, (entity) => entities[entity])
    .replace(/\s+/g, ' ')
    .trim();
}

function publisherOf(originalLink: string | null) {
  if (!originalLink) return null;
  try {
    return new URL(originalLink).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

const httpUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * The items of one Naver response (`{ items: [{ title, originallink, link, description, pubDate }] }`). An item
 * without a title, a usable link or a valid date is left out; a body that is not the expected shape is an error,
 * so a changed format does not pass as "no news today".
 */
export function parseNaverNews(body: unknown): NewsItem[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new NewsSourceError('Naver news response format is not valid');
  const parsed: NewsItem[] = [];
  for (const raw of items as Record<string, unknown>[]) {
    const link = httpUrl(raw.link) ?? httpUrl(raw.originallink);
    const title = typeof raw.title === 'string' ? stripTags(raw.title) : '';
    const publishedAt = new Date(typeof raw.pubDate === 'string' ? raw.pubDate : '');
    if (!link || !title || Number.isNaN(publishedAt.getTime())) continue;
    const originalLink = httpUrl(raw.originallink);
    parsed.push({
      title,
      summary: typeof raw.description === 'string' ? stripTags(raw.description) : '',
      link,
      originalLink,
      publisher: publisherOf(originalLink),
      publishedAt,
    });
  }
  return parsed;
}

const endpoint = 'https://openapi.naver.com/v1/search/news.json';
const display = 30;

/** Naver News search, newest first. The id and secret go in headers; no error message carries them. */
export function naverNewsSource(clientId: string, clientSecret: string): NewsSource {
  return {
    name: 'NAVER',
    async search(query) {
      const url = `${endpoint}?${new URLSearchParams({ query, display: String(display), sort: 'date' })}`;
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new NewsSourceError('Could not connect to Naver news');
      }
      if (!response.ok)
        throw new NewsSourceError(`Naver news response error (HTTP ${response.status})`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new NewsSourceError('Could not read the Naver news response');
      }
      return parseNaverNews(body);
    },
  };
}

/** A deterministic source for tests and for running without keys (NEWS_SOURCE=fake). */
export function fakeNewsSource(now: () => Date = () => new Date()): NewsSource {
  return {
    name: 'FAKE',
    search(query) {
      const at = now();
      return Promise.resolve(
        [1, 2].map((n) => ({
          title: `[가짜 뉴스] ${query} 관련 소식 ${n}`,
          summary: `${query} 시장 동향을 요약한 가짜 기사 ${n}`,
          link: `https://news.example.test/fake/${encodeURIComponent(query)}/${n}`,
          originalLink: `https://www.example.test/fake/${encodeURIComponent(query)}/${n}`,
          publisher: 'example.test',
          publishedAt: new Date(at.getTime() - n * 60_000),
        })),
      );
    },
  };
}

const key = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/**
 * The news source from the environment: NEWS_SOURCE=fake uses the fake (refused in production, where its items
 * would be stored as real news); otherwise the Naver source when NAVER_CLIENT_ID and NAVER_CLIENT_SECRET are set,
 * else none (the fetch then does nothing).
 */
export function newsSourceFromEnv(env: NodeJS.ProcessEnv = process.env): NewsSource | undefined {
  if (env.NEWS_SOURCE?.trim() === 'fake') {
    if (env.NODE_ENV === 'production')
      throw new Error('NEWS_SOURCE=fake cannot be used in production');
    return fakeNewsSource();
  }
  const id = key(env.NAVER_CLIENT_ID);
  const secret = key(env.NAVER_CLIENT_SECRET);
  return id && secret ? naverNewsSource(id, secret) : undefined;
}
