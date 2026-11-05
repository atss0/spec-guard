/**
 * Jira ve Confluence REST API cagrilari.
 *
 * Her fonksiyon bir "as" parametresi alir:
 *   'user' -> api.asUser(): istegi yapan kullanicinin yetkileriyle (tercih edilen; kullanici
 *             goremeyecegi veriyi uygulama da gosteremez)
 *   'app'  -> api.asApp(): uygulamanin kendi bot kullanicisiyla (kullanici baglami olmayan
 *             yerlerde, ornegin Confluence tetikleyicisinde)
 */
import api, { route } from '@forge/api';
import { adfToText, storageToText, findConfluencePageIds } from './text';

/**
 * as: 'user' (canli kullanici), 'app' (uygulama botu) ya da { accountId } (arka plan isinde
 * isi baslatan kullanicinin yetkileriyle; manifestte allowImpersonation gerektirir).
 */
const client = (as) => {
  if (as && typeof as === 'object' && as.accountId) return api.asUser(as.accountId);
  return as === 'app' ? api.asApp() : api.asUser();
};

/** Yanit basarisizsa anlasilir bir hata firlatir. */
async function json(res, what) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${what} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Bir Jira isini ozet, aciklama ve uzak baglantilariyla getirir.
 * @returns {{key, summary, description, status, updated, url, linkedPageIds: string[]}}
 */
export async function getIssue(issueKey, as = 'user') {
  const c = client(as);
  const issue = await json(
    await c.requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,status,updated,issuetype,project`),
    `Reading issue ${issueKey}`
  );
  const description = adfToText(issue.fields.description);

  // Uzak baglantilar: Jira'da "Confluence sayfasini bagla" ile eklenen linkler burada durur
  let remoteLinks = [];
  try {
    remoteLinks = await json(
      await c.requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`),
      `Reading remote links of ${issueKey}`
    );
  } catch (e) {
    console.warn('remote links unavailable', e.message);
  }
  const linkText = remoteLinks.map((l) => (l.object && l.object.url) || '').join(' ');
  // Confluence uygulama baglantilari URL'de pageId tasir; bazilari globalId'de tasir
  const globalIds = remoteLinks
    .map((l) => l.globalId || '')
    .map((g) => (g.match(/pageId=(\d+)/) || [])[1])
    .filter(Boolean);

  const linkedPageIds = [...new Set([...findConfluencePageIds(description), ...findConfluencePageIds(linkText), ...globalIds])];

  return {
    key: issue.key,
    summary: issue.fields.summary,
    description,
    status: issue.fields.status && issue.fields.status.name,
    type: issue.fields.issuetype && issue.fields.issuetype.name,
    updated: issue.fields.updated,
    linkedPageIds,
    projectKey: issue.fields.project && issue.fields.project.key,
    issueTypeId: issue.fields.issuetype && issue.fields.issuetype.id,
    // Ham ADF: aciklamayi guncellerken mevcut yapiyi korumak icin
    descriptionAdf: issue.fields.description || null,
  };
}

/**
 * Bir Confluence sayfasini duz metin govdesi ve surum bilgisiyle getirir.
 * @returns {{id, title, version, versionAt, text, url}}
 */
export async function getPage(pageId, as = 'user') {
  const c = client(as);
  const page = await json(
    await c.requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`),
    `Reading Confluence page ${pageId}`
  );
  const html = (page.body && page.body.storage && page.body.storage.value) || '';
  return {
    id: String(page.id),
    title: page.title,
    version: page.version ? page.version.number : 0,
    versionAt: page.version ? page.version.createdAt : null,
    text: storageToText(html),
    // _links.webui goreli bir yoldur ("/spaces/.../pages/..."); base ile birlestirilir
    url: page._links && page._links.base && page._links.webui ? page._links.base + page._links.webui : null,
  };
}

/** Bir Jira isine yorum ekler (duz metin, ADF paragraflari olarak). */
export async function addComment(issueKey, text, as = 'app') {
  const paragraphs = text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }));
  return json(
    await client(as).requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: { type: 'doc', version: 1, content: paragraphs } }),
    }),
    `Commenting on ${issueKey}`
  );
}

/**
 * Verilen is anahtarlarindan kullanicinin gorebildiklerini (anahtar, ozet, durum) dondurur.
 * Gorunurluk kontrolu kullanicinin kendi JQL aramasiyla yapilir.
 */
export async function visibleIssueKeys(keys, as = 'user') {
  const out = [];
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50).filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k));
    if (!chunk.length) continue;
    const res = await client(as).requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql: `key in (${chunk.join(',')})`, fields: ['summary', 'status'], maxResults: 50 }),
    });
    if (!res.ok) {
      console.warn('visibility search failed', res.status, (await res.text()).slice(0, 200));
      continue;
    }
    const data = await res.json();
    for (const it of data.issues || []) out.push({ key: it.key, summary: it.fields.summary, status: it.fields.status && it.fields.status.name });
  }
  return out;
}

/** Kullanici bu Confluence sayfasini okuyabiliyor mu? (govde istemeden, hafif kontrol) */
export async function canReadPage(pageId, as = 'user') {
  try {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    return res.ok;
  } catch (e) {
    return false;
  }
}

/** Sayfanin guncel surum numarasi (govde istemeden). Okunamazsa null. */
export async function pageVersion(pageId, as = 'user') {
  try {
    const res = await client(as).requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    if (!res.ok) return null;
    const p = await res.json();
    return p.version ? p.version.number : null;
  } catch (e) {
    return null;
  }
}

/** Bir isin aciklamasini (ADF) degistirir. Kullanici onayindan sonra, kullanici yetkisiyle cagrilir. */
export async function updateDescription(issueKey, adf, as = 'user') {
  const res = await client(as).requestJira(route`/rest/api/3/issue/${issueKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fields: { description: adf } }),
  });
  if (!res.ok) throw new Error(`Updating ${issueKey} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/** Yeni bir Jira isi olusturur; olusan isin anahtarini dondurur. */
export async function createIssue({ projectKey, issueTypeId, summary, description }, as = 'user') {
  const created = await json(
    await client(as).requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields: { project: { key: projectKey }, issuetype: { id: issueTypeId }, summary: summary.slice(0, 250), description } }),
    }),
    `Creating a work item in ${projectKey}`
  );
  return created.key;
}
