/**
 * Deterministic post-processing of LLM output: JSON extraction, quote verification, scoring and
 * coverage normalisation. Kept free of Forge imports so it can be unit tested.
 */

/** Parses the first JSON object in a model reply (tolerates code fences and surrounding prose). */
export function extractJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : String(text);
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

// ---------- quote verification ----------

/** Lower-case, unify quotes/dashes, drop markup and collapse whitespace. */
export function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[*_#|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True if the quote appears in the source (after normalisation). Long quotes may be trimmed by the
 * model with "..."; each fragment must then appear in order.
 */
export function verifyQuote(quote, source) {
  const q = normalizeForMatch(quote).replace(/^["']|["']$/g, '');
  if (!q) return true; // nothing to verify (e.g. "not mentioned")
  const src = normalizeForMatch(source);
  const parts = q.split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length > 0);
  // A quote shortened with "..." only counts if every fragment is substantial and the fragments are
  // close together, so unrelated phrases cannot be stitched into a quote.
  if (parts.length > 1 && parts.some((p) => p.length < 10)) return false;
  let from = -1;
  for (const part of parts) {
    const at = src.indexOf(part, Math.max(from, 0));
    if (at < 0) return false;
    if (from >= 0 && at - from > 300) return false;
    from = at + part.length;
  }
  return true;
}

// ---------- alignment analysis ----------

const STATUS = ['covered', 'missing', 'conflict', 'unclear', 'elsewhere'];
const WEIGHT = { covered: 1, unclear: 0.5, missing: 0, conflict: 0 };

/** Cleans the model output, checks every quote against its source and computes the score. */
export function normalizeAnalysis(a, specText = '', issueText = '') {
  const reqs = Array.isArray(a && a.requirements) ? a.requirements : [];
  const requirements = reqs.map((r, i) => {
    const specQuote = String(r.specQuote || '');
    const issueQuote = String(r.issueQuote || '');
    return {
      id: String(r.id || `R${i + 1}`),
      requirement: String(r.requirement || ''),
      specQuote,
      issueQuote,
      specQuoteVerified: specText && specQuote.trim() ? verifyQuote(specQuote, specText) : null,
      issueQuoteVerified: issueText && issueQuote.trim() ? verifyQuote(issueQuote, issueText) : null,
      status: STATUS.includes(r.status) ? r.status : 'unclear',
      explanation: String(r.explanation || ''),
      page: r.page ? String(r.page) : '',
      coveredBy: r.coveredBy ? String(r.coveredBy).toUpperCase() : '',
    };
  });
  // "elsewhere" (delivered by another work item) does not count for or against this work item.
  const scored = requirements.filter((r) => r.status !== 'elsewhere');
  const score = scored.length ? Math.round((100 * scored.reduce((s, r) => s + WEIGHT[r.status], 0)) / scored.length) : null;
  const quotes = requirements.flatMap((r) => [r.specQuoteVerified, r.issueQuoteVerified]).filter((v) => v !== null);
  return {
    scope: String((a && a.scope) || ''),
    summary: String((a && a.summary) || ''),
    score,
    requirements,
    openQuestions: Array.isArray(a && a.openQuestions) ? a.openQuestions.map(String).slice(0, 8) : [],
    quoteCheck: { checked: quotes.length, verified: quotes.filter(Boolean).length },
  };
}

const COVERAGE = ['covered', 'partial', 'conflict', 'gap'];

/** Normalises a coverage map: unknown keys are dropped, quotes are verified, totals computed. */
export function normalizeCoverage(r, itemKeys, specText = '') {
  const keys = new Set(itemKeys);
  const clean = (arr) => (Array.isArray(arr) ? [...new Set(arr.map((k) => String(k).toUpperCase()).filter((k) => keys.has(k)))] : []);
  const requirements = (Array.isArray(r && r.requirements) ? r.requirements : []).map((q, i) => {
    const coveredBy = clean(q.coveredBy);
    let status = COVERAGE.includes(q.status) ? q.status : 'gap';
    // A "covered" requirement must name the work item that covers it.
    if ((status === 'covered' || status === 'partial') && coveredBy.length === 0) status = 'gap';
    return {
      id: String(q.id || `R${i + 1}`),
      requirement: String(q.requirement || ''),
      specQuote: String(q.specQuote || ''),
      specQuoteVerified: specText && String(q.specQuote || '').trim() ? verifyQuote(q.specQuote, specText) : null,
      status,
      coveredBy,
      conflictsIn: clean(q.conflictsIn),
      note: String(q.note || ''),
    };
  });
  const count = (st) => requirements.filter((q) => q.status === st).length;
  return {
    summary: String((r && r.summary) || ''),
    requirements,
    totals: { total: requirements.length, covered: count('covered'), partial: count('partial'), conflict: count('conflict'), gap: count('gap') },
  };
}

