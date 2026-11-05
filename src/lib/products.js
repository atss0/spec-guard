/**
 * Jira and Confluence REST calls.
 *
 * Every function takes an `as` argument that decides whose permissions the request uses:
 *   'user'        the user who is using the app right now (preferred; the app never shows data
 *                 the user could not see themselves)
 *   'app'         the app's own bot user (only for writing app comments and properties)
 *   {accountId}   a specific user, for background jobs (offline impersonation; the scopes must
 *                 allow it in manifest.yml)
 */
import api, { route } from '@forge/api';
import { adfToText, storageToText, findConfluencePageIds } from './text.js';

const client = (as) => {
  if (as && typeof as === 'object' && as.accountId) return api.asUser(as.accountId);
  return as === 'app' ? api.asApp() : api.asUser();
};

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

/** Throws a readable error (with the HTTP status attached) when a request fails. */
async function json(res, what) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${what} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text(); // some endpoints (e.g. issue properties) answer with an empty body
  return text ? JSON.parse(text) : null;
}

/** Confluence page ids referenced by an issue's description (ADF) and remote links. */
function linkedPagesFrom(descriptionText, remoteLinks) {
  const linkText = remoteLinks.map((l) => (l.object && l.object.url) || '').join(' ');
  const fromGlobalId = remoteLinks.map((l) => ((l.globalId || '').match(/pageId=(\d+)/) || [])[1]).filter(Boolean);
  return [...new Set([...findConfluencePageIds(descriptionText), ...findConfluencePageIds(linkText), ...fromGlobalId])];
}

/** A Jira work item with its description as text and the Confluence pages it links. */
export async function getIssue(issueKey, as = 'user') {
  const c = client(as);
  const issue = await json(
    await c.requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,status,updated,issuetype,project`),
    `Reading issue ${issueKey}`
  );
  const description = adfToText(issue.fields.description);
  let remoteLinks = [];
  try {
    remoteLinks = await json(await c.requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`), `Reading remote links of ${issueKey}`);
  } catch (e) {
    console.warn('remote links unavailable', e.message);
  }
  return {
    key: issue.key,
    summary: issue.fields.summary,
    description,
    status: issue.fields.status && issue.fields.status.name,
    type: issue.fields.issuetype && issue.fields.issuetype.name,
    updated: issue.fields.updated,
    linkedPageIds: linkedPagesFrom(description, remoteLinks),
    projectKey: issue.fields.project && issue.fields.project.key,
    issueTypeId: issue.fields.issuetype && issue.fields.issuetype.id,
    descriptionAdf: issue.fields.description || null, // kept so updates can preserve the structure
  };
}

/** A Confluence page with its body as plain text and its version. */
export async function getPage(pageId, as = 'user') {
  const page = await json(await client(as).requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`), `Reading Confluence page ${pageId}`);
  const html = (page.body && page.body.storage && page.body.storage.value) || '';
  return {
    id: String(page.id),
    title: page.title,
    version: page.version ? page.version.number : 0,
    versionAt: page.version ? page.version.createdAt : null,
    text: storageToText(html),
    url: page._links && page._links.base && page._links.webui ? page._links.base + page._links.webui : null,
  };
}

/** Whether `as` can read the page (no body requested). */
export async function canReadPage(pageId, as = 'user') {
  try {
    return (await client(as).requestConfluence(route`/wiki/api/v2/pages/${pageId}`)).ok;
  } catch (e) {
    return false;
  }
}

/** True if the user may edit the work item. */
export async function canEditIssue(issueKey, as = 'user') {
  try {
    const r = await json(await client(as).requestJira(route`/rest/api/3/mypermissions?issueKey=${issueKey}&permissions=EDIT_ISSUES`), 'Checking permissions');
    return Boolean(r && r.permissions && r.permissions.EDIT_ISSUES && r.permissions.EDIT_ISSUES.havePermission);
  } catch (e) {
    return false;
  }
}

/** Current version number of a page, or null if it cannot be read. */
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

/** Adds a plain-text comment (one paragraph per line). */
export async function addComment(issueKey, text, as = 'app') {
  const content = text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }));
  return json(
    await client(as).requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: { type: 'doc', version: 1, content } }),
    }),
    `Commenting on ${issueKey}`
  );
}

/** Runs a JQL search and returns the raw issues (up to `max`). */
export async function searchIssues(jql, fields, max = 100, as = 'user') {
  const out = [];
  let nextPageToken;
  do {
    const res = await client(as).requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jql, fields, maxResults: Math.min(100, max - out.length), nextPageToken }),
    });
    const data = await json(res, 'Searching work items');
    out.push(...(data.issues || []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken && out.length < max);
  return out;
}

/** The subset of `keys` that `as` can see, with summary and status. */
export async function visibleIssueKeys(keys, as = 'user') {
  const valid = keys.filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k));
  const out = [];
  for (let i = 0; i < valid.length; i += 50) {
    try {
      const issues = await searchIssues(`key in (${valid.slice(i, i + 50).join(',')})`, ['summary', 'status'], 50, as);
      for (const it of issues) out.push({ key: it.key, summary: it.fields.summary, status: it.fields.status && it.fields.status.name });
    } catch (e) {
      console.warn('visibility search failed', e.message);
    }
  }
  return out;
}

/**
 * Finds work items that link a Confluence page in their description, by scanning recently updated
 * work items in the given projects. Jira does not index link URLs for text search, so this is a
 * bounded scan (newest first).
 */
export async function findItemsLinkingPage(pageId, projectKeys, as = 'user', max = 300) {
  if (!projectKeys.length) return [];
  const jql = `project in (${projectKeys.map((k) => `"${k}"`).join(',')}) AND updated >= -180d ORDER BY updated DESC`;
  const issues = await searchIssues(jql, ['summary', 'description'], max, as);
  return issues.filter((it) => findConfluencePageIds(adfToText(it.fields.description)).includes(String(pageId))).map((it) => it.key);
}

/** Replaces a work item's description (ADF). */
export async function updateDescription(issueKey, adf, as = 'user') {
  await json(
    await client(as).requestJira(route`/rest/api/3/issue/${issueKey}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ fields: { description: adf } }) }),
    `Updating ${issueKey}`
  );
}

/** Creates a work item and returns its key. */
export async function createIssue({ projectKey, issueTypeId, summary, description }, as = 'user') {
  const created = await json(
    await client(as).requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ fields: { project: { key: projectKey }, issuetype: { id: issueTypeId }, summary: summary.slice(0, 250), description } }),
    }),
    `Creating a work item in ${projectKey}`
  );
  return created.key;
}

/**
 * Stores Spec Guard's alignment summary as an issue property. The property is indexed by the
 * jira:entityProperty module, so it can be used in JQL, e.g. `specGuardConflicts > 0`.
 */
export async function setAlignmentProperty(issueKey, value) {
  await json(
    await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/specguard`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(value) }),
    `Saving alignment property on ${issueKey}`
  );
}
