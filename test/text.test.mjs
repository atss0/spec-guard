// Spec Guard metin yardimcilari icin birim testleri (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { adfToText, storageToText, findConfluencePageIds, clip, replaceAcceptanceCriteria, gapIssueAdf } from '../src/lib/text.js';

const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

test('adfToText keeps headings, list items and smart-link URLs', () => {
  const adf = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Spec: ' }, { type: 'inlineCard', attrs: { url: 'https://x.atlassian.net/wiki/spaces/A/pages/123/T' } }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('one')] }, { type: 'listItem', content: [p('two')] }] },
    ],
  };
  const t = adfToText(adf);
  assert.match(t, /pages\/123/);
  assert.match(t, /### Acceptance criteria/);
  assert.match(t, /- one\n- two/);
});

test('storageToText converts Confluence storage format to readable text', () => {
  const t = storageToText('<h2>Rules</h2><ul><li><strong>FR-1</strong> Link &amp; expiry: 24&nbsp;hours</li></ul><table><tr><td>a</td><td>b</td></tr></table>');
  assert.match(t, /## Rules/);
  assert.match(t, /- FR-1 Link & expiry: 24 hours/);
  assert.match(t, /\| a \| b/);
});

test('findConfluencePageIds finds both URL styles and de-duplicates', () => {
  const ids = findConfluencePageIds(
    'see https://s.atlassian.net/wiki/spaces/MD/pages/3702785/Title and /wiki/pages/viewpage.action?pageId=42 and again /wiki/spaces/X/pages/3702785'
  );
  assert.deepEqual(ids.sort(), ['3702785', '42']);
});

test('clip marks truncated text', () => {
  assert.equal(clip('abc', 10), 'abc');
  assert.match(clip('abcdef', 3), /^abc\n\[\.\.\. 3 characters truncated/);
});

test('replaceAcceptanceCriteria replaces only the acceptance criteria section', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      p('As a user...'),
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('old')] }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Notes' }] },
      p('keep me'),
    ],
  };
  const out = replaceAcceptanceCriteria(adf, ['new 1', 'new 2'], 'note');
  const text = adfToText(out);
  assert.match(text, /As a user/);
  assert.match(text, /- new 1\n- new 2/);
  assert.doesNotMatch(text, /old/);
  assert.match(text, /### Notes\nkeep me/);
});

test('replaceAcceptanceCriteria appends a section when none exists', () => {
  const out = replaceAcceptanceCriteria({ type: 'doc', version: 1, content: [p('story')] }, ['a'], 'n');
  assert.match(adfToText(out), /story[\s\S]*### Acceptance criteria\n- a/);
  assert.match(adfToText(replaceAcceptanceCriteria(null, ['a'], 'n')), /Acceptance criteria/);
});

test('gapIssueAdf links the spec and quotes the requirement', () => {
  const t = adfToText(gapIssueAdf({ pageUrl: 'https://s/wiki/spaces/A/pages/9/T', pageTitle: 'T', reqId: 'GC-4', requirement: 'Do X', specQuote: 'The page offers X' }));
  assert.match(t, /pages\/9/);
  assert.match(t, /GC-4/);
  assert.match(t, /The page offers X/);
});

import { clipBytes, findAcceptanceCriteriaStart } from '../src/lib/text.js';

test('clipBytes caps by UTF-8 bytes without splitting characters', () => {
  const tr = 'ğüşıöç'.repeat(100); // 2 bytes per character
  const out = clipBytes(tr, 101);
  assert.ok(Buffer.byteLength(out, 'utf8') <= 101);
  assert.ok(!out.includes('\uFFFD'));
  assert.equal(clipBytes('abc', 10), 'abc');
});

test('acceptance criteria are found under a heading or a bold label, never under "Requirements"', () => {
  const bold = { type: 'paragraph', content: [{ type: 'text', text: 'Acceptance criteria:', marks: [{ type: 'strong' }] }] };
  const req = { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Technical requirements' }] };
  assert.equal(findAcceptanceCriteriaStart([p('story'), req, p('x'), bold, p('a')]), 3);
  assert.equal(findAcceptanceCriteriaStart([p('story'), req, p('x')]), -1);
});

test('replaceAcceptanceCriteria keeps a "Requirements" section and stops at the next label', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Requirements' }] },
      p('keep this'),
      { type: 'paragraph', content: [{ type: 'text', text: 'Acceptance criteria:', marks: [{ type: 'strong' }] }] },
      p('old criterion'),
      p('Notes:'),
      p('keep notes'),
    ],
  };
  const text = adfToText(replaceAcceptanceCriteria(adf, ['new'], 'note'));
  assert.match(text, /### Requirements\nkeep this/);
  assert.match(text, /Acceptance criteria:\n- new\nnote/);
  assert.doesNotMatch(text, /old criterion/);
  assert.match(text, /Notes:\nkeep notes/);
});
