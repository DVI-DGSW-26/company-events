/**
 * keycloak.js — 사내 통합 로그인 토큰을 쿠키에 보관하고 갱신한다
 *
 * 백엔드 API(api.dvi-ind.com/events)가 Keycloak access token 을 요구한다.
 * 토큰을 화면에 내려보내면 스크립트가 읽을 수 있으므로 HttpOnly 쿠키에만 둔다.
 *
 *   ev_at  access token   5분
 *   ev_rt  refresh token  세션 길이
 *
 * 쿠키 경로를 /api 로 둔다. 사진·CSS 같은 요청에까지 토큰이 따라붙을 이유가 없고,
 * 토큰이 길어서 요청 헤더가 불필요하게 커진다.
 *
 * ── 갱신을 한 곳에서만 하는 이유 ──────────────────────────────
 * Keycloak 이 refresh token 재사용을 탐지한다. 같은 브라우저에서 두 요청이 동시에
 * 갱신하면 세션이 끊긴다. 그래서 /api/archive 에서만 갱신하고, 나머지 경로는
 * 있는 토큰을 그대로 쓰다가 401 이 나면 화면이 /api/archive 를 한 번 부르게 한다.
 */
import { discover } from './oidc.js';

export const AT_COOKIE = 'ev_at';
export const RT_COOKIE = 'ev_rt';
const COOKIE_PATH = '/api';

/** 만료 이 시간 전이면 미리 갱신한다 */
const RENEW_BEFORE_MS = 30_000;

export function tokenCookie(name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly', 'Secure', 'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function readTokenCookie(req, name) {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** 로그인·갱신 결과를 쿠키 문자열로 만든다 */
export function tokenCookies(token) {
  const out = [];
  if (token.access_token) {
    out.push(tokenCookie(AT_COOKIE, token.access_token, Number(token.expires_in) || 300));
  }
  if (token.refresh_token) {
    out.push(tokenCookie(RT_COOKIE, token.refresh_token, Number(token.refresh_expires_in) || 43_200));
  }
  return out;
}

export const clearTokenCookies = () => [tokenCookie(AT_COOKIE, '', 0), tokenCookie(RT_COOKIE, '', 0)];

/** JWT 의 만료 시각(ms). 읽지 못하면 0 */
function expiryOf(jwt) {
  try {
    const body = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(body + '='.repeat((4 - (body.length % 4)) % 4)));
    return (Number(claims.exp) || 0) * 1000;
  } catch { return 0; }
}

export const isUsable = (at) => Boolean(at) && expiryOf(at) - RENEW_BEFORE_MS > Date.now();

/**
 * 쓸 수 있는 access token 을 돌려준다.
 * @param {Request} req
 * @param {boolean} allowRefresh  이 경로에서 갱신해도 되는지 (/api/archive 만 true)
 * @returns {Promise<{token:string|null, cookies:string[], expired:boolean}>}
 */
export async function accessToken(req, allowRefresh = false) {
  const at = readTokenCookie(req, AT_COOKIE);
  if (isUsable(at)) return { token: at, cookies: [], expired: false };

  const rt = readTokenCookie(req, RT_COOKIE);
  if (!allowRefresh || !rt) {
    // 갱신하지 않는 경로에서는 있는 토큰이라도 넘겨 본다. 백엔드가 401 로 알려 준다.
    return { token: at ?? null, cookies: [], expired: !at };
  }

  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!issuer || !clientId) return { token: at ?? null, cookies: [], expired: true };

  try {
    const meta = await discover(issuer);
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: clientId });
    if (clientSecret) form.set('client_secret', clientSecret);

    const res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
    });
    // 퇴사·세션 만료·재사용 탐지 → 다시 로그인해야 한다
    if (!res.ok) return { token: null, cookies: clearTokenCookies(), expired: true };

    const token = await res.json();
    return { token: token.access_token ?? null, cookies: tokenCookies(token), expired: false };
  } catch {
    return { token: at ?? null, cookies: [], expired: !at };
  }
}
