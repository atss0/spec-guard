/**
 * Spec Guard'in is mantigi: urun verisini toplar, yapay zekayi cagirir,
 * sonuclari Forge Key-Value Store'da (KVS) saklar.
 *
 * KVS anahtarlari:
 *   analysis:<ISSUE-KEY>  -> son analiz sonucu ve hangi sayfa surumlerine dayandigi
 *   snapshot:<pageId>     -> sayfanin en son gordugumuz metni (degisiklik farki cikarmak icin)
 *   watch:<pageId>        -> bu sayfaya bagli Jira isleri listesi (sayfa degisince kime haber verilecek)
 */
import { kvs, WhereConditions } from '@forge/kvs';
import { Queue } from '@forge/events';
import { getIssue, getPage, addComment, visibleIssueKeys, canReadPage, pageVersion, updateDescription, createIssue } from './products';
import { replaceAcceptanceCriteria, gapIssueAdf } from './text';
import { analyzeAlignment, verifyChange, summarizeSpecDiff, buildCoverageMap, proposeWorkItemFix } from './ai';

// Uzun suren yapay zeka isleri icin arka plan kuyrugu (normal fonksiyonlarin suresi kisa)
const queue = new Queue({ key: 'specguard-jobs' });

/**
 * Paneldeki "Check alignment" butonu: kullanicinin isi ve sayfalari okuyabildigini
 * kendi yetkisiyle dogrular, sonra analizi kuyruga atar. Sonuc KVS'ye yazilir; panel bekler.
 */
export async function requestAnalysis(issueKey, accountId) {
  const { pages } = await loadContext(issueKey, 'user'); // yetki kontrolu (okuyamazsa hata firlatir)
  if (pages.length === 0) return { queued: false, noSpec: true };
  await kvs.set(`job:${issueKey}`, { state: 'running', startedAt: new Date().toISOString() });
  await queue.push({ body: { type: 'analyze', issueKey, accountId } });
  return { queued: true };
}

/** Confluence tetikleyicisinden gelen sayfa degisikligini kuyruga atar. */
export async function enqueuePageUpdated(pageId, accountId) {
  await queue.push({ body: { type: 'pageUpdated', pageId: String(pageId), accountId } });
}

/**
 * Kuyruk tuketicisi. Isler, isi baslatan kullanicinin yetkileriyle calisir (offline impersonation);
 * kullanici bilgisi yoksa uygulama kimligine duser.
 */
export async function processJob(body) {
  const actor = body.accountId ? { accountId: body.accountId } : 'app';
  if (body.type === 'analyze') {
    try {
      await runAnalysis(body.issueKey, actor);
      await kvs.set(`job:${body.issueKey}`, { state: 'done', finishedAt: new Date().toISOString() });
    } catch (e) {
      console.error('analysis failed', e);
      await kvs.set(`job:${body.issueKey}`, { state: 'error', error: e.message || String(e), finishedAt: new Date().toISOString() });
    }
  } else if (body.type === 'coverage') {
    try {
      await runCoverage(body.pageId, actor);
      await kvs.set(`covjob:${body.pageId}`, { state: 'done', finishedAt: new Date().toISOString() });
    } catch (e) {
      console.error('coverage failed', e);
      await kvs.set(`covjob:${body.pageId}`, { state: 'error', error: e.message || String(e), finishedAt: new Date().toISOString() });
    }
  } else if (body.type === 'verify') {
    const key = `vjob:${body.issueKey}:${body.accountId || 'app'}`;
    try {
      const result = await verifyChangeFor(body.issueKey, body.change, actor);
      await kvs.set(key, { state: 'done', result, finishedAt: new Date().toISOString() });
    } catch (e) {
      console.error('verify failed', e);
      await kvs.set(key, { state: 'error', error: e.message || String(e), finishedAt: new Date().toISOString() });
    }
  } else if (body.type === 'fix') {
    const key = `fjob:${body.issueKey}:${body.accountId || 'app'}`;
    try {
      const proposal = await proposeFix(body.issueKey, actor);
      await kvs.set(key, { state: 'done', proposal, finishedAt: new Date().toISOString() });
    } catch (e) {
      console.error('fix proposal failed', e);
      await kvs.set(key, { state: 'error', error: e.message || String(e), finishedAt: new Date().toISOString() });
    }
  } else if (body.type === 'pageUpdated') {
    const r = await onPageUpdated(body.pageId, actor);
    console.log(`page ${body.pageId} updated; notified ${r.notified} work item(s)`);
  }
}

