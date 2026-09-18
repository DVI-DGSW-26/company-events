/**
 * /api/auth/callback — Google 로그인 결과 처리
 *
 * 1. state 쿠키로 요청 위조를 막는다
 * 2. code 를 Google 토큰 엔드포인트에 직접 보내 id_token 을 받는다
 * 3. 이메일 도메인이 회사 도메인인지 확인한다  ← 실제 접근 통제는 여기서 이뤄진다
 * 4. 서명한 세션 쿠키를 심고 원래 보려던 주소로 돌려보낸다
 *
 * id_token 은 TLS 로 Google 에서 직접 받아오므로 서명 재검증은 생략한다
 * (Google 문서가 허용하는 방식이다). 대신 aud 가 우리 클라이언트인지 확인한다.
 */
import { SESSION_COOKIE, SESSION_HOURS, buildCookie, signSession } from '../../lib/session.js';

export const config = { runtime: 'edge' };

const fail = (msg, status = 400) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>로그인 실패</title>` +
    `<div style="font:15px/1.7 system-ui;max-width:32rem;margin:12vh auto;padding:0 1.5rem;color:#1B2428">` +
    `<h1 style="font-size:1.25rem">로그인하지 못했습니다</h1><p>${msg}</p>` +
    `<p><a href="/login.html" style="color:#B23F05">다시 시도하기</a></p></div>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

function readCookieRaw(req, name) {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export default async function handler(req) {
  const url = new URL(req.url);

  if (url.searchParams.get('error')) {
    return fail(`Google 에서 로그인이 취소되었습니다. (${url.searchParams.get('error')})`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = readCookieRaw(req, 'ev_state');
  if (!code || !state || !saved) return fail('로그인 정보가 없거나 만료되었습니다. 처음부터 다시 시도해 주세요.');

  const [savedState, savedNext] = saved.split('|');
  if (savedState !== state) return fail('로그인 요청이 유효하지 않습니다. 처음부터 다시 시도해 주세요.');

  const secret = process.env.SESSION_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const domain = process.env.ALLOWED_DOMAIN;
  if (!secret || !clientId || !clientSecret) {
    return fail('서버 환경변수가 설정되지 않았습니다. 관리자에게 문의하세요.', 500);
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return fail('Google 인증 서버 응답이 올바르지 않습니다.', 502);

  const token = await res.json();
  if (!token.id_token) return fail('Google 에서 계정 정보를 받지 못했습니다.', 502);

  let claims;
  try {
    const body = token.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(atob(body + '='.repeat((4 - (body.length % 4)) % 4)));
  } catch { return fail('계정 정보를 해석하지 못했습니다.', 502); }

  if (claims.aud !== clientId) return fail('계정 정보가 이 사이트의 것이 아닙니다.', 401);
  if (claims.email_verified === false) return fail('확인되지 않은 이메일 계정입니다.', 403);

  const email = String(claims.email || '').toLowerCase();
  if (domain) {
    const allowed = claims.hd === domain || email.endsWith(`@${domain.toLowerCase()}`);
    if (!allowed) {
      return fail(`${domain} 계정으로만 접속할 수 있습니다. 회사 계정으로 다시 로그인해 주세요.`, 403);
    }
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const value = await signSession({ email, name: claims.name ?? '', exp }, secret);

  const nextPath = savedNext && savedNext.startsWith('/') && !savedNext.startsWith('//') ? savedNext : '/';
  const headers = new Headers({ Location: new URL(nextPath, url.origin).toString() });
  headers.append('Set-Cookie', buildCookie(SESSION_COOKIE, value, SESSION_HOURS * 3600));
  headers.append('Set-Cookie', buildCookie('ev_state', '', 0));
  return new Response(null, { status: 302, headers });
}
