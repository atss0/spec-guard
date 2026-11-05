import { invoke } from '@forge/bridge';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls a resolver that returns a job ({ state, result, error }) until it is done.
 * Returns the job result; throws with the job error.
 */
export async function pollJob(resolverName, { attempts = 80 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(i < 5 ? 2500 : 4000);
    const r = await invoke(resolverName);
    if (!r.ok) throw new Error(r.error);
    const job = r.data;
    if (job && job.state === 'done') return job.result;
    if (job && job.state === 'error') throw new Error(job.error);
  }
  throw new Error('This is taking longer than expected. Please try again in a minute.');
}

/** Relative time, e.g. "5 min ago". */
export function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
