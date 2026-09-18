/**
 * POST /api/admin/delete — 행사 삭제
 *
 * 행사 정보를 목록에서 빼고, 화면에서 올린 사진·묶음 파일을 함께 지운다.
 * 본문: { id, title, rev }   title 은 실수로 다른 행사를 지우는 것을 막는 확인용
 */
import { requireAdmin, readJsonBody, json } from '../../lib/admin.js';
import baseline from '../../data/baseline.js';
import { listUnder, paths, readArchive, removeFiles, writeArchive } from '../../lib/store.js';

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'POST 로 요청해 주세요.' }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const { body, error } = await readJsonBody(req);
  if (error) return error;

  const id = String(body?.id ?? '');
  if (!/^e\d{2,4}$/.test(id)) return json({ error: '행사 번호가 올바르지 않습니다.' }, 400);

  try {
    let doc = await readArchive();
    if (!doc) doc = await writeArchive(baseline);

    if (body?.rev != null && Number(body.rev) !== (doc.rev ?? 0)) {
      return json({ error: '다른 사람이 먼저 저장했습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.' }, 409);
    }

    const target = (doc.events ?? []).find((e) => e.id === id);
    if (!target) return json({ error: '이미 삭제된 행사입니다.' }, 404);

    // 화면에 뜬 행사명과 다르면 다른 행사를 지우려는 것이므로 멈춘다
    if (typeof body?.title === 'string' && body.title !== target.title) {
      return json({ error: '행사 정보가 화면과 다릅니다. 새로 고친 뒤 다시 시도해 주세요.' }, 409);
    }

    doc.events = doc.events.filter((e) => e.id !== id);
    const next = await writeArchive(doc);

    // 이 행사에 딸린 파일 정리
    let removed = 0;
    for (const prefix of paths.eventPrefixes(id)) {
      const found = prefix.endsWith('/') ? await listUnder(prefix) : [prefix];
      removed += await removeFiles(found);
    }

    return json({ ok: true, rev: next.rev, removed });
  } catch (e) {
    return json({ error: `삭제하지 못했습니다: ${e.message}` }, 502);
  }
}
