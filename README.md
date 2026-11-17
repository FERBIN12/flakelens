# FlakeLens

**Stop re-running CI and hoping. FlakeLens tells your team which failing tests are flaky, which are real
regressions, and files the Jira issue with the evidence.**

FlakeLens is an [Atlassian Forge](https://developer.atlassian.com/platform/forge/) app for Jira with a Rovo agent
and Rovo MCP tools. Your CI uploads its JUnit XML report after every run. FlakeLens keeps a per-test history
and separates two very different problems:

| Verdict | Rule (see `app/src/core/flake.js`) | What to do |
|---|---|---|
| **flaky** | the same commit both passed and failed, or the outcome flips in >= 30% of consecutive runs (with >= 2 passes and >= 2 failures) | quarantine or fix the nondeterminism |
| **broken** (regression) | failed the last 3+ runs in a row after passing before; FlakeLens names the first failing run and commit | bisect from that commit |
| healthy | everything else, including one-off failures | nothing |

Then you just ask Rovo: *"Which tests are flaky in demo-shop, and is anything actually broken?"* or
*"File a Jira issue in SHOP for the worst flaky test."* The agent only reports what the stored runs show.

## What is in the app

- **Web trigger `ingest-junit`**: CI POSTs a JUnit XML report (`?project=&commit=&run=&branch=`), authenticated with
  a bearer token stored as an encrypted Forge variable. Duplicate run ids are ignored, so retried uploads do not
  double count. `DELETE ?project=` clears one project's history.
- **Rovo agent "FlakeLens Triage"** with four actions: `list-flaky-tests`, `explain-test`, `list-recent-runs`,
  `file-flaky-issue` (creates a Bug, or a Task if the project has no Bug type, labelled `flakelens`; if FlakeLens
  already filed one for that test it adds a comment with the new evidence instead of a duplicate).
- **Rovo MCP module `flakelens-mcp`** exposing the three read-only tools to MCP clients.
- **Jira global page "FlakeLens"** (UI Kit, `app/src/frontend/index.jsx` + resolver `app/src/resolver.js`): project
  picker, totals, a passed/failed bar per CI run, and the ranked flaky/regression table with the evidence line for
  each test. It reads the same stored data as the agent, so the page and Rovo always agree.
- **Forge KVS storage**: last 50 observations per test, last 30 runs per project.
- Dependency-free JUnit parser (Jest/pytest/Surefire/Node test runner style reports), no XML entity expansion.

## Try it without any CI (2 minutes)

Install FlakeLens on a Jira site, open **Apps > FlakeLens** and press **Load sample data**. It ingests 12 bundled
JUnit reports into a separate project called `sample-demo-shop`. These are real reports, not hand-written: they were
produced by `scripts/make_sample_bundle.sh`, which runs the `demo-shop` suite 4 times on each of its 3 commits (see
below) and saves every report to `app/src/sample/sample_runs.js`. Then ask the FlakeLens Triage agent in Rovo
*"Which tests are flaky in sample-demo-shop?"*. Pressing the button again changes nothing (run ids are de-duplicated).

![Dashboard after Load sample data](https://github.com/FERBIN12/flakelens/releases/download/media-v2/sample_loaded.png)


## Use it from any MCP client (Claude Code, Cursor, ...)

The `rovo:mcp` module exposes the three read-only tools outside Atlassian, through Atlassian's Forge MCP endpoint:

```
https://mcp.atlassian.com/forge/f4b87f81-c151-4fec-92ae-c733a7b23e0f
```

1. A site admin turns it on once (it is off by default): **admin.atlassian.com > your site > Connected apps >
   FlakeLens > Details > Tools > Enable tools**.
2. Add the server to your client, for example Claude Code:
   `claude mcp add --transport http flakelens https://mcp.atlassian.com/forge/f4b87f81-c151-4fec-92ae-c733a7b23e0f`
3. The client opens Atlassian's OAuth consent page; pick your site and press **Accept**.

Verified on 2026-11-17 with an OAuth 2.1 (dynamic client registration + PKCE) client over Streamable HTTP:
`tools/list` returned `list-flaky-tests`, `explain-test` and `list-recent-runs` (Atlassian appends the environment,
for example `_development`), and `list-flaky-tests` on `sample-demo-shop` returned the same ranking as the Jira page
(9 tests, 12 runs, top flaky test `inventory.test.js::lookup is fast enough`, score 74).

## Run it yourself (3 commands)

```bash
cd app && npm install && npm test             # 16 unit tests: parser, classifier, ingest, issue text, sample data
forge deploy -e development && forge install -e development --product jira --site <your-site>.atlassian.net
forge variables set --encrypt -e development FLAKELENS_INGEST_TOKEN <random-32-chars> && forge deploy -e development
```

Get the upload URL with `forge webtrigger create -f ingest-junit -s <your-site>.atlassian.net -p Jira -e development`.

### Demo data that is real, not mocked

`demo-shop/` is a tiny shop module whose tests are genuinely nondeterministic (a latency assumption, a lost-update
race across an `await`, a `Promise.race`). `scripts/make_demo_history.sh` builds a 3-commit git history where the
third commit really breaks the coupon math. `scripts/demo_ci.sh` checks out each commit, runs the suite 4 times
with Node's built-in JUnit reporter and uploads every report:

```bash
FLAKELENS_URL=<web trigger url> FLAKELENS_TOKEN=<token> scripts/demo_ci.sh demo-shop 4
```

Because the flaky tests are really random, exact counts differ between runs; the regression always shows up.

### From any CI (GitHub Actions example)

```yaml
- name: Upload test results to FlakeLens
  if: always()
  run: |
    curl -sS -X POST -H "Authorization: Bearer ${{ secrets.FLAKELENS_TOKEN }}" -H 'Content-Type: application/xml' \
      --data-binary @junit.xml \
      "${{ secrets.FLAKELENS_URL }}?project=${{ github.event.repository.name }}&commit=${{ github.sha }}&run=${{ github.run_id }}-${{ github.run_attempt }}&branch=${{ github.ref_name }}"
```

(`scripts/upload-junit.sh` does the same with URL encoding.)

## How it was built

Built for Atlassian Codegeist 2026 by Ferbin Richard. **The code was written with Claude Code (Anthropic's AI
coding agent) directed by Ferbin**, who chose the problem and design and verified every feature by running it
on an Atlassian developer site (the Rovo answers and the Jira issue in the demo come from real uploaded runs).

Built on Atlassian Forge (`@forge/api`, `@forge/kvs`), Rovo agents/actions and the Rovo MCP module (Preview).
The Forge app was started from the `rovo-agent-rovo` template.

## License

MIT, see [LICENSE](LICENSE).
