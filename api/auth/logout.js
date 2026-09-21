/**
 * /api/auth/logout — 이 사이트의 세션만 지운다
 *
 * 통합 로그인 자체를 끊지는 않는다. 여기서 SSO 전체를 로그아웃시키면
 * 같은 계정으로 열어 둔 다른 사내 서비스까지 함께 끊겨서 당황스럽기 때문이다.
 * (전체 로그아웃이 필요하면 Keycloak 의 end_session_endpoint 로 보내면 된다)
 */
import { SESSION_COOKIE, buildCookie } from '../../lib/session.js';
import { AUTH_COOKIE } from '../../lib/oidc.js';
import { clearTokenCookies } from '../../lib/keycloak.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const headers = new Headers({
    Location: new URL('/login.html?bye=1', url.origin).toString(),
    'cache-control': 'no-store',
  });
  headers.append('Set-Cookie', buildCookie(SESSION_COOKIE, '', 0));
  headers.append('Set-Cookie', buildCookie(AUTH_COOKIE, '', 0));
  for (const c of clearTokenCookies()) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}
