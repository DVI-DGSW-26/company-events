/**
 * oidc.js — 사내 통합 로그인(Keycloak) 연동에 필요한 조각들
 *
 * 다른 사내 서비스와 같은 계정으로 들어오게 하려고 회사 Keycloak 을 거친다.
 *   realm 주소:  https://api.dvi-ind.com/dauth/realms/dvi
 *
 * 엔드포인트를 코드에 박지 않고 표준 discovery 문서에서 읽는다.
 * realm 주소나 Keycloak 버전이 바뀌어도 환경변수만 고치면 된다.
 */
import { toB64url, fromB64url } from './session.js';

export const AUTH_COOKIE = 'ev_auth';   // 로그인 진행 중에만 쓰는 임시 쿠키

/** discovery 문서에서 엔드포인트를 읽는다 */
export async function discover(issuer) {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`통합 로그인 설정을 읽지 못했습니다 (${res.status})`);
  const meta = await res.json();
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('통합 로그인 설정에 필요한 주소가 없습니다.');
  }
  return meta;
}

/** 무작위 문자열 (state · nonce · PKCE verifier 용) */
export function randomString(bytes = 48) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toB64url(b);
}

/** PKCE — verifier 를 SHA-256 해시해 challenge 로 만든다 (S256) */
export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toB64url(new Uint8Array(digest));
}

/**
 * JWT 본문을 읽는다.
 * 토큰 엔드포인트에서 TLS 로 직접 받은 것이라 서명 재검증은 하지 않는다.
 * 대신 호출부에서 iss · aud · nonce · exp 를 반드시 확인한다.
 */
export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('토큰 형식이 올바르지 않습니다.');
  return JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
}

/** 같은 사이트 안의 경로만 허용한다 (열린 리다이렉트 방지) */
export function safePath(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : '/';
}

/** 설정이 빠졌을 때 사람이 읽을 수 있는 화면을 돌려준다 */
export function configError(msg) {
  return htmlError('설정이 필요합니다', msg, 500);
}

export function htmlError(title, msg, status = 400) {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${title}</title>` +
    `<div style="font:15px/1.7 system-ui,'Malgun Gothic',sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#1B2428">` +
    `<div style="width:4px;height:22px;border-radius:1px;background:linear-gradient(#E0530D 0 55%,#C3CACE 55% 100%);margin-bottom:1.25rem"></div>` +
    `<h1 style="font-size:1.25rem;margin:0 0 .5rem">${title}</h1>` +
    `<p style="margin:0 0 1.25rem;color:#48545A">${msg}</p>` +
    `<p style="margin:0"><a href="/login.html" style="color:#B23F05">로그인 화면으로</a></p></div></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
