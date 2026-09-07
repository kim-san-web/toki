import type { DashboardState, Settings } from '../shared/types.js';

export interface TokiApi {
  getState(): Promise<DashboardState>;
  onState(handler: (state: DashboardState) => void): () => void;
  refresh(): Promise<void>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  setInteractive(interactive: boolean): void;
  setProviderCount(count: number): void;
  setHitRect(rect: { x: number; y: number; width: number; height: number } | null): void;
  onPointer(handler: (inside: boolean) => void): () => void;
  openSettings(): void;
  quit(): void;
  openExternal(url: string): void;
  installClaudeHooks(install: boolean): Promise<boolean>;
  displays(): Promise<{ id: number; label: string; primary: boolean }[]>;
  beginSignIn(providerId: string): Promise<boolean>;
  completeSignIn(providerId: string, code: string): Promise<{ ok: boolean; error?: string }>;
  setApiKey(providerId: string, key: string): Promise<{ ok: boolean; error?: string }>;
  clearCredentials(providerId: string): Promise<boolean>;
  answerOnWeb(providerId: string): void;
  answerInApp(providerId: string, cwd: string | null): void;
}

declare global {
  interface Window {
    toki: TokiApi;
  }
}

export const toki = window.toki;
