/**
 * The contract between the main process (which knows how Claude, Codex and
 * Cursor each work) and the renderer (which knows none of it).
 *
 * Everything here must survive `structuredClone` across IPC, so dates travel as
 * epoch milliseconds and unions are tagged plain objects rather than classes.
 */

/** How much to trust a provider's numbers. */
export type Fidelity = 'official' | 'derived' | 'manual';

/** Prefix shown in front of a percentage we worked out ourselves. */
export function qualifier(f: Fidelity): string {
  return f === 'official' ? '' : '~';
}

export type ProviderStatus =
  | { kind: 'ok' }
  /** The reading is real but old; `since` is when it was actually taken. */
  | { kind: 'stale'; since: number }
  /** No usable credential -- the user has to sign in to the owning tool. */
  | { kind: 'needsAuth' }
  /** The credential exists and Windows/the file system refused to hand it over. */
  | { kind: 'accessDenied' }
  /** Readable, but there is genuinely no quota being counted. Not an error. */
  | { kind: 'unsupported'; why: string }
  | { kind: 'error'; why: string }
  /** Switched off in Settings. No credential is read at all. */
  | { kind: 'disabled' };

/**
 * One metered window a provider exposes. Claude has two (the rolling session
 * and the longer all-models window); Codex has primary and secondary.
 */
export interface LimitWindow {
  id: string;
  label: string;
  /** 0..1+, where 1 means spent. Null when the provider never states a ceiling. */
  usedFraction: number | null;
  /** How many are left, when that is what the provider reports. */
  remaining: number | null;
  /** How many are spent, when the provider counts up and never states a limit. */
  used: number | null;
  /** Epoch ms, or null when the provider does not say when the window rolls over. */
  resetsAt: number | null;
}

/**
 * A limit that has been *reached*, even where the headline still shows room.
 * Not a measurement -- a door being shut.
 */
export interface UsageBlock {
  reason: string;
  resetsAt: number | null;
}

/** Which mark a provider cell draws. Rendered as an inline SVG by the renderer. */
export type ProviderGlyph = 'claude' | 'openai' | 'cursor' | 'glm' | 'generic';

export interface ProviderAccount {
  label: string;
  plan: string | null;
  /** Which app on this PC owns the credential we borrowed. */
  source: string;
  manageUrl: string | null;
}

export interface ProviderSnapshot {
  id: string;
  displayName: string;
  glyph: ProviderGlyph;
  fidelity: Fidelity;
  status: ProviderStatus;
  windows: LimitWindow[];
  /**
   * Which window the ring means, declared by the provider rather than left to
   * position: a window dropping out of a response must not silently promote
   * another one into the headline's place.
   */
  headlineId: string | null;
  block: UsageBlock | null;
  account: ProviderAccount | null;
  /** Epoch ms of the last successful read, for the "as of" line. */
  readAt: number | null;
  /** Where the reading came from, in the user's terms. Shown in Settings. */
  sourceNote: string;
  /** Which credential modes this provider can offer. */
  support: CredentialSupport;
  /** Which mode produced the current reading. */
  origin: CredentialOrigin;
  /** True when TOKI holds a secret of its own for this provider. */
  hasStoredSecret: boolean;
}

/** What one agent session is doing right now. */
export type SessionState = 'busy' | 'waiting' | 'idle';

export interface AgentSession {
  id: string;
  providerId: string;
  /** What to call it in the tooltip -- usually the project folder. */
  name: string;
  /** The quieter second line: where it is running. */
  detail: string;
  state: SessionState;
  /** Set while waiting: what it wants from you, in the tool's own words. */
  waitingFor: string | null;
  /** Where it is running, so TOKI can open the right folder or app. */
  cwd: string | null;
  /** Epoch ms it entered this state. */
  since: number;
}

/**
 * The activity reading for one provider. `unavailable` is deliberate and
 * distinct from `idle`: no signal is not the same as a signal saying nothing
 * is running.
 */
export type ActivityState = 'working' | 'waiting' | 'idle' | 'unavailable';

export interface ProviderActivity {
  providerId: string;
  state: ActivityState;
  sessions: AgentSession[];
}

