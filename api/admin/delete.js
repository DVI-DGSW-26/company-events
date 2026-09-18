/**
 * POST /api/admin/delete — 행사 삭제
 *
 * 행사 정보와 그 행사에 딸린 사진·기사·영상 파일을 한 커밋으로 지운다.
 * 되돌려야 하면 저장소 이력에서 복구할 수 있다.
 *
 * 본문: { id, title, head }   title 은 실수로 지우는 것을 막기 위한 확인용
 */
import { requireAdmin, readJsonBody, json } from '../../lib/admin.js';
import { commitFiles, listPaths, readFile } from '../../lib/github.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const id = String(body?.id ?? '');
  if (!/^e\d{2,4}$/.test(id)) return json({ error: '행사 번호가 올바르지 않습니다.' }, 400);

  try {
    const current = await readFile('data/events.json');
    if (!current) return json({ error: '행사 자료를 찾지 못했습니다.' }, 500);
    const doc = JSON.parse(current.text);

    const target = doc.events.find((e) => e.id === id);
    if (!target) return json({ error: '이미 삭제된 행사입니다.' }, 404);

    // 화면에 뜬 행사명과 다르면 다른 행사를 지우려는 것이므로 멈춘다
    if (typeof body?.title === 'string' && body.title !== target.title) {
      return json({ error: '행사 정보가 화면과 다릅니다. 새로 고친 뒤 다시 시도해 주세요.' }, 409);
    }

    doc.events = doc.events.filter((e) => e.id !== id);

    const owned = await listPaths([`photos/${id}`, `thumbs/${id}`, `articles/${id}`, `videos/${id}`, `data/media/${id}.json`]);

    const files = [
      { path: 'data/events.json', text: `${JSON.stringify(doc, null, 2)}\n` },
      ...owned.map((p) => ({ path: p, remove: true })),
    ];

    const { sha } = await commitFiles(
      files,
      `${id} ${target.title} 삭제\n\n행사 아카이브 화면에서 삭제함 (파일 ${owned.length}개 정리)`,
      { name: auth.user.name, email: auth.user.email },
      typeof body?.head === 'string' ? body.head : undefined,
    );

    return json({ ok: true, sha, removed: owned.length });
  } catch (e) {
    return json({ error: e.message }, e.conflict ? 409 : 502);
  }
}
