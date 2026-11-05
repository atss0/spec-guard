/**
 * Metin yardimcilari: Jira'nin ADF (Atlassian Document Format) icerigini ve
 * Confluence'in "storage" (XHTML) govdesini duz metne cevirir; Confluence
 * sayfa baglantilarini bulur.
 *
 * Neden duz metin? Yapay zeka modeline gondermek icin hem kisa hem de
 * yapisi (basliklar, liste maddeleri) korunmus bir metin istiyoruz.
 */

/**
 * ADF agacini dolasip duz metin uretir.
 * Paragraflar ve liste maddeleri ayri satirlara yazilir, basliklar "#" ile isaretlenir.
 * @param {object} node ADF dugumu (genellikle issue.fields.description)
 * @returns {string}
 */
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
        // Akilli baglanti kartlari: URL'yi metne yaziyoruz ki baglanti tespiti calissin
        if (n.attrs && n.attrs.url) out.push(` ${n.attrs.url} `);
        return;
      case 'mention':
        out.push(n.attrs && n.attrs.text ? n.attrs.text : '@someone');
        return;
      case 'heading': {
        const level = (n.attrs && n.attrs.level) || 1;
        out.push('\n' + '#'.repeat(level) + ' ');
        (n.content || []).forEach((c) => walk(c));
        out.push('\n');
        return;
      }
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
        // Diger dugumlerde (tablo, panel, alinti vb.) cocuklari dolasmak yeterli.
        // Bazi dugumler metni attrs.text icinde tasir (ornegin emoji).
        if (n.attrs && typeof n.attrs.text === 'string' && !n.content) out.push(n.attrs.text);
        (n.content || []).forEach((c) => walk(c, prefix));
        if (n.type === 'tableRow' || n.type === 'tableCell' || n.type === 'tableHeader') out.push(n.type === 'tableRow' ? '\n' : ' | ');
    }
  };
  walk(node);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** HTML varliklarini (&amp; gibi) cozer. */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * Confluence "storage" formatini (XHTML benzeri) duz metne cevirir.
 * Basliklar "#", liste maddeleri "- " ve tablo hucreleri " | " ile korunur.
 * @param {string} html
 * @returns {string}
 */
export function storageToText(html) {
  if (!html) return '';
  let s = html;
  // Makro parametreleri gibi gorunmeyen icerigi at
  s = s.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/g, '');
  // Basliklar
  s = s.replace(/<h([1-6])[^>]*>/g, (_, l) => '\n' + '#'.repeat(Number(l)) + ' ');
  s = s.replace(/<\/h[1-6]>/g, '\n');
  // Liste maddeleri ve gorev listeleri
  s = s.replace(/<li[^>]*>/g, '\n- ');
  s = s.replace(/<ac:task-body[^>]*>/g, '\n- [ ] ');
  // Tablo
  s = s.replace(/<\/tr>/g, '\n');
  s = s.replace(/<t[dh][^>]*>/g, ' | ');
  // Paragraf ve satir sonlari
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<\/p>/g, '\n');
  // Kalan etiketleri sil
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * Bir metindeki Confluence sayfa kimliklerini bulur.
 * Desteklenen bicimler:
 *   https://site.atlassian.net/wiki/spaces/KEY/pages/123456/Baslik
 *   https://site.atlassian.net/wiki/pages/viewpage.action?pageId=123456
 *   https://site.atlassian.net/wiki/x/AbCd  (kisa link; cozumlenemez, atlanir)
 * @param {string} text
 * @returns {string[]} benzersiz sayfa kimlikleri
 */
export function findConfluencePageIds(text) {
  if (!text) return [];
  const ids = new Set();
  const re1 = /\/wiki\/spaces\/[^/\s]+\/pages\/(\d+)/g;
  const re2 = /[?&]pageId=(\d+)/g;
  let m;
  while ((m = re1.exec(text))) ids.add(m[1]);
  while ((m = re2.exec(text))) ids.add(m[1]);
  return [...ids];
}

/**
 * Modele gondermeden once cok uzun metinleri kisaltir (karakter bazinda).
 * Sonuna kisaltildigini belirten bir not ekler ki model bunu bilsin.
 */
export function clip(text, max) {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max) + `\n[... ${text.length - max} characters truncated ...]`;
}

// ---------- ADF uretimi (Jira aciklamalari) ----------

const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const bulletList = (items) => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [para(t)] })),
});
const heading = (text, level = 3) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });

/** Bir ADF dugumunun duz metni (baslik eslestirmek icin). */
function nodeText(n) {
  if (!n) return '';
  if (n.type === 'text') return n.text || '';
  return (n.content || []).map(nodeText).join('');
}

const AC_RE = /acceptance criteria|kabul kriter|definition of done|requirements/i;

/**
 * Aciklamadaki "Acceptance criteria" bolumunu (baslik + ardindan gelen listeler/paragraflar,
 * bir sonraki basliga kadar) yeni maddelerle degistirir. Bolum yoksa sona ekler.
 * Aciklamanin geri kalani (spesifikasyon linki, kullanici hikayesi vb.) aynen korunur.
 * @param {object|null} adf mevcut aciklama
 * @param {string[]} items yeni kabul kriterleri
 * @param {string} note kucuk not satiri (ne zaman, hangi spesifikasyona gore guncellendi)
 */
export function replaceAcceptanceCriteria(adf, items, note) {
  const content = adf && Array.isArray(adf.content) ? [...adf.content] : [];
  const start = content.findIndex((n) => n.type === 'heading' && AC_RE.test(nodeText(n)));
  const newSection = [bulletList(items), para(note)];
  if (start === -1) {
    return { type: 'doc', version: 1, content: [...content, heading('Acceptance criteria'), ...newSection] };
  }
  let end = start + 1;
  while (end < content.length && content[end].type !== 'heading') end++;
  return { type: 'doc', version: 1, content: [...content.slice(0, start + 1), ...newSection, ...content.slice(end)] };
}

/** Kapsama boslugu icin yeni is aciklamasi: spesifikasyon linki, alinti ve kabul kriteri. */
export function gapIssueAdf({ pageUrl, pageTitle, reqId, requirement, specQuote }) {
  const linkPara = pageUrl
    ? { type: 'paragraph', content: [{ type: 'text', text: 'Spec: ' }, { type: 'inlineCard', attrs: { url: pageUrl } }] }
    : para(`Spec: ${pageTitle}`);
  return {
    type: 'doc',
    version: 1,
    content: [
      linkPara,
      para(`This work item was created by Spec Guard because requirement ${reqId} of "${pageTitle}" was not covered by any work item.`),
      { type: 'blockquote', content: [para(specQuote || requirement)] },
      heading('Acceptance criteria'),
      bulletList([requirement]),
    ],
  };
}
