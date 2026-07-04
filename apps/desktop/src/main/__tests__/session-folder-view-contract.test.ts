import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import { readRendererShellSource } from './renderer-shell-source-helpers.js';

const repoRoot = process.cwd().endsWith('apps/desktop')
  ? join(process.cwd(), '..', '..')
  : process.cwd();

async function readRepo(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8');
}

describe('session folder view renderer contract', () => {
  it('wires AppShell folder state and actions into SessionListPanel', async () => {
    const appShell = await readRendererShellSource('app-shell.tsx');
    const panelInvocation = appShell.match(/<SessionListPanel[\s\S]*?sidebarCollapsed=\{sessionListCollapsed\}[\s\S]*?\/>/)?.[0] ?? '';

    assert.notEqual(panelInvocation, '', 'AppShell must render SessionListPanel');
    assert.match(
      panelInvocation,
      /statusGroups=\{sessionFolderGroups \?\? sessionStatusGroups\}/,
      'SessionListPanel must receive folder-derived groups while folder view is active',
    );
    assert.match(
      panelInvocation,
      /viewMode=\{sessionViewMode\}/,
      'SessionListPanel must receive the persisted status/folder view mode',
    );
    assert.match(
      panelInvocation,
      /onViewModeChange=\{changeSessionViewMode\}/,
      'SessionListPanel must receive the view-mode change handler so the toggle can render',
    );
    assert.match(
      panelInvocation,
      /folders=\{folders\}/,
      'SessionListPanel must receive folder metadata for folder headers and move menus',
    );
    assert.match(
      panelInvocation,
      /onMoveToFolder: \(sessionId, folderId\) => moveSessionToFolder\(sessionId, folderId\)/,
      'row actions must expose move-to-folder from AppShell',
    );
    assert.match(
      panelInvocation,
      /folderActions=\{\{[\s\S]*onCreateFolder: \(name\) => createFolder\(name\),[\s\S]*onRenameFolder: \(id, name\) => renameFolder\(id, name\),[\s\S]*onRemoveFolder: \(id\) => removeFolder\(id\),[\s\S]*onToggleFolderCollapsed: \(id, collapsed\) => toggleFolderCollapsed\(id, collapsed\),[\s\S]*\}\}/,
      'folder create/rename/remove/collapse actions must be wired into SessionListPanel',
    );
  });

  it('keeps SessionListPanel view toggle conditional on the wired props', async () => {
    const panel = await readRepo('packages/ui/src/session-list-panel.tsx');
    assert.match(
      panel,
      /props\.viewMode &&[\s\S]*props\.onViewModeChange &&[\s\S]*按文件夹/,
      'SessionListPanel renders the folder toggle only when AppShell passes viewMode and onViewModeChange',
    );
  });
});