const SNAPSHOT_MAX = 100000; // KVS deger boyutu sinirinin altinda kalmak icin

/** Isi ve bagli spesifikasyon sayfalarini getirir. Okunamayan sayfalar "errors" listesine duser. */
export async function loadContext(issueKey, as = 'user') {
  const issue = await getIssue(issueKey, as);
  const pages = [];
  const errors = [];
  for (const id of issue.linkedPageIds.slice(0, 5)) {
    try {
      pages.push(await getPage(id, as));
    } catch (e) {
      errors.push({ pageId: id, message: e.status === 404 || e.status === 403 ? 'Page not found or no access' : e.message });
    }
  }
  return { issue, pages, errors };
}

/** Isin ozet + aciklamasindan kisa bir parmak izi (degisiklik tespiti icin). */
function hashIssue(issue) {
  const str = `${issue.summary}
${issue.description}`;
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
}

/** Isi, bagli oldugu sayfalarin izleme listesine ekler (kardes is tespiti ve bildirimler icin). */
async function registerLinks(issueKey, pageIds) {
  for (const id of pageIds) {
    const watchers = (await kvs.get(`watch:${id}`)) || [];
    if (!watchers.includes(issueKey)) await kvs.set(`watch:${id}`, [...watchers, issueKey].slice(-200));
  }
}

/** Ayni spesifikasyona bagli diger isler (en fazla 8): modele "kardes is" olarak verilir. */
async function loadSiblings(issueKey, pages, as) {
  const keys = new Set();
  for (const p of pages) for (const k of (await kvs.get(`watch:${p.id}`)) || []) if (k !== issueKey) keys.add(k);
  const out = [];
  for (const k of [...keys].slice(0, 8)) {
    try {
      const it = await getIssue(k, as);
      if (it.linkedPageIds.some((id) => pages.some((p) => p.id === id))) out.push({ key: it.key, summary: it.summary, description: it.description });
    } catch (e) {
      // silinmis ya da gorulemeyen is: atla
    }
  }
  return out;
}

const pageRef = (p) => ({ id: p.id, title: p.title, version: p.version, url: p.url });

/**
 * Kayitli analiz spesifikasyondan alintilar icerir. Kullanici analizin dayandigi sayfalardan
 * birini bile okuyamiyorsa (kisitli sayfa) analizi ona hic gostermeyiz.
 */
function readableAnalysis(saved, pages) {
  if (!saved) return null;
  const readable = new Set(pages.map((p) => p.id));
  return (saved.pages || []).every((p) => readable.has(p.id)) ? saved : null;
}

const JOB_TIMEOUT_MS = 10 * 60 * 1000;

/** Arka plan isi 10 dakikadan uzun suruyorsa (cokmus olabilir) hata olarak raporla. */
function normalizeJob(job) {
  if (job && job.state === 'running' && Date.now() - new Date(job.startedAt).getTime() > JOB_TIMEOUT_MS) {
    return { ...job, state: 'error', error: 'The analysis did not finish in time. Please try again.' };
  }
  return job;
}

/**
 * Kayitli analizi ve guncel olup olmadigini dondurur. Yapay zeka cagirmaz (hizli).
 * stale: analizden sonra spesifikasyon sayfasi ya da Jira isi degistiyse true.
 */
