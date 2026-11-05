/**
 * Rovo eylemleri. Ayni eylemler hem Rovo ajaninda hem de MCP sunucusunda (Claude Code,
 * Cursor gibi dis yapay zeka istemcileri icin) arac olarak sunulur.
 *
 * Forge eylem fonksiyonlari (payload, context) alir. payload eylem girdilerini icerir;
 * Jira icinden cagrildiginda payload.context.jira.issueKey de dolu olabilir.
 * Yetkilendirme icin girdilere degil, kullanicinin kendi yetkilerine (asUser) guveniyoruz.
 */
import { getSpecContext, runAnalysis, verifyChangeFor, getStatus, specCoverageFor, proposeFix, applyProposal, createGapItems } from '../lib/service';
import { getIssue } from '../lib/products';

/** Is anahtarini girdiden ya da Jira baglamindan alir, bicimini dogrular. */
function issueKeyFrom(payload) {
  const fromCtx = payload && payload.context && payload.context.jira && payload.context.jira.issueKey;
  const raw = (payload && payload.issueKey) || fromCtx || '';
  const key = String(raw).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) {
    throw new Error(`"${raw}" is not a valid Jira work item key (expected something like PROJ-123).`);
  }
  return key;
}

/** Eylem hatalarini ajanin anlayacagi bir metne cevirir. */
const wrap = (fn) => async (payload, context) => {
  try {
    return await fn(payload, context);
  } catch (e) {
    console.error(e);
    return { error: e.message || String(e) };
  }
};

/** Kodlamaya baslamadan once: isin gereksinimleri, spesifikasyon metni ve son analiz. */
export const getSpecContextAction = wrap(async (payload) => getSpecContext(issueKeyFrom(payload), 'user'));

/** Spesifikasyon ile Jira isini yeniden karsilastirir. */
export const checkAlignmentAction = wrap(async (payload, context) => {
  const accountId = context && (context.accountId || (context.principal && context.principal.accountId));
  // Kullanici yetkisiyle oku; kimlik biliniyorsa saatlik kontrol icin kaydedilir
  const r = await runAnalysis(issueKeyFrom(payload), accountId ? { accountId } : 'user');
  if (r.noSpec) return { issueKey: r.issueKey, message: 'No Confluence specification page is linked to this work item.' };
  return r;
});

/** Kodlamadan sonra: degisiklik ozetini (ya da diff'i) spesifikasyona gore denetler. */
export const verifyChangeAction = wrap(async (payload) => {
  const change = String(payload.change || '').trim();
  if (!change) throw new Error('Provide "change": a summary or diff of what was implemented.');
  return verifyChangeFor(issueKeyFrom(payload), change, 'user');
});

/** Hizli durum: son analiz ve o zamandan beri spesifikasyon degisti mi. */
export const getAlignmentStatusAction = wrap(async (payload) => getStatus(issueKeyFrom(payload), 'user'));

/** Spesifikasyon kapsama haritasi: her gereksinim hangi islerde, hangileri hic karsilanmiyor. */
export const getSpecCoverageAction = wrap(async (payload, context) => {
  // Eylemi cagiran kullanici: Rovo ve MCP baglamlari farkli alanlarda tasiyabilir
  const accountId =
    (context && (context.accountId || (context.principal && context.principal.accountId))) ||
    (payload && payload.context && payload.context.accountId);
  return specCoverageFor(payload.spec || (payload.context && payload.context.confluence && payload.context.confluence.contentId), accountId);
});

/** Isin kabul kriterlerini spesifikasyona gore duzeltir (Rovo bu eylemden once kullanicidan onay ister). */
export const alignWorkItemAction = wrap(async (payload) => {
  const key = issueKeyFrom(payload);
  const proposal = await proposeFix(key, 'user');
  return applyProposal(key, proposal, 'user');
});

/** Kapsama haritasindaki bosluklar icin Jira isleri olusturur. */
export const createGapItemsAction = wrap(async (payload) => {
  const raw = String(payload.spec || '').trim();
  let pageId = (raw.match(/pages\/(\d+)/) || raw.match(/pageId=(\d+)/) || raw.match(/^(\d+)$/) || [])[1];
  if (!pageId && /^[A-Za-z][A-Za-z0-9_]+-\d+$/.test(raw)) pageId = (await getIssue(raw.toUpperCase(), 'user')).linkedPageIds[0];
  if (!pageId) throw new Error('Give a Confluence page URL or ID, or a Jira work item key that links the spec.');
  const ids = String(payload.requirementIds || '')
    .split(/[,\s]+/)
    .filter(Boolean);
  return createGapItems(pageId, ids.length ? ids : null, 'user');
});
