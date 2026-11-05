/**
 * Confluence sayfa basligi altindaki Spec Guard rozeti.
 * 1) Bu spesifikasyona bagli Jira isleri ve uyum durumlari
 * 2) Kapsama haritasi: her gereksinim hangi islerde karsilaniyor, hangileri hic karsilanmiyor (bosluk)
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  Em,
  Inline,
  Link,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const COV = {
  gap: { label: 'Gap', appearance: 'removed' },
  conflict: { label: 'Conflict', appearance: 'removed' },
  partial: { label: 'Partial', appearance: 'moved' },
  covered: { label: 'Covered', appearance: 'success' },
};
const ORDER = { gap: 0, conflict: 1, partial: 2, covered: 3 };

const card = xcss({
  maxWidth: '400px',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'border.radius',
  padding: 'space.100',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Keys = ({ keys }) => (
  <Inline space="space.050">
    {keys.map((k) => (
      <Link key={k} href={`/browse/${k}`} openNewTab>
        {k}
      </Link>
    ))}
  </Inline>
);

/** Bosluklar icin is olusturma: onay penceresi, sonra olusan islerin listesi. */
const GapCreator = ({ gaps, onCreated }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await invoke('createGapItems', { reqIds: gaps.map((g) => g.id) });
    setBusy(false);
    if (r.ok) {
      setResult(r.data);
      setOpen(false);
      onCreated && onCreated();
    } else setError(r.error);
  };

  if (result) {
    return (
      <SectionMessage appearance="success" title="Work items created">
        <Stack space="space.050">
          {result.created.map((c) => (
            <Inline key={c.key} space="space.075">
              <Link href={`/browse/${c.key}`} openNewTab>
                {c.key}
              </Link>
              <Text>{c.summary}</Text>
            </Inline>
          ))}
          {result.skipped.map((c) => (
            <Text key={c.id}>
              {c.id} already has {c.key}
            </Text>
          ))}
        </Stack>
      </SectionMessage>
    );
  }
  return (
    <>
      <Inline>
        <Button appearance="primary" spacing="compact" onClick={() => setOpen(true)}>
          Create {gaps.length} work item{gaps.length === 1 ? '' : 's'} for gaps
        </Button>
      </Inline>
      <ModalTransition>
        {open ? (
          <Modal onClose={() => setOpen(false)}>
            <ModalHeader>
              <ModalTitle>Create work items for uncovered requirements</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>
                  Spec Guard will create one work item per requirement, in the same project and type as the work items already linked to
                  this spec. Each one links back to this page and quotes the requirement.
                </Text>
                {gaps.map((g) => (
                  <Text key={g.id}>
                    • <Strong>{g.id}</Strong> {g.requirement}
                  </Text>
                ))}
                {error ? <Text>{error}</Text> : null}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <LoadingButton appearance="primary" isLoading={busy} onClick={create}>
                Create work items
              </LoadingButton>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </>
  );
};

const CoverageView = ({ cov, stale, running, onRun }) => {
  const t = cov.totals;
  const reqs = [...cov.requirements].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <Stack space="space.100">
      <Strong>Requirement coverage</Strong>
      <Inline space="space.075" alignBlock="center" shouldWrap>
        <Lozenge appearance={t.gap ? 'removed' : 'success'} isBold>
          {t.gap} gap{t.gap === 1 ? '' : 's'}
        </Lozenge>
        {t.conflict ? <Lozenge appearance="removed">{t.conflict} conflict</Lozenge> : null}
        {t.partial ? <Lozenge appearance="moved">{t.partial} partial</Lozenge> : null}
        <Lozenge appearance="success">
          {t.covered}/{t.total} covered
        </Lozenge>
      </Inline>
      {cov.summary ? <Text>{cov.summary}</Text> : null}
      {t.gap ? <GapCreator gaps={cov.requirements.filter((q) => q.status === 'gap')} onCreated={onRun} /> : null}
      {stale ? (
        <SectionMessage appearance="warning">
          <Text>The spec or its linked work items changed since this map was built.</Text>
        </SectionMessage>
      ) : null}
      {reqs.map((q) => (
        <Box key={q.id} xcss={card}>
          <Stack space="space.050">
            {/* Etiket ve kimlik ayri satirda: uzun gereksinim metni etiketi sikistirmasin */}
            <Inline space="space.075" alignBlock="center">
              <Lozenge appearance={COV[q.status].appearance} isBold>
                {COV[q.status].label}
              </Lozenge>
              <Strong>{q.id}</Strong>
            </Inline>
            <Text>{q.requirement}</Text>
            {q.coveredBy.length ? (
              <Inline space="space.050">
                <Text>Delivered by</Text>
                <Keys keys={q.coveredBy} />
              </Inline>
            ) : null}
            {q.conflictsIn.length ? (
              <Inline space="space.050">
                <Text>Contradicted in</Text>
                <Keys keys={q.conflictsIn} />
              </Inline>
            ) : null}
            {q.note ? <Text>{q.note}</Text> : null}
            {q.status === 'gap' && q.specQuote ? (
              <Text>
                <Em>“{q.specQuote}”</Em>
              </Text>
            ) : null}
          </Stack>
        </Box>
      ))}
      <Inline>
        <LoadingButton spacing="compact" isLoading={running} onClick={onRun}>
          Rebuild coverage map
        </LoadingButton>
      </Inline>
    </Stack>
  );
};

