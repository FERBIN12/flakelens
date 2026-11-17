/**
 * Resolver for the FlakeLens Jira dashboard (jira:globalPage, UI Kit).
 * Reads the same stored data the Rovo agent and MCP tools use, so the page and the agent always agree.
 */
import Resolver from '@forge/resolver';
import { forgeStore } from './store.js';
import { flakyReport, runsKey, safe, PROJECTS_KEY } from './core/ingest.js';
import { loadSample } from './core/sample.js';
import sampleBundle from './sample/sample_runs.js';

const resolver = new Resolver();

resolver.define('getDashboard', async ({ payload }) => {
  const projects = (await forgeStore.get(PROJECTS_KEY)) || [];
  const project = payload && payload.project && projects.includes(safe(payload.project)) ? safe(payload.project) : projects[0];
  if (!project) return { projects: [], project: null };
  const report = await flakyReport(forgeStore, project, 50);
  const runs = ((await forgeStore.get(runsKey(project))) || []).slice(-20);
  return { projects, project, report, runs };
});

// "Load sample data" button: real bundled demo-shop runs into project sample-demo-shop (duplicates skipped).
resolver.define('loadSample', async () => loadSample(forgeStore, sampleBundle));

export const handler = resolver.getDefinitions();
