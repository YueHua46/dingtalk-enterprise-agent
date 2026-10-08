import type { CodexClientLike } from './codex-client.js';
import { listingExportSchema, type ListingExport } from './listing-export.js';

/** Fixed worker endpoint: data is JSON, never Python source or shell code. */
export async function renderListingInWorker(worker: Pick<CodexClientLike, 'renderListing'>, taskId: string, payload: ListingExport, signal?: AbortSignal) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error('LISTING_EXPORT_TASK_INVALID');
  if (!worker.renderListing) throw new Error('LISTING_EXPORT_WORKER_UNAVAILABLE');
  if (signal?.aborted) throw new Error('LISTING_EXPORT_CANCELLED');
  const files = await worker.renderListing(taskId, listingExportSchema.parse(structuredClone(payload)), signal);
  if (signal?.aborted) throw new Error('LISTING_EXPORT_CANCELLED');
  for (const ext of ['docx', 'xlsx'] as const) {
    if (typeof files[ext] !== 'string' || !new RegExp(`^listing-[a-f0-9]{64}\\.${ext}$`).test(files[ext])) throw new Error('LISTING_EXPORT_OUTPUT_INVALID');
  }
  return files;
}