export async function getStatus(issueKey, as = 'user') {
  const { issue, pages, errors } = await loadContext(issueKey, as);
  await registerLinks(issueKey, pages.map((p) => p.id));
  const saved = readableAnalysis(await kvs.get(`analysis:${issueKey}`), pages);
  const job = normalizeJob((await kvs.get(`job:${issueKey}`)) || null);
  const reasons = [];
  if (saved) {
    for (const p of pages) {
      const old = saved.pages.find((x) => x.id === p.id);
      if (!old) reasons.push(`New spec page linked: "${p.title}"`);
      else if (old.version !== p.version) reasons.push(`"${p.title}" changed (v${old.version} → v${p.version})`);
    }
    // Sadece ozet/aciklama degistiyse "is duzenlendi" de (yorumlar ve alan degisiklikleri sayilmaz)
    if (saved.issueHash && saved.issueHash !== hashIssue(issue)) reasons.push('The work item description was edited');
  }
  return {
    issueKey,
    pages: pages.map(pageRef),
    errors,
    analysis: saved ? saved.result : null,
    analyzedAt: saved ? saved.analyzedAt : null,
    stale: Boolean(saved) && reasons.length > 0,
    staleReasons: reasons,
    pendingChanges: saved && saved.pendingChanges ? saved.pendingChanges : [],
    job,
  };
}

/** Analizi calistirir ve kaydeder; izleme listelerini ve sayfa anlik goruntulerini gunceller. */
export async function runAnalysis(issueKey, as = 'user') {
  const { issue, pages, errors } = await loadContext(issueKey, as);
  if (pages.length === 0) {
    return { issueKey, pages: [], errors, analysis: null, noSpec: true };
  }
  const siblings = await loadSiblings(issueKey, pages, as);
  const result = await analyzeAlignment(issue, pages, siblings);
  const record = {
    analyzedAt: new Date().toISOString(),
    issueHash: hashIssue(issue),
    pages: pages.map(pageRef),
    result,
    pendingChanges: [],
  };
  await kvs.set(`analysis:${issueKey}`, record);
  await registerLinks(issueKey, pages.map((p) => p.id));
  const accountId = as && typeof as === 'object' ? as.accountId : undefined;
  for (const p of pages) {
    const prev = (await kvs.get(`snapshot:${p.id}`)) || {};
    await kvs.set(`snapshot:${p.id}`, { version: p.version, title: p.title, text: p.text.slice(0, SNAPSHOT_MAX), accountId: accountId || prev.accountId });
  }
  return { issueKey, pages: pages.map(pageRef), errors, analysis: result, analyzedAt: record.analyzedAt, stale: false, staleReasons: [] };
}

/** Kodlama ajaninin onerdigi degisikligi spesifikasyona gore denetler. */
export async function verifyChangeFor(issueKey, change, as = 'user') {
  const { issue, pages, errors } = await loadContext(issueKey, as);
  if (pages.length === 0) {
    const summary = errors.length
      ? 'A specification page is linked but could not be read (deleted, or you have no access), so the change could not be checked.'
      : 'No specification page is linked to this work item, so the change could not be checked.';
    return { issueKey, verdict: 'warn', summary, findings: [], errors };
  }
  const siblings = await loadSiblings(issueKey, pages, as);
  const r = await verifyChange(issue, pages, change, siblings);
  return { issueKey, pages: pages.map(pageRef), ...r, errors };
}

/** Kodlama ajanlari icin: isin gereksinimlerini ve spesifikasyon metnini tek pakette verir. */
export async function getSpecContext(issueKey, as = 'user') {
  const { issue, pages, errors } = await loadContext(issueKey, as);
  const saved = readableAnalysis(await kvs.get(`analysis:${issueKey}`), pages);
  return {
    issue: { key: issue.key, summary: issue.summary, status: issue.status, type: issue.type, description: issue.description },
    specPages: pages.map((p) => ({ ...pageRef(p), text: p.text.slice(0, 30000) })),
    lastAnalysis: saved ? { analyzedAt: saved.analyzedAt, ...saved.result } : null,
    guidance:
      pages.length === 0
        ? errors.length
          ? 'A specification page is linked but could not be read (deleted, or no access). Ask the user to check the link before implementing.'
          : 'No specification page is linked. Ask the user for the spec before implementing.'
        : 'The specification pages are the source of truth. Where the work item conflicts with them, follow the spec and flag the conflict.',
    errors,
  };
}

/**
 * Confluence sayfasi guncellendiginde cagrilir (tetikleyici). Bagli her Jira isi icin
 * eski/yeni metin farkini ozetler; isi etkiliyorsa ise yorum yazar ve analizi "bekleyen degisiklik" ile isaretler.
 */
