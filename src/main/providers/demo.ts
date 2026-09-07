import type { ProviderSnapshot, ProviderActivity } from '../../shared/types.js';

/**
 * Fixed sample data, for screenshots and for trying the UI without pointing it
 * at anybody's account.
 *
 * Deliberately a separate flag from every provider's enable switch: turning the
 * demo on must never be mistakable for consent to read a real credential, and
 * while it is on no provider read happens at all.
 */
export function demoProviders(now = Date.now()): ProviderSnapshot[] {
  return [
    {
      id: 'claude',
      displayName: 'Claude',
      glyph: 'claude',
      fidelity: 'official',
      status: { kind: 'ok' },
      windows: [
        { id: 'session', label: 'Current session', usedFraction: 0.73, remaining: null, used: null, resetsAt: now + 51 * 60_000 },
        { id: 'weekly_all', label: 'All models', usedFraction: 0.07, remaining: null, used: null, resetsAt: now + 3 * 86_400_000 }
      ],
      headlineId: 'session',
      block: null,
      account: { label: 'Claude', plan: 'max', source: 'Claude Code', manageUrl: 'https://claude.ai/settings/usage' },
      readAt: now,
      support: { borrow: true, oauth: true, apiKey: false, apiKeyUrl: null, borrowNote: "Claude Code's own login" },
      origin: 'borrowed',
      hasStoredSecret: false,
      sourceNote: 'Sample data'
    },
    {
      id: 'codex',
      displayName: 'Codex',
      glyph: 'openai',
      fidelity: 'official',
      status: { kind: 'ok' },
      windows: [
        { id: 'primary', label: '5h limit', usedFraction: 0.21, remaining: null, used: null, resetsAt: now + 2 * 3_600_000 },
        { id: 'secondary', label: 'Weekly limit', usedFraction: 0.16, remaining: null, used: null, resetsAt: now + 5 * 86_400_000 }
      ],
      headlineId: 'primary',
      block: null,
      account: { label: 'you@example.com', plan: 'plus', source: 'Codex', manageUrl: null },
      readAt: now,
      support: { borrow: true, oauth: false, apiKey: false, apiKeyUrl: null, borrowNote: 'Codex' },
      origin: 'borrowed',
      hasStoredSecret: false,
      sourceNote: 'Sample data'
    },
    {
      id: 'cursor',
      displayName: 'Cursor',
      glyph: 'cursor',
      fidelity: 'official',
      status: { kind: 'ok' },
      windows: [
        { id: 'included', label: 'Included usage', usedFraction: 0.52, remaining: null, used: null, resetsAt: now + 12 * 86_400_000 }
      ],
      headlineId: 'included',
      block: null,
      account: { label: 'you@example.com', plan: 'pro', source: 'Cursor', manageUrl: 'https://cursor.com/dashboard' },
      readAt: now,
      support: { borrow: true, oauth: false, apiKey: true, apiKeyUrl: 'https://cursor.com/dashboard', borrowNote: 'Cursor' },
      origin: 'borrowed',
      hasStoredSecret: false,
      sourceNote: 'Sample data'
    },
    {
      id: 'glm',
      displayName: 'GLM',
      glyph: 'glm',
      fidelity: 'official',
      status: { kind: 'stale', since: now - 40 * 60_000 },
      windows: [
        { id: 'prompts', label: 'Prompts', usedFraction: 0.94, remaining: null, used: null, resetsAt: now + 20 * 60_000 }
      ],
      headlineId: 'prompts',
      block: null,
      account: null,
      readAt: now - 40 * 60_000,
      support: { borrow: true, oauth: false, apiKey: true, apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list', borrowNote: 'a coding tool' },
      origin: 'apiKey',
      hasStoredSecret: true,
      sourceNote: 'Sample data'
    }
  ];
}

export function demoActivity(now = Date.now()): ProviderActivity[] {
  return [
    {
      providerId: 'claude',
      state: 'working',
      sessions: [
        { id: 'demo.1', providerId: 'claude', name: 'toki', detail: 'Terminal - D:\\Projects\\toki', state: 'busy', waitingFor: null, cwd: 'D:\\Projects\\toki', since: now - 92_000 }
      ]
    },
    {
      providerId: 'codex',
      state: 'waiting',
      sessions: [
        { id: 'demo.2', providerId: 'codex', name: 'oil2value', detail: 'VS Code - D:\\Projects\\oil2value', state: 'waiting', waitingFor: 'Run `npm test` in oil2value?', cwd: 'D:\\Projects\\oil2value', since: now - 15_000 }
      ]
    },
    { providerId: 'cursor', state: 'idle', sessions: [] },
    { providerId: 'glm', state: 'unavailable', sessions: [] }
  ];
}
