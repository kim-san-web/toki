import { app, ipcMain, safeStorage, screen, shell, BrowserWindow, Notification } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { DashboardState, NotchEdge, PendingQuestion, ProviderActivity, Settings } from '../shared/types.js';
import { initLog, log } from './log.js';
import { SettingsStore } from './settings-store.js';
import { UsageArchive } from './archive.js';
import { UsageStore } from './usage-store.js';
import { NotchWindow } from './notch-window.js';
import { SettingsWindow } from './settings-window.js';
import { TrayIcon } from './tray.js';
import { ClaudeProvider } from './providers/claude.js';
import { SecretStore } from './secrets.js';
import { authorizeUrl, createPkce, exchangeCode, type PkcePair } from './providers/claude-oauth.js';
import { CodexProvider } from './providers/codex.js';
import { CursorProvider } from './providers/cursor.js';
import { GlmProvider } from './providers/glm.js';
import type { UsageProvider } from './providers/provider.js';
import { ActivityStore } from './activity/activity-store.js';
import { ClaudeActivityMonitor } from './activity/claude-monitor.js';
import { CodexActivityMonitor } from './activity/codex-monitor.js';
import { CursorActivityMonitor } from './activity/cursor-monitor.js';
import type { ActivityMonitor } from './activity/monitor.js';
import { applyHooks } from './activity/claude-hooks.js';
import { claudeProfiles } from './paths.js';
import { demoActivity } from './providers/demo.js';
import { Notifier } from './notifier.js';
import { answerRoute } from '../shared/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const resourcesDir = app.isPackaged ? join(process.resourcesPath, 'assets') : resolve(here, '../../assets');

/**
 * One instance only.
 *
 * Two TOKIs would fight over the notch's position, double every poll, and
 * interleave writes into the same settings and hook files -- so a second launch
 * simply opens the running one's Settings and exits.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const stateDir = app.getPath('userData');
initLog(stateDir);

const settings = new SettingsStore(stateDir);
const archive = new UsageArchive(stateDir);
// DPAPI on Windows, scoped to this Windows account. Nothing is stored at all
// when the OS cannot encrypt -- a plaintext key on disk is worse than asking.
const secrets = new SecretStore(stateDir, safeStorage);

if (process.env.TOKI_DEMO === '1' && !settings.get().demoMode) {
  settings.update({ demoMode: true });
}

/**
 * Every provider TOKI can read, built once at launch.
 *
 * Claude is one provider *per profile*: a work login under `~/.claude-work` has
 * its own token, its own limits and its own ring, and the default `~/.claude`
 * always comes first so the rings never swap places between launches.
 */
const providers: UsageProvider[] = [
  ...claudeProfiles().map(
    (profile) => new ClaudeProvider(profile.id, profile.displayName, profile.dir, secrets)
  ),
  new CodexProvider(),
  new CursorProvider(secrets),
  new GlmProvider(secrets)
];

/** Claude adapters by id, for the sign-in handlers below. */
const claudeProviders = new Map(
  providers.filter((p): p is ClaudeProvider => p instanceof ClaudeProvider).map((p) => [p.id, p])
);

/**
 * One PKCE pair per sign-in attempt, held only until the code is pasted back.
 *
 * In memory deliberately: a verifier is single-use and worthless afterwards, so
 * persisting it would be storing a secret with no upside.
 */
const pendingSignIns = new Map<string, PkcePair>();

const usage = new UsageStore(providers, settings, archive);

const notch = new NotchWindow(() => settings.get());
const settingsWindow = new SettingsWindow();

const monitors: ActivityMonitor[] = [
  ...claudeProfiles().map(
    (profile) =>
      new ClaudeActivityMonitor(
        profile.id,
        stateDir,
        () => archive.activityCutoff(profile.id),
        () => pushState()
      )
  ),
  new CodexActivityMonitor(undefined, () => archive.activityCutoff('codex'), () => pushState()),
  new CursorActivityMonitor(undefined, () => archive.activityCutoff('cursor'), () => pushState())
];
const activity = new ActivityStore(monitors, settings, archive);

let pushScheduled = false;

function currentState(): DashboardState {
  const current = settings.get();
  const live = current.demoMode ? demoActivity() : activity.list();
  return {
    providers: usage.list(),
    activity: live,
    questions: pendingQuestions(live),
    settings: current,
    sweptAt: usage.sweptAt,
    refreshing: usage.refreshing
  };
}

/**
 * Every session currently blocked on the user, with the ways it can be
 * answered.
 *
 * Derived from activity rather than tracked separately: a question exists
 * exactly as long as its session is waiting, so there is no second list that
 * can disagree with what the rings show.
 */
