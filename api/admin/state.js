/**
 * GET /api/admin/state — 편집 화면이 읽을 현재 자료
 *
 * rev 도 함께 준다. 저장할 때 그 사이 다른 사람이 고쳤는지 확인하는 데 쓴다.
 */
import { requireAdmin } from '../../lib/admin.js';
import { accessToken } from '../../lib/keycloak.js';
import { call, fail, json, notConnected, usingBackend } from '../../lib/backend.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (!usingBackend()) return notConnected();

  const id = new URL(req.url).searchParams.get('id');

  // 토큰 갱신은 /api/archive 에서만 한다. 여기서는 있는 토큰을 그대로 쓴다.
  const { token } = await accessToken(req);
  try {
    return json(await call('/event/state', { token, search: { id } }));
  } catch (e) { return fail(e); }
}
