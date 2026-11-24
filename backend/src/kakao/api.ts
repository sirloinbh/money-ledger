// #311 The three Kakao calls the app makes, with `fetch` (no package). `fetch` is injected so tests serve fake answers.

export type Fetch = typeof fetch;

export type KakaoConfig = {
  restApiKey: string;
  clientSecret: string | undefined;
  redirectUri: string;
  /** KAKAO_TOKEN_KEY, for crypto.ts. */
  tokenKey: string;
};

/** Reads the settings; undefined when any required one is missing (the card then says it is not set up). */
export function kakaoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KakaoConfig | undefined {
  const restApiKey = env.KAKAO_REST_API_KEY;
  const redirectUri = env.KAKAO_REDIRECT_URI;
  const tokenKey = env.KAKAO_TOKEN_KEY;
  if (!restApiKey || !redirectUri || !tokenKey) return undefined;
  return { restApiKey, clientSecret: env.KAKAO_CLIENT_SECRET || undefined, redirectUri, tokenKey };
}

export type Tokens = {
  accessToken: string;
  accessExpiresAt: Date;
  /** Kakao sends a new refresh token only when the old one is close to expiring. */
  refreshToken: string | undefined;
  refreshExpiresAt: Date | undefined;
};

/** The token or the memo was refused for good: the user revoked access, or the refresh token expired. */
export class KakaoRevokedError extends Error {
  constructor(message = 'KakaoTalk access was revoked') {
    super(message);
    this.name = 'KakaoRevokedError';
  }
}

/** Kakao answered with an error that reconnecting would not fix (5xx, limits, bad input). */
export class KakaoApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KakaoApiError';
  }
}

const authorizeUrl = 'https://kauth.kakao.com/oauth/authorize';
const tokenUrl = 'https://kauth.kakao.com/oauth/token';
const memoUrl = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

export function loginUrl(config: KakaoConfig, state: string) {
  const url = new URL(authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.restApiKey,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'talk_message',
    state,
  }).toString();
  return url.toString();
}

type TokenAnswer = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
};

async function tokenRequest(
  fetcher: Fetch,
  config: KakaoConfig,
  params: Record<string, string>,
  now: Date,
) {
  const body = new URLSearchParams({ client_id: config.restApiKey, ...params });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  const response = await fetcher(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const data = (await response.json().catch(() => ({}))) as TokenAnswer;
  if (!response.ok || !data.access_token || !data.expires_in) {
    // invalid_grant: the code or refresh token is no longer valid (revoked, expired, reused).
    if (data.error === 'invalid_grant' || data.error === 'invalid_token')
      throw new KakaoRevokedError();
    throw new KakaoApiError(
      `Kakao token request failed (${response.status}${data.error ? ` ${data.error}` : ''})`,
    );
  }
  return {
    accessToken: data.access_token,
    accessExpiresAt: new Date(now.getTime() + data.expires_in * 1000),
    refreshToken: data.refresh_token,
    refreshExpiresAt:
      data.refresh_token && data.refresh_token_expires_in
        ? new Date(now.getTime() + data.refresh_token_expires_in * 1000)
        : undefined,
  } satisfies Tokens;
}

export const exchangeCode = (fetcher: Fetch, config: KakaoConfig, code: string, now: Date) =>
  tokenRequest(
    fetcher,
    config,
    { grant_type: 'authorization_code', redirect_uri: config.redirectUri, code },
    now,
  );

export const refreshTokens = (
  fetcher: Fetch,
  config: KakaoConfig,
  refreshToken: string,
  now: Date,
) =>
  tokenRequest(fetcher, config, { grant_type: 'refresh_token', refresh_token: refreshToken }, now);

/** A Kakao template object (text or list), sent as the `template_object` JSON. */
export type Template = Record<string, unknown> & { object_type: 'text' | 'list' };

export async function sendMemo(fetcher: Fetch, accessToken: string, template: Template) {
  const response = await fetcher(memoUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  if (response.ok) return;
  const data = (await response.json().catch(() => ({}))) as { code?: number };
  // -401 invalid token, -402 permission (talk_message consent withdrawn), -403 not agreed.
  if (response.status === 401 || data.code === -401 || data.code === -402)
    throw new KakaoRevokedError();
  throw new KakaoApiError(
    `Kakao send failed (${response.status}${data.code ? ` code ${data.code}` : ''})`,
  );
}