export async function onPageUpdated(pageId, actor = 'app') {
  const watchers = (await kvs.get(`watch:${pageId}`)) || [];
  if (watchers.length === 0) return { notified: 0 };
  const snapshot = await kvs.get(`snapshot:${pageId}`);
  const page = await getPage(pageId, actor); // sayfayi duzenleyen kisi okuyabilir
  if (snapshot && snapshot.version === page.version) return { notified: 0 };

  let notified = 0;
  for (const issueKey of watchers.slice(0, 20)) {
    try {
      const issue = await getIssue(issueKey, 'app'); // yorum uygulama adina yazilir
      if (!issue.linkedPageIds.includes(String(pageId))) continue; // baglanti kaldirilmis
      const diff = snapshot ? await summarizeSpecDiff(page.title, snapshot.text, page.text, issue) : null;
      if (diff && !diff.affectsIssue) continue;

      const lines = [
        `⚠️ Spec Guard: the specification "${page.title}" changed (v${snapshot ? snapshot.version : '?'} → v${page.version}).`,
      ];
      if (diff) {
        if (diff.summary) lines.push(diff.summary);
        for (const c of diff.changes.slice(0, 5)) {
          lines.push(`• Before: "${c.before || '—'}"  →  After: "${c.after || '—'}"`);
          if (c.impact) lines.push(`  Impact: ${c.impact}`);
        }
      }
      lines.push('Open the Spec Guard panel and click "Re-check" to update the alignment report.');
      await addComment(issueKey, lines.join('\n'), 'app');

      const saved = await kvs.get(`analysis:${issueKey}`);
      if (saved) {
        saved.pendingChanges = [...(saved.pendingChanges || []), { pageId: String(pageId), title: page.title, version: page.version, diff }].slice(-5);
        await kvs.set(`analysis:${issueKey}`, saved);
      }
      notified++;
    } catch (e) {
      console.error(`notify ${issueKey} failed`, e.message);
    }
  }
  await kvs.set(`snapshot:${pageId}`, {
    version: page.version,
    title: page.title,
    text: page.text.slice(0, SNAPSHOT_MAX),
    accountId: (actor && typeof actor === 'object' && actor.accountId) || (snapshot && snapshot.accountId),
  });
  return { notified };
}

/** KVS'de bir onekle baslayan tum kayitlari sayfa sayfa getirir. */
async function listByPrefix(prefix, max = 500) {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...page.results);
    cursor = page.nextCursor;
  } while (cursor && out.length < max);
  return out;
}

/** Ozet satiri: panolar ve rozetler icin bir analizin kisa hali. */
function summaryRow(issueKey, rec) {
  const reqs = (rec.result && rec.result.requirements) || [];
  const count = (st) => reqs.filter((r) => r.status === st).length;
  return {
    issueKey,
    score: rec.result ? rec.result.score : null,
    conflicts: count('conflict'),
    missing: count('missing'),
    covered: count('covered'),
    analyzedAt: rec.analyzedAt,
    pages: rec.pages || [],
    specChanged: Array.isArray(rec.pendingChanges) && rec.pendingChanges.length > 0,
  };
}

/**
 * Jira genel sayfasi: analiz edilmis tum isler. Sadece kullanicinin gorebildigi isler dondurulur
 * (yetki kontrolu kullanicinin kendi JQL aramasiyla yapilir).
 */
export async function listAlignment() {
  const rows = (await listByPrefix('analysis:')).map((r) => summaryRow(r.key.slice('analysis:'.length), r.value));
  if (rows.length === 0) return { rows: [] };
  const visible = await visibleIssueKeys(rows.map((r) => r.issueKey));
  const details = new Map(visible.map((v) => [v.key, v]));
  // Spesifikasyon sayfalarindan birini okuyamayan kullaniciya o satiri gostermeyiz
  const pageIds = [...new Set(rows.filter((r) => details.has(r.issueKey)).flatMap((r) => r.pages.map((p) => p.id)))].slice(0, 100);
  const readable = new Set();
  await Promise.all(pageIds.map(async (id) => (await canReadPage(id)) && readable.add(id)));
  return {
    rows: rows
      .filter((r) => details.has(r.issueKey) && r.pages.every((p) => readable.has(p.id)))
      .map((r) => ({ ...r, summary: details.get(r.issueKey).summary, status: details.get(r.issueKey).status }))
      .sort((a, b) => b.conflicts - a.conflicts || (a.score ?? 101) - (b.score ?? 101)),
  };
}

