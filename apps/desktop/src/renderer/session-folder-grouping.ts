/**
 * Pure derivation of sidebar session grouping by folder (PR-FOLDERS).
 *
 * Mirrors `session-status-grouping.ts` in shape — produces the same
 * `{ id, label, sessions, collapsible, defaultExpanded }` group objects
 * the panel consumes via its `statusGroups` prop — but the grouping axis
 * is the user-created folder instead of `SessionStatus`.
 *
 * Sessions with a `folderId` that doesn't match any known folder (e.g.
 * the folder was deleted on another device but the session header still
 * references it) fall through to the synthetic 未分组 bucket so they
 * never disappear from the sidebar. Empty folders still render so the
 * user can see them and drop sessions in.
 *
 * Within each group sessions are ordered by `lastMessageAt` desc with
 * `id.localeCompare` secondary — identical to the status-grouping sort
 * so switching view modes doesn't reshuffle sessions within a bucket.
 */

import type { SessionFolder, SessionSummary } from '@maka/core';
import { UNGROUPED_FOLDER_KEY, UNGROUPED_FOLDER_LABEL } from '@maka/core';

export interface SessionFolderGroup {
  /** Folder id, or `UNGROUPED_FOLDER_KEY` for the synthetic 未分组 bucket. */
  id: string;
  /** Folder name, or `未分组` for the synthetic bucket. */
  label: string;
  /** Sessions in this group, already sorted. */
  sessions: SessionSummary[];
  /** Folders are always collapsible; 未分组 is not. */
  collapsible: boolean;
  /** Default expanded state — derived from `folder.collapsed`. */
  defaultExpanded: boolean;
}

/**
 * Sort sessions within a group. Matches `session-status-grouping.ts` —
 * `lastMessageAt` desc with `id.localeCompare` tiebreaker.
 */
function sortSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const tsDelta = (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    if (tsDelta !== 0) return tsDelta;
    return a.id.localeCompare(b.id);
  });
}

function normalizePathForKey(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

function basenameFromPath(path: string): string {
  const normalized = normalizePathForKey(path);
  if (!normalized) return path.trim();
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function cwdGroupKey(cwd: string): string {
  return `cwd:${normalizePathForKey(cwd).toLowerCase()}`;
}

/**
 * Project a flat session list + folder list into folder-grouped buckets.
 * Folders appear in their stored `order`; the synthetic 未分组 bucket
 * always renders last (even when empty, if there are ungrouped sessions
 * — but empty 未分组 is dropped to avoid a dangling header).
 *
 * Empty real folders ARE rendered (with zero sessions) so the user can
 * see the folder and move sessions into it.
 */
export function deriveSessionFolderGroups(
  sessions: readonly SessionSummary[],
  folders: readonly SessionFolder[],
): SessionFolderGroup[] {
  // Index sessions by folderId. Sessions whose folderId doesn't match
  // any known folder land in 未分组 (defensive against orphan refs).
  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  const byFolder = new Map<string, SessionSummary[]>();
  const byCwd = new Map<string, { cwd: string; sessions: SessionSummary[] }>();
  const ungrouped: SessionSummary[] = [];
  for (const session of sessions) {
    const folderId = session.folderId ?? null;
    if (folderId && knownFolderIds.has(folderId)) {
      const bucket = byFolder.get(folderId);
      if (bucket) bucket.push(session);
      else byFolder.set(folderId, [session]);
    } else if (session.cwd?.trim()) {
      const key = cwdGroupKey(session.cwd);
      const bucket = byCwd.get(key);
      if (bucket) bucket.sessions.push(session);
      else byCwd.set(key, { cwd: session.cwd, sessions: [session] });
    } else {
      ungrouped.push(session);
    }
  }

  const groups: SessionFolderGroup[] = folders.map((folder) => ({
    id: folder.id,
    label: folder.name,
    sessions: sortSessions(byFolder.get(folder.id) ?? []),
    collapsible: true,
    defaultExpanded: !folder.collapsed,
  }));

  groups.push(
    ...[...byCwd.entries()]
      .sort(([, a], [, b]) =>
        basenameFromPath(a.cwd).localeCompare(basenameFromPath(b.cwd)) ||
        a.cwd.localeCompare(b.cwd)
      )
      .map(([id, group]) => ({
        id,
        label: basenameFromPath(group.cwd),
        sessions: sortSessions(group.sessions),
        collapsible: true,
        defaultExpanded: true,
      })),
  );

  if (ungrouped.length > 0) {
    groups.push({
      id: UNGROUPED_FOLDER_KEY,
      label: UNGROUPED_FOLDER_LABEL,
      sessions: sortSessions(ungrouped),
      collapsible: false,
      defaultExpanded: true,
    });
  }

  return groups;
}