function pendingQuestions(activity: ProviderActivity[]): PendingQuestion[] {
  const byId = new Map(usage.list().map((p) => [p.id, p.displayName]));
  const questions: PendingQuestion[] = [];
  for (const provider of activity) {
    for (const session of provider.sessions) {
      if (session.state !== 'waiting') continue;
      const route = answerRoute(provider.providerId);
      questions.push({
        sessionId: session.id,
        providerId: provider.providerId,
        providerName: byId.get(provider.providerId) ?? provider.providerId,
        sessionName: session.name,
        question: session.waitingFor ?? 'Waiting for your answer',
        since: session.since,
        cwd: session.cwd,
        routes: { web: route.web, appName: route.app?.name ?? null }
      });
    }
  }
  return questions.sort((a, b) => a.since - b.since);
}

/**
 * Push the whole dashboard at once.
 *
 * One object rather than per-provider messages, so the UI can never render a
 * torn state -- half of it from before a refresh and half from after. Coalesced
 * onto the next tick because a single sweep updates several providers.
 */
function pushState(): void {
  if (pushScheduled) return;
  pushScheduled = true;
  setImmediate(() => {
    pushScheduled = false;
    const state = currentState();
    notch.send('toki:state', state);
    settingsWindow.send('toki:state', state);
    usage.setBusy(activity.anyBusy);
    // Raised here rather than inside the monitors: this is the one place that
    // sees the whole, settled picture, so a session cannot be announced from a
    // half-applied update.
    notifier.update(state.activity);
  });
}

usage.onChange(pushState);
activity.onChange(pushState);

const notifier = new Notifier(
  () => settings.get(),
  () => settingsWindow.open()
);

const tray = new TrayIcon(resourcesDir, {
  refresh: () => void usage.refresh(),
  openSettings: () => settingsWindow.open(),
  setEdge: (edge: NotchEdge) => void applySettings({ edge }),
  setVisibility: (visibility) => void applySettings({ visibility }),
  quit: () => quit()
});

/** The one path every settings change goes through, whatever asked for it. */
function applySettings(patch: Partial<Settings>): Settings {
  const previous = settings.get();
  const next = settings.update(patch);
  usage.applySettings(previous, next);
  activity.sync();
  notch.reposition();
  if (next.presence === 'tray') tray.show(next);
  else tray.hide();
  notch.setVisible(next.visibility !== 'hidden');
  if (previous.launchAtLogin !== next.launchAtLogin) {
    try {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] });
    } catch (error) {
      log.error('settings', `could not set launch at login: ${String(error)}`);
    }
  }
  pushState();
  return next;
}

function quit(): void {
  usage.stop();
  activity.stop();
  tray.hide();
  notch.destroy();
  app.exit(0);
}

app.on('second-instance', () => settingsWindow.open());

// The notch is the app; closing the Settings window must not end it.
app.on('window-all-closed', () => {});

void app.whenReady().then(() => {
  app.setAppUserModelId('com.toki.notch');

  notch.create();
  const current = settings.get();
  if (current.presence === 'tray') tray.show(current);
  notch.setVisible(current.visibility !== 'hidden');

  // Hover is driven by the OS cursor, not by DOM events: a transparent,
  // click-through overlay does not receive `mouseenter` dependably on Windows.
  notch.watchPointer((inside) => notch.send('toki:pointer', inside));

  activity.sync();
  usage.start();

  // A display being added, removed or resized moves the work area under us.
  screen.on('display-metrics-changed', () => notch.reposition());
  screen.on('display-added', () => notch.reposition());
  screen.on('display-removed', () => notch.reposition());

  registerIpc();
});

