/**
 * Yapay zeka cagrilari (Forge LLM: Atlassian'in kendi altyapisinda calisan Claude modelleri).
 * Veri Atlassian disina cikmaz; bu sayede uygulama "Runs on Atlassian" kapsaminda kalir.
 *
 * Uc gorev var:
 *   analyzeAlignment  -> spesifikasyon(lar) ile Jira isini karsilastirir
 *   verifyChange      -> bir kod degisikliginin ozetini spesifikasyona gore denetler
 *   summarizeSpecDiff -> bir spesifikasyon sayfasinin eski ve yeni halleri arasindaki farki ozetler
 *
 * Seffaflik ilkesi: her karar, iki taraftan birebir alintilarla gerekcelendirilir.
 * Boylece kullanici modelin "neden" boyle dedigini gorebilir.
 */
import { chat } from '@forge/llm';
import { clip } from './text';

// Dengeli hiz/kalite icin Sonnet; ayar tek yerden degistirilebilir.
export const MODEL = 'claude-sonnet-4-6';

const MAX_SPEC_CHARS = 60000;
const MAX_ISSUE_CHARS = 20000;

/** Model yanitinin metnini cikarir (icerik string ya da parca dizisi olabilir). */
function responseText(res) {
  const msg = res && res.choices && res.choices[0] && res.choices[0].message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.map((p) => p.text || '').join('');
  return '';
}

