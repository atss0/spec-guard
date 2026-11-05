/**
 * UI Kit panelinin arka ucu (resolver). Panel bu fonksiyonlari invoke() ile cagirir.
 * Tum Jira/Confluence istekleri kullanicinin yetkileriyle (asUser) yapilir.
 */
import Resolver from '@forge/resolver';
import { getStatus, requestAnalysis, listAlignment, pageAlignment, requestCoverage, getCoverage, requestVerify, getVerify, requestFix, getFix, applyFix, createGapItems, linkWorkItems } from '../lib/service';
import { demoTargets, createDemo } from '../lib/demo';

const resolver = new Resolver();

/** Is anahtarini once Forge baglamindan, yoksa istekten alir. */
const issueKeyOf = (req) =>
  (req.context && req.context.extension && req.context.extension.issue && req.context.extension.issue.key) ||
  (req.payload && req.payload.issueKey);

/** Hatalari panelde gosterilebilir bicime cevirir (panel hic cokmesin). */
const safe = (fn) => async (req) => {
  try {
    return { ok: true, data: await fn(req) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message || String(e) };
  }
};

resolver.define('getStatus', safe((req) => getStatus(issueKeyOf(req), 'user')));
resolver.define('runAnalysis', safe((req) => requestAnalysis(issueKeyOf(req), req.context.accountId)));
resolver.define('verifyChange', safe((req) => requestVerify(issueKeyOf(req), req.payload.change, req.context.accountId)));
resolver.define('getVerify', safe((req) => getVerify(issueKeyOf(req), req.context.accountId)));

resolver.define('listAlignment', safe(() => listAlignment()));
resolver.define(
  'pageAlignment',
  safe((req) => pageAlignment(req.context && req.context.extension && req.context.extension.content && req.context.extension.content.id))
);

const pageIdOf = (req) => req.context && req.context.extension && req.context.extension.content && req.context.extension.content.id;
resolver.define('requestCoverage', safe((req) => requestCoverage(pageIdOf(req), req.context.accountId)));
resolver.define('getCoverage', safe((req) => getCoverage(pageIdOf(req))));

resolver.define('requestFix', safe((req) => requestFix(issueKeyOf(req), req.context.accountId)));
resolver.define('getFix', safe((req) => getFix(issueKeyOf(req), req.context.accountId)));
resolver.define('applyFix', safe((req) => applyFix(issueKeyOf(req), req.context.accountId)));
resolver.define('createGapItems', safe((req) => createGapItems(pageIdOf(req), (req.payload && req.payload.reqIds) || null, 'user')));

resolver.define('demoTargets', safe(() => demoTargets()));
resolver.define(
  'createDemo',
  safe(async (req) => {
    const r = await createDemo(req.payload.projectKey, req.payload.spaceId);
    await linkWorkItems(r.keys, r.pageId);
    return r;
  })
);

export const handler = resolver.getDefinitions();
