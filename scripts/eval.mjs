// Spec Guard evaluation: runs check-alignment and get-spec-coverage several times on a seeded spec
// with known ground truth and reports detection, false positives, stability and quote verification.
// Usage: node eval.mjs [runs]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';

const RUNS = Number(process.argv[2] || 3);
const PAGE = '4292609';
// Ground truth for "Notifications — Requirements (eval)"
const TRUTH = {
  'PLAT-33518': { scope: ['NT-1', 'NT-2', 'NT-3', 'NT-4'], conflicts: ['NT-2', 'NT-3', 'NT-4'] },
  'PLAT-33519': { scope: ['NT-5'], conflicts: [] },
  'PLAT-33520': { scope: ['NT-6'], conflicts: ['NT-6'] },
  'PLAT-33521': { scope: ['NT-7'], conflicts: [] },
};

const load = () => JSON.parse(fs.readFileSync('./oauth-store.json', 'utf8'));
const save = (p) => fs.writeFileSync('./oauth-store.json', JSON.stringify({ ...load(), ...p }, null, 2));
const provider = {
  get redirectUrl() { return 'http://localhost:8765/callback'; },
  get clientMetadata() { return { client_name: 'eval', redirect_uris: ['http://localhost:8765/callback'] }; },
  clientInformation: () => load().client, saveClientInformation: (c) => save({ client: c }),
  tokens: () => load().tokens, saveTokens: (t) => save({ tokens: t }),
  saveCodeVerifier: (v) => save({ verifier: v }), codeVerifier: () => load().verifier,
  redirectToAuthorization: () => { throw new Error('re-auth needed'); },
};
const client = new Client({ name: 'eval', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.atlassian.com/forge/00236d0b-a8f0-4b50-82c2-f1d2d34642cc'), { authProvider: provider }));
const { tools } = await client.listTools();
const tool = (frag) => tools.find((t) => t.name.includes(frag)).name;
const call = async (frag, args) => {
  const r = await client.callTool({ name: tool(frag), arguments: args });
  return r.structuredContent || JSON.parse(r.content[0].text);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reqId = (r) => ((`${r.id} ${r.requirement}`.match(/NT-\d/) || [])[0]) || r.id;

async function analyse(key) {
  let r = await call('check-alignment', { issueKey: key });
  for (let i = 0; r.pending && i < 20; i++) {
    await sleep(10000);
    r = await call('get-job-result', { kind: 'analyze-action', key });
  }
  if (r.error) throw new Error(r.error);
  return r.analysis || r;
}

const rows = [];
const quote = { checked: 0, verified: 0 };
for (const [key, truth] of Object.entries(TRUTH)) {
  for (let run = 1; run <= RUNS; run++) {
    const t0 = Date.now();
    const a = await analyse(key);
    const ms = Date.now() - t0;
    quote.checked += a.quoteCheck.checked;
    quote.verified += a.quoteCheck.verified;
    const byId = {};
    for (const r of a.requirements) byId[reqId(r)] = r.status;
    const conflicts = Object.keys(byId).filter((id) => byId[id] === 'conflict');
    const falseMissing = Object.keys(byId).filter((id) => byId[id] === 'missing' && !truth.scope.includes(id));
    rows.push({
      key, run, ms, score: a.score,
      detected: truth.conflicts.filter((id) => conflicts.includes(id)).length,
      expected: truth.conflicts.length,
      falseConflicts: conflicts.filter((id) => !truth.conflicts.includes(id)),
      falseMissing,
      statuses: byId,
    });
    console.log(`${key} run ${run}: score ${a.score}, conflicts ${conflicts.join(',') || '-'}, false missing ${falseMissing.join(',') || '-'} (${ms} ms)`);
  }
}

// Coverage map: built once (it is cached until the spec or its linked work items change)
const covRuns = [];
{
  let c = await call('coverage', { spec: PAGE });
  for (let i = 0; c.building && i < 20; i++) {
    await sleep(10000);
    c = await call('coverage', { spec: PAGE });
  }
  const conflictIds = c.requirements.filter((q) => q.status === 'conflict').map((q) => reqId(q));
  covRuns.push({ totals: c.totals, conflictIds, gaps: c.requirements.filter((q) => q.status === 'gap').map((q) => reqId(q)) });
  console.log('coverage:', JSON.stringify(c.totals), 'conflicts', conflictIds.join(','));
}
await client.close();

const total = (f) => rows.reduce((s, r) => s + f(r), 0);
const scoresBy = {};
for (const r of rows) (scoresBy[r.key] = scoresBy[r.key] || []).push(r.score);
const spread = Object.fromEntries(Object.entries(scoresBy).map(([k, v]) => [k, Math.max(...v) - Math.min(...v)]));
const summary = {
  runs: RUNS,
  conflictRecall: `${total((r) => r.detected)}/${total((r) => r.expected)}`,
  falseConflicts: total((r) => r.falseConflicts.length),
  falseMissing: total((r) => r.falseMissing.length),
  scoreSpreadPerItem: spread,
  quotesVerified: `${quote.verified}/${quote.checked}`,
  medianLatencyMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  coverage: covRuns,
};
console.log('\nSUMMARY', JSON.stringify(summary, null, 1));
fs.writeFileSync('eval-result.json', JSON.stringify({ summary, rows }, null, 1));
