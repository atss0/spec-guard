/**
 * Spec Guard issue panel: alignment report, align-with-spec, and change verification.
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
  Toggle,
  Tooltip,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { pollJob, timeAgo } from './poll';

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

/** A quote with a marker when it could not be found in its source. */
const Quote = ({ text, verified }) => (
  <>
    <Em>“{text}”</Em>
    {verified === false ? (
      <Tooltip content="This quote was not found word for word in the source. Check it before relying on it.">
        <Lozenge appearance="moved">unverified quote</Lozenge>
      </Tooltip>
    ) : null}
  </>
);

const RequirementCard = ({ r }) => (
  <Box xcss={card}>
    <Stack space="space.075">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={STATUS[r.status].appearance}>{STATUS[r.status].label}</Lozenge>
        <Strong>{r.requirement}</Strong>
      </Inline>
      {r.specQuote ? (
        <Text>
          Spec{r.page ? ` (${r.page})` : ''}: <Quote text={r.specQuote} verified={r.specQuoteVerified} />
        </Text>
      ) : null}
      {r.status === 'elsewhere' ? (
        <Text>Delivered by {r.coveredBy ? <Link href={`/browse/${r.coveredBy}`}>{r.coveredBy}</Link> : 'another work item'}</Text>
      ) : (
        <Text>Work item: {r.issueQuote ? <Quote text={r.issueQuote} verified={r.issueQuoteVerified} /> : <Em>not mentioned</Em>}</Text>
      )}
      {r.explanation ? <Text>{r.explanation}</Text> : null}
      {r.unverifiedConflict ? (
        <Text>
          <Em>Reported as a conflict, but the spec quote was not found in the spec, so it is not counted as one. Check it by hand.</Em>
        </Text>
      ) : null}
    </Stack>
  </Box>
);

/** Before/after of a spec change (only shown to users who can read the spec). */
const PendingChange = ({ c }) => (
  <Stack space="space.050">
    <Text>
      <Strong>{c.title}</Strong> → v{c.version}
      {c.diff && c.diff.summary ? `: ${c.diff.summary}` : ''}
    </Text>
    {c.diff
      ? c.diff.changes.slice(0, 3).map((d, i) => (
          <Text key={i}>
            {d.before ? <Quote text={d.before} verified={d.beforeVerified} /> : <Em>(new)</Em>} →{' '}
            {d.after ? <Quote text={d.after} verified={d.afterVerified} /> : <Em>(removed)</Em>}
          </Text>
        ))
      : null}
  </Stack>
);

