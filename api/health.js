/**
 * GET /api/health — 지금 어떤 상태로 돌고 있는지 한눈에 보여준다
 *
 * 환경변수가 제대로 들어갔는지, 행사 자료를 어디서 읽고 있는지, 사내 행사 서버와
 * 통신이 되는지를 브라우저에서 바로 확인하기 위한 것이다.
 * 로그인해야 열리고(미들웨어), 값 자체는 내보내지 않는다 — 설정 여부만 알려준다.
 */
import { SESSION_COOKIE, readCookie, verifySession } from '../lib/session.js';
import { AT_COOKIE, RT_COOKIE, isUsable, readTokenCookie } from '../lib/keycloak.js';
import { BASE, usingBackend } from '../lib/backend.js';

export const config = { runtime: 'edge' };

const has = (name) => Boolean(process.env[name]);

/**
 * 사진 주소가 어떤 모양으로 오는지 그대로 보여준다.
 * 브라우저가 쓸 수 있으려면 https:// 로 시작하는 완전한 주소여야 한다.
 * 저장 참조(예: 2026/09/3f2a….jpg)가 그대로 오면 화면에서 사진이 깨진다.
 */
/**
 * 사진 주소를 실제로 받아 본다.
 * 호스트를 바로잡은 주소가 열리는지 확인해야, 화면이 안 뜨는 이유가
 * 주소 때문인지 다른 것 때문인지 갈린다.
 */
async function probe(raw) {
  if (!raw || !/^https?:\/\//.test(raw)) return '확인할 주소 없음';

  const want = BASE ? new URL(BASE).origin : '';
  let fixed = raw;
  try {
    const u = new URL(raw);
    if (want && u.origin !== want) fixed = want + u.pathname + u.search;
  } catch { return '주소를 읽지 못했습니다'; }

  const hit = async (url) => {
    try {
      const r = await fetch(url, { headers: { accept: 'image/*' } });
      return `${r.status}${r.ok ? ' 정상' : ''} · ${r.headers.get('content-type') ?? '형식 없음'}`;
    } catch (e) { return `연결 실패 (${e.message})`; }
  };

  const out = { '호스트 바로잡은 주소': await hit(fixed) };
  if (fixed !== raw) out['서버가 준 주소 그대로'] = await hit(raw);

  out.판정 = out['호스트 바로잡은 주소'].startsWith('200')
    ? '사진이 떠야 정상입니다. 안 뜨면 브라우저 캐시이니 Ctrl+Shift+R 로 새로고침하세요.'
    : '바로잡은 주소도 열리지 않습니다. 서명에 호스트가 포함된 것으로 보여 서버 수정이 필요합니다.';
  return out;
}

function sampleUrls(sample) {
  if (!sample) return {};
  const want = BASE ? new URL(BASE).origin : '';
  const judge = (v) => {
    if (!v) return '없음';
    if (!/^https?:\/\//.test(v)) return `⚠ 저장 참조 (브라우저가 못 엶) — ${v.slice(0, 80)}`;
    let origin = '';
    try { origin = new URL(v).origin; } catch { /* 주소로 못 읽음 */ }
    if (origin && origin !== want) {
      return `⚠ 서버가 준 호스트가 다름 (${origin}) — 화면에 내보낼 때 ${want} 로 바로잡는 중`;
    }
    return `주소 — ${v.slice(0, 110)}${v.length > 110 ? '…' : ''}`;
  };
  return {
    표본_행사: sample.행사,
    표본_사진: judge(sample.사진),
    표본_썸네일: judge(sample.썸네일),
    표본_묶음: judge(sample.묶음),
  };
}

export default async function handler(req) {
  const session = await verifySession(readCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  const at = readTokenCookie(req, AT_COOKIE);

  const report = {
    // edge 런타임의 시간대 지원에 기대지 않고 한국 시각을 직접 만든다
    확인시각: new Date(Date.now() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) + ' (KST)',

    행사자료를_읽는_곳: usingBackend()
      ? '사내 행사 서버 (전환 완료)'
      : '배포에 포함된 기준 자료 — EVENTS_API 미설정 (등록·수정 불가)',

    로그인: session
      ? { 상태: '로그인됨', 이름: session.name, 관리권한: session.admin === true }
      : { 상태: '로그인 안 됨' },

    사내계정_토큰: {
      access: at ? (isUsable(at) ? '있음 (유효)' : '있음 (만료 — 다음 요청 때 갱신)') : '없음',
      refresh: readTokenCookie(req, RT_COOKIE) ? '있음' : '없음',
    },

    환경변수: {
      EVENTS_API: has('EVENTS_API') ? `설정됨 — ${BASE}` : '없음',
      OIDC_ISSUER: has('OIDC_ISSUER') ? '설정됨' : '없음',
      OIDC_CLIENT_ID: has('OIDC_CLIENT_ID') ? '설정됨' : '없음',
      OIDC_CLIENT_SECRET: has('OIDC_CLIENT_SECRET') ? '설정됨' : '없음',
      SESSION_SECRET: has('SESSION_SECRET') ? '설정됨' : '없음',
    },
  };

  /* 사내 행사 서버까지 실제로 닿는지 확인한다 */
  if (usingBackend()) {
    try {
      const res = await fetch(`${BASE}/event`, {
        headers: { accept: 'application/json', ...(at ? { authorization: `Bearer ${at}` } : {}) },
      });
      let count = null, sample = null;
      try {
        const body = await res.json();
        const events = body?.data?.events ?? [];
        count = events.length;
        // 사진이 안 뜰 때 주소 모양을 바로 보기 위해 표본을 하나 싣는다
        const withPhoto = events.find((e) => e.photos?.length) ?? events[0];
        sample = {
          행사: withPhoto?.title ?? null,
          사진: withPhoto?.photos?.[0]?.src ?? null,
          썸네일: withPhoto?.photos?.[0]?.thumb ?? null,
          묶음: withPhoto?.bundle?.src ?? null,
        };
      } catch { /* 본문이 JSON 이 아님 */ }

      report.사내_행사_서버 = res.ok
        ? { 응답: `정상 (${res.status})`, 행사수: count, ...sampleUrls(sample), 사진_실제확인: await probe(sample?.사진) }
        : {
          응답: `거절 (${res.status})`,
          설명: res.status === 401 ? '토큰이 없거나 만료되었습니다. 로그아웃 후 다시 로그인해 보세요.'
            : res.status === 403 ? '권한이 없는 계정입니다.'
              : '서버가 요청을 거절했습니다.',
        };
    } catch (e) {
      report.사내_행사_서버 = { 응답: '연결 실패', 설명: e.message };
    }
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
