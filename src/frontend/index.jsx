/**
 * Spec Guard Jira is paneli (UI Kit).
 * Uc durum gosterir: spesifikasyon bagli degil / henuz analiz yok / analiz sonucu.
 * Sadece @forge/react bilesenleri kullanilir (UI Kit kurali).
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  EmptyState,
  Em,
  Heading,
  Inline,
  Link,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

// Durum -> (etiket, Lozenge gorunumu)
const STATUS = {
  conflict: { label: 'Conflict', appearance: 'removed' },
  missing: { label: 'Missing', appearance: 'moved' },
  unclear: { label: 'Unclear', appearance: 'default' },
  covered: { label: 'Covered', appearance: 'success' },
  elsewhere: { label: 'Other work item', appearance: 'inprogress' },
};
const ORDER = { conflict: 0, missing: 1, unclear: 2, covered: 3, elsewhere: 4 };
const VERDICT = {
  pass: { label: 'Pass', appearance: 'success' },
  warn: { label: 'Needs attention', appearance: 'moved' },
  fail: { label: 'Fails spec', appearance: 'removed' },
};

const card = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'border.radius',
  padding: 'space.150',
});

const scoreAppearance = (s) => (s === null ? 'default' : s >= 85 ? 'success' : s >= 60 ? 'moved' : 'removed');

const timeAgo = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Tek bir gereksinim karti: durum, gereksinim, iki taraftan alinti ve aciklama. */
const RequirementCard = ({ r }) => (
  <Box xcss={card}>
    <Stack space="space.075">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={STATUS[r.status].appearance}>{STATUS[r.status].label}</Lozenge>
        <Strong>{r.requirement}</Strong>
      </Inline>
      {r.specQuote ? (
        <Text>
          Spec{r.page ? ` (${r.page})` : ''}: <Em>“{r.specQuote}”</Em>
        </Text>
      ) : null}
      {r.status === 'elsewhere' ? (
        <Text>
          Delivered by {r.coveredBy ? <Link href={`/browse/${r.coveredBy}`}>{r.coveredBy}</Link> : 'another work item'}
        </Text>
      ) : (
        <Text>
          Work item: {r.issueQuote ? <Em>“{r.issueQuote}”</Em> : <Em>not mentioned</Em>}
        </Text>
      )}
      {r.explanation ? <Text>{r.explanation}</Text> : null}
    </Stack>
  </Box>
);

/** Spesifikasyon degisikligi bildirimi (tetikleyicinin kaydettigi fark). */
const PendingChange = ({ c }) => (
  <Stack space="space.050">
    <Text>
      <Strong>{c.title}</Strong> → v{c.version}
      {c.diff && c.diff.summary ? `: ${c.diff.summary}` : ''}
    </Text>
    {c.diff
      ? c.diff.changes.slice(0, 3).map((d, i) => (
          <Text key={i}>
            <Em>“{d.before || '—'}”</Em> → <Em>“{d.after || '—'}”</Em>
          </Text>
        ))
      : null}
  </Stack>
);

/**
 * "Align with spec": isin kabul kriterlerini spesifikasyona gore yeniden yazan oneriyi hazirlar,
 * onizleme gosterir; kullanici onaylarsa Jira isine uygular.
 */
const FixPanel = ({ onApplied }) => {
  const [state, setState] = useState('idle'); // idle | working | ready | applying | done
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState(null);

  const propose = async () => {
    setState('working');
    setError(null);
    const r = await invoke('requestFix');
    if (!r.ok) {
      setError(r.error);
      setState('idle');
      return;
    }
    for (let i = 0; i < 80; i++) {
      await new Promise((res) => setTimeout(res, i < 5 ? 2500 : 4000));
      const s = await invoke('getFix');
      if (!s.ok) {
        setError(s.error);
        break;
      }
      if (s.data && s.data.state === 'done') {
        setProposal(s.data.proposal);
        setState('ready');
        return;
      }
      if (s.data && s.data.state === 'error') {
        setError(s.data.error);
        break;
      }
    }
    setState('idle');
  };

  const apply = async () => {
    setState('applying');
    const r = await invoke('applyFix');
    if (r.ok) {
      setState('done');
      onApplied && onApplied();
    } else {
      setError(r.error);
      setState('ready');
    }
  };

  if (state === 'done') {
    return (
      <SectionMessage appearance="success" title="Work item updated">
        <Text>The acceptance criteria now match the spec. An audit comment was added. Reload the work item to see the new description.</Text>
      </SectionMessage>
    );
  }
  if (state === 'ready' || state === 'applying') {
    return (
      <SectionMessage appearance="discovery" title="Proposed acceptance criteria">
        <Stack space="space.100">
          {proposal.changes.length ? (
            <Stack space="space.050">
              <Strong>What changes</Strong>
              {proposal.changes.map((c, i) => (
                <Text key={i}>• {c}</Text>
              ))}
            </Stack>
          ) : null}
          <Stack space="space.050">
            <Strong>New acceptance criteria</Strong>
            {proposal.acceptanceCriteria.map((c, i) => (
              <Text key={i}>• {c}</Text>
            ))}
          </Stack>
          {error ? <Text>{error}</Text> : null}
          <Inline space="space.100">
            <LoadingButton appearance="primary" isLoading={state === 'applying'} onClick={apply}>
              Apply to work item
            </LoadingButton>
            <Button appearance="subtle" onClick={() => setState('idle')}>
              Discard
            </Button>
          </Inline>
        </Stack>
      </SectionMessage>
    );
  }
  return (
    <Stack space="space.050">
      {error ? <Text>{error}</Text> : null}
      <Inline space="space.100" alignBlock="center">
        <LoadingButton appearance="primary" isLoading={state === 'working'} onClick={propose}>
          Align work item with spec
        </LoadingButton>
        <Text>Preview first — nothing changes until you apply.</Text>
      </Inline>
    </Stack>
  );
};

