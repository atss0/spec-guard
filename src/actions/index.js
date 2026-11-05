/**
 * Rovo actions. The same actions are exposed as MCP tools (rovo:mcp) for external agents such as
 * Claude Code or Cursor.
 *
 * Slow actions (anything that calls the LLM) start a background job and wait up to ~18 seconds.
 * If the job is not done by then they return { pending, job }, and the agent collects the result
 * with get-job-result. Writes are two-step: align-work-item only proposes, apply-alignment applies an
 * approved proposal.
 */
import {
  getSpecContext,
  getStatus,
  specCoverageFor,
  createGapItems,
  resolveSpecPageId,
  runOrDefer,
  getUserJob,
  applyProposalById,
} from '../lib/service.js';

/** Work item key from the input or from the Jira context the agent was opened in. */
function issueKeyFrom(payload) {
  const fromCtx = payload && payload.context && payload.context.jira && payload.context.jira.issueKey;
  const raw = (payload && payload.issueKey) || fromCtx || '';
  const key = String(raw).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) throw new Error(`"${raw}" is not a valid Jira work item key (expected something like PROJ-123).`);
  return key;
}

/** The calling user (Rovo and MCP put it in different places). */
function accountIdFrom(payload, context) {
  const id = (context && (context.accountId || (context.principal && context.principal.accountId))) || (payload && payload.context && payload.context.accountId);
  // Fail closed: without a known user the action would run with the app's permissions.
  if (!id) throw new Error('Spec Guard could not identify the calling user, so it did not run this action.');
  return id;
}

/** Turns errors into a message the agent can show instead of failing the tool call. */
const wrap = (fn) => async (payload, context) => {
  try {
    return await fn(payload || {}, context || {});
  } catch (e) {
    console.error(e);
    return { error: e.message || String(e) };
  }
};

export const getSpecContextAction = wrap(async (payload) => getSpecContext(issueKeyFrom(payload), 'user'));

export const getAlignmentStatusAction = wrap(async (payload) => getStatus(issueKeyFrom(payload), 'user'));

export const checkAlignmentAction = wrap(async (payload, context) => runOrDefer('analyze-action', issueKeyFrom(payload), accountIdFrom(payload, context)));

export const verifyChangeAction = wrap(async (payload, context) => {
  const change = String(payload.change || '').trim();
  if (!change) throw new Error('Provide "change": a summary or diff of what was implemented.');
  return runOrDefer('verify', issueKeyFrom(payload), accountIdFrom(payload, context), { change: change.slice(0, 40000) });
});

export const getSpecCoverageAction = wrap(async (payload, context) => {
  const ref = payload.spec || (payload.context && payload.context.confluence && payload.context.confluence.contentId);
  return specCoverageFor(ref, accountIdFrom(payload, context));
});

/** Step 1 of 2: proposes corrected acceptance criteria. Changes nothing. */
export const alignWorkItemAction = wrap(async (payload, context) => runOrDefer('align-action', issueKeyFrom(payload), accountIdFrom(payload, context)));

/** Step 2 of 2: applies a proposal the user approved. */
export const applyAlignmentAction = wrap(async (payload, context) => applyProposalById(payload.proposalId, accountIdFrom(payload, context)));

export const createGapItemsAction = wrap(async (payload, context) => {
  const pageId = await resolveSpecPageId(payload.spec);
  const ids = String(payload.requirementIds || '')
    .split(/[,\s]+/)
    .filter(Boolean);
  accountIdFrom(payload, context);
  const confirm = payload.confirm === true || String(payload.confirm).toLowerCase() === 'true';
  return createGapItems(pageId, ids.length ? ids : null, 'user', { confirm });
});

/** Collects the result of a job that was still running when an action returned. */
export const getJobResultAction = wrap(async (payload, context) => {
  const kind = String(payload.kind || '').trim();
  const key = String(payload.key || '').trim().toUpperCase();
  if (!['analyze-action', 'verify', 'align-action'].includes(kind)) throw new Error('kind must be one of analyze-action, verify, align-action.');
  const job = await getUserJob(kind, key, accountIdFrom(payload, context));
  if (!job) throw new Error('No such job for this user.');
  if (job.state === 'running') return { pending: true, message: 'Still working. Try again in about 20 seconds.' };
  if (job.state === 'error') throw new Error(job.error);
  return job.result;
});
