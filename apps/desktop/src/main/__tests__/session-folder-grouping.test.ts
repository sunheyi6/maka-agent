import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SessionFolder, SessionSummary } from '@maka/core';
import { deriveSessionFolderGroups } from '../../renderer/session-folder-grouping.js';

function session(input: {
  id: string;
  cwd?: string;
  folderId?: string | null;
  lastMessageAt?: number;
}): SessionSummary {
  return {
    id: input.id,
    name: input.id,
    isFlagged: false,
    isArchived: false,
    labels: [],
    hasUnread: false,
    backend: 'ai-sdk',
    llmConnectionSlug: 'zai-live',
    model: 'glm-4.7',
    permissionMode: 'ask',
    status: 'active',
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
    ...(input.lastMessageAt !== undefined ? { lastMessageAt: input.lastMessageAt } : {}),
  };
}

function folder(input: { id: string; name: string; order?: number; collapsed?: boolean }): SessionFolder {
  return {
    id: input.id,
    name: input.name,
    order: input.order ?? 0,
    createdAt: 1,
    updatedAt: 1,
    collapsed: input.collapsed ?? false,
  };
}

describe('deriveSessionFolderGroups', () => {
  it('groups unassigned sessions by their working directory cwd', () => {
    const groups = deriveSessionFolderGroups([
      session({ id: 'alpha-new', cwd: 'D:\\work\\alpha', lastMessageAt: 30 }),
      session({ id: 'beta', cwd: 'D:\\work\\beta', lastMessageAt: 20 }),
      session({ id: 'alpha-old', cwd: 'D:\\work\\alpha', lastMessageAt: 10 }),
    ], []);

    assert.deepEqual(groups.map((group) => group.label), ['alpha', 'beta']);
    assert.deepEqual(groups[0]?.sessions.map((item) => item.id), ['alpha-new', 'alpha-old']);
    assert.deepEqual(groups[1]?.sessions.map((item) => item.id), ['beta']);
  });

  it('keeps explicit user folders ahead of automatic cwd groups', () => {
    const groups = deriveSessionFolderGroups([
      session({ id: 'manual', cwd: 'D:\\work\\alpha', folderId: 'f1', lastMessageAt: 30 }),
      session({ id: 'auto', cwd: 'D:\\work\\alpha', lastMessageAt: 20 }),
    ], [
      folder({ id: 'f1', name: 'Pinned folder', order: 0 }),
    ]);

    assert.deepEqual(groups.map((group) => group.label), ['Pinned folder', 'alpha']);
    assert.deepEqual(groups[0]?.sessions.map((item) => item.id), ['manual']);
    assert.deepEqual(groups[1]?.sessions.map((item) => item.id), ['auto']);
  });
});
