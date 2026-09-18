/**
 * /api/auth/login — 사내 통합 로그인(Keycloak) 시작
 *
 * 다른 사내 서비스와 동일하게 authorization code + PKCE(S256) 방식으로 보낸다.
 * state · nonce · code_verifier 는 서명한 임시 쿠키에 담아 두고 callback 에서 대조한다.
 */
import { buildCookie, signSession } from '../../lib/session.js';
import { AUTH_COOKIE, configError, discover, pkceChallenge, randomString, safePath } from '../../lib/oidc.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const secret = process.env.SESSION_SECRET;

  if (!issuer || !clientId || !secret) {
    const missing = [
      !issuer && 'OIDC_ISSUER',
      !clientId && 'OIDC_CLIENT_ID',
      !secret && 'SESSION_SECRET',
    ].filter(Boolean).join(', ');
    return configError(`환경변수가 설정되지 않았습니다: <code>${missing}</code><br>관리자에게 문의해 주세요.`);
  }

  let meta;
  try { meta = await discover(issuer); }
  catch (e) { return configError(e.message); }

  const url = new URL(req.url);
  const next = safePath(url.searchParams.get('next'));

  const state = randomString(24);
  const nonce = randomString(24);
  const verifier = randomString(48);

  // 로그인 진행 상태는 10분만 유효하다
  const pending = await signSession(
    { state, nonce, verifier, next, exp: Math.floor(Date.now() / 1000) + 600 },
    secret,
  );

  const auth = new URL(meta.authorization_endpoint);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
  auth.searchParams.set('scope', process.env.OIDC_SCOPE || 'openid profile email');
  auth.searchParams.set('state', state);
  auth.searchParams.set('nonce', nonce);
  auth.searchParams.set('code_challenge', await pkceChallenge(verifier));
  auth.searchParams.set('code_challenge_method', 'S256');

  const headers = new Headers({ Location: auth.toString(), 'cache-control': 'no-store' });
  headers.append('Set-Cookie', buildCookie(AUTH_COOKIE, pending, 600));
  return new Response(null, { status: 302, headers });
}
