// Service-level tests with the Forge modules mocked: the propose/apply lifecycle, failing closed
// without a user, permission checks and the "only watched pages are queued" rule.
// Run with: node --experimental-test-module-mocks --test test/service.test.mjs
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------- fakes ----------
const store = new Map();
const queued = [];
const requests = [];
let readablePages = new Set(['100']);
let canEdit = true;
let issueDescription = 'Reset password.\nSpec: https://x.atlassian.net/wiki/spaces/S/pages/100/Spec\nAcceptance criteria\n- link expires after 48 hours';

const adf = (text) => ({ type: 'doc', version: 1, content: text.split('\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
const res = (status, body) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

function fakeClient(who) {
  return {
    async requestJira(path, opts = {}) {
      requests.push({ who, path: String(path), method: opts.method || 'GET' });
      const p = String(path);
      if (p.includes('/remotelink')) return res(200, []);
      if (p.includes('/mypermissions')) return res(200, { permissions: { EDIT_ISSUES: { havePermission: canEdit } } });
      if (p.includes('/comment')) return res(201, { id: '1' });
      if (opts.method === 'PUT') return res(204);
      if (p.startsWith('/rest/api/3/issue/PLAT-1')) {
        return res(200, { key: 'PLAT-1', fields: { summary: 'Reset password', description: adf(issueDescription), project: { key: 'PLAT' }, issuetype: { id: '1', name: 'Story' } } });
      }
      return res(404, {});
    },
    async requestConfluence(path) {
      requests.push({ who, path: String(path), method: 'GET' });
      const id = (String(path).match(/pages\/(\d+)/) || [])[1];
      if (!readablePages.has(id)) return res(404, {});
      return res(200, { id, title: 'Spec', version: { number: 3 }, body: { storage: { value: '<p>The link expires after 24 hours.</p>' } } });
    },
  };
}

mock.module('@forge/api', {
  defaultExport: { asUser: (id) => fakeClient(id || 'current-user'), asApp: () => fakeClient('app') },
  namedExports: { route: (s, ...v) => s.reduce((a, x, i) => a + x + (i < v.length ? encodeURIComponent(v[i]) : ''), '') },
});
mock.module('@forge/kvs', {
  namedExports: {
    kvs: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      set: async (k, v) => void store.set(k, structuredClone(v)),
      delete: async (k) => void store.delete(k),
      query: () => {
        const q = { prefix: '', where(_f, c) { q.prefix = c.prefix; return q; }, limit() { return q; }, cursor() { return q; },
          async getMany() { return { results: [...store].filter(([k]) => k.startsWith(q.prefix)).map(([key, value]) => ({ key, value })) }; } };
        return q;
      },
    },
    WhereConditions: { beginsWith: (prefix) => ({ prefix }) },
  },
});
mock.module('@forge/events', { namedExports: { Queue: class { async push(e) { queued.push(...[].concat(e)); } } } });
mock.module('@forge/llm', { namedExports: { chat: async () => { throw new Error('LLM not available in tests'); } } });

const service = await import('../src/lib/service.js');
const actions = await import('../src/actions/index.js');

const proposal = { issueKey: 'PLAT-1', pages: [{ id: '100', title: 'Spec', version: 3 }], changes: ['48 hours → 24 hours'], acceptanceCriteria: ['The link expires after 24 hours.'] };

beforeEach(() => {
  store.clear();
  queued.length = 0;
  requests.length = 0;
  readablePages = new Set(['100']);
  canEdit = true;
});

test('a proposal can be applied once, by the user who requested it', async () => {
  const id = await service.saveProposal(proposal, 'alice');
  await assert.rejects(service.applyProposalById(id, 'mallory'), /another user/);
  const r = await service.applyProposalById(id, 'alice');
  assert.equal(r.applied, true);
  assert.ok(requests.some((q) => q.method === 'PUT' && q.path.startsWith('/rest/api/3/issue/PLAT-1')));
  assert.ok(queued.some((e) => e.body.type === 'analyze' && e.body.accountId === 'alice'), 're-check queued');
  await assert.rejects(service.applyProposalById(id, 'alice'), /Unknown or expired/);
});

test('a proposal without a known user cannot be applied', async () => {
  const id = await service.saveProposal(proposal, 'alice');
  await assert.rejects(service.applyProposalById(id, undefined), /another user/);
  const orphan = await service.saveProposal(proposal, undefined);
  await assert.rejects(service.applyProposalById(orphan, 'alice'), /another user/);
});

test('expired proposals are refused', async () => {
  const id = await service.saveProposal(proposal, 'alice');
  const rec = store.get(`proposal:${id}`);
  rec.createdAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  store.set(`proposal:${id}`, rec);
  await assert.rejects(service.applyProposalById(id, 'alice'), /expired/);
});

test('agent actions fail closed when the calling user is unknown', async () => {
  const r = await actions.checkAlignmentAction({ issueKey: 'PLAT-1' }, {});
  assert.match(r.error, /could not identify the calling user/);
  assert.equal(queued.length, 0, 'nothing runs with app permissions');
  const g = await actions.createGapItemsAction({ spec: '100' }, {});
  assert.match(g.error, /could not identify the calling user/);
});

test('jobs cannot be stored or read without a user', async () => {
  await assert.rejects(service.startUserJob('verify', 'PLAT-1', undefined), /identify the (calling|current) user/);
  await assert.rejects(service.getUserJob('verify', 'PLAT-1', undefined), /calling user/);
});

test('saved analyses are hidden from users who cannot read the spec', async () => {
  store.set('analysis:PLAT-1', { result: { score: 50, requirements: [{ specQuote: 'The link expires after 24 hours.' }] }, pages: [{ id: '100', title: 'Spec', version: 3 }], issueHash: 'x', pendingChanges: [] });
  const visible = await service.getStatus('PLAT-1');
  readablePages = new Set();
  const hidden = await service.getStatus('PLAT-1');
  assert.ok(visible.analysis, 'reader sees the analysis');
  assert.ok(!hidden.analysis || !hidden.analysis.requirements, 'non-reader does not get spec quotes');
});

test('only a user who can read the page can mark it as not a spec', async () => {
  readablePages = new Set();
  await assert.rejects(service.setPageIgnored('PLAT-1', '100', true), /cannot read this page/);
  readablePages = new Set(['100']);
  assert.deepEqual((await service.setPageIgnored('PLAT-1', '100', true)).ignored, ['100']);
});

test('edits to pages no work item links are not queued', async () => {
  assert.equal(await service.enqueuePageUpdated('999', 'alice'), false);
  assert.equal(queued.length, 0);
});

test('spec changes from pages the user cannot read are not shown', async () => {
  store.set('analysis:PLAT-1', {
    result: { score: 50, requirements: [] },
    pages: [{ id: '100', title: 'Spec', version: 3 }],
    pendingChanges: [{ pageId: '100', diff: { changes: ['visible'] } }, { pageId: '200', diff: { changes: ['restricted text'] } }],
  });
  const s = await service.getStatus('PLAT-1');
  assert.deepEqual(s.pendingChanges.map((c) => c.pageId), ['100']);
});

test('creating gap work items without confirm only previews', async () => {
  store.set('coverage:100', { items: [{ key: 'PLAT-1' }], requirements: [{ id: 'R1', status: 'gap', requirement: 'Audit log', specQuote: 'Every reset is logged.', coveredBy: [], conflictsIn: [] }] });
  const r = await service.createGapItems('100', null, 'user', { confirm: false });
  assert.equal(r.preview, true);
  assert.equal(r.wouldCreate.length, 1);
  assert.ok(!requests.some((q) => q.method === 'POST'), 'nothing created');
});

test('a coverage map is not stale just because a linked item was already considered', async () => {
  store.set('link:100:PLAT-1', 1);
  store.set('link:100:PLAT-9', 1);
  store.set('coverage:100', { pageVersion: 3, items: [{ key: 'PLAT-1' }], considered: ['PLAT-1', 'PLAT-9'], requirements: [] });
  assert.equal((await service.getCoverage('100')).stale, false);
  store.set('link:100:PLAT-7', 1);
  assert.equal((await service.getCoverage('100')).stale, true, 'a newly linked item makes it stale');
});

test('panel checks and coverage maps need a known user', async () => {
  await assert.rejects(service.requestAnalysis('PLAT-1', undefined), /current user/);
  await assert.rejects(service.requestCoverage('100', undefined), /current user/);
  await service.processJob({ type: 'analyze', issueKey: 'PLAT-1' });
  assert.equal(store.get('job:PLAT-1').state, 'error', 'a job without a user is refused, not run as the app');
});

test('a re-check cannot replace a report built from a page the user cannot read', async () => {
  issueDescription += '\nAlso https://x.atlassian.net/wiki/spaces/S/pages/200/Restricted';
  store.set('analysis:PLAT-1', { result: { score: 50, requirements: [] }, pages: [{ id: '100' }, { id: '200' }], pendingChanges: [] });
  try {
    await assert.rejects(service.requestAnalysis('PLAT-1', 'alice'), /cannot read/);
  } finally {
    issueDescription = issueDescription.replace(/\nAlso .*$/, '');
  }
});

test('only people who can edit the work item can switch a spec page off', async () => {
  canEdit = false;
  await assert.rejects(service.setPageIgnored('PLAT-1', '100', true), /can edit/);
});

test('agents create exactly the previewed gaps, once, for the same user', async () => {
  store.set('coverage:100', { pageVersion: 3, analyzedAt: 't1', items: [{ key: 'PLAT-1' }], requirements: [{ id: 'R1', status: 'gap', requirement: 'Audit log', specQuote: 'Every reset is logged.', coveredBy: [], conflictsIn: [] }] });
  const pv = await service.createGapItems('100', null, 'user', { confirm: false, previewOwner: 'alice' });
  assert.ok(pv.previewId);
  await assert.rejects(service.createGapItems('100', null, 'user', { confirm: true, previewId: pv.previewId, previewOwner: 'mallory' }), /another user/);
});
