/**
 * POST /api/admin/delete — 행사 삭제
 *
 * title 을 함께 보낸다. 화면에 뜬 행사명과 서버의 것이 다르면 서버가 거절하므로,
 * 목록이 바뀐 줄 모르고 엉뚱한 행사를 지우는 일을 막는다.
 */
import { requireAdmin, readJsonBody, json } from '../../lib/admin.js';
import { accessToken } from '../../lib/keycloak.js';
import { call, fail, json as apiJson, notConnected, usingBackend } from '../../lib/backend.js';

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (!usingBackend()) return notConnected();

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const id = String(body?.id ?? '');
  if (!/^e\d{2,4}$/.test(id)) return json({ error: '행사 번호가 올바르지 않습니다.' }, 400);

  const { token } = await accessToken(req);
  try {
    const data = await call(`/event/${encodeURIComponent(id)}`, {
      token, method: 'DELETE',
      search: { rev: body?.rev, title: body?.title },
    });
    return apiJson(data);
  } catch (e) { return fail(e); }
}