/** Confluence rozeti: bu spesifikasyon sayfasina bagli islerin uyum ozeti. */
export async function pageAlignment(pageId) {
  const keys = (await kvs.get(`watch:${pageId}`)) || [];
  const rows = [];
  for (const key of keys.slice(0, 50)) {
    const rec = await kvs.get(`analysis:${key}`);
    if (rec && (rec.pages || []).some((p) => p.id === String(pageId))) rows.push(summaryRow(key, rec));
  }
  const visible = rows.length ? await visibleIssueKeys(rows.map((r) => r.issueKey)) : [];
  const details = new Map(visible.map((v) => [v.key, v]));
  const shown = rows.filter((r) => details.has(r.issueKey)).map((r) => ({ ...r, summary: details.get(r.issueKey).summary, status: details.get(r.issueKey).status }));
  return { pageId: String(pageId), rows: shown, drifting: shown.filter((r) => r.conflicts > 0).length };
}

/**
 * Kapsama haritasi icin bagli isleri toplar: izleme listesindeki ve hala bu sayfaya bagli olan isler.
 */
async function linkedItems(pageId, as) {
  const items = [];
  for (const key of ((await kvs.get(`watch:${pageId}`)) || []).slice(0, 25)) {
    try {
      const it = await getIssue(key, as);
      if (it.linkedPageIds.includes(String(pageId))) items.push({ key: it.key, summary: it.summary, description: it.description });
    } catch (e) {
      // silinmis ya da gorulemeyen is
    }
  }
  return items;
}

/** Kapsama haritasini hesaplar ve kaydeder (kuyrukta, asApp). */
export async function runCoverage(pageId, as = 'app') {
  const page = await getPage(pageId, as);
  const items = await linkedItems(pageId, as);
  const map = await buildCoverageMap(page, items);
  const record = { analyzedAt: new Date().toISOString(), pageVersion: page.version, items: items.map((i) => ({ key: i.key, summary: i.summary })), ...map };
  await kvs.set(`coverage:${pageId}`, record);
  return record;
}

/** Confluence rozetindeki "Map coverage" butonu: yetkiyi kullanicinin kendisiyle dogrular, isi kuyruga atar. */
export async function requestCoverage(pageId, accountId) {
  if (!(await canReadPage(pageId, 'user'))) throw new Error('You cannot read this page.');
  await kvs.set(`covjob:${pageId}`, { state: 'running', startedAt: new Date().toISOString() });
  await queue.push({ body: { type: 'coverage', pageId: String(pageId), accountId } });
  return { queued: true };
}

/** Kayitli kapsama haritasi; kullanicinin goremedigi isler gizlenir. */
export async function getCoverage(pageId) {
  const rec = await kvs.get(`coverage:${pageId}`);
  const job = normalizeJob((await kvs.get(`covjob:${pageId}`)) || null);
  if (!rec) return { coverage: null, job };
  const visible = new Set((await visibleIssueKeys(rec.items.map((i) => i.key))).map((v) => v.key));
  const hide = (arr) => arr.filter((k) => visible.has(k));
  const current = await pageVersion(pageId, 'user');
  const watchers = (await kvs.get(`watch:${pageId}`)) || [];
  return {
    job,
    stale: (current !== null && current !== rec.pageVersion) || watchers.some((k) => !rec.items.some((i) => i.key === k)),
    coverage: {
      ...rec,
      items: rec.items.filter((i) => visible.has(i.key)),
      requirements: rec.requirements.map((q) => ({ ...q, coveredBy: hide(q.coveredBy), conflictsIn: hide(q.conflictsIn) })),
    },
  };
}

/**
 * Rovo/MCP icin kapsama haritasi. Girdi: Confluence sayfa URL'si, sayfa kimligi ya da bir Jira is anahtari
 * (o zaman isin bagli oldugu ilk spesifikasyon sayfasi). Kayitli harita guncelse hemen dondurulur;
 * yoksa ya da eskiyse yeniden olusturma arka planda baslatilir.
 */
