/**
 * "Try with demo data": bos bir sitede Spec Guard'i birkac saniyede denemek icin
 * bilerek sapma iceren hazir bir senaryo olusturur (Confluence spesifikasyonu + 3 Jira isi).
 * Tum istekler kullanicinin kendi yetkisiyle (asUser) yapilir.
 */
import api, { route } from '@forge/api';

const P = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const H = (text) => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] });
const L = (items) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [P(t)] })) });

const SPEC_HTML = `<p>Users who forget their password must be able to regain access to their account securely without contacting support.</p>
<h2>Functional requirements</h2><ul>
<li><strong>FR-1 Request reset:</strong> The login page shows a "Forgot password?" link. The user enters their email address and receives a reset link by email only. SMS is out of scope for this release.</li>
<li><strong>FR-2 Neutral response:</strong> The confirmation message must be identical whether or not the email exists ("If an account exists, we sent you a link") to prevent account enumeration.</li>
<li><strong>FR-3 Link validity:</strong> The reset link is single-use and expires <strong>24 hours</strong> after it is sent.</li>
<li><strong>FR-4 Password rules:</strong> The new password must have at least <strong>12 characters</strong> and must not match any of the last 5 passwords.</li>
<li><strong>FR-5 Sessions:</strong> After a successful reset, all other active sessions of the user are signed out.</li>
<li><strong>FR-6 Notification:</strong> A confirmation email "Your password was changed" is sent after the reset.</li></ul>
<h2>Security requirements</h2><ul>
<li><strong>SR-1 Rate limiting:</strong> At most <strong>3 reset requests per email per hour</strong>; further requests are silently ignored.</li>
<li><strong>SR-2 Lockout:</strong> After <strong>5 failed login attempts</strong> the account is locked for 15 minutes.</li>
<li><strong>SR-3 Token storage:</strong> Reset tokens are stored hashed (SHA-256), never in plain text.</li></ul>
<h2>Analytics</h2><ul><li><strong>AN-1:</strong> Track the events reset_requested, reset_completed and reset_link_expired.</li></ul>
<h2>Out of scope</h2><ul><li>SMS or authenticator-app based recovery.</li><li>Security questions.</li></ul>`;

const ISSUES = [
  {
    summary: 'Implement password reset flow',
    story: 'As a user who forgot my password, I want to reset it myself.',
    ac: [
      'Login page has a "Forgot password?" link.',
      'User enters email or phone number and receives the reset link by email or SMS.',
      'If the email is not registered, show "No account found for this email".',
      'Reset link is valid for 48 hours and can be used once.',
      'New password must be at least 8 characters.',
      'Send a "Your password was changed" email after reset.',
    ],
  },
  {
    summary: 'Lock account after repeated failed logins',
    story: 'Protect accounts against brute-force attacks.',
    ac: ['After 5 failed login attempts the account is locked for 15 minutes.', 'Locked users see a message explaining when they can try again.'],
  },
  {
    summary: 'Track password reset analytics',
    story: 'Product wants to measure the reset funnel.',
    ac: ['Send reset_requested when a reset link is requested.', 'Send reset_completed when the password is changed.'],
  },
];

async function ok(res, what) {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Kullanicinin is olusturabildigi Jira projeleri ve Confluence alanlari (secim listeleri icin). */
export async function demoTargets() {
  const projects = await ok(
    await api.asUser().requestJira(route`/rest/api/3/project/search?action=create&maxResults=50&orderBy=name`),
    'Listing projects'
  );
  const spaces = await ok(await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?status=current&limit=100&sort=name`), 'Listing spaces');
  return {
    projects: (projects.values || []).map((p) => ({ key: p.key, name: p.name })),
    // Kisisel alanlar sona: takim alanlari once gelsin
    spaces: (spaces.results || [])
      .map((s) => ({ id: String(s.id), key: s.key, name: s.type === 'personal' ? `${s.name} (personal)` : s.name, personal: s.type === 'personal' }))
      .sort((a, b) => Number(a.personal) - Number(b.personal)),
  };
}

/** Projede kullanilabilecek alt gorev olmayan bir is turu: once Story, sonra Task, sonra ilki. */
async function pickIssueType(projectKey) {
  const meta = await ok(await api.asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`), 'Reading issue types');
  const types = (meta.issueTypes || meta.values || []).filter((t) => !t.subtask);
  const by = (re) => types.find((t) => re.test(t.name));
  const t = by(/story|hikaye/i) || by(/task|görev/i) || types[0];
  if (!t) throw new Error(`No usable work item type in ${projectKey}.`);
  return t.id;
}

/** Demo senaryosunu olusturur; olusan sayfa ve is anahtarlarini dondurur. */
export async function createDemo(projectKey, spaceId) {
  if (!projectKey || !spaceId) throw new Error('Choose a Jira space (project) and a Confluence space.');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const page = await ok(
    await api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        spaceId,
        status: 'current',
        title: `Password Reset — Product Requirements (Spec Guard demo ${stamp})`,
        body: { representation: 'storage', value: SPEC_HTML },
      }),
    }),
    'Creating the demo spec page'
  );
  const url = page._links && page._links.base ? page._links.base + page._links.webui : null;
  const issueTypeId = await pickIssueType(projectKey);
  const keys = [];
  for (const it of ISSUES) {
    const description = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Spec: ' }, url ? { type: 'inlineCard', attrs: { url } } : { type: 'text', text: page.title }] },
        P(it.story),
        H('Acceptance criteria'),
        L(it.ac),
      ],
    };
    const created = await ok(
      await api.asUser().requestJira(route`/rest/api/3/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ fields: { project: { key: projectKey }, issuetype: { id: issueTypeId }, summary: it.summary, description } }),
      }),
      `Creating "${it.summary}"`
    );
    keys.push(created.key);
  }
  return { pageId: String(page.id), pageTitle: page.title, pageUrl: url, keys };
}
