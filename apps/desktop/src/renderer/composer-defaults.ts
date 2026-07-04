/**
 * Global "last selection" defaults for the composer's folder / permission
 * mode / model chips. Survives reloads so a freshly created task inherits the
 * most recent pick instead of falling back to factory defaults.
 *
 * Keyed with a `v1` suffix to allow schema migration later.
 */

import type { PermissionMode } from '@maka/core';
import { safeLocalStorageGet, safeLocalStorageSet } from './browser-storage';

const STORAGE_KEY = 'maka-composer-defaults-v1';

export const MAX_RECENT_PATHS = 5;

export interface ComposerDefaults {
  projectPath: string | null;
  permissionMode: PermissionMode | null;
  model: { llmConnectionSlug: string; model: string } | null;
  recentProjectPaths: string[];
}

const EMPTY: ComposerDefaults = {
  projectPath: null,
  permissionMode: null,
  model: null,
  recentProjectPaths: [],
};

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}
function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'explore' || value === 'ask' || value === 'execute' || value === 'bypass';
}
function isModel(value: unknown): value is { llmConnectionSlug: string; model: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return isString(record.llmConnectionSlug) && isString(record.model);
}

function parse(raw: string | null): ComposerDefaults | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      projectPath: isString(parsed.projectPath) ? parsed.projectPath : null,
      permissionMode: isPermissionMode(parsed.permissionMode) ? parsed.permissionMode : null,
      model: isModel(parsed.model) ? parsed.model : null,
      recentProjectPaths: isStringArray(parsed.recentProjectPaths) ? parsed.recentProjectPaths.slice(0, MAX_RECENT_PATHS) : [],
    };
  } catch {
    // Corrupt JSON — treat as absent so callers fall back to defaults.
    return null;
  }
}

/** Read the persisted defaults. Returns `null` when storage is empty/invalid. */
export function loadComposerDefaults(): ComposerDefaults | null {
  return parse(safeLocalStorageGet(STORAGE_KEY));
}

/**
 * Merge-write: reads the current persisted blob, overlays the provided partial,
 * and writes back. Fields set to `null` are cleared. Keeps the on-disk shape
 * stable even when only one of the three selections changes.
 */
export function saveComposerDefaults(patch: Partial<ComposerDefaults>): void {
  const current = loadComposerDefaults() ?? EMPTY;
  let recentProjectPaths = patch.recentProjectPaths !== undefined ? patch.recentProjectPaths : current.recentProjectPaths;
  if (recentProjectPaths.length > MAX_RECENT_PATHS) {
    recentProjectPaths = recentProjectPaths.slice(0, MAX_RECENT_PATHS);
  }
  const next: ComposerDefaults = {
    projectPath: patch.projectPath !== undefined ? patch.projectPath : current.projectPath,
    permissionMode: patch.permissionMode !== undefined ? patch.permissionMode : current.permissionMode,
    model: patch.model !== undefined ? patch.model : current.model,
    recentProjectPaths,
  };
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(next));
}