/** Proposes acceptance criteria that match the spec; applies them only after the user confirms. */
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
    try {
      setProposal(await pollJob('getFix'));
      setState('ready');
    } catch (e) {
      setError(e.message);
      setState('idle');
    }
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
        <Text>The acceptance criteria now match the spec and an audit comment was added. Reload the work item to see the new description.</Text>
      </SectionMessage>
    );
  }
  if (state === 'ready' || state === 'applying') {
    return (
      <SectionMessage appearance="discovery" title="Proposed acceptance criteria">
        <Stack space="space.100">
          {proposal.changes.length ? (
            <Stack space="space.050">
              <Strong>Changes</Strong>
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
          <Text>
            <Em>Only the acceptance criteria section of the description is replaced. The rest stays as it is.</Em>
          </Text>
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
        <Text>You review the changes before anything is saved.</Text>
      </Inline>
    </Stack>
  );
};

const AlignmentView = ({ status, onRun, onApplied, running }) => {
  const a = status.analysis;
  const reqs = [...a.requirements].sort((x, y) => ORDER[x.status] - ORDER[y.status]);
  const counts = reqs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  const qc = a.quoteCheck;
  return (
    <Stack space="space.200">
      {status.stale ? (
        <SectionMessage appearance="warning" title="Out of date">
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
        <Inline space="space.100" alignBlock="center" shouldWrap>
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
      {counts.conflict || counts.missing ? <FixPanel onApplied={onApplied} /> : null}
      {a.scope ? (
        <Text>
          <Strong>Scope:</Strong> {a.scope}
        </Text>
      ) : null}
      <Text>
        <Em>
          Checked {timeAgo(status.analyzedAt)} against {status.pages.map((p) => `“${p.title}” v${p.version}`).join(', ')}
          {qc && qc.checked ? ` · ${qc.verified} of ${qc.checked} quotes found word for word in the sources` : ''}
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
    if (!r.ok) setError(r.error);
    else {
      try {
        setResult(await pollJob('getVerify'));
      } catch (e) {
        setError(e.message);
      }
    }
    setBusy(false);
  };
  return (
    <Stack space="space.150">
      <Text>Paste a summary or diff of what was implemented. Spec Guard checks it against the linked spec.</Text>
      {/* Uncontrolled on purpose: a controlled TextArea can drop characters while typing fast. */}
      <TextArea name="change" placeholder="e.g. Added password reset: link valid for 24 hours, sent by email" onChange={(e) => setChange(e.target.value)} />
      <Inline>
        <LoadingButton appearance="primary" isLoading={busy} isDisabled={!change.trim()} onClick={run}>
          Verify change
        </LoadingButton>
      </Inline>
      {error ? (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
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
                  <Lozenge appearance={f.severity === 'high' ? 'removed' : f.severity === 'medium' ? 'moved' : 'default'}>{f.severity}</Lozenge>
                  <Strong>{f.requirement}</Strong>
                </Inline>
                {f.specQuote ? (
                  <Text>
                    Spec: <Quote text={f.specQuote} verified={f.specQuoteVerified} />
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

/** Lets the user exclude linked pages that are not specs (meeting notes, designs, ...). */
const SpecPages = ({ status, onChanged }) => {
  const [busy, setBusy] = useState(null);
  const toggle = async (pageId, ignored) => {
    setBusy(pageId);
    await invoke('setPageIgnored', { pageId, ignored });
    setBusy(null);
    onChanged();
  };
  const linked = status.linkedPages || [];
  if (linked.length <= 1 && !linked.some((p) => p.ignored)) {
    return (
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Text>Spec:</Text>
        {status.pages.map((p) => (
          <Link key={p.id} href={p.url || '#'} openNewTab>
            {p.title} (v{p.version})
          </Link>
        ))}
      </Inline>
    );
  }
  return (
    <Stack space="space.050">
      <Text>Linked Confluence pages. Turn off pages that are not specifications:</Text>
      {linked.map((lp) => {
        const page = status.pages.find((p) => p.id === lp.id);
        return (
          <Inline key={lp.id} space="space.100" alignBlock="center">
            <Toggle isChecked={!lp.ignored} isDisabled={busy === lp.id} onChange={() => toggle(lp.id, !lp.ignored)} />
            {page ? (
              <Link href={page.url || '#'} openNewTab>
                {page.title} (v{page.version})
              </Link>
            ) : (
              <Text>{lp.ignored ? `Page ${lp.id} (ignored)` : `Page ${lp.id} (not readable)`}</Text>
            )}
          </Inline>
        );
      })}
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
    return r.ok ? r.data : null;
  };

  const waitForAnalysis = async () => {
    setRunning(true);
    for (let i = 0; i < 90; i++) {
      await new Promise((res) => setTimeout(res, i < 5 ? 2000 : 4000));
      const d = await load();
      if (!d) break;
      if (!d.job || d.job.state !== 'running') {
        if (d.job && d.job.state === 'error') setError(`The check failed: ${d.job.error}`);
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
    await waitForAnalysis();
  };

  useEffect(() => {
    load();
  }, []);

  // A check started elsewhere (sidebar, re-check after an edit) is still running: wait for it.
  useEffect(() => {
    if (status && status.job && status.job.state === 'running' && !running) waitForAnalysis();
  }, [status && status.job && status.job.state]);

  if (error && !status) {
    return (
      <SectionMessage appearance="error" title="Spec Guard could not load">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!status) return <Spinner label="Loading Spec Guard" />;

  if (status.pages.length === 0) {
    return (
      <Stack space="space.100">
        <EmptyState
          header="No specification linked"
          description="Paste the URL of a Confluence page into the description, or link the page to this work item. Spec Guard will then compare the spec with this work item and tell you when the spec changes."
        />
        {(status.linkedPages || []).some((p) => p.ignored) ? <SpecPages status={status} onChanged={load} /> : null}
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
      {error ? (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      <SpecPages status={status} onChanged={load} />
      <Tabs id="specguard-tabs">
        <TabList>
          <Tab>Alignment</Tab>
          <Tab>Verify a change</Tab>
        </TabList>
        <TabPanel>
          <Box padding="space.150">
            {status.analysis ? (
              <AlignmentView status={status} onRun={run} onApplied={waitForAnalysis} running={running} />
            ) : (
              <Stack space="space.150">
                <Heading size="small">Check this work item against its spec</Heading>
                <Text>
                  Spec Guard reads the linked spec, finds the requirements this work item is responsible for, and flags anything missing or
                  contradictory, quoting both sides.
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
