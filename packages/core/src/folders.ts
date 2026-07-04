/**
 * Session folder types (PR-FOLDERS).
 *
 * Folders are a user-created grouping axis for the sidebar session list,
 * orthogonal to SessionStatus. A session carries an optional `folderId`
 * on its header (see `session.ts`); the folder metadata itself (name,
 * order, collapsed state) lives in the folder store and is persisted to
 * `folders.json` at the workspace root.
 *
 * Folders are single-level (no nesting) by design — the sidebar already
 * has a status-grouping mode, and folder mode is a flat alternative with
 * one level of indentation for sessions under a folder header.
 */

/** A session folder as persisted by the folder store. */
export interface SessionFolder {
  id: string;
  /** Display name shown in the sidebar group header. */
  name: string;
  /**
   * Stable sort key. The folder store assigns a monotonically increasing
   * integer at creation; `reorder` rewrites the order field of affected
   * folders. `list()` returns folders sorted ascending by this field.
   */
  order: number;
  /** `createdAt` timestamp (ms). */
  createdAt: number;
  /** `updatedAt` timestamp (ms). */
  updatedAt: number;
  /**
   * Whether the user collapsed this folder in the sidebar. Persisted so
   * the folder stays collapsed across restarts. The renderer is the
   * source of truth for toggling this via `setCollapsed`.
   */
  collapsed: boolean;
}

/** Synthetic group id for sessions that don't belong to any folder. */
export const UNGROUPED_FOLDER_KEY = '__ungrouped';

export const UNGROUPED_FOLDER_LABEL = '未分组';

/**
 * Folder id used by the renderer grouping helper. Either a real folder
 * id or the synthetic `UNGROUPED_FOLDER_KEY`.
 */
export type SessionFolderGroupId = string;