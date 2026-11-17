/**
 * Build the Jira issue text for a flaky or broken test (Atlassian Document Format), from real stored evidence only.
 */
export function issueSummary(t) {
  const label = t.verdict === 'broken' ? 'Regression' : 'Flaky test';
  const s = `${label}: ${t.id}`;
  return s.length > 250 ? `${s.slice(0, 247)}...` : s;
}

const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

export function issueDescription(t, project) {
  const rows = (t.recent || []).map((o) => `${o.runId}  ${o.commit ? o.commit.slice(0, 8) : '-'}  ${o.status}${o.message ? `  ${o.message}` : ''}`);
  return {
    type: 'doc',
    version: 1,
    content: [
      p(`FlakeLens verdict: ${t.verdict} (score ${t.score}/100) in CI project "${project}".`),
      p(`Why: ${t.reason}`),
      p(`Evidence: ${t.failures} failure(s) in ${t.runs} recorded run(s), outcome flip rate ${Math.round(t.flipRate * 100)}%.`),
      ...(t.lastFailure && t.lastFailure.message ? [p(`Last failure message: ${t.lastFailure.message}`)] : []),
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Recent runs (oldest first)' }] },
      { type: 'codeBlock', content: [{ type: 'text', text: rows.join('\n') || '(none)' }] },
      p('Filed by the FlakeLens Forge app from uploaded JUnit reports.'),
    ],
  };
}
