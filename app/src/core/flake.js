/**
 * Flake detection: pure functions over per-test run history, so they can be unit tested without Forge.
 *
 * A test's history is an array of observations, oldest first:
 *   { runId, commit, ts, status: 'pass'|'fail'|'error'|'skip', message }
 *
 * Verdicts:
 *   - "flaky":   the same commit produced both a pass and a failure (strongest evidence), OR the outcome flips
 *                often across recent runs (flip rate >= FLIP_THRESHOLD with at least 2 passes and 2 failures).
 *   - "broken":  the most recent BROKEN_STREAK+ runs all failed after earlier passes: a real regression, not a flake.
 *                We report the first failing run/commit so someone can bisect.
 *   - "healthy": everything else (including tests with too little history to judge).
 */

export const MAX_HISTORY = 50; // observations kept per test
export const FLIP_THRESHOLD = 0.3;
export const BROKEN_STREAK = 3;

const isFail = (s) => s === 'fail' || s === 'error';

/** Append one run's observation to a history, dropping skips and keeping the newest MAX_HISTORY entries. */
export function appendObservation(history, obs) {
  if (obs.status === 'skip') return history || [];
  const next = [...(history || []), obs];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** Commits that saw both a pass and a failure of this test. */
export function mixedCommits(history) {
  const byCommit = new Map();
  for (const o of history) {
    if (!o.commit) continue;
    const e = byCommit.get(o.commit) || { pass: 0, fail: 0 };
    if (isFail(o.status)) e.fail += 1;
    else e.pass += 1;
    byCommit.set(o.commit, e);
  }
  return [...byCommit.entries()].filter(([, e]) => e.pass > 0 && e.fail > 0).map(([c, e]) => ({ commit: c, ...e }));
}

/** Fraction of consecutive run pairs whose outcome changed (0 = stable, 1 = alternates every run). */
export function flipRate(history) {
  if (history.length < 2) return 0;
  let flips = 0;
  for (let i = 1; i < history.length; i += 1) {
    if (isFail(history[i].status) !== isFail(history[i - 1].status)) flips += 1;
  }
  return flips / (history.length - 1);
}

/**
 * Classify one test from its history.
 * @returns {{verdict:'flaky'|'broken'|'healthy', score:number, runs:number, passes:number, failures:number,
 *            flipRate:number, mixedCommits:object[], firstBad:object|null, lastFailure:object|null, reason:string}}
 */
export function classify(history) {
  const h = history || [];
  const failures = h.filter((o) => isFail(o.status)).length;
  const passes = h.length - failures;
  const fr = flipRate(h);
  const mixed = mixedCommits(h);
  const lastFailure = [...h].reverse().find((o) => isFail(o.status)) || null;

  // Trailing failure streak (for "broken").
  let streak = 0;
  for (let i = h.length - 1; i >= 0 && isFail(h[i].status); i -= 1) streak += 1;
  const firstBad = streak > 0 ? h[h.length - streak] : null;

  const base = { runs: h.length, passes, failures, flipRate: Math.round(fr * 100) / 100, mixedCommits: mixed, lastFailure };

  if (streak >= BROKEN_STREAK && passes > 0 && mixed.every((m) => m.commit !== firstBad.commit)) {
    return {
      ...base,
      verdict: 'broken',
      score: 0,
      firstBad,
      reason: `Failed the last ${streak} runs in a row after passing before; first failing run ${firstBad.runId} at commit ${short(firstBad.commit)}.`,
    };
  }
  if (mixed.length > 0) {
    const m = mixed[0];
    return {
      ...base,
      verdict: 'flaky',
      score: flakeScore(fr, mixed.length, failures, h.length),
      firstBad: null,
      reason: `Passed and failed on the same commit ${short(m.commit)} (${m.pass} pass / ${m.fail} fail)${mixed.length > 1 ? ` and on ${mixed.length - 1} other commit(s)` : ''}.`,
    };
  }
  if (fr >= FLIP_THRESHOLD && passes >= 2 && failures >= 2) {
    return {
      ...base,
      verdict: 'flaky',
      score: flakeScore(fr, 0, failures, h.length),
      firstBad: null,
      reason: `Outcome flipped in ${Math.round(fr * 100)}% of consecutive runs (${passes} pass / ${failures} fail over ${h.length} runs).`,
    };
  }
  return { ...base, verdict: 'healthy', score: 0, firstBad: null, reason: failures ? `${failures} failure(s) in ${h.length} runs, no flaky pattern.` : `Passed all ${h.length} runs.` };
}

/** 0-100 "how flaky" score used for ranking: flip rate, same-commit evidence and failure share. */
export function flakeScore(fr, mixedCount, failures, runs) {
  const failShare = runs ? failures / runs : 0;
  const s = 50 * fr + 15 * Math.min(mixedCount, 2) + 40 * Math.min(failShare, 0.5);
  return Math.max(1, Math.min(100, Math.round(s)));
}

function short(commit) {
  return commit ? String(commit).slice(0, 8) : '(unknown)';
}

/**
 * Rank all tests in a project: flaky first (by score), then broken, healthy omitted unless includeHealthy.
 * @param {Record<string, object[]>} histories map of testId -> history
 */
export function rankTests(histories, { includeHealthy = false, limit = 20 } = {}) {
  const rows = Object.entries(histories).map(([id, h]) => ({ id, ...classify(h) }));
  const order = { flaky: 0, broken: 1, healthy: 2 };
  return rows
    .filter((r) => includeHealthy || r.verdict !== 'healthy')
    .sort((a, b) => order[a.verdict] - order[b.verdict] || b.score - a.score || b.failures - a.failures || a.id.localeCompare(b.id))
    .slice(0, limit);
}
