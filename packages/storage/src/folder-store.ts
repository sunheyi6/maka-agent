import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionFolder } from '@maka/core/folders';

/**
 * Folder name normalization contract — same spirit as
 * `normalizeUserSessionName` from `@maka/core/session-name`: trim,
 * collapse internal whitespace, NFC, reject empty / over-long names.
 * Kept local because folders are a much smaller surface than session
 * names and don't warrant a shared core helper yet.
 */
const FOLDER_NAME_MAX_CODE_POINTS = 60;

export interface NormalizeFolderNameResult {
  ok: boolean;
  value?: string;
  error?: string;
}

export function normalizeFolderName(raw: string): NormalizeFolderNameResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: '文件夹名称必须是字符串' };
  }
  // NFC first so code-point counting is consistent across platforms.
  const nfc = raw.normalize('NFC');
  // Collapse runs of whitespace and trim — a folder name with only
  // spaces is the same as empty after this.
  const collapsed = nfc.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return { ok: false, error: '文件夹名称不能为空' };
  }
  const codePoints = Array.from(collapsed);
  if (codePoints.length > FOLDER_NAME_MAX_CODE_POINTS) {
    return { ok: false, error: `文件夹名称过长（最多 ${FOLDER_NAME_MAX_CODE_POINTS} 个字符）` };
  }
  return { ok: true, value: collapsed };
}

export interface FolderStore {
  list(): Promise<SessionFolder[]>;
  create(name: string): Promise<SessionFolder>;
  rename(id: string, name: string): Promise<SessionFolder>;
  /**
   * Move a folder to a new position relative to its siblings. `toIndex`
   * is the desired 0-based index within `list()`. Other folders shift to
   * make room. The store rewrites the `order` field of affected folders.
   */
  reorder(id: string, toIndex: number): Promise<SessionFolder[]>;
  /**
   * Toggle the collapsed state of a folder. Persisted so the sidebar
   * remembers the user's collapse choice across restarts.
   */
  setCollapsed(id: string, collapsed: boolean): Promise<SessionFolder>;
  /**
   * Permanently remove a folder. Caller is responsible for clearing
   * `folderId` on sessions that referenced this folder (the store does
   * not know about sessions). The folder is gone after this returns.
   */
  remove(id: string): Promise<void>;
}

export function createFolderStore(workspaceRoot: string): FolderStore {
  return new FileFolderStore(workspaceRoot);
}

class FileFolderStore implements FolderStore {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(workspaceRoot: string) {
    this.filePath = join(workspaceRoot, 'folders.json');
  }

  async list(): Promise<SessionFolder[]> {
    const folders = await this.read();
    return [...folders].sort((a, b) => {
      const delta = a.order - b.order;
      return delta === 0 ? a.id.localeCompare(b.id) : delta;
    });
  }

  async create(name: string): Promise<SessionFolder> {
    const normalized = normalizeFolderName(name);
    if (!normalized.ok) throw new Error(normalized.error);
    const now = Date.now();
    const folders = await this.read();
    // Monotonic order: one past the current max so the new folder lands
    // at the bottom of the list. Empty store → order 0.
    const maxOrder = folders.reduce((max, folder) => Math.max(max, folder.order), -1);
    const folder: SessionFolder = {
      id: randomUUID(),
      name: normalized.value!,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
      collapsed: false,
    };
    await this.mutate((current) => [...current, folder]);
    return folder;
  }

  async rename(id: string, name: string): Promise<SessionFolder> {
    const normalized = normalizeFolderName(name);
    if (!normalized.ok) throw new Error(normalized.error);
    const now = Date.now();
    let updated: SessionFolder | undefined;
    await this.mutate((folders) =>
      folders.map((folder) => {
        if (folder.id !== id) return folder;
        updated = { ...folder, name: normalized.value!, updatedAt: now };
        return updated!;
      }),
    );
    if (!updated) throw new Error(`No such folder: ${id}`);
    return updated;
  }

  async reorder(id: string, toIndex: number): Promise<SessionFolder[]> {
    const folders = await this.read();
    const sorted = [...folders].sort((a, b) => {
      const delta = a.order - b.order;
      return delta === 0 ? a.id.localeCompare(b.id) : delta;
    });
    const currentIndex = sorted.findIndex((folder) => folder.id === id);
    if (currentIndex === -1) throw new Error(`No such folder: ${id}`);
    const clampedIndex = Math.max(0, Math.min(sorted.length - 1, Math.trunc(toIndex)));
    if (clampedIndex === currentIndex) {
      return sorted;
    }
    // Move the folder to the target index, then rewrite `order` as the
    // new positional index so the on-disk order stays dense and stable.
    const moved = sorted.splice(currentIndex, 1)[0]!;
    sorted.splice(clampedIndex, 0, moved);
    const now = Date.now();
    const reordered = sorted.map((folder, index) =>
      folder.id === id || folder.order !== index
        ? { ...folder, order: index, updatedAt: folder.id === id ? now : folder.updatedAt }
        : folder,
    );
    await this.write(reordered);
    return [...reordered].sort((a, b) => {
      const delta = a.order - b.order;
      return delta === 0 ? a.id.localeCompare(b.id) : delta;
    });
  }

  async setCollapsed(id: string, collapsed: boolean): Promise<SessionFolder> {
    const now = Date.now();
    let updated: SessionFolder | undefined;
    await this.mutate((folders) =>
      folders.map((folder) => {
        if (folder.id !== id) return folder;
        updated = { ...folder, collapsed, updatedAt: now };
        return updated!;
      }),
    );
    if (!updated) throw new Error(`No such folder: ${id}`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.mutate((folders) => folders.filter((folder) => folder.id !== id));
  }

  private async read(): Promise<SessionFolder[]> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return [];
      const folders: SessionFolder[] = [];
      for (let i = 0; i < parsed.length; i += 1) {
        const normalized = normalizePersistedFolder(parsed[i], i);
        if (normalized) folders.push(normalized);
      }
      return folders;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async mutate(fn: (folders: SessionFolder[]) => SessionFolder[]): Promise<void> {
    const run = async () => {
      const current = await this.read();
      await this.write(fn(current));
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {
      // Keep the chain alive after failures.
    });
    await next;
  }

  private async write(folders: SessionFolder[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(folders, null, 2) + '\n', 'utf8');
    await rename(tempPath, this.filePath);
  }
}

/**
 * Validate a single folder record loaded from disk. Malformed entries
 * are dropped (not fatal) so a single bad row doesn't take out the whole
 * folder list — same leniency policy as the session store's migration
 * path.
 */
function normalizePersistedFolder(value: unknown, index: number): SessionFolder | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = record.id;
  const name = record.name;
  const order = record.order;
  const createdAt = record.createdAt;
  const updatedAt = record.updatedAt;
  const collapsed = record.collapsed;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof order !== 'number' || !Number.isFinite(order) ||
    typeof createdAt !== 'number' || !Number.isFinite(createdAt) ||
    typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) ||
    typeof collapsed !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    name,
    order,
    createdAt,
    updatedAt,
    collapsed,
  };
}