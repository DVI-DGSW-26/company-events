/**
 * session.js — 로그인 세션 쿠키 서명·검증
 *
 * 쿠키 값은  base64url(JSON) + "." + base64url(HMAC-SHA256)  형태다.
 * 비밀키(SESSION_SECRET)는 저장소가 아니라 Vercel 환경변수에 둔다.
 * Edge 런타임에서 돌아가야 하므로 Node 모듈 대신 Web Crypto 만 쓴다.
 *
 * 세션 수명은 정해 두지 않는다. 로그인할 때와 /api/archive 가 토큰을 갱신할 때마다
 * refresh token(ev_rt) 수명에 맞춰 다시 서명한다. 갱신이 실패하면 세션도 함께 지운다.
 * 그래서 통합 로그인이 살아 있는 동안만 유지되고, 퇴사·권한 변경은 다음 갱신에 반영된다.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = 'ev_session';

export function toB64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** 세션 값을 서명해 쿠키 문자열로 만든다 */
export async function signSession(payload, secret) {
  const body = toB64url(enc.encode(JSON.stringify(payload)));
  const sig = toB64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

/** 서명과 만료를 확인한다. 유효하지 않으면 null */
export async function verifySession(token, secret) {
  if (!token || !secret || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
  } catch { return null; }
  if (!ok) return null;
  try {
    const data = JSON.parse(dec.decode(fromB64url(body)));
    if (!data.exp || data.exp * 1000 < Date.now()) return null;
    return data;
  } catch { return null; }
}

/** Cookie 헤더에서 값 하나를 꺼낸다 */
export function readCookie(req, name) {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Set-Cookie 헤더 값을 만든다. maxAge 0 이면 삭제 */
export function buildCookie(name, value, maxAge) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  return bits.join('; ');
}
