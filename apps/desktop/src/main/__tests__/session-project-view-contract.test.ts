import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { deriveProjectGroups } from '../../renderer/session-project-grouping.js';
import { makeSessionSummary, renderSessionListPanel } from './session-list-render-helpers.js';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

async function readRepo(path: string): Promise<string> {
  return readFile(join(REPO_ROOT, path), 'utf8');
}

describe('sidebar project view mode', () => {
  it('renders project groups, the unassigned bucket, and keeps the status fallback path', () => {
    const sessions = [
      makeSessionSummary({
        id: 'repo-session',
        name: 'Repo session',
        cwd: 'C:\\work\\repo-a',
        status: 'active',
        lastMessageAt: 3,
      }),
      makeSessionSummary({
        id: 'pending-session',
        name: 'Pending session',
        cwd: undefined,
        status: 'active',
        lastMessageAt: undefined,
      }),
    ];

    const projectMarkup = renderSessionListPanel({
      sessions,
      statusGroups: deriveProjectGroups(sessions),
      viewMode: 'project',
    });
    assert.match(projectMarkup, /repo-a/);
    assert.match(projectMarkup, /Pending session/);

    const fallbackMarkup = renderSessionListPanel({
      sessions: [sessions[1]],
    });
    assert.match(fallbackMarkup, /待发送/);
  });

  it('AppShell derives status and project groups from the same visible session set', async () => {
    const appShell = await readRepo('apps/desktop/src/renderer/app-shell.tsx');
    const panel = await readRepo('packages/ui/src/session-list-panel.tsx');

    assert.match(appShell, /const visibleSessions = useMemo\(\(\) => filterSessions\(sessions, navSelection\), \[sessions, navSelection\]\)/);
    assert.match(appShell, /deriveSessionStatusGroups\(visibleSessions, \{ pinFirst: true \}\)/);
    assert.match(appShell, /deriveProjectGroups\(visibleSessions\)/);
    assert.match(appShell, /const sessionListGroups = viewMode === 'project' \? sessionProjectGroups : sessionStatusGroups/);
    assert.match(appShell, /statusGroups=\{sessionListGroups\}/);
    assert.doesNotMatch(appShell, /projectGroups=\{/);

    assert.doesNotMatch(panel, /projectGroups\?:/);
    assert.doesNotMatch(panel, /id: 'all'/);
  });
});
