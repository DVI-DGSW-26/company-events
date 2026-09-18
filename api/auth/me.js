/** /api/auth/me — 화면 상단에 표시할 로그인 계정 정보 */
import { SESSION_COOKIE, readCookie, verifySession } from '../../lib/session.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const session = await verifySession(readCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  const json = (body, status) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });

  if (!session) return json({ signedIn: false }, 401);
  return json({ signedIn: true, email: session.email, name: session.name ?? '' }, 200);
}
