// Unit tests for the deterministic parts around the LLM: JSON extraction, quote verification,
// scoring and coverage normalisation. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, verifyQuote, normalizeForMatch, normalizeAnalysis, normalizeCoverage } from '../src/lib/analysis.js';

const SPEC = `## Functional requirements
- FR-3 Link validity: The reset link is single-use and expires 24 hours after it is sent.
- FR-4 Password rules: The new password must have at least 12 characters and must not match any of the last 5 passwords.`;

test('extractJson handles fences and surrounding prose', () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"a":{"b":[1,2]}} suffix'), { a: { b: [1, 2] } });
  assert.throws(() => extractJson('no json here'));
});

test('verifyQuote accepts verbatim quotes despite whitespace, case and typography', () => {
  assert.equal(verifyQuote('The reset link is single-use and expires 24 hours after it is sent.', SPEC), true);
  assert.equal(verifyQuote('the RESET link is single-use   and expires 24 hours', SPEC), true);
  assert.equal(verifyQuote('“at least 12 characters”', SPEC), true);
  assert.equal(normalizeForMatch('A — b’s  “c”'), 'a - b\'s "c"');
});

test('verifyQuote accepts quotes shortened with an ellipsis, in order', () => {
  assert.equal(verifyQuote('The new password must have ... last 5 passwords', SPEC), true);
  assert.equal(verifyQuote('last 5 passwords ... The new password', SPEC), false);
});

test('verifyQuote rejects invented quotes', () => {
  assert.equal(verifyQuote('The reset link expires after 48 hours.', SPEC), false);
  assert.equal(verifyQuote('', SPEC), null); // nothing to check, not counted
  assert.equal(verifyQuote('""', SPEC), null);
  assert.equal(verifyQuote('...', SPEC), null);
});

test('normalizeAnalysis scores in-scope requirements and ignores "elsewhere"', () => {
  const a = normalizeAnalysis(
    {
      requirements: [
        { requirement: 'a', status: 'covered' },
        { requirement: 'b', status: 'conflict' },
        { requirement: 'c', status: 'unclear' },
        { requirement: 'd', status: 'elsewhere', coveredBy: 'plat-2' },
        { requirement: 'e', status: 'bogus' },
      ],
    },
    SPEC,
    ''
  );
  // covered 1 + conflict 0 + unclear 0.5 + bogus->unclear 0.5 = 2 of 4 in-scope requirements
  assert.equal(a.score, 50);
  assert.equal(a.requirements[3].coveredBy, 'PLAT-2');
  assert.equal(a.requirements[4].status, 'unclear');
});

test('normalizeAnalysis flags quotes that are not in the sources', () => {
  const a = normalizeAnalysis(
    {
      requirements: [
        { requirement: 'x', status: 'conflict', specQuote: 'expires 24 hours after it is sent', issueQuote: 'valid for 48 hours' },
        { requirement: 'y', status: 'missing', specQuote: 'must be at least 16 characters' },
      ],
    },
    SPEC,
    'Reset link is valid for 48 hours and can be used once.'
  );
  assert.equal(a.requirements[0].specQuoteVerified, true);
  assert.equal(a.requirements[0].issueQuoteVerified, true);
  assert.equal(a.requirements[1].specQuoteVerified, false);
  assert.deepEqual(a.quoteCheck, { checked: 3, verified: 2 });
});

test('normalizeAnalysis returns a null score when there are no requirements', () => {
  assert.equal(normalizeAnalysis({}).score, null);
  assert.equal(normalizeAnalysis({ requirements: [{ status: 'elsewhere', coveredBy: 'A-1' }] }).score, null);
});

test('normalizeCoverage drops unknown work items and treats unattributed coverage as a gap', () => {
  const c = normalizeCoverage(
    {
      requirements: [
        { id: 'FR-3', status: 'covered', coveredBy: ['plat-1', 'NOPE-9'] },
        { id: 'FR-4', status: 'covered', coveredBy: [] },
        { id: 'FR-5', status: 'conflict', conflictsIn: ['PLAT-2'] },
        { id: 'FR-6', status: 'weird' },
      ],
    },
    ['PLAT-1', 'PLAT-2']
  );
  assert.deepEqual(c.requirements[0].coveredBy, ['PLAT-1']);
  assert.equal(c.requirements[1].status, 'gap');
  assert.deepEqual(c.requirements[2].conflictsIn, ['PLAT-2']);
  assert.equal(c.requirements[3].status, 'gap');
  assert.deepEqual(c.totals, { total: 4, covered: 1, partial: 0, conflict: 1, gap: 2 });
});

test('empty quotes are not counted as verified', () => {
  const a = normalizeAnalysis(
    { requirements: [{ id: 'R1', status: 'missing', specQuote: 'The reset link is single-use', issueQuote: '' }, { id: 'R2', status: 'unclear', specQuote: '  ', issueQuote: '' }] },
    SPEC,
    'some work item text',
  );
  assert.equal(a.requirements[1].specQuoteVerified, null);
  assert.equal(a.requirements[0].issueQuoteVerified, null);
  assert.deepEqual(a.quoteCheck, { checked: 1, verified: 1 });
});

test('verifyQuote rejects ellipsis quotes made of tiny fragments', () => {
  assert.equal(verifyQuote('The ... 24', SPEC), false);
  assert.equal(verifyQuote('a ... b ... c', SPEC), false);
});

test('verifyQuote rejects phrases stitched together from far apart', () => {
  const long = 'The reset link is single-use. ' + 'Filler text that is unrelated. '.repeat(20) + 'Sessions expire after 48 hours of inactivity.';
  assert.equal(verifyQuote('The reset link is single-use ... expire after 48 hours', long), false);
  assert.equal(verifyQuote('The reset link ... expires ... 48 hours', SPEC), false);
});

test('a conflict whose spec quote is not in the spec is not counted as a conflict', () => {
  const a = normalizeAnalysis({ requirements: [{ id: 'R1', status: 'conflict', specQuote: 'The reset link expires after 48 hours.', issueQuote: '' }] }, SPEC, 'x');
  assert.equal(a.requirements[0].status, 'unclear');
  assert.equal(a.requirements[0].unverifiedConflict, true);
});

test('very short quotes do not count as verified', () => {
  assert.equal(verifyQuote('24', SPEC), false);
  assert.equal(verifyQuote('the', SPEC), false);
});