export async function specCoverageFor(ref, accountId) {
  const raw = String(ref || '').trim();
  let pageId = (raw.match(/pages\/(\d+)/) || raw.match(/pageId=(\d+)/) || raw.match(/^(\d+)$/) || [])[1];
  if (!pageId && /^[A-Za-z][A-Za-z0-9_]+-\d+$/.test(raw)) {
    const issue = await getIssue(raw.toUpperCase(), 'user');
    pageId = issue.linkedPageIds[0];
    if (!pageId) return { message: `${raw.toUpperCase()} does not link a Confluence specification page.` };
  }
  if (!pageId) throw new Error('Give a Confluence page URL, a page ID, or a Jira work item key.');
  const { coverage, stale, job } = await getCoverage(pageId);
  if (coverage && !stale) return { pageId, ...coverage };
  if (!job || job.state !== 'running') await requestCoverage(pageId, accountId);
  return {
    pageId,
    building: true,
    message: 'The coverage map is being (re)built in the background. Ask again in about a minute.',
    previous: coverage || null,
  };
}

/** Paneldeki "Verify change": yetkiyi kullaniciyla dogrular, denetimi kuyruga atar (zaman asimi olmasin). */
export async function requestVerify(issueKey, change, accountId) {
  const text = String(change || '').trim().slice(0, 40000);
  if (!text) throw new Error('Describe the change first.');
  const { pages, errors } = await loadContext(issueKey, 'user');
  if (pages.length === 0) return { queued: false, result: await verifyChangeFor(issueKey, text, 'user') };
  await kvs.set(`vjob:${issueKey}:${accountId}`, { state: 'running', startedAt: new Date().toISOString() });
  await queue.push({ body: { type: 'verify', issueKey, change: text, accountId } });
  return { queued: true, errors };
}

/** Kullanicinin son "Verify change" isinin durumu ve sonucu (sadece kendi isi). */
export async function getVerify(issueKey, accountId) {
  return normalizeJob((await kvs.get(`vjob:${issueKey}:${accountId}`)) || null);
}

/**
 * Saatlik yedek kontrol: Confluence olaylari gelmese bile (ornegin olay teslimi gecikirse)
 * izlenen spesifikasyon sayfalarinin surumunu kontrol eder; degismisse bildirim akisini baslatir.
 * Sayfa, onu en son analiz eden kullanicinin yetkisiyle okunur.
 */
export async function pollWatchedPages() {
  let queued = 0;
  for (const { key, value } of await listByPrefix('snapshot:', 300)) {
    const pageId = key.slice('snapshot:'.length);
    const actor = value.accountId ? { accountId: value.accountId } : 'app';
    const current = await pageVersion(pageId, actor);
    if (current !== null && current !== value.version) {
      await queue.push({ body: { type: 'pageUpdated', pageId, accountId: value.accountId } });
      queued++;
    }
  }
  return { queued };
}

// ---------- Donguyu kapatmak: isi duzelt, bosluklar icin is olustur ----------

/** Isin kabul kriterlerini spesifikasyona gore yeniden yazan oneriyi hesaplar (degisiklik yapmaz). */
export async function proposeFix(issueKey, as = 'user') {
  const { issue, pages } = await loadContext(issueKey, as);
  if (!pages.length) throw new Error('No readable specification page is linked to this work item.');
  const siblings = await loadSiblings(issueKey, pages, as);
  const r = await proposeWorkItemFix(issue, pages, siblings);
  return { ...r, issueHash: hashIssue(issue), pages: pages.map(pageRef) };
}

/** Paneldeki "Align with spec": oneriyi arka planda hazirlatir. */
export async function requestFix(issueKey, accountId) {
  const { pages } = await loadContext(issueKey, 'user');
  if (!pages.length) throw new Error('No readable specification page is linked to this work item.');
  await kvs.set(`fjob:${issueKey}:${accountId}`, { state: 'running', startedAt: new Date().toISOString() });
  await queue.push({ body: { type: 'fix', issueKey, accountId } });
  return { queued: true };
}

export async function getFix(issueKey, accountId) {
  return normalizeJob((await kvs.get(`fjob:${issueKey}:${accountId}`)) || null);
}