const App = () => {
  const [items, setItems] = useState(null);
  const [cov, setCov] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  const loadCoverage = async () => {
    const r = await invoke('getCoverage');
    if (r.ok) setCov(r.data);
    else setError(r.error);
    return r.ok ? r.data : null;
  };

  const runCoverage = async () => {
    setRunning(true);
    setError(null);
    const r = await invoke('requestCoverage');
    if (!r.ok) {
      setError(r.error);
      setRunning(false);
      return;
    }
    for (let i = 0; i < 60; i++) {
      await sleep(i < 5 ? 3000 : 5000);
      const d = await loadCoverage();
      if (!d || !d.job || d.job.state !== 'running') {
        if (d && d.job && d.job.state === 'error') setError(d.job.error);
        break;
      }
    }
    setRunning(false);
  };

  useEffect(() => {
    invoke('pageAlignment').then((r) => (r.ok ? setItems(r.data) : setError(r.error)));
    loadCoverage();
  }, []);

  if (!items || !cov) return error ? <Text>Spec Guard: {error}</Text> : <Spinner label="Loading" />;

  return (
    <Stack space="space.150">
      {error ? (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      {items.rows.length === 0 ? (
        <Text>No checked Jira work items link this page yet. Link this page from a work item and open its Spec Guard panel.</Text>
      ) : (
        <Stack space="space.075">
          <Text>
            <Strong>{items.rows.length}</Strong> work item(s) implement this spec · <Strong>{items.drifting}</Strong> with conflicts
          </Text>
          {items.rows.map((r) => (
            <Inline key={r.issueKey} space="space.100" alignBlock="center" shouldWrap>
              <Lozenge appearance={r.conflicts ? 'removed' : r.missing ? 'moved' : 'success'}>
                {r.conflicts ? `${r.conflicts} conflict` : r.missing ? `${r.missing} missing` : 'aligned'}
              </Lozenge>
              <Link href={`/browse/${r.issueKey}`} openNewTab>
                {r.issueKey}
              </Link>
              <Text>{r.summary}</Text>
              {r.specChanged ? <Lozenge appearance="moved">re-check needed</Lozenge> : null}
            </Inline>
          ))}
        </Stack>
      )}
      {cov.coverage ? (
        <CoverageView cov={cov.coverage} stale={cov.stale} running={running} onRun={runCoverage} />
      ) : (
        <Stack space="space.075">
          <Text>
            Map every requirement of this spec to the Jira work items that deliver it, and find requirements that no work item covers.
          </Text>
          <Inline>
            <LoadingButton appearance="primary" isLoading={running} onClick={runCoverage}>
              Map requirement coverage
            </LoadingButton>
          </Inline>
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
