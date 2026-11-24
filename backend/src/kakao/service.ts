import { randomBytes } from 'node:crypto';

import type { Pool } from 'pg';

import { inTransaction } from '../db.js';
import { HttpError } from '../standard/http.js';
import {
  exchangeCode,
  type Fetch,
  type KakaoConfig,
  KakaoRevokedError,
  loginUrl,
  refreshTokens,
  sendMemo,
  type Template,
  type Tokens,
} from './api.js';
import { decrypt, encrypt } from './crypto.js';

// #311 The one KakaoTalk connection: login, a valid access token (refreshed before it expires), and send-to-me.

/** What other code (the chatbot replies, the event wiring) sends through; tests use fakeMessenger. */
export type Messenger = { send(template: Template): Promise<void> };

export type KakaoStatus = {
  configured: boolean;
  state: 'not-configured' | 'disconnected' | 'connected' | 'revoked';
  connectedAt: string | null;
};

type ConnectionRow = {
  status: 'connected' | 'revoked';
  access_token_enc: string;
  access_expires_at: Date;
  refresh_token_enc: string;
  refresh_expires_at: Date;
  connected_at: Date;
};

const loginStateMinutes = 10;
/** An access token with less time left than this is refreshed before it is used. */
const refreshMarginMs = 5 * 60 * 1000;

export type KakaoService = Messenger & {
  status(): Promise<KakaoStatus>;
  startLogin(): Promise<string>;
  finishLogin(code: string, state: string): Promise<void>;
  disconnect(): Promise<void>;
};

export function createKakaoService(
  pool: Pool,
  options: { config: KakaoConfig | undefined; fetch?: Fetch; now?: () => Date },
): KakaoService {
  const { config } = options;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const needConfig = () => {
    if (!config) throw new HttpError(503, 'KakaoTalk is not set up on the server yet');
    return config;
  };

  const load = async (client: Pick<Pool, 'query'>, lock = false) => {
    const { rows } = await client.query<ConnectionRow>(
      `SELECT status, access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at, connected_at
       FROM kakao_connection WHERE id = 1${lock ? ' FOR UPDATE' : ''}`,
    );
    return rows[0];
  };

  const markRevoked = async () => {
    await pool.query(
      "UPDATE kakao_connection SET status = 'revoked', updated_at = now() WHERE id = 1",
    );
  };

  // One transaction with the row locked, so two sends that both find an expired token refresh it once.
  const accessToken = async (force: boolean) => {
    const cfg = needConfig();
    const current = await load(pool);
    if (!current) throw new HttpError(409, 'KakaoTalk is not connected');
    if (current.status === 'revoked') throw new KakaoRevokedError();
    const fresh = (row: ConnectionRow) =>
      !force && row.access_expires_at.getTime() - now().getTime() > refreshMarginMs;
    if (fresh(current)) return decrypt(current.access_token_enc, cfg.tokenKey);
    try {
      return await inTransaction(pool, async (client) => {
        const row = (await load(client, true)) ?? current;
        if (row.status === 'revoked') throw new KakaoRevokedError();
        // Someone else refreshed while this call waited for the lock (a forced refresh always goes on).
        if (!force && fresh(row)) return decrypt(row.access_token_enc, cfg.tokenKey);
        const tokens = await refreshTokens(
          fetcher,
          cfg,
          decrypt(row.refresh_token_enc, cfg.tokenKey),
          now(),
        );
        await client.query(
          `UPDATE kakao_connection SET access_token_enc = $1, access_expires_at = $2,
             refresh_token_enc = coalesce($3, refresh_token_enc), refresh_expires_at = coalesce($4, refresh_expires_at),
             updated_at = now() WHERE id = 1`,
          [
            encrypt(tokens.accessToken, cfg.tokenKey),
            tokens.accessExpiresAt,
            tokens.refreshToken ? encrypt(tokens.refreshToken, cfg.tokenKey) : null,
            tokens.refreshExpiresAt ?? null,
          ],
        );
        return tokens.accessToken;
      });
    } catch (error) {
      if (error instanceof KakaoRevokedError) await markRevoked();
      throw error;
    }
  };

  const save = async (tokens: Tokens) => {
    const cfg = needConfig();
    if (!tokens.refreshToken || !tokens.refreshExpiresAt)
      throw new HttpError(502, 'Kakao did not return a refresh token');
    await pool.query(
      `INSERT INTO kakao_connection (id, status, access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at)
       VALUES (1, 'connected', $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET status = 'connected', access_token_enc = $1, access_expires_at = $2,
         refresh_token_enc = $3, refresh_expires_at = $4, connected_at = now(), updated_at = now()`,
      [
        encrypt(tokens.accessToken, cfg.tokenKey),
        tokens.accessExpiresAt,
        encrypt(tokens.refreshToken, cfg.tokenKey),
        tokens.refreshExpiresAt,
      ],
    );
  };

  return {
    async status() {
      if (!config) return { configured: false, state: 'not-configured', connectedAt: null };
      const row = await load(pool);
      if (!row) return { configured: true, state: 'disconnected', connectedAt: null };
      return { configured: true, state: row.status, connectedAt: row.connected_at.toISOString() };
    },

    async startLogin() {
      const cfg = needConfig();
      const state = randomBytes(24).toString('base64url');
      await pool.query('DELETE FROM kakao_login_states WHERE expires_at < now()');
      await pool.query(
        'INSERT INTO kakao_login_states (state, expires_at) VALUES ($1, now() + make_interval(mins => $2))',
        [state, loginStateMinutes],
      );
      return loginUrl(cfg, state);
    },

    async finishLogin(code, state) {
      const cfg = needConfig();
      // One use: the state is deleted as it is checked, so a replayed callback fails.
      const used = await pool.query(
        'DELETE FROM kakao_login_states WHERE state = $1 AND expires_at > now()',
        [state],
      );
      if (!used.rowCount) throw new HttpError(400, 'This KakaoTalk login expired. Start it again');
      try {
        await save(await exchangeCode(fetcher, cfg, code, now()));
      } catch (error) {
        if (error instanceof KakaoRevokedError)
          throw new HttpError(400, 'KakaoTalk refused the login code. Start it again');
        throw error;
      }
    },

    async send(template) {
      try {
        await sendMemo(fetcher, await accessToken(false), template);
      } catch (error) {
        // A token that Kakao rejects before its expiry time (changed on the Kakao side): refresh once and retry.
        if (!(error instanceof KakaoRevokedError)) throw error;
        const status = await load(pool);
        if (status?.status === 'revoked') throw error;
        try {
          await sendMemo(fetcher, await accessToken(true), template);
        } catch (second) {
          if (second instanceof KakaoRevokedError) await markRevoked();
          throw second;
        }
      }
    },

    async disconnect() {
      await pool.query('DELETE FROM kakao_connection WHERE id = 1');
    },
  };
}