/**
 * Onaylanan oneriyi uygular: aciklamadaki kabul kriterleri bolumunu degistirir ve bir denetim yorumu birakir.
 * Is, oneri hazirlandiktan sonra degistiyse uygulamaz (baskasinin degisikligini ezmemek icin).
 */
export async function applyProposal(issueKey, proposal, as = 'user') {
  const issue = await getIssue(issueKey, as);
  if (proposal.issueHash && proposal.issueHash !== hashIssue(issue)) {
    throw new Error('The work item was edited after the proposal was made. Propose again to avoid overwriting those edits.');
  }
  const spec = proposal.pages.map((p) => `"${p.title}" v${p.version}`).join(', ');
  const note = `Aligned with ${spec} by Spec Guard on ${new Date().toISOString().slice(0, 10)}.`;
  await updateDescription(issueKey, replaceAcceptanceCriteria(issue.descriptionAdf, proposal.acceptanceCriteria, note), as);
  const lines = [`✅ Spec Guard aligned the acceptance criteria with ${spec}.`];
  for (const c of proposal.changes.slice(0, 10)) lines.push(`• ${c}`);
  await addComment(issueKey, lines.join('\n'), as);
  return { issueKey, applied: true, changes: proposal.changes, acceptanceCriteria: proposal.acceptanceCriteria };
}

/** Panel: kullanicinin hazirlattigi son oneriyi uygular. */
export async function applyFix(issueKey, accountId) {
  const job = await kvs.get(`fjob:${issueKey}:${accountId}`);
  if (!job || job.state !== 'done') throw new Error('There is no proposal to apply. Click "Align with spec" first.');
  const r = await applyProposal(issueKey, job.proposal, 'user');
  await kvs.delete(`fjob:${issueKey}:${accountId}`);
  return r;
}

/**
 * Kapsama haritasindaki bosluklar (hicbir isin karsilamadigi gereksinimler) icin is olusturur.
 * Yeni isler, haritadaki ilk isle ayni proje ve is turunde acilir ve spesifikasyona baglanir.
 * Ayni bosluk icin ikinci kez is acilmaz.
 * @param {string} pageId
 * @param {string[]|null} reqIds sadece bu gereksinimler (bos ise tum bosluklar)
 */
export async function createGapItems(pageId, reqIds, as = 'user') {
  const rec = await kvs.get(`coverage:${pageId}`);
  if (!rec) throw new Error('Build the coverage map first.');
  const wanted = reqIds && reqIds.length ? new Set(reqIds.map((x) => String(x).trim().toUpperCase())) : null;
  const gaps = rec.requirements.filter((q) => q.status === 'gap' && (!wanted || wanted.has(q.id.toUpperCase())));
  if (!gaps.length) return { created: [], skipped: [], message: 'There are no uncovered requirements to create work items for.' };
  if (!rec.items.length) throw new Error('No work item is linked to this spec yet, so the project for new work items is unknown.');
  const template = await getIssue(rec.items[0].key, as);
  const page = await getPage(pageId, as);
  const created = [];
  const skipped = [];
  for (const q of gaps.slice(0, 10)) {
    const existing = await kvs.get(`gapitem:${pageId}:${q.id}`);
    if (existing) {
      skipped.push({ id: q.id, key: existing });
      continue;
    }
    const key = await createIssue(
      {
        projectKey: template.projectKey,
        issueTypeId: template.issueTypeId,
        summary: `${q.id}: ${q.requirement}`,
        description: gapIssueAdf({ pageUrl: page.url, pageTitle: page.title, reqId: q.id, requirement: q.requirement, specQuote: q.specQuote }),
      },
      as
    );
    await kvs.set(`gapitem:${pageId}:${q.id}`, key);
    await registerLinks(key, [String(pageId)]);
    created.push({ id: q.id, key, summary: `${q.id}: ${q.requirement}` });
  }
  return { created, skipped };
}

/** Demo senaryosunda olusan isleri spesifikasyon sayfasina baglar (kardes is ve kapsama icin). */
export async function linkWorkItems(keys, pageId) {
  for (const k of keys) await registerLinks(k, [String(pageId)]);
}
