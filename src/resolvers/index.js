/**
 * Backend for the UI Kit modules (issue panel, issue context, global page, Confluence byline).
 * All product reads use the current user's permissions.
 */
import Resolver from '@forge/resolver';
import {
  getStatus,
  requestAnalysis,
  listAlignment,
  pageAlignment,
  requestCoverage,
  getCoverage,
  createGapItems,
  linkWorkItems,
  startUserJob,
  getUserJob,
  applyProposal,
  setPageIgnored,
  pollWatchedPages,
  loadContext,
} from '../lib/service.js';
import { demoTargets, createDemo } from '../lib/demo.js';

const resolver = new Resolver();

const ext = (req) => (req.context && req.context.extension) || {};
const issueKeyOf = (req) => (ext(req).issue && ext(req).issue.key) || (req.payload && req.payload.issueKey);
const pageIdOf = (req) => ext(req).content && ext(req).content.id;
const accountOf = (req) => req.context.accountId;

/** Returns { ok, data } or { ok: false, error } so the UI never crashes on a failed call. */
const safe = (fn) => async (req) => {
  try {
    return { ok: true, data: await fn(req) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message || String(e) };
  }
};

/** Throws unless the user can read at least one spec page linked to the work item. */
async function requireSpec(req) {
  const { pages } = await loadContext(issueKeyOf(req), 'user');
  if (!pages.length) throw new Error('No readable specification page is linked to this work item.');
}

// Issue panel and issue context
resolver.define('getStatus', safe((req) => getStatus(issueKeyOf(req), 'user')));
resolver.define('runAnalysis', safe((req) => requestAnalysis(issueKeyOf(req), accountOf(req))));
resolver.define('setPageIgnored', safe((req) => setPageIgnored(issueKeyOf(req), req.payload.pageId, Boolean(req.payload.ignored))));

resolver.define(
  'verifyChange',
  safe(async (req) => {
    const change = String(req.payload.change || '').trim();
    if (!change) throw new Error('Describe the change first.');
    await requireSpec(req);
    await startUserJob('verify', issueKeyOf(req), accountOf(req), { change: change.slice(0, 40000) });
    return { queued: true };
  })
);
resolver.define('getVerify', safe((req) => getUserJob('verify', issueKeyOf(req), accountOf(req))));

resolver.define(
  'requestFix',
  safe(async (req) => {
    await requireSpec(req);
    await startUserJob('fix', issueKeyOf(req), accountOf(req));
    return { queued: true };
  })
);
resolver.define('getFix', safe((req) => getUserJob('fix', issueKeyOf(req), accountOf(req))));
resolver.define(
  'applyFix',
  safe(async (req) => {
    const job = await getUserJob('fix', issueKeyOf(req), accountOf(req));
    if (!job || job.state !== 'done') throw new Error('There is no proposal to apply. Click "Align work item with spec" first.');
    return applyProposal(issueKeyOf(req), job.result, 'user', accountOf(req));
  })
);

// Global page
resolver.define('listAlignment', safe(() => listAlignment()));
resolver.define('checkSpecsNow', safe(() => pollWatchedPages({ budgetMs: 20000, manual: true })));
resolver.define('demoTargets', safe(() => demoTargets()));
resolver.define(
  'createDemo',
  safe(async (req) => {
    const r = await createDemo(req.payload.projectKey, req.payload.spaceId);
    await linkWorkItems(r.keys, r.pageId);
    return r;
  })
);

// Confluence byline
resolver.define('pageAlignment', safe((req) => pageAlignment(pageIdOf(req))));
resolver.define('requestCoverage', safe((req) => requestCoverage(pageIdOf(req), accountOf(req))));
resolver.define('getCoverage', safe((req) => getCoverage(pageIdOf(req))));
resolver.define('createGapItems', safe((req) => createGapItems(pageIdOf(req), (req.payload && req.payload.reqIds) || null, 'user')));

export const handler = resolver.getDefinitions();