export type NotchEdge = 'top' | 'right' | 'bottom' | 'left';
export type NotchVisibility = 'hover' | 'always' | 'hidden';
export type AppPresence = 'tray' | 'none';

/**
 * How a provider gets its credential.
 *
 * - `borrow` reads whatever a tool already signed in on this PC holds. Nothing
 *   is stored and TOKI never signs in.
 * - `oauth` signs in to TOKI itself. Needed because some installs leave the
 *   borrowed file empty, so there is genuinely nothing to read.
 * - `apiKey` uses a key the user pastes in.
 *
 * `auto` tries every mode the provider supports, in that order.
 */
export type CredentialMode = 'auto' | 'borrow' | 'oauth' | 'apiKey';

/** What a provider can actually offer, so the UI only shows real choices. */
export interface CredentialSupport {
  borrow: boolean;
  oauth: boolean;
  apiKey: boolean;
  /** Where an API key is obtained, for the "get one" link. */
  apiKeyUrl: string | null;
  /** What the borrow mode reads, in the user's own terms. */
  borrowNote: string;
}

/** Which mode actually produced the current reading. Shown in Settings. */
export type CredentialOrigin = 'borrowed' | 'oauth' | 'apiKey' | 'none';

export interface ProviderPref {
  /** Live reads. Off by default: nothing is read until asked for. */
  enabled: boolean;
  /** Defaults to `auto`. */
  mode?: CredentialMode;
}

export interface Settings {
  edge: NotchEdge;
  /** 0..1 along the edge. 0.5 is centred. */
  offset: number;
  visibility: NotchVisibility;
  presence: AppPresence;
  /** Which display, by Electron display id. Null follows the primary. */
  displayId: number | null;
  /** Sample data instead of any live read. Separate from every enable flag. */
  demoMode: boolean;
  launchAtLogin: boolean;
  scale: number;
  providers: Record<string, ProviderPref>;
  /** Claude Code hooks installed into settings.json, for activity events. */
  claudeHooksInstalled: boolean;
  /** Raise a desktop notification when an agent blocks on you. */
  notifyOnWaiting: boolean;
  /** The active theme's id, from the theme library or a saved custom one. */
  themeId: string;
  /** Themes the user has built and saved, newest last. */
  customThemes: CustomTheme[];
}

/** A theme the user built in the editor, stored whole so it survives updates. */
export interface CustomTheme {
  id: string;
  name: string;
  /** The id it was derived from, so the editor can show what changed. */
  basedOn: string;
  palette: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  edge: 'top',
  offset: 0.5,
  visibility: 'hover',
  presence: 'tray',
  displayId: null,
  demoMode: false,
  launchAtLogin: false,
  scale: 1,
  providers: {},
  claudeHooksInstalled: false,
  notifyOnWaiting: true,
  themeId: 'toki-dark',
  customThemes: []
};

/** Everything the notch renders, pushed as one object so it can never tear. */
export interface DashboardState {
  providers: ProviderSnapshot[];
  activity: ProviderActivity[];
  /** Every session blocked on the user right now. */
  questions: PendingQuestion[];
  settings: Settings;
  /** Epoch ms of the last poll sweep, successful or not. */
  sweptAt: number;
  refreshing: boolean;
}

/** A question an agent is blocked on, with the ways it can be answered. */
export interface PendingQuestion {
  sessionId: string;
  providerId: string;
  providerName: string;
  sessionName: string;
  question: string;
  since: number;
  /** Where the session is running, for opening the right folder or app. */
  cwd: string | null;
  routes: { web: string | null; appName: string | null };
}

export const IPC = {
  state: 'toki:state',
  getState: 'toki:get-state',
  refresh: 'toki:refresh',
  setSettings: 'toki:set-settings',
  setHover: 'toki:set-hover',
  setInteractive: 'toki:set-interactive',
  openSettings: 'toki:open-settings',
  closeSettings: 'toki:close-settings',
  quit: 'toki:quit',
  openExternal: 'toki:open-external',
  installClaudeHooks: 'toki:install-claude-hooks',
  displays: 'toki:displays',
  reportSize: 'toki:report-size'
} as const;
