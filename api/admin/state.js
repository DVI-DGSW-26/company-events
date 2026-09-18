/**
 * GET /api/admin/state — 편집 화면이 읽을 현재 자료
 *
 * 화면에 보이는 data.js 는 빌드 결과라 편집용 원본과 다르다.
 * 저장소의 data/events.json 을 그대로 읽어 준다.
 * head(커밋 sha)도 함께 줘서, 저장할 때 그 사이에 다른 사람이 고쳤는지 확인한다.
 */
import { requireAdmin, json } from '../../lib/admin.js';
import { headCommit, readFile } from '../../lib/github.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const id = new URL(req.url).searchParams.get('id');

  try {
    const head = await headCommit();
    const events = await readFile('data/events.json');
    if (!events) return json({ error: '행사 자료를 찾지 못했습니다.' }, 500);

    const body = { head: head.sha, data: JSON.parse(events.text), user: { name: auth.user.name } };

    if (id) {
      const media = await readFile(`data/media/${id}.json`);
      body.media = media ? JSON.parse(media.text) : { photos: [], videos: [] };
    }
    return json(body);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
