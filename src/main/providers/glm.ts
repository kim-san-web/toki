import { existsSync, readFileSync } from 'node:fs';
import type { CredentialMode, CredentialSupport, ProviderAccount } from '../../shared/types.js';
import type { SecretStore } from '../secrets.js';
import { glmKeySources } from '../paths.js';
import { log } from '../log.js';
import { getPinnedJson } from './http.js';
import { limitWindow, modeOrder, UsageError, type ProviderReading, type SignInRoute, type UsageProvider } from './provider.js';

/**
 * Z.ai's Coding Plan usage, with a key borrowed from whichever coding tool on
 * this PC already holds one -- Claude Code's `settings.json` env block, ZCode,
 * or OpenCode.
 *
 * TOKI never asks for a key of its own and never stores one: the file is read
 * inside the request and the value is dropped when it returns.
 */
export class GlmProvider implements UsageProvider {
  readonly id = 'glm';
  readonly displayName = 'GLM';
  readonly glyph = 'glm' as const;
  readonly fidelity = 'official' as const;
  readonly sourceNote = 'A GLM coding-plan key already held by Claude Code, ZCode or OpenCode';
  readonly support: CredentialSupport = {
    borrow: true,
    oauth: false,
    apiKey: true,
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    borrowNote: 'a GLM key already held by Claude Code, ZCode or OpenCode'
  };
  readonly signIn: SignInRoute = {
    kind: 'url',
    url: 'https://z.ai/manage-apikey/apikey-list',
    label: 'Get a Z.ai coding-plan key'
  };

  /** Which file the key came from, for the Settings row. Never the key itself. */
  private keySource: string | null = null;

  constructor(private readonly secrets: SecretStore) {}

  private findKey(): string {
    for (const source of glmKeySources()) {
      if (!existsSync(source.path)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(source.path, 'utf8'));
      } catch {
        continue;
      }
      const key = extractGlmKey(parsed);
      if (key) {
        this.keySource = source.path;
        return key;
      }
    }
    this.keySource = null;
    throw new UsageError('needsAuth', 'No GLM coding-plan key found in a tool on this PC');
  }

  async fetch(signal: AbortSignal, mode: CredentialMode): Promise<ProviderReading> {
    let key: string | null = null;
    let origin: 'borrowed' | 'apiKey' = 'borrowed';
    for (const candidate of modeOrder(mode, this.support)) {
      if (candidate === 'borrowed') {
        try {
          key = this.findKey();
          origin = 'borrowed';
          break;
        } catch {
          continue; // nothing to borrow; try a key the user gave us
        }
      } else if (candidate === 'apiKey') {
        const stored = this.secrets.get('glm:apiKey');
        if (stored) {
          key = stored;
          this.keySource = 'a key you gave TOKI';
          origin = 'apiKey';
          break;
        }
      }
    }
    if (!key) {
      throw new UsageError('needsAuth', 'No GLM coding-plan key found on this PC');
    }
    const payload = await getPinnedJson<GlmMonitorResponse>({
      url: 'https://api.z.ai/api/biz/monitor/usage',
      allowedHost: 'api.z.ai',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal
    });
    const windows = glmWindows(payload);
    if (windows.length === 0) {
      throw new UsageError('nothingMetered', 'Z.ai reported no coding-plan windows');
    }
    log.debug('glm', `read ${windows.length} window(s) via ${origin}`);
    return { windows, headlineId: windows[0]!.id, origin, account: this.account() };
  }

  account(): ProviderAccount | null {
    if (!this.keySource) {
      // Probe without holding the value, so the row is honest before the first
      // fetch too.
      try {
        this.findKey();
      } catch {
        return null;
      }
    }
    return {
      label: 'Coding Plan key',
      plan: null,
      source: this.keySource ?? 'a coding tool on this PC',
      manageUrl: 'https://z.ai/manage-apikey/apikey-list'
    };
  }

  forgetCached(): void {
    this.keySource = null;
  }
}

interface GlmMonitorResponse {
  data?: {
    usage?: { used?: number; limit?: number; type?: string; refreshTime?: string | number }[];
    promptUsage?: number;
    promptLimit?: number;
    refreshTime?: string | number;
  };
}

function toEpoch(value: string | number | undefined): number | null {
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * A window whose refresh time has passed reports no figure.
 *
 * Same reasoning as Codex: a percentage attached to a reset time in the past is
 * not stale, it is known-wrong, and the payload carries the proof itself.
 */
function glmWindow(
  id: string,
  label: string,
  used: number,
  limit: number,
  refreshTime: string | number | undefined,
  now: number
) {
  const resetsAt = toEpoch(refreshTime);
  const expired = resetsAt !== null && resetsAt <= now;
  return limitWindow({
    id,
    label,
    usedFraction: expired ? null : used / limit,
    resetsAt: expired ? null : resetsAt
  });
}

export function glmWindows(payload: GlmMonitorResponse, now = Date.now()) {
  const data = payload.data ?? {};
  const windows = (data.usage ?? [])
    .filter((entry) => typeof entry.used === 'number' && typeof entry.limit === 'number' && entry.limit! > 0)
    .map((entry, index) =>
      glmWindow(
        entry.type ?? `window_${index}`,
        entry.type ? entry.type.replace(/_/g, ' ') : 'Coding plan',
        entry.used!,
        entry.limit!,
        entry.refreshTime,
        now
      )
    );
  if (windows.length > 0) return windows;
  if (typeof data.promptUsage === 'number' && typeof data.promptLimit === 'number' && data.promptLimit > 0) {
    return [
      glmWindow('prompts', 'Prompts', data.promptUsage, data.promptLimit, data.refreshTime, now)
    ];
  }
  return [];
}

/**
 * Finds a GLM key in whatever shape the holding tool wrote it.
 *
 * Matched by *name* rather than by shape: every one of these tools stores an
 * env-style map somewhere, and the key is always the one named for Z.ai or
 * Anthropic-compatible GLM access.
 */
export function extractGlmKey(config: unknown, depth = 0): string | null {
  if (depth > 4 || !config || typeof config !== 'object') return null;
  const record = config as Record<string, unknown>;
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > 8) {
      const key = name.toUpperCase();
      const looksGlm =
        key === 'ZAI_API_KEY' ||
        key === 'GLM_API_KEY' ||
        key === 'ZHIPUAI_API_KEY' ||
        (key === 'ANTHROPIC_AUTH_TOKEN' && hasZaiBaseUrl(record));
      if (looksGlm) return value;
    }
  }
  for (const value of Object.values(record)) {
    const found = extractGlmKey(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * A GLM key is often filed under Anthropic's own variable, because that is how
 * these tools are pointed at Z.ai. Only accept it when a sibling base URL says
 * the traffic really goes to Z.ai -- otherwise this would send a genuine
 * Anthropic token to a third party.
 */
function hasZaiBaseUrl(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(
    ([name, value]) =>
      /BASE_URL$/i.test(name) && typeof value === 'string' && /(^|\.)z\.ai/i.test(value)
  );
}
