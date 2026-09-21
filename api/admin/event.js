/**
 * POST /api/admin/event — 행사 등록·수정
 *
 * 본문 모양이 사내 행사 서버의 SaveEventRequest 와 같아 그대로 넘긴다.
 * rev 를 함께 보내 편집을 시작한 뒤 다른 사람이 저장했으면 거절되게 한다.
 */
import { requireAdmin, readJsonBody, json, cleanEvent } from '../../lib/admin.js';
import { accessToken } from '../../lib/keycloak.js';
import { call, fail, json as apiJson, notConnected, usingBackend } from '../../lib/backend.js';

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (!usingBackend()) return notConnected();

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  // 서버에 보내기 전에 화면에서 들어온 값을 한 번 정리한다.
  // 틀린 값은 여기서 바로 알려주는 편이 사용자에게 빠르다.
  const { event, errors } = cleanEvent(body?.event);
  if (errors.length) return json({ error: errors.join('\n') }, 400);

  const { token } = await accessToken(req);
  try {
    const data = await call(`/event/${encodeURIComponent(event.id)}`, {
      token, method: 'PUT',
      json: {
        event,
        media: body?.media ?? { photos: [] },
        removePhotos: body?.removePhotos ?? [],
        rev: body?.rev,
      },
    });
    return apiJson(data);
  } catch (e) { return fail(e); }
}
