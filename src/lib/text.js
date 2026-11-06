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

// Confluence storage format writes most non-ASCII letters as named entities (&uuml;, &ccedil;, ...).
// Latin-1 names map to code points 160-255 in this order.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ');
const NAMED = Object.fromEntries(LATIN1.map((n, i) => [n, String.fromCharCode(160 + i)]));
Object.assign(NAMED, {
  nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&',
  lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"', ndash: '-', mdash: '-',
  hellip: '...', bull: '•', euro: '€', trade: '™', rarr: '→', larr: '←', harr: '↔', le: '≤', ge: '≥', ne: '≠',
  OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', circ: 'ˆ', tilde: '˜', zwj: '', zwnj: '', thinsp: ' ', ensp: ' ', emsp: ' ',
});

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      if (code === 39) return "'";
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}

/** Plain text of Confluence storage format (XHTML). */
export function storageToText(html) {
  if (!html) return '';
  let s = html;
  // Code blocks keep their text; escape it so the tag stripping below does not eat it.
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => '\n' + c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n');
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

/** True if an acceptance-criteria label appears anywhere below the top level of the document. */
export function hasNestedAcceptanceCriteria(content) {
  const walk = (nodes, depth) =>
    (nodes || []).some((n) => (depth > 0 && (n.type === 'heading' || n.type === 'paragraph') && AC_TITLE.test(nodeText(n))) || walk(n.content, depth + 1));
  return walk(content, 0);
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
  if (start === -1) {
    // A label inside a panel, expand or table cannot be replaced safely; appending would leave two
    // conflicting sections, so refuse instead.
    if (hasNestedAcceptanceCriteria(content)) {
      throw new Error('The acceptance criteria are inside a panel, expand or table. Move them to the top level of the description, or apply the proposed changes by hand.');
    }
    return { type: 'doc', version: 1, content: [...content, heading('Acceptance criteria'), ...section] };
  }
  // Replace only what belongs to the criteria: the lists directly under the label, empty paragraphs
  // and an earlier Spec Guard note. The first other node (text, a link card, a panel, a heading, ...)
  // ends the section, so nothing else in the description is removed.
  let end = start + 1;
  const LISTS = ['bulletList', 'orderedList', 'taskList'];
  const isOurNote = (n) => n.type === 'paragraph' && /^Aligned with .* by Spec Guard on \d{4}-\d{2}-\d{2}\.?$/.test(nodeText(n).trim());
  const isEmpty = (n) => n.type === 'paragraph' && !nodeText(n).trim() && !(n.content || []).some((c) => c.type !== 'text' && c.type !== 'hardBreak');
  if (end < content.length && LISTS.includes(content[end].type)) {
    while (end < content.length && (LISTS.includes(content[end].type) || isOurNote(content[end]) || isEmpty(content[end]))) end++;
  } else {
    // Criteria written as plain paragraphs: take plain-text paragraphs up to the next label
    // ("Notes:"), heading or any other kind of node.
    const plain = (n) => n.type === 'paragraph' && !(n.content || []).some((c) => c.type !== 'text' && c.type !== 'hardBreak');
    const isLabel = (n) => n.type === 'paragraph' && /^\s*\S[^.]{0,40}:\s*$/.test(nodeText(n));
    while (end < content.length && plain(content[end]) && !isLabel(content[end])) end++;
  }
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
