/**
 * "Load sample data": ingests the bundled sample runs (src/sample/sample_runs.json, real JUnit reports produced by
 * scripts/make_sample_bundle.sh from the demo-shop suite) into a clearly named project, so a new install shows
 * FlakeLens working before any CI is wired up. Re-running it is harmless: duplicate run ids are skipped.
 */
import { ingestRun } from './ingest.js';

export const SAMPLE_PROJECT = 'sample-demo-shop';

/** Space the runs one hour apart, ending at `now`, so the history reads like a day of CI. */
export async function loadSample(store, bundle, now = Date.now()) {
  const runs = bundle.runs || [];
  let loaded = 0;
  for (let i = 0; i < runs.length; i += 1) {
    const r = runs[i];
    const res = await ingestRun(store, {
      project: SAMPLE_PROJECT, commit: r.commit, branch: r.branch, runId: r.runId, xml: r.xml,
      now: now - (runs.length - 1 - i) * 3600 * 1000,
    });
    if (!res.duplicate) loaded += 1;
  }
  return { project: SAMPLE_PROJECT, loaded, total: runs.length };
}
