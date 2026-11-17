import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, DynamicTable, EmptyState, Heading, Inline, Lozenge, Select, SectionMessage, Spinner, Stack,
  StackBarChart, Strong, Text, Tooltip, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const VERDICT = { flaky: 'moved', broken: 'removed', healthy: 'success' };
const tile = xcss({ padding: 'space.200', borderRadius: 'border.radius', backgroundColor: 'elevation.surface.sunken', minWidth: '150px' });

const Stat = ({ label, value }) => (
  <Box xcss={tile}>
    <Text size="small">{label}</Text>
    <Heading size="large">{String(value)}</Heading>
  </Box>
);

function runRows(runs) {
  // One bar per CI run, split into passed and failed tests (real counts from the uploaded JUnit reports).
  const rows = [];
  for (const r of runs) {
    const label = `${r.runId} (${(r.commit || '').slice(0, 7)})`;
    rows.push({ run: label, kind: 'passed', tests: Math.max(0, (r.total || 0) - (r.failed || 0) - (r.skipped || 0)) });
    rows.push({ run: label, kind: 'failed', tests: r.failed || 0 });
  }
  return rows;
}

function App() {
  const [data, setData] = useState(null);
  const [project, setProject] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    invoke('getDashboard', { project }).then(setData).catch((e) => setError(String(e && e.message ? e.message : e)));
  }, [project]);

  if (error) return <SectionMessage appearance="error"><Text>Could not load FlakeLens data: {error}</Text></SectionMessage>;
  if (!data) return <Spinner label="Loading FlakeLens" />;
  if (!data.project) {
    return (
      <EmptyState header="No CI data yet"
        description="Add the FlakeLens upload step to your CI so each test run POSTs its JUnit XML report to the FlakeLens web trigger." />
    );
  }
  const { report, runs } = data;
  const flaky = report.tests.filter((t) => t.verdict === 'flaky');
  const broken = report.tests.filter((t) => t.verdict === 'broken');

  const head = { cells: [
    { key: 'test', content: 'Test', isSortable: true },
    { key: 'verdict', content: 'Verdict', isSortable: true },
    { key: 'score', content: 'Flake score', isSortable: true },
    { key: 'fails', content: 'Failed / runs', isSortable: true },
    { key: 'why', content: 'Evidence' },
  ] };
  const rows = report.tests.map((t) => ({
    key: t.id,
    cells: [
      { key: t.id, content: <Strong>{t.id}</Strong> },
      { key: t.verdict, content: <Lozenge appearance={VERDICT[t.verdict]} isBold>{t.verdict === 'broken' ? 'regression' : t.verdict}</Lozenge> },
      { key: t.verdict === 'broken' ? -1 : t.score, content: t.verdict === 'broken' ? 'n/a (steady fail)' : String(t.score) },
      { key: t.failures, content: `${t.failures} / ${t.runs}` },
      { key: 'why-' + t.id, content: <Tooltip content={t.lastFailureMessage || 'no failure message'}><Text>{t.reason}</Text></Tooltip> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="xlarge">FlakeLens: flaky test triage</Heading>
        <Box xcss={xcss({ width: '260px' })}>
          <Select label="CI project" value={{ label: data.project, value: data.project }}
            options={data.projects.map((p) => ({ label: p, value: p }))} onChange={(o) => setProject(o.value)} />
        </Box>
      </Inline>
      <Inline space="space.200">
        <Stat label="CI runs stored" value={report.runsStored} />
        <Stat label="Tests tracked" value={report.testsTracked} />
        <Stat label="Flaky tests" value={flaky.length} />
        <Stat label="Regressions" value={broken.length} />
      </Inline>
      <StackBarChart title="Test results per CI run" subtitle="From the JUnit reports CI uploaded" data={runRows(runs)}
        xAccessor="run" yAccessor="tests" colorAccessor="kind" height={300}
        colorPalette={[{ key: 'passed', value: '#22A06B' }, { key: 'failed', value: '#C9372C' }]} />
      <Heading size="medium">Ranked: fix these first</Heading>
      <DynamicTable head={head} rows={rows} rowsPerPage={10}
        emptyView="No flaky tests or regressions in the stored runs." />
      <Text size="small">Ask the FlakeLens Triage agent in Rovo to explain a test or file a Jira issue with this evidence.</Text>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
