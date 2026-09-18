/**
 * /api/auth/login — 회사 Google 계정 로그인 시작
 *
 * hd 파라미터로 회사 도메인 계정만 고르도록 유도하고, 실제 검증은 callback 에서 한다.
 * (hd 는 화면 안내용이라 그것만 믿으면 안 된다)
 */
export const config = { runtime: 'edge' };

const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export default async function handler(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response('GOOGLE_CLIENT_ID 환경변수가 설정되지 않았습니다.', {
      status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const url = new URL(req.url);
  const nextPath = url.searchParams.get('next') || '/';
  // 열린 리다이렉트를 막는다 — 같은 사이트 안의 경로만 허용
  const safeNext = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';
  const state = crypto.randomUUID();

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', 'select_account');
  if (process.env.ALLOWED_DOMAIN) auth.searchParams.set('hd', process.env.ALLOWED_DOMAIN);

  const headers = new Headers({ Location: auth.toString() });
  headers.append('Set-Cookie', cookie('ev_state', `${state}|${safeNext}`, 600));
  return new Response(null, { status: 302, headers });
}
