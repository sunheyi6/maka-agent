import { safeLocalStorageGet } from './browser-storage';

export const SESSION_LIST_COLLAPSED_WIDTH = 0;
export const SESSION_LIST_EXPANDED_DEFAULT_WIDTH = 210;
export const SESSION_LIST_EXPANDED_MIN_WIDTH = 210;
export const SESSION_LIST_EXPANDED_MAX_WIDTH = 280;

export function readSessionListWidth(): number {
  const stored = Number(safeLocalStorageGet('maka-chat-list-width-v1'));
  if (Number.isFinite(stored) && stored > 0) return clampSessionListWidth(stored);
  return SESSION_LIST_EXPANDED_DEFAULT_WIDTH;
}

export function readSessionListCollapsed(): boolean {
  const stored = safeLocalStorageGet('maka-chat-list-collapsed-v1');
  if (stored === 'false') return false;
  if (stored === 'true') return true;
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampSessionListWidth(value: number): number {
  return Math.round(clamp(value, SESSION_LIST_EXPANDED_MIN_WIDTH, SESSION_LIST_EXPANDED_MAX_WIDTH));
}

// PR-FOLDERS: sidebar session-list grouping view mode. `'status'` is the
// pre-folder default (grouped by SessionStatus); `'folder'` groups by
// user-created folders with one level of indentation. Persisted so the
// user's choice survives restarts.
export type SessionViewMode = 'status' | 'folder';

const SESSION_VIEW_MODE_KEY = 'maka-session-view-mode-v1';

export function readSessionViewMode(): SessionViewMode {
  const stored = safeLocalStorageGet(SESSION_VIEW_MODE_KEY);
  return stored === 'folder' ? 'folder' : 'status';
}

export function writeSessionViewMode(mode: SessionViewMode): void {
  try {
    window.localStorage.setItem(SESSION_VIEW_MODE_KEY, mode);
  } catch {
    // Ignore quota / privacy-mode write failures — the in-memory state
    // still drives the current session.
  }
}