function registerIpc(): void {
  ipcMain.handle('toki:get-state', () => currentState());

  ipcMain.handle('toki:refresh', async () => {
    await usage.refresh();
  });

  ipcMain.handle('toki:set-settings', (_event, patch: Partial<Settings>) => applySettings(patch));

  ipcMain.on('toki:set-interactive', (_event, interactive: boolean) => {
    notch.setInteractive(Boolean(interactive));
  });

  ipcMain.on('toki:set-provider-count', (_event, count: number) => {
    notch.setProviderCount(Math.max(1, Number(count) || 1));
  });

  ipcMain.on(
    'toki:set-hit-rect',
    (_event, rect: { x: number; y: number; width: number; height: number } | null) => {
      if (!rect || typeof rect.width !== 'number' || typeof rect.height !== 'number') {
        notch.setHitRect(null);
        return;
      }
      notch.setHitRect({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    }
  );

  ipcMain.on('toki:open-settings', () => settingsWindow.open());
  ipcMain.on('toki:quit', () => quit());

  ipcMain.on('toki:open-external', (_event, url: string) => {
    // Checked here as well as in the preload: the renderer is the untrusted
    // side of this boundary, and `shell.openExternal` with an arbitrary scheme
    // will happily launch a local program.
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol !== 'https:') return;
      void shell.openExternal(parsed.toString());
    } catch {
      /* not a URL: nothing to open */
    }
  });

  ipcMain.handle('toki:install-claude-hooks', (_event, install: boolean) => {
    const hookCommand = `node "${join(resourcesDir, 'hook', 'toki-hook.mjs')}"`;
    let ok = true;
    // Serialised across profiles on purpose: each rewrite is atomic, and doing
    // them one at a time keeps two profiles sharing a settings file safe.
    for (const profile of claudeProfiles()) {
      if (!applyHooks(profile.dir, hookCommand, Boolean(install))) ok = false;
    }
    if (ok) applySettings({ claudeHooksInstalled: Boolean(install) });
    return ok;
  });

  /**
   * Start an OAuth sign-in.
   *
   * The browser is opened rather than an embedded window: a sign-in inside the
   * app would ask the user to type their password into a surface TOKI controls,
   * which is exactly the habit phishing relies on. Their own browser shows the
   * real address bar and their existing session.
   */
  ipcMain.handle('toki:begin-sign-in', (_event, providerId: string) => {
    const provider = claudeProviders.get(String(providerId));
    if (!provider) return false;
    const pkce = createPkce();
    pendingSignIns.set(provider.id, pkce);
    // The user's own browser, never an embedded window: a sign-in inside the
    // app asks them to type a password into a surface TOKI controls, which is
    // the exact habit phishing relies on.
    void shell.openExternal(authorizeUrl(pkce));
    return true;
  });

  ipcMain.handle('toki:complete-sign-in', async (_event, providerId: string, code: string) => {
    const id = String(providerId);
    const provider = claudeProviders.get(id);
    const pkce = pendingSignIns.get(id);
    if (!provider || !pkce) {
      return { ok: false, error: 'Start the sign-in again' };
    }
    try {
      const tokens = await exchangeCode(String(code), pkce);
      if (!secrets.set(`${id}:oauth`, JSON.stringify(tokens))) {
        return {
          ok: false,
          error:
            'Signed in, but Windows would not encrypt the token so it was not saved. ' +
            'This usually means DPAPI is unavailable for this account.'
        };
      }
      pendingSignIns.delete(id);
      provider.forgetCached();
      // Signing in is a statement of intent: switch the provider on and read.
      applySettings({ providers: { [id]: { enabled: true, mode: 'auto' } } });
      void usage.refresh();
      return { ok: true };
    } catch (error) {
      // The message is written for a person; the code itself never appears.
      return { ok: false, error: error instanceof Error ? error.message : 'Sign-in failed' };
    }
  });

  ipcMain.handle('toki:set-api-key', (_event, providerId: string, key: string) => {
    const id = String(providerId);
    const trimmed = String(key).trim();
    if (!trimmed) {
      secrets.delete(`${id}:apiKey`);
      void usage.refresh();
      return { ok: true };
    }
    if (!secrets.canStore) {
      return { ok: false, error: 'Windows would not encrypt the key, so it was not saved' };
    }
    secrets.set(`${id}:apiKey`, trimmed);
    applySettings({ providers: { [id]: { enabled: true, mode: settings.providerPref(id).mode ?? 'auto' } } });
    void usage.refresh();
    return { ok: true };
  });

  /** Forget every secret TOKI holds for a provider. Borrowed ones are not ours to clear. */
  ipcMain.handle('toki:clear-credentials', (_event, providerId: string) => {
    const id = String(providerId);
    secrets.delete(`${id}:oauth`);
    secrets.delete(`${id}:apiKey`);
    pendingSignIns.delete(id);
    claudeProviders.get(id)?.forgetCached();
    archive.forget(id);
    void usage.refresh();
    return true;
  });

  /** Open the provider's own web chat, where a blocked question can be answered. */
  ipcMain.on('toki:answer-web', (_event, providerId: string) => {
    Notifier.openWeb(String(providerId));
  });

  /** Bring the owning app (or the session's folder) forward. */
  ipcMain.on('toki:answer-app', (_event, providerId: string, cwd: string | null) => {
    Notifier.openApp(String(providerId), cwd ? String(cwd) : null);
  });

  ipcMain.handle('toki:displays', () =>
    screen.getAllDisplays().map((display) => ({
      id: display.id,
      label: `${display.size.width} x ${display.size.height}`,
      primary: display.id === screen.getPrimaryDisplay().id
    }))
  );
}

app.on('before-quit', () => {
  usage.stop();
  activity.stop();
});

process.on('uncaughtException', (error) => {
  // A dashboard that dies silently is worse than one that logs and keeps going.
  log.error('main', `uncaught: ${String(error)}`);
});
