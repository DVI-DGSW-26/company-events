/** /api/auth/logout — 세션 쿠키를 지우고 로그인 화면으로 보낸다 */
import { SESSION_COOKIE, buildCookie } from '../../lib/session.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const headers = new Headers({ Location: new URL('/login.html?bye=1', url.origin).toString() });
  headers.append('Set-Cookie', buildCookie(SESSION_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}
