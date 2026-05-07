import { getClient } from './auth';
import { ResourceCount, ManagedResourceType } from '../../shared/types';
import { RESOURCE_TYPES, PROBE_TIMEOUT_MS } from '../../shared/constants';

interface CountResult {
  count: number;
  sampleId?: string;
}

async function countResource(type: ManagedResourceType): Promise<CountResult> {
  const def = RESOURCE_TYPES.find(r => r.type === type);
  if (!def) throw new Error(`Unknown resource type: ${type}`);

  const client = getClient();
  const baseEndpoint = def.countEndpoint.replace('limit=1', 'limit=200');
  let total = 0;
  let sampleId: string | undefined;
  let nextUrl: string | null = baseEndpoint;

  while (nextUrl) {
    const response = await client.get(nextUrl, { timeout: PROBE_TIMEOUT_MS });
    const items = Array.isArray(response.data) ? response.data : [];
    total += items.length;

    // Grab the first resource ID for sub-resource probing
    if (!sampleId && items.length > 0 && items[0].id) {
      sampleId = items[0].id;
    }

    const linkHeader = response.headers['link'] as string | undefined;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        try {
          const url = new URL(nextMatch[1]);
          nextUrl = url.pathname + url.search;
        } catch {
          nextUrl = nextMatch[1];
        }
        continue;
      }
    }
    nextUrl = null;
  }

  return { count: total, sampleId };
}

export async function countResources(
  types: ManagedResourceType[],
  onProgress: (current: string) => void
): Promise<ResourceCount[]> {
  const results: ResourceCount[] = [];

  for (const type of types) {
    const def = RESOURCE_TYPES.find(r => r.type === type);
    if (!def) continue;

    onProgress(def.label);

    try {
      const { count, sampleId } = await countResource(type);
      console.log(`[counter] ${def.label}: ${count} resources${sampleId ? `, sampleId=${sampleId}` : ''}`);
      results.push({ type, label: def.label, count, sampleId });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
      const message = axiosErr.message || String(err);
      console.log(`[counter] ${def.label}: FAILED — HTTP ${axiosErr.response?.status}, ${message}`);
      if (axiosErr.response?.data) {
        console.log(`[counter]   Response: ${JSON.stringify(axiosErr.response.data).slice(0, 300)}`);
      }
      results.push({ type, label: def.label, count: 0, error: message });
    }
  }

  return results;
}
