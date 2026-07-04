import type { SessionSummary, StoredMessage } from '@maka/core';
import { generalizedErrorMessageChinese } from '@maka/core';

type RefBox<T> = { current: T };

type ToastApi = {
  success(title: string, description?: string): void;
  error(title: string, description?: string): void;
  confirm(options: {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    destructive?: boolean;
  }): Promise<boolean>;
};

export interface AppShellSessionRowActions {
  flagSession(sessionId: string, flagged: boolean): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
  unarchiveSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, name: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  moveSessionToFolder(sessionId: string, folderId: string | null): Promise<void>;
}

export interface AppShellFolderActions {
  createFolder(name: string): Promise<void>;
  renameFolder(id: string, name: string): Promise<void>;
  removeFolder(id: string): Promise<void>;
  toggleFolderCollapsed(id: string, collapsed: boolean): Promise<void>;
}

export function createAppShellSessionRowActions(deps: {
  activeIdRef: RefBox<string | undefined>;
  clearSessionRendererState: (sessionId: string) => void;
  pendingSessionRowActionsRef: RefBox<Set<string>>;
  refreshSessions: () => Promise<SessionSummary[]>;
  refreshFolders: () => Promise<void>;
  sessionsRef: RefBox<SessionSummary[]>;
  setActiveId: (sessionId: string | undefined) => void;
  setMessages: (messages: StoredMessage[]) => void;
  toastApi: ToastApi;
}): AppShellSessionRowActions & AppShellFolderActions {
  const {
    activeIdRef,
    clearSessionRendererState,
    pendingSessionRowActionsRef,
    refreshSessions,
    refreshFolders,
    sessionsRef,
    setActiveId,
    setMessages,
    toastApi,
  } = deps;

  async function runSessionRowAction(
    sessionId: string,
    actionId: 'flag' | 'archive' | 'rename' | 'delete' | 'move',
    errorTitle: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const sessionPrefix = `${sessionId}:`;
    if (Array.from(pendingSessionRowActionsRef.current).some((key) => key.startsWith(sessionPrefix))) return;
    const key = `${sessionId}:${actionId}`;
    pendingSessionRowActionsRef.current.add(key);
    try {
      await action();
    } catch (error) {
      toastApi.error(errorTitle, generalizedErrorMessageChinese(error, '会话操作失败，请稍后重试。'));
    } finally {
      pendingSessionRowActionsRef.current.delete(key);
    }
  }

  async function flagSession(sessionId: string, flagged: boolean) {
    return runSessionRowAction(sessionId, 'flag', flagged ? '标记会话失败' : '取消标记失败', async () => {
      await window.maka.sessions.setFlagged(sessionId, flagged);
      await refreshSessions();
    });
  }

  async function archiveSession(sessionId: string) {
    return runSessionRowAction(sessionId, 'archive', '归档会话失败', async () => {
      await window.maka.sessions.archive(sessionId);
      if (activeIdRef.current === sessionId) {
        setActiveId(undefined);
        setMessages([]);
        clearSessionRendererState(sessionId);
      }
      await refreshSessions();
    });
  }

  async function unarchiveSession(sessionId: string) {
    return runSessionRowAction(sessionId, 'archive', '恢复会话失败', async () => {
      await window.maka.sessions.unarchive(sessionId);
      await refreshSessions();
    });
  }

  async function renameSession(sessionId: string, name: string) {
    return runSessionRowAction(sessionId, 'rename', '重命名会话失败', async () => {
      await window.maka.sessions.rename(sessionId, name);
      await refreshSessions();
    });
  }

  async function deleteSession(sessionId: string) {
    return runSessionRowAction(sessionId, 'delete', '删除会话失败', async () => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const name = session?.name ?? '当前会话';
      const ok = await toastApi.confirm({
        title: `删除 "${name}"`,
        description: '会话和全部消息会从磁盘上永久移除。该操作不可撤销。',
        confirmLabel: '删除',
        cancelLabel: '取消',
        destructive: true,
      });
      if (!ok) return;
      await window.maka.sessions.remove(sessionId);
      if (activeIdRef.current === sessionId) {
        setActiveId(undefined);
        setMessages([]);
      }
      clearSessionRendererState(sessionId);
      await refreshSessions();
      toastApi.success(`已删除 ${name}`);
    });
  }

  // PR-FOLDERS: move a session into / out of a folder. The folder store
  // owns folder metadata; the session store owns the folderId field.
  async function moveSessionToFolder(sessionId: string, folderId: string | null) {
    return runSessionRowAction(sessionId, 'move', '移动会话失败', async () => {
      await window.maka.sessions.setFolder(sessionId, folderId);
      await refreshSessions();
    });
  }

  async function createFolder(name: string) {
    try {
      await window.maka.folders.create(name);
      await refreshFolders();
    } catch (error) {
      toastApi.error('新建文件夹失败', generalizedErrorMessageChinese(error, '新建文件夹失败，请稍后重试。'));
    }
  }

  async function renameFolder(id: string, name: string) {
    try {
      await window.maka.folders.rename(id, name);
      await refreshFolders();
    } catch (error) {
      toastApi.error('重命名文件夹失败', generalizedErrorMessageChinese(error, '重命名文件夹失败，请稍后重试。'));
    }
  }

  async function removeFolder(id: string) {
    const folder = (await window.maka.folders.list()).find((f) => f.id === id);
    const name = folder?.name ?? '该文件夹';
    const ok = await toastApi.confirm({
      title: `删除文件夹 "${name}"`,
      description: '文件夹内的会话将移至「未分组」，不会被删除。',
      confirmLabel: '删除',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    try {
      await window.maka.folders.remove(id);
      await refreshFolders();
      await refreshSessions();
    } catch (error) {
      toastApi.error('删除文件夹失败', generalizedErrorMessageChinese(error, '删除文件夹失败，请稍后重试。'));
    }
  }

  async function toggleFolderCollapsed(id: string, collapsed: boolean) {
    try {
      await window.maka.folders.setCollapsed(id, collapsed);
      await refreshFolders();
    } catch (error) {
      toastApi.error('更新文件夹失败', generalizedErrorMessageChinese(error, '更新文件夹失败，请稍后重试。'));
    }
  }

  return {
    flagSession,
    archiveSession,
    unarchiveSession,
    renameSession,
    deleteSession,
    moveSessionToFolder,
    createFolder,
    renameFolder,
    removeFolder,
    toggleFolderCollapsed,
  };
}
