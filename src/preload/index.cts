import { contextBridge, ipcRenderer } from 'electron';
import type { DashboardState, Settings } from '../shared/types.js';

/**
 * The whole surface the renderer is given.
 *
 * Deliberately a fixed list of named calls rather than a generic `invoke`:
 * with contextIsolation on, this is the security boundary, and a passthrough
 * that forwards any channel would make it decorative. No filesystem, no shell,
 * no provider internals -- the renderer cannot read a credential even in
 * principle.
 */
const IPC = {
  state: 'toki:state',
  getState: 'toki:get-state',
  refresh: 'toki:refresh',
  setSettings: 'toki:set-settings',
  setInteractive: 'toki:set-interactive',
  setProviderCount: 'toki:set-provider-count',
  setHitRect: 'toki:set-hit-rect',
  pointer: 'toki:pointer',
  openSettings: 'toki:open-settings',
  quit: 'toki:quit',
  openExternal: 'toki:open-external',
  installClaudeHooks: 'toki:install-claude-hooks',
  displays: 'toki:displays',
  beginSignIn: 'toki:begin-sign-in',
  completeSignIn: 'toki:complete-sign-in',
  setApiKey: 'toki:set-api-key',
  clearCredentials: 'toki:clear-credentials',
  answerWeb: 'toki:answer-web',
  answerApp: 'toki:answer-app'
} as const;

const api = {
  getState: (): Promise<DashboardState> => ipcRenderer.invoke(IPC.getState),

  onState: (handler: (state: DashboardState) => void): (() => void) => {
    const listener = (_event: unknown, state: DashboardState): void => handler(state);
    ipcRenderer.on(IPC.state, listener);
    return () => ipcRenderer.removeListener(IPC.state, listener);
  },

  refresh: (): Promise<void> => ipcRenderer.invoke(IPC.refresh),

  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.setSettings, patch),

  /** Whether the notch window should accept the mouse right now. */
  setInteractive: (interactive: boolean): void => {
    ipcRenderer.send(IPC.setInteractive, interactive);
  },

  /**
   * How many rings there are. Deliberately not hover state: the window is
   * sized for its worst case and never resized while the pointer moves.
   */
  setProviderCount: (count: number): void => {
    ipcRenderer.send(IPC.setProviderCount, count);
  },

  /**
   * The region the renderer actually draws, in window coordinates.
   *
   * The main process tracks the OS cursor against this rather than relying on
   * DOM hover: a transparent, non-focusable, click-through overlay on Windows
   * does not receive `mouseenter` dependably, so hover alone can leave the
   * notch permanently shut.
   */
  setHitRect: (rect: { x: number; y: number; width: number; height: number } | null): void => {
    ipcRenderer.send(IPC.setHitRect, rect);
  },

  /** Fires when the OS cursor enters or leaves that region. */
  onPointer: (handler: (inside: boolean) => void): (() => void) => {
    const listener = (_event: unknown, inside: boolean): void => handler(inside);
    ipcRenderer.on(IPC.pointer, listener);
    return () => ipcRenderer.removeListener(IPC.pointer, listener);
  },

  openSettings: (): void => {
    ipcRenderer.send(IPC.openSettings);
  },

  quit: (): void => {
    ipcRenderer.send(IPC.quit);
  },

  /** Only https links, and the main process checks that again. */
  openExternal: (url: string): void => {
    ipcRenderer.send(IPC.openExternal, url);
  },

  installClaudeHooks: (install: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.installClaudeHooks, install),

  displays: (): Promise<{ id: number; label: string; primary: boolean }[]> =>
    ipcRenderer.invoke(IPC.displays),

  /** Opens the provider's sign-in in the user's own browser. */
  beginSignIn: (providerId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.beginSignIn, providerId),

  /** Exchanges the pasted code. The code never touches renderer storage. */
  completeSignIn: (providerId: string, code: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.completeSignIn, providerId, code),

  /** Stores an API key, encrypted by the OS. An empty value removes it. */
  setApiKey: (providerId: string, key: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.setApiKey, providerId, key),

  /** Forgets every secret TOKI holds for a provider. */
  clearCredentials: (providerId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.clearCredentials, providerId),

  answerOnWeb: (providerId: string): void => {
    ipcRenderer.send(IPC.answerWeb, providerId);
  },

  answerInApp: (providerId: string, cwd: string | null): void => {
    ipcRenderer.send(IPC.answerApp, providerId, cwd);
  }
};

contextBridge.exposeInMainWorld('toki', api);

export type TokiApi = typeof api;
