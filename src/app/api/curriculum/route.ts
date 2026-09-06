import { jsonOk, requireCapability } from '@/lib/api/guard';
import { getCurriculumBrowser, listResources } from '@/lib/curriculum/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('curriculum:read', async (actor) => {
  const [blocks, resources] = await Promise.all([
    getCurriculumBrowser(actor.ownerId),
    listResources(actor.ownerId),
  ]);

  return jsonOk({ blocks, resources });
});
