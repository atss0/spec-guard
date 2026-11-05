/**
 * Spec Guard global page: every checked work item in one table (conflicts first), a manual
 * "check specs for changes" action, and demo data for trying the app on an empty site.
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Code,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Link,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const scoreLozenge = (s) => (
  <Lozenge appearance={s === null ? 'default' : s >= 85 ? 'success' : s >= 60 ? 'moved' : 'removed'} isBold>
    {s === null ? 'n/a' : `${s}%`}
  </Lozenge>
);

const head = {
  cells: [
    { key: 'issue', content: 'Work item', isSortable: true },
    { key: 'score', content: 'Alignment', isSortable: true },
    { key: 'conflicts', content: 'Conflicts', isSortable: true },
    { key: 'missing', content: 'Missing', isSortable: true },
    { key: 'spec', content: 'Specification' },
    { key: 'state', content: 'State' },
  ],
};

/** Creates a spec page and three drifting work items so the app can be tried in a minute. */
const DemoCreator = () => {
  const [targets, setTargets] = useState(null);
  const [project, setProject] = useState(null);
  const [space, setSpace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke('demoTargets').then((r) => (r.ok ? setTargets(r.data) : setError(r.error)));
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await invoke('createDemo', { projectKey: project.value, spaceId: space.value });
    setBusy(false);
    if (r.ok) setResult(r.data);
    else setError(r.error);
  };

  if (result) {
    return (
      <SectionMessage appearance="success" title="Demo scenario created">
        <Stack space="space.075">
          <Text>
            Spec:{' '}
            <Link href={result.pageUrl || '#'} openNewTab>
              {result.pageTitle}
            </Link>
          </Text>
          <Inline space="space.100">
            <Text>Work items:</Text>
            {result.keys.map((k) => (
              <Link key={k} href={`/browse/${k}`} openNewTab>
                {k}
              </Link>
            ))}
          </Inline>
          <Text>
            Open {result.keys[0]} and click “Check alignment” in the Spec Guard section of the details sidebar. It contradicts the spec in four
            places; the other two work items each cover part of the spec.
          </Text>
        </Stack>
      </SectionMessage>
    );
  }
  return (
    <Stack space="space.100">
      <Heading size="small">Try with demo data</Heading>
      <Text>Creates a password-reset spec in Confluence and three linked work items that deliberately drift from it.</Text>
      {error ? <Text>{error}</Text> : null}
      {!targets ? (
        error ? null : <Spinner size="small" label="Loading spaces" />
      ) : (
        <Inline space="space.100" alignBlock="end" shouldWrap>
          <Select placeholder="Jira space for work items" options={targets.projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))} onChange={setProject} />
          <Select placeholder="Confluence space for the spec" options={targets.spaces.map((sp) => ({ label: sp.name, value: sp.id }))} onChange={setSpace} />
          <LoadingButton appearance="primary" isLoading={busy} isDisabled={!project || !space} onClick={create}>
            Create demo scenario
          </LoadingButton>
        </Inline>
      )}
    </Stack>
  );
};

const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const load = () => invoke('listAlignment').then((r) => (r.ok ? setData(r.data) : setError(r.error)));
  useEffect(() => {
    load();
  }, []);

  const checkNow = async () => {
    setChecking(true);
    const r = await invoke('checkSpecsNow');
    setChecking(false);
    setCheckResult(r.ok ? r.data.queued : null);
  };

  if (error) {
    return (
      <SectionMessage appearance="error" title="Could not load Spec Guard">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!data) return <Spinner label="Loading" />;

  const rows = data.rows.map((r) => ({
    key: r.issueKey,
    cells: [
      {
        key: r.issueKey,
        content: (
          <Stack space="space.025">
            <Link href={`/browse/${r.issueKey}`}>{r.issueKey}</Link>
            <Text>{r.summary}</Text>
          </Stack>
        ),
      },
      { key: r.score ?? -1, content: scoreLozenge(r.score) },
      { key: r.conflicts, content: r.conflicts ? <Lozenge appearance="removed">{r.conflicts}</Lozenge> : <Text>0</Text> },
      { key: r.missing, content: r.missing ? <Lozenge appearance="moved">{r.missing}</Lozenge> : <Text>0</Text> },
      {
        key: 'spec',
        content: (
          <Stack space="space.025">
            {r.pages.map((p) => (
              <Link key={p.id} href={p.url || '#'} openNewTab>
                {p.title} (v{p.version})
              </Link>
            ))}
          </Stack>
        ),
      },
      { key: 'state', content: r.specChanged ? <Lozenge appearance="moved">Spec changed</Lozenge> : <Lozenge appearance="success">Up to date</Lozenge> },
    ],
  }));

  const drifting = data.rows.filter((r) => r.conflicts > 0).length;
  const changed = data.rows.filter((r) => r.specChanged).length;

  return (
    <Stack space="space.200">
      <Text>Work items checked against their Confluence specs, conflicts first.</Text>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Lozenge>{data.rows.length} checked</Lozenge>
        <Lozenge appearance={drifting ? 'removed' : 'success'}>{drifting} with conflicts</Lozenge>
        <Lozenge appearance={changed ? 'moved' : 'success'}>{changed} with spec changes</Lozenge>
        <LoadingButton spacing="compact" isLoading={checking} onClick={checkNow}>
          Check specs for changes
        </LoadingButton>
        {checkResult !== null ? <Text>{checkResult ? `${checkResult} changed spec(s) found, notifying linked work items.` : 'No spec changes found.'}</Text> : null}
      </Inline>
      {data.rows.length === 0 ? (
        <EmptyState
          header="Nothing checked yet"
          description="Open a work item that links a Confluence spec and click “Check alignment” in the Spec Guard section, or create a demo scenario below."
        />
      ) : (
        <DynamicTable head={head} rows={rows} rowsPerPage={20} />
      )}
      <Text>
        Filter work items in Jira with <Code>specGuardConflicts &gt; 0</Code>, <Code>specGuardMissing &gt; 0</Code>, <Code>specGuardScore &lt; 60</Code> or{' '}
        <Code>specGuardSpecChanged = 1</Code>.
      </Text>
      <DemoCreator />
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
