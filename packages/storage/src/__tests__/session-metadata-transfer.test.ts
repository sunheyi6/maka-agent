import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { CreateSessionInput } from '@maka/core';
import { importLegacySessionMetadataTree } from '../session-metadata-transfer.js';
import { createLegacyFileSessionStore as createSessionStore } from '../session-store.js';
import { createSqliteSessionMetadataStore } from '../sqlite-session-metadata-store.js';

describe('legacy session metadata transfer', () => {
  test('imports every legacy line-1 header without reading transcript payloads as metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-session-transfer-'));
    const legacy = createSessionStore(root);
    const sqlite = createSqliteSessionMetadataStore(join(root, 'state.sqlite'));
    try {
      const first = await legacy.create(makeInput({ name: 'First', labels: ['alpha'] }));
      const second = await legacy.create(makeInput({ name: 'Second', labels: ['beta'] }));
      await legacy.appendMessage(first.id, {
        type: 'user',
        id: 'user-1',
        turnId: 'turn-1',
        ts: 10,
        text: 'This transcript row is not session metadata.',
      });
      await legacy.updateHeader(second.id, {
        status: 'blocked',
        blockedReason: 'permission_required',
        hasUnread: true,
      });

      const report = await importLegacySessionMetadataTree({
        workspaceRoot: root,
        destination: sqlite,
      });
      assert.deepEqual(report, {
        filesScanned: 2,
        headersRead: 2,
        headersImported: 2,
        headersExisting: 0,
        sourcesAlreadyImported: 0,
        sourcesTombstoned: 0,
      });
      assert.deepEqual((await sqlite.list()).map((record) => record.header.name).sort(), [
        'First',
        'Second',
      ]);
      assert.deepEqual(
        (await sqlite.read(first.id)).header,
        await legacy.readHeaderSnapshot(first.id),
      );
      assert.deepEqual(
        (await sqlite.read(second.id)).header,
        await legacy.readHeaderSnapshot(second.id),
      );

      await legacy.appendMessage(second.id, {
        type: 'assistant',
        id: 'assistant-1',
        turnId: 'turn-1',
        ts: 11,
        text: 'Appending transcript bytes must not invalidate the imported header.',
        modelId: 'fake-model',
      });
      await sqlite.update(first.id, { name: 'SQLite is canonical now' });
      const repeated = await importLegacySessionMetadataTree({
        workspaceRoot: root,
        destination: sqlite,
      });
      assert.deepEqual(repeated, {
        filesScanned: 2,
        headersRead: 2,
        headersImported: 0,
        headersExisting: 0,
        sourcesAlreadyImported: 2,
        sourcesTombstoned: 0,
      });
      assert.equal((await sqlite.read(first.id)).header.name, 'SQLite is canonical now');
    } finally {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('decodes legacy compatibility defaults through the FileSessionStore codec', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-session-transfer-legacy-'));
    const sqlite = createSqliteSessionMetadataStore(join(root, 'state.sqlite'));
    const sessionId = 'legacy-session';
    const path = join(root, 'sessions', sessionId, 'session.jsonl');
    try {
      const legacy = {
        id: sessionId,
        workspaceRoot: root,
        cwd: '/workspace',
        createdAt: 1,
        lastUsedAt: 2,
        name: 'New Session',
        isFlagged: false,
        labels: [],
        isArchived: false,
        pendingCwdReminder: {
          from: '/workspace/old',
          to: '/workspace',
        },
        hasUnread: false,
        backend: 'pi',
        llmConnectionSlug: 'legacy',
        connectionLocked: false,
        schemaVersion: 1,
      };
      await mkdir(join(root, 'sessions', sessionId), { recursive: true });
      await writeFile(path, `${JSON.stringify(legacy)}\n`, 'utf8');

      await importLegacySessionMetadataTree({ workspaceRoot: root, destination: sqlite });
      const header = (await sqlite.read(sessionId)).header;
      assert.equal(header.backend, 'pi-agent');
      assert.equal(header.model, 'default');
      assert.equal(header.permissionMode, 'ask');
      assert.equal(header.collaborationMode, 'agent');
      assert.equal(header.orchestrationMode, 'default');
      assert.equal(header.status, 'active');
      assert.equal(header.titleIsManual, false);
      assert.equal(header.name, 'New Chat');
      assert.equal(Object.hasOwn(header, 'pendingCwdReminder'), false);
    } finally {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('skips a malformed header and tombstones it while importing valid sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-session-transfer-invalid-'));
    const legacy = createSessionStore(root);
    const sqlite = createSqliteSessionMetadataStore(join(root, 'state.sqlite'));
    try {
      const valid = await legacy.create(makeInput({ name: 'Valid' }));
      const invalid = await legacy.create(makeInput({ name: 'Invalid' }));
      const invalidPath = join(root, 'sessions', invalid.id, 'session.jsonl');
      const lines = (await readFile(invalidPath, 'utf8')).split('\n');
      lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), labels: 'not-an-array' });
      await writeFile(invalidPath, lines.join('\n'), 'utf8');

      const report = await importLegacySessionMetadataTree({
        workspaceRoot: root,
        destination: sqlite,
      });
      assert.equal(report.filesScanned, 2);
      assert.equal(report.headersImported, 1);
      // The valid session was imported.
      assert.equal((await sqlite.read(valid.id)).header.name, 'Valid');
      // The malformed session was tombstoned, not imported.
      assert.equal(await sqlite.has(invalid.id), false);
      assert.equal(await sqlite.isTombstoned(invalid.id), true);
      // Re-importing should not retry the tombstoned session.
      const repeated = await importLegacySessionMetadataTree({
        workspaceRoot: root,
        destination: sqlite,
      });
      assert.equal(repeated.filesScanned, 2);
      assert.equal(repeated.headersImported, 0);
    } finally {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('does not tombstone a session when a non-ENOENT filesystem error occurs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-session-transfer-fs-error-'));
    const legacy = createSessionStore(root);
    const sqlite = createSqliteSessionMetadataStore(join(root, 'state.sqlite'));
    try {
      const valid = await legacy.create(makeInput({ name: 'Valid' }));
      const unreadable = await legacy.create(makeInput({ name: 'Unreadable' }));
      const unreadablePath = join(root, 'sessions', unreadable.id, 'session.jsonl');
      // Replace the session file with a directory to provoke a non-ENOENT
      // filesystem error (EISDIR) when readFirstJsonlRecord tries to open it.
      await rm(unreadablePath);
      await mkdir(unreadablePath);

      await assert.rejects(
        importLegacySessionMetadataTree({ workspaceRoot: root, destination: sqlite }),
      );
      // The session must NOT be tombstoned — a filesystem error is not corrupt data.
      assert.equal(await sqlite.isTombstoned(unreadable.id), false);
      // The valid session was not imported because the scan aborted.
      assert.equal(await sqlite.has(valid.id), false);
    } finally {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('does not tombstone a malformed header when a later scan step fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-session-transfer-rollback-'));
    const legacy = createSessionStore(root);
    const sqlite = createSqliteSessionMetadataStore(join(root, 'state.sqlite'));
    try {
      const valid = await legacy.create(makeInput({ name: 'Valid' }));
      const invalid = await legacy.create(makeInput({ name: 'Invalid' }));
      // Corrupt the invalid session's header.
      const invalidPath = join(root, 'sessions', invalid.id, 'session.jsonl');
      const lines = (await readFile(invalidPath, 'utf8')).split('\n');
      lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), labels: 'not-an-array' });
      await writeFile(invalidPath, lines.join('\n'), 'utf8');
      // Create an orphan transcript-marker directory with no SQLite metadata.
      // The scan will collect the malformed tombstone, but the transcript
      // marker check fails before the import, so the tombstone must not be
      // committed.
      const orphanId = 'orphan-transcript-session';
      const orphanDir = join(root, 'sessions', orphanId);
      await mkdir(orphanDir, { recursive: true });
      const orphanPath = join(orphanDir, 'session.jsonl');
      await writeFile(
        orphanPath,
        `${JSON.stringify({ type: 'session_transcript', sessionId: orphanId, schemaVersion: 1 })}\n`,
        'utf8',
      );

      await assert.rejects(
        importLegacySessionMetadataTree({ workspaceRoot: root, destination: sqlite }),
        /transcript marker has no SQLite metadata/,
      );
      // The malformed session must NOT be tombstoned because the scan failed.
      assert.equal(await sqlite.isTombstoned(invalid.id), false);
      // The valid session was not imported either.
      assert.equal(await sqlite.has(valid.id), false);
      // Re-running with the orphan removed should now succeed and tombstone.
      await rm(orphanDir, { recursive: true, force: true });
      const report = await importLegacySessionMetadataTree({
        workspaceRoot: root,
        destination: sqlite,
      });
      assert.equal(report.headersImported, 1);
      assert.equal(await sqlite.read(valid.id).then((r) => r.header.name), 'Valid');
      assert.equal(await sqlite.isTombstoned(invalid.id), true);
    } finally {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps canonical metadata readable when its optional transcript is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-session-transfer-missing-transcript-'));
    const legacy = createSessionStore(root);
    const sqlite = createSqliteSessionMetadataStore(join(root, 'state.sqlite'));
    try {
      const created = await legacy.create(makeInput({ name: 'Canonical metadata' }));
      await importLegacySessionMetadataTree({ workspaceRoot: root, destination: sqlite });
      await rm(join(root, 'sessions', created.id, 'session.jsonl'));

      const report = await importLegacySessionMetadataTree({
        workspaceRoot: root,
        destination: sqlite,
      });

      assert.deepEqual(report, {
        filesScanned: 1,
        headersRead: 0,
        headersImported: 0,
        headersExisting: 0,
        sourcesAlreadyImported: 0,
        sourcesTombstoned: 0,
      });
      assert.equal((await sqlite.read(created.id)).header.name, 'Canonical metadata');
    } finally {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

function makeInput(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  return {
    cwd: '/tmp/cwd',
    backend: 'fake',
    llmConnectionSlug: 'fake',
    model: 'fake-model',
    permissionMode: 'ask',
    name: 'Session',
    labels: [],
    ...overrides,
  };
}