/** Metnin icindeki ilk JSON nesnesini ayiklar ve cozer. */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Tek bir sohbet istegi; JSON bekler, bozuk gelirse bir kez daha dener. */
async function askJson(system, user, maxTokens = 4000) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({
      model: MODEL,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: attempt === 0 ? user : user + '\n\nIMPORTANT: Reply with ONE valid JSON object only, no prose.' },
      ],
    });
    try {
      return extractJson(responseText(res));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const STATUS = ['covered', 'missing', 'conflict', 'unclear', 'elsewhere'];

function normalizeAnalysis(a) {
  const reqs = Array.isArray(a.requirements) ? a.requirements : [];
  const requirements = reqs.map((r, i) => ({
    id: String(r.id || `R${i + 1}`),
    requirement: String(r.requirement || ''),
    specQuote: String(r.specQuote || ''),
    issueQuote: String(r.issueQuote || ''),
    status: STATUS.includes(r.status) ? r.status : 'unclear',
    explanation: String(r.explanation || ''),
    page: r.page ? String(r.page) : '',
    coveredBy: r.coveredBy ? String(r.coveredBy).toUpperCase() : '',
  }));
  // "elsewhere" (baska bir iste karsilaniyor) puani etkilemez
  const weight = { covered: 1, unclear: 0.5, missing: 0, conflict: 0 };
  const scored = requirements.filter((r) => r.status !== 'elsewhere');
  const score = scored.length ? Math.round((100 * scored.reduce((s, r) => s + weight[r.status], 0)) / scored.length) : null;
  return {
    scope: String(a.scope || ''),
    summary: String(a.summary || ''),
    score,
    requirements,
    openQuestions: Array.isArray(a.openQuestions) ? a.openQuestions.map(String).slice(0, 8) : [],
  };
}

/**
 * Spesifikasyon sayfalari ile Jira isini karsilastirir.
 * @param {{key, summary, description}} issue
 * @param {{id, title, text}[]} pages
 */
export async function analyzeAlignment(issue, pages, siblings = []) {
  const system = `You are Spec Guard, a meticulous requirements analyst embedded in Jira.
You compare a specification (Confluence pages) with a Jira work item and report drift.
Rules:
- First decide the SCOPE of this work item from its summary and description. A specification usually covers several work items; requirements that clearly belong to other work items are OUT of scope and must not be listed as missing. Only list a requirement as "missing" if this work item is responsible for it (it is part of the feature the work item delivers, or the work item claims to implement the whole spec).
- Details that only appear in the work item and are not covered by the spec are fine; do not list them as requirements unless they contradict the spec (then it is a "conflict").
- For each relevant requirement decide: "covered" (the work item states it, consistently), "missing" (the work item does not mention it), "conflict" (the work item says something different, e.g. other number, other behaviour), or "unclear" (cannot tell).
- Quote VERBATIM short excerpts (max ~200 chars) from the spec (specQuote) and from the work item (issueQuote, empty if missing). Never invent quotes.
- Be concrete in "explanation" (one sentence). Mention exact values when they differ.
- SIBLING WORK ITEMS (if given) implement other parts of the same spec. If a relevant requirement is clearly delivered by a sibling and not by this work item, use status "elsewhere" with "coveredBy": "<sibling key>" instead of "missing". Never mark something "elsewhere" without naming the sibling. Problems that exist only in a sibling work item (e.g. the sibling uses a wrong value) are NOT conflicts of this work item — report such a requirement as "elsewhere"; the sibling's own report will flag it.
- Prefer at most 12 requirements, the most important first. Conflicts first.
- openQuestions: ambiguities a developer should clarify before coding (max 5).
Reply with JSON only:
{"scope": "<one sentence: what this work item delivers>", "summary": "<one or two sentences>", "requirements": [{"id":"R1","requirement":"<short normalized requirement>","page":"<page title>","specQuote":"...","issueQuote":"...","status":"covered|missing|conflict|unclear|elsewhere","coveredBy":"<sibling key, only for elsewhere>","explanation":"..."}], "openQuestions": ["..."]}`;

  const specBlock = pages
    .map((p) => `=== SPEC PAGE: "${p.title}" (id ${p.id}, version ${p.version}) ===\n${clip(p.text, Math.floor(MAX_SPEC_CHARS / pages.length))}`)
    .join('\n\n');
  const siblingBlock = siblings.length
    ? '\n\n=== SIBLING WORK ITEMS (same spec, other scope) ===\n' +
      siblings.map((s) => `--- ${s.key}: ${s.summary} ---\n${clip(s.description || '', 2500)}`).join('\n')
    : '';
  const user = `${specBlock}${siblingBlock}\n\n=== JIRA WORK ITEM ${issue.key}: ${issue.summary} ===\n${clip(issue.description || '(no description)', MAX_ISSUE_CHARS)}`;

  return normalizeAnalysis(await askJson(system, user));
}

const VERDICT = ['pass', 'warn', 'fail'];

/**
 * Bir kod degisikliginin (kodlama ajaninin yazdigi ozet ya da diff) spesifikasyona uyup uymadigini denetler.
 * @param {{key, summary, description}} issue
 * @param {{id, title, text}[]} pages
 * @param {string} change degisiklik ozeti veya diff
 */
export async function verifyChange(issue, pages, change, siblings = []) {
  const system = `You are Spec Guard, reviewing a proposed code change against the specification of a Jira work item.
The specification (Confluence) is the source of truth; the work item may be outdated.
Only judge requirements within THIS work item's scope. A spec usually covers several work items: requirements delivered by the SIBLING WORK ITEMS (if listed) or clearly belonging to another feature are out of scope — do not report them as omissions.
Report every place where the CHANGE contradicts or omits an in-scope requirement, with verbatim spec quotes.
The verdict judges ONLY the change: "pass" (consistent with the spec), "warn" (minor gaps or ambiguity), "fail" (the change contradicts a requirement or misses an in-scope must-have).
If the Jira work item itself disagrees with the spec, do NOT count that against the change; list it in "workItemDrift" (one short sentence each, with exact values) so the team can fix the work item.
Reply with JSON only:
{"verdict":"pass|warn|fail","summary":"<one or two sentences about the change>","findings":[{"severity":"high|medium|low","requirement":"...","specQuote":"...","problem":"...","suggestion":"..."}],"workItemDrift":["..."]}`;
  const specBlock = pages.map((p) => `=== SPEC PAGE: "${p.title}" (version ${p.version}) ===\n${clip(p.text, Math.floor(MAX_SPEC_CHARS / pages.length))}`).join('\n\n');
  const siblingBlock = siblings.length
    ? '\n\n=== SIBLING WORK ITEMS (same spec, other scope) ===\n' +
      siblings.map((s) => `--- ${s.key}: ${s.summary} ---\n${clip(s.description || '', 1500)}`).join('\n')
    : '';
  const user = `${specBlock}${siblingBlock}\n\n=== JIRA WORK ITEM ${issue.key}: ${issue.summary} ===\n${clip(issue.description || '', MAX_ISSUE_CHARS)}\n\n=== PROPOSED CHANGE ===\n${clip(change, 40000)}`;
  const r = await askJson(system, user);
  return {
    verdict: VERDICT.includes(r.verdict) ? r.verdict : 'warn',
    summary: String(r.summary || ''),
    findings: (Array.isArray(r.findings) ? r.findings : []).map((f) => ({
      severity: ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
      requirement: String(f.requirement || ''),
      specQuote: String(f.specQuote || ''),
      problem: String(f.problem || ''),
      suggestion: String(f.suggestion || ''),
    })),
    workItemDrift: (Array.isArray(r.workItemDrift) ? r.workItemDrift : []).map(String).slice(0, 8),
  };
}

/**
 * Bir spesifikasyon sayfasinin iki surumu arasindaki anlamli farklari ozetler
 * ve verilen Jira isini etkileyip etkilemedigini soyler.
 */
export async function summarizeSpecDiff(pageTitle, oldText, newText, issue) {
  const system = `You are Spec Guard. A specification page changed. List the meaningful requirement changes (ignore formatting/typos) and say whether they affect the given Jira work item.
Reply with JSON only:
{"affectsIssue": true|false, "changes":[{"before":"<verbatim old excerpt or empty>","after":"<verbatim new excerpt or empty>","impact":"<one sentence for this work item>"}], "summary":"<one sentence>"}`;
  const user = `=== PAGE "${pageTitle}" — OLD VERSION ===\n${clip(oldText, 30000)}\n\n=== NEW VERSION ===\n${clip(newText, 30000)}\n\n=== JIRA WORK ITEM ${issue.key}: ${issue.summary} ===\n${clip(issue.description || '', 10000)}`;
  const r = await askJson(system, user, 2500);
  return {
    affectsIssue: r.affectsIssue !== false,
    summary: String(r.summary || ''),
    changes: (Array.isArray(r.changes) ? r.changes : []).slice(0, 10).map((c) => ({
      before: String(c.before || ''),
      after: String(c.after || ''),
      impact: String(c.impact || ''),
    })),
  };
}

const COVERAGE = ['covered', 'partial', 'conflict', 'gap'];

/**
 * Kapsama haritasi: bir spesifikasyondaki her gereksinimin hangi Jira isleri tarafindan
 * karsilandigini ve hicbir isin karsilamadigi bosluklari (gap) tek analizde cikarir.
 * @param {{id,title,version,text}} page
 * @param {{key, summary, description}[]} items bu sayfaya bagli isler
 */
export async function buildCoverageMap(page, items) {
  const system = `You are Spec Guard. Build a requirement coverage map: for EVERY requirement in the specification, decide which Jira work items deliver it.
status per requirement:
- "covered": at least one work item clearly states it, consistently.
- "partial": a work item touches it but leaves out part of it.
- "conflict": a work item states something that contradicts it (list those keys in conflictsIn).
- "gap": no work item delivers it.
Rules: quote the spec VERBATIM (specQuote, max ~200 chars). Use only the given work item keys. Keep "note" to one short sentence (what is missing or contradictory, with exact values).
Out-of-scope / non-goal sections of the spec are not requirements.
Reply with JSON only:
{"summary":"<one or two sentences>","requirements":[{"id":"<spec id like FR-1 if present, else R1>","requirement":"<short>","specQuote":"...","status":"covered|partial|conflict|gap","coveredBy":["KEY-1"],"conflictsIn":["KEY-2"],"note":"..."}]}`;
  const itemsBlock = items
    .map((it) => `--- ${it.key}: ${it.summary} ---\n${clip(it.description || '(no description)', Math.floor(30000 / Math.max(1, items.length)))}`)
    .join('\n');
  const user = `=== SPEC PAGE "${page.title}" (version ${page.version}) ===\n${clip(page.text, MAX_SPEC_CHARS)}\n\n=== JIRA WORK ITEMS LINKED TO THIS SPEC ===\n${itemsBlock || '(none)'}`;
  const r = await askJson(system, user, 6000);
  const keys = new Set(items.map((i) => i.key));
  const clean = (arr) => (Array.isArray(arr) ? arr.map((k) => String(k).toUpperCase()).filter((k) => keys.has(k)) : []);
  const requirements = (Array.isArray(r.requirements) ? r.requirements : []).map((q, i) => ({
    id: String(q.id || `R${i + 1}`),
    requirement: String(q.requirement || ''),
    specQuote: String(q.specQuote || ''),
    status: COVERAGE.includes(q.status) ? q.status : 'gap',
    coveredBy: clean(q.coveredBy),
    conflictsIn: clean(q.conflictsIn),
    note: String(q.note || ''),
  }));
  const count = (st) => requirements.filter((q) => q.status === st).length;
  return {
    summary: String(r.summary || ''),
    requirements,
    totals: { total: requirements.length, covered: count('covered'), partial: count('partial'), conflict: count('conflict'), gap: count('gap') },
  };
}

/**
 * "Isi spesifikasyona gore duzelt": isin kapsami icindeki gereksinimlerle tutarli, yeni kabul kriterleri onerir.
 * Isin kendi gecerli detaylari (spesifikasyonla celismeyen) korunur; kardes islerin kapsami eklenmez.
 */
export async function proposeWorkItemFix(issue, pages, siblings = []) {
  const system = `You are Spec Guard. Rewrite the ACCEPTANCE CRITERIA of a Jira work item so that they match its specification (the source of truth).
Rules:
- Keep the work item's scope. Do not add requirements that belong to the SIBLING WORK ITEMS or to other features.
- Fix every criterion that contradicts the spec (use the spec's exact values). Add in-scope spec requirements that are missing.
- Keep the work item's own details that do not contradict the spec.
- Each criterion is one short, testable sentence. Where it comes from the spec, end it with the spec id in brackets, e.g. "(FR-3)".
- "changes" lists what you changed versus the current work item, one short line each (e.g. "48 hours → 24 hours (FR-3)").
Reply with JSON only:
{"acceptanceCriteria":["..."],"changes":["..."]}`;
  const specBlock = pages.map((p) => `=== SPEC PAGE: "${p.title}" (version ${p.version}) ===\n${clip(p.text, Math.floor(MAX_SPEC_CHARS / pages.length))}`).join('\n\n');
  const siblingBlock = siblings.length
    ? '\n\n=== SIBLING WORK ITEMS (same spec, other scope) ===\n' + siblings.map((s) => `--- ${s.key}: ${s.summary} ---\n${clip(s.description || '', 1500)}`).join('\n')
    : '';
  const user = `${specBlock}${siblingBlock}\n\n=== JIRA WORK ITEM ${issue.key}: ${issue.summary} ===\n${clip(issue.description || '(no description)', MAX_ISSUE_CHARS)}`;
  const r = await askJson(system, user, 3000);
  const ac = (Array.isArray(r.acceptanceCriteria) ? r.acceptanceCriteria : []).map(String).filter(Boolean).slice(0, 25);
  if (!ac.length) throw new Error('Spec Guard could not propose acceptance criteria for this work item.');
  return { acceptanceCriteria: ac, changes: (Array.isArray(r.changes) ? r.changes : []).map(String).slice(0, 20) };
}
