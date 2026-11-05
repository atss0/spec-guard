/**
 * Text helpers: converts Jira ADF and Confluence storage format to plain text (keeping headings,
 * list items and table cells), finds Confluence page links, and builds ADF for descriptions that
 * Spec Guard writes.
 */

/** Plain text of an ADF document. Headings become "#", list items "- ", smart links their URL. */
export function adfToText(node) {
  if (!node) return '';
  const out = [];
  const walk = (n, prefix = '') => {
    if (!n) return;
    switch (n.type) {
      case 'text':
        out.push(n.text || '');
        return;
      case 'hardBreak':
        out.push('\n');
        return;
      case 'inlineCard':
      case 'blockCard':
      case 'embedCard':
        if (n.attrs && n.attrs.url) out.push(` ${n.attrs.url} `); // keep the URL so links can be found
        return;
      case 'mention':
        out.push(n.attrs && n.attrs.text ? n.attrs.text : '@someone');
        return;
      case 'heading':
        out.push('\n' + '#'.repeat((n.attrs && n.attrs.level) || 1) + ' ');
        (n.content || []).forEach((c) => walk(c));
        out.push('\n');
        return;
      case 'paragraph':
        out.push(prefix);
        (n.content || []).forEach((c) => walk(c));
        out.push('\n');
        return;
      case 'listItem':
        (n.content || []).forEach((c) => walk(c, prefix || '- '));
        return;
      case 'bulletList':
      case 'orderedList':
        (n.content || []).forEach((c) => walk(c, '- '));
        return;
      default:
        if (n.attrs && typeof n.attrs.text === 'string' && !n.content) out.push(n.attrs.text);
        (n.content || []).forEach((c) => walk(c, prefix));
        if (n.type === 'tableRow') out.push('\n');
        else if (n.type === 'tableCell' || n.type === 'tableHeader') out.push(' | ');
    }
  };
  walk(node);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[lr]squo;/g, "'")
    .replace(/&[lr]dquo;/g, '"')
    .replace(/&[nm]dash;/g, '-')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Plain text of Confluence storage format (XHTML). */
export function storageToText(html) {
  if (!html) return '';
  let s = html;
  s = s.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/g, ''); // macro parameters are not content
  s = s.replace(/<h([1-6])[^>]*>/g, (_, l) => '\n' + '#'.repeat(Number(l)) + ' ');
  s = s.replace(/<\/h[1-6]>/g, '\n');
  s = s.replace(/<li[^>]*>/g, '\n- ');
  s = s.replace(/<ac:task-body[^>]*>/g, '\n- [ ] ');
  s = s.replace(/<\/tr>/g, '\n');
  s = s.replace(/<t[dh][^>]*>/g, ' | ');
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<\/p>/g, '\n');
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * Confluence page ids in a text. Supports /wiki/spaces/KEY/pages/<id>/... and ?pageId=<id>.
 * Short links (/wiki/x/...) cannot be resolved offline and are ignored.
 */
export function findConfluencePageIds(text) {
  if (!text) return [];
  const ids = new Set();
  for (const re of [/\/wiki\/spaces\/[^/\s]+\/pages\/(\d+)/g, /[?&]pageId=(\d+)/g]) {
    let m;
    while ((m = re.exec(text))) ids.add(m[1]);
  }
  return [...ids];
}

/** Cuts a string so that its UTF-8 encoding fits into maxBytes (Forge KVS limits are in bytes). */
export function clipBytes(text, maxBytes) {
  const buf = Buffer.from(text || '', 'utf8');
  if (buf.length <= maxBytes) return text || '';
  return buf.subarray(0, maxBytes).toString('utf8').replace(/�+$/, '');
}

/** Shortens text to max characters and says so, so the model knows it is incomplete. */
export function clip(text, max) {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max) + `\n[... ${text.length - max} characters truncated ...]`;
}

// ---------- ADF for descriptions written by Spec Guard ----------

const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const bulletList = (items) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [para(t)] })) });
const heading = (text, level = 3) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });

function nodeText(n) {
  if (!n) return '';
  if (n.type === 'text') return n.text || '';
  return (n.content || []).map(nodeText).join('');
}

// Section titles that introduce acceptance criteria. Deliberately narrow: "Requirements" or
// "Technical notes" sections are never replaced.
const AC_TITLE = /^\s*(acceptance criteria|acceptance criterion|ac|definition of done|kabul kriterleri)\s*:?\s*$/i;

/**
 * Index of the node that starts the acceptance-criteria section: a heading, or a short paragraph
 * that only contains the label (often written in bold, e.g. "**Acceptance criteria:**").
 */
export function findAcceptanceCriteriaStart(content) {
  return content.findIndex((n) => (n.type === 'heading' || n.type === 'paragraph') && AC_TITLE.test(nodeText(n)));
}

/**
 * Replaces the acceptance-criteria section (from its label up to the next heading or label-like
 * paragraph) with new bullet points. Appends a section if none exists. Everything else in the
 * description (spec link, user story, other sections) is kept unchanged.
 */
export function replaceAcceptanceCriteria(adf, items, note) {
  const content = adf && Array.isArray(adf.content) ? [...adf.content] : [];
  const start = findAcceptanceCriteriaStart(content);
  const section = [bulletList(items), para(note)];
  if (start === -1) return { type: 'doc', version: 1, content: [...content, heading('Acceptance criteria'), ...section] };
  let end = start + 1;
  const isNextSection = (n) => n.type === 'heading' || (n.type === 'paragraph' && /^\s*\S[^.]{0,40}:\s*$/.test(nodeText(n)));
  while (end < content.length && !isNextSection(content[end])) end++;
  return { type: 'doc', version: 1, content: [...content.slice(0, start + 1), ...section, ...content.slice(end)] };
}

/** Description for a work item created for an uncovered requirement. */
export function gapIssueAdf({ pageUrl, pageTitle, reqId, requirement, specQuote }) {
  const linkPara = pageUrl
    ? { type: 'paragraph', content: [{ type: 'text', text: 'Spec: ' }, { type: 'inlineCard', attrs: { url: pageUrl } }] }
    : para(`Spec: ${pageTitle}`);
  return {
    type: 'doc',
    version: 1,
    content: [
      linkPara,
      para(`Created by Spec Guard: requirement ${reqId} of "${pageTitle}" was not covered by any work item.`),
      { type: 'blockquote', content: [para(specQuote || requirement)] },
      heading('Acceptance criteria'),
      bulletList([requirement]),
    ],
  };
}
