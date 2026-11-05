/**
 * Spec Guard section in the work item's details sidebar (shown on every work item): score, counts,
 * an "out of date" warning and a one-click check. The panel shows the full report.
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Inline, LoadingButton, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const run = async () => {
    setRunning(true);
    setError(null);
    const r = await invoke('runAnalysis');
    if (!r.ok) setError(r.error);
    else if (r.data.queued || r.data.alreadyRunning) {
      for (let i = 0; i < 90; i++) {
        await sleep(i < 5 ? 2000 : 4000);
        const d = await load();
        if (!d || !d.job || d.job.state !== 'running') {
          if (d && d.job && d.job.state === 'error') setError(d.job.error);
          break;
        }
      }
    } else await load();
    setRunning(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (error && !status) return <Text>{error}</Text>;
  if (!status) return <Spinner size="small" label="Loading" />;
  if (status.pages.length === 0) {
    return <Text>No spec linked. Paste a Confluence page URL into the description to check this work item against it.</Text>;
  }

  const a = status.analysis;
  const reqs = a ? a.requirements : [];
  const count = (s) => reqs.filter((r) => r.status === s).length;
  const score = a ? a.score : null;

  return (
    <Stack space="space.100">
      {a ? (
        <Inline space="space.075" alignBlock="center" shouldWrap>
          <Lozenge appearance={score === null ? 'default' : score >= 85 ? 'success' : score >= 60 ? 'moved' : 'removed'} isBold>
            {score === null ? 'no requirements' : `${score}% aligned`}
          </Lozenge>
          {count('conflict') ? <Lozenge appearance="removed">{count('conflict')} conflict</Lozenge> : null}
          {count('missing') ? <Lozenge appearance="moved">{count('missing')} missing</Lozenge> : null}
        </Inline>
      ) : (
        <Text>Not checked yet against “{status.pages[0].title}”.</Text>
      )}
      {status.stale ? (
        <SectionMessage appearance="warning">
          <Text>The spec or this work item changed since the last check.</Text>
        </SectionMessage>
      ) : null}
      {error ? <Text>{error}</Text> : null}
      <Inline>
        <LoadingButton spacing="compact" appearance={a && !status.stale ? 'default' : 'primary'} isLoading={running} onClick={run}>
          {a ? 'Re-check' : 'Check alignment'}
        </LoadingButton>
      </Inline>
      {a ? <Text>Quotes, fixes and change verification: Apps button next to the work item title → Spec Guard.</Text> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