const AlignmentView = ({ status, onRun, running }) => {
  const a = status.analysis;
  const reqs = [...a.requirements].sort((x, y) => ORDER[x.status] - ORDER[y.status]);
  const counts = reqs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  return (
    <Stack space="space.200">
      {status.stale ? (
        <SectionMessage appearance="warning" title="The specification changed since the last check">
          <Stack space="space.100">
            {status.staleReasons.map((r, i) => (
              <Text key={i}>• {r}</Text>
            ))}
            {status.pendingChanges.map((c, i) => (
              <PendingChange key={i} c={c} />
            ))}
            <Inline>
              <LoadingButton appearance="warning" isLoading={running} onClick={onRun}>
                Re-check now
              </LoadingButton>
            </Inline>
          </Stack>
        </SectionMessage>
      ) : null}

      <Inline space="space.150" alignBlock="center" spread="space-between">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={scoreAppearance(a.score)} isBold>
            {a.score === null ? 'No requirements' : `${a.score}% aligned`}
          </Lozenge>
          {['conflict', 'missing', 'unclear', 'covered', 'elsewhere'].map((k) =>
            counts[k] ? (
              <Lozenge key={k} appearance={STATUS[k].appearance}>
                {counts[k]} {STATUS[k].label.toLowerCase()}
              </Lozenge>
            ) : null
          )}
        </Inline>
        {!status.stale ? (
          <LoadingButton spacing="compact" isLoading={running} onClick={onRun}>
            Re-check
          </LoadingButton>
        ) : null}
      </Inline>

      {a.summary ? <Text>{a.summary}</Text> : null}
      {counts.conflict || counts.missing ? <FixPanel onApplied={onRun} /> : null}
      {a.scope ? (
        <Text>
          <Strong>Scope:</Strong> {a.scope}
        </Text>
      ) : null}
      <Text>
        <Em>
          Checked {timeAgo(status.analyzedAt)} against{' '}
          {status.pages.map((p) => `“${p.title}” v${p.version}`).join(', ')}
        </Em>
      </Text>

      <Stack space="space.100">
        {reqs.map((r) => (
          <RequirementCard key={r.id} r={r} />
        ))}
      </Stack>

      {a.openQuestions.length ? (
        <SectionMessage appearance="information" title="Clarify before coding">
          <Stack space="space.050">
            {a.openQuestions.map((q, i) => (
              <Text key={i}>• {q}</Text>
            ))}
          </Stack>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

/** "Bir degisikligi dogrula" sekmesi: kod degisikligi ozetini spesifikasyona gore denetler. */
const VerifyView = () => {
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const r = await invoke('verifyChange', { change });
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    if (!r.data.queued) {
      setResult(r.data.result);
      setBusy(false);
      return;
    }
    // Denetim arka planda calisir; bitene kadar birkac saniyede bir sor
    for (let i = 0; i < 80; i++) {
      await new Promise((res) => setTimeout(res, i < 5 ? 2500 : 4000));
      const s = await invoke('getVerify');
      if (!s.ok) {
        setError(s.error);
        break;
      }
      if (s.data && s.data.state === 'done') {
        setResult(s.data.result);
        break;
      }
      if (s.data && s.data.state === 'error') {
        setError(s.data.error);
        break;
      }
    }
    setBusy(false);
  };
  return (
    <Stack space="space.150">
      <Text>Paste a summary or diff of what was implemented. Spec Guard checks it against the linked specification.</Text>
      {/* Kontrolsuz alan: "value" vermiyoruz; aksi halde hizli yazimda karakterler kaybolabiliyor */}
      <TextArea
        name="change"
        placeholder="e.g. Added password reset: link valid for 24 hours, sent by email…"
        onChange={(e) => setChange(e.target.value)}
      />
      <Inline>
        <LoadingButton appearance="primary" isLoading={busy} isDisabled={!change.trim()} onClick={run}>
          Verify change
        </LoadingButton>
      </Inline>
      {error ? <SectionMessage appearance="error">{<Text>{error}</Text>}</SectionMessage> : null}
      {result ? (
        <Stack space="space.100">
          <Inline>
            <Lozenge appearance={VERDICT[result.verdict].appearance} isBold>
              {VERDICT[result.verdict].label}
            </Lozenge>
          </Inline>
          <Text>{result.summary}</Text>
          {result.findings.length === 0 && result.verdict === 'pass' ? <Text>No problems found in the change.</Text> : null}
          {result.findings.map((f, i) => (
            <Box key={i} xcss={card}>
              <Stack space="space.050">
                <Inline space="space.100">
                  <Lozenge appearance={f.severity === 'high' ? 'removed' : f.severity === 'medium' ? 'moved' : 'default'}>
                    {f.severity}
                  </Lozenge>
                  <Strong>{f.requirement}</Strong>
                </Inline>
                {f.specQuote ? (
                  <Text>
                    Spec: <Em>“{f.specQuote}”</Em>
                  </Text>
                ) : null}
                <Text>{f.problem}</Text>
                {f.suggestion ? <Text>Suggestion: {f.suggestion}</Text> : null}
              </Stack>
            </Box>
          ))}
          {result.workItemDrift && result.workItemDrift.length ? (
            <SectionMessage appearance="information" title="The work item itself disagrees with the spec">
              <Stack space="space.050">
                {result.workItemDrift.map((d, i) => (
                  <Text key={i}>• {d}</Text>
                ))}
              </Stack>
            </SectionMessage>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
};

const App = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const r = await invoke('getStatus');
    if (r.ok) setStatus(r.data);
    else setError(r.error);
  };

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  /** Analiz arka planda calisir; is bitene kadar birkac saniyede bir durumu sorar. */
  const waitForJob = async () => {
    setRunning(true);
    for (let i = 0; i < 90; i++) {
      await sleep(i < 5 ? 2000 : 4000);
      const r = await invoke('getStatus');
      if (!r.ok) {
        setError(r.error);
        break;
      }
      const job = r.data.job;
      if (!job || job.state !== 'running') {
        setStatus(r.data);
        if (job && job.state === 'error') setError(`Analysis failed: ${job.error}`);
        break;
      }
    }
    setRunning(false);
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    const r = await invoke('runAnalysis');
    if (!r.ok) {
      setRunning(false);
      setError(r.error);
      return;
    }
    if (r.data.noSpec) {
      setRunning(false);
      await load();
      return;
    }
    await waitForJob();
  };

  useEffect(() => {
    load().then(() => null);
  }, []);

  // Panel acildiginda bir analiz hala suruyorsa onu bekle
  useEffect(() => {
    if (status && status.job && status.job.state === 'running' && !running) waitForJob();
  }, [status && status.job && status.job.state]);

  if (error && !status) {
    return <SectionMessage appearance="error" title="Spec Guard could not load">{<Text>{error}</Text>}</SectionMessage>;
  }
  if (!status) return <Spinner label="Loading Spec Guard" />;

  if (status.pages.length === 0) {
    return (
      <Stack space="space.100">
        <EmptyState
          header="No specification linked"
          description="Link a Confluence page to this work item (or paste its URL in the description). Spec Guard will compare the spec with this work item and warn you when the spec changes."
        />
        {status.errors.map((e, i) => (
          <SectionMessage key={i} appearance="warning">
            <Text>
              Page {e.pageId}: {e.message}
            </Text>
          </SectionMessage>
        ))}
      </Stack>
    );
  }

  return (
    <Stack space="space.150">
      {error ? <SectionMessage appearance="error">{<Text>{error}</Text>}</SectionMessage> : null}
      <Inline space="space.100" alignBlock="center">
        <Text>Spec:</Text>
        {status.pages.map((p) => (
          <Link key={p.id} href={p.url || '#'} openNewTab>
            {p.title} (v{p.version})
          </Link>
        ))}
      </Inline>
      <Tabs id="specguard-tabs">
        <TabList>
          <Tab>Alignment</Tab>
          <Tab>Verify a change</Tab>
        </TabList>
        <TabPanel>
          <Box padding="space.150">
            {status.analysis ? (
              <AlignmentView status={status} onRun={run} running={running} />
            ) : (
              <Stack space="space.150">
                <Heading size="small">Check this work item against its specification</Heading>
                <Text>
                  Spec Guard reads the linked spec, lists the requirements that apply to this work item, and flags anything
                  missing or contradictory — with quotes from both sides.
                </Text>
                <Inline>
                  <LoadingButton appearance="primary" isLoading={running} onClick={run}>
                    Check alignment
                  </LoadingButton>
                </Inline>
              </Stack>
            )}
          </Box>
        </TabPanel>
        <TabPanel>
          <Box padding="space.150">
            <VerifyView />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
