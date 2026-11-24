import { Router } from 'express';
import { z } from 'zod/v4';

import { HttpError } from '../standard/http.js';
import { KakaoApiError, KakaoRevokedError } from './api.js';
import { testMessage } from './messages.js';
import type { KakaoService } from './service.js';

// #311 /api/kakao: the Settings card's connection, login and test message. Behind the shared sign-in like every /api route.

export const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(256).optional(),
});

export function kakaoRouter(service: KakaoService, options: { appUrl?: string } = {}) {
  const router = Router();
  const appUrl = options.appUrl ?? '/';
  const settings = (result: 'connected' | 'failed') =>
    `${appUrl.replace(/\/$/, '')}/settings?kakao=${result}`;

  router.get('/status', async (_req, res) => {
    res.json(await service.status());
  });

  // The browser opens the returned URL itself (Kakao Login), so the answer is JSON, not a redirect.
  router.post('/connect', async (_req, res) => {
    res.json({ url: await service.startLogin() });
  });

  // Kakao sends the browser back here with ?code&state; the state proves this server started that login.
  router.get('/callback', async (req, res) => {
    const query = callbackQuery.parse(req.query);
    if (query.error || !query.code || !query.state) {
      res.redirect(302, settings('failed'));
      return;
    }
    try {
      await service.finishLogin(query.code, query.state);
      res.redirect(302, settings('connected'));
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) {
        res.redirect(302, settings('failed'));
        return;
      }
      throw error;
    }
  });

  router.post('/test', async (_req, res) => {
    try {
      await service.send(testMessage(appUrl));
    } catch (error) {
      if (error instanceof KakaoRevokedError)
        throw new HttpError(409, 'KakaoTalk access was revoked. Reconnect KakaoTalk');
      if (error instanceof KakaoApiError)
        throw new HttpError(502, 'KakaoTalk did not accept the message. Try again later');
      throw error;
    }
    res.json({ sent: true });
  });

  router.delete('/connection', async (_req, res) => {
    await service.disconnect();
    res.status(204).end();
  });

  return router;
}
