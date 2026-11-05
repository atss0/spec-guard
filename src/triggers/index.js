/**
 * Product events, the scheduled check and the queue consumer. Triggers only enqueue work; the slow
 * part runs in the queue consumer.
 */
import { Queue } from '@forge/events';
import { enqueuePageUpdated, processJob, pollWatchedPages } from '../lib/service.js';

const queue = new Queue({ key: 'specguard-jobs' });

/** avi:confluence:updated:page */
export async function pageUpdated(event) {
  const content = event && event.content;
  if (!content || content.type !== 'page') return;
  console.log(`spec page ${content.id} updated (v${content.version && content.version.number})`);
  // The editor can read the page, so the background job reads it with their permissions.
  await enqueuePageUpdated(content.id, event.atlassianId);
}

/** avi:jira:created:issue and avi:jira:updated:issue: index spec links, re-check analysed work items. */
export async function issueChanged(event) {
  const key = event && event.issue && event.issue.key;
  if (!key) return;
  const changed = ((event.changelog && event.changelog.items) || []).map((i) => i.field);
  if (event.eventType === 'avi:jira:updated:issue' && changed.length && !changed.some((f) => f === 'description' || f === 'summary')) return;
  console.log(`work item ${key} ${event.eventType === 'avi:jira:created:issue' ? 'created' : 'updated'}`);
  await queue.push({ body: { type: 'issueChanged', issueKey: key, accountId: event.atlassianId } });
}

/** Hourly fallback in case a Confluence event was not delivered. */
export async function pollSpecs() {
  const r = await pollWatchedPages();
  if (r.queued) console.log(`hourly check: ${r.queued} changed spec page(s)`);
}

/** Queue consumer. */
export async function jobWorker(event) {
  await processJob(event.body);
}
