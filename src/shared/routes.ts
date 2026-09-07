/**
 * Where a blocked question can be answered, per provider.
 *
 * Pure data, deliberately in `shared/` and free of any `electron` import: a
 * module that pulls in `electron` cannot be loaded under plain Node, so every
 * test touching it fails on module resolution rather than on anything it is
 * actually testing. The main process owns opening things; this owns knowing
 * where they are.
 */
export interface AnswerRoute {
  /** The provider's own web chat. */
  web: string | null;
  /**
   * The local app that owns the session. `protocol` is null when there is no
   * URL that focuses it -- Claude Code and Codex run in a terminal, and
   * inventing a scheme would produce a button that silently does nothing.
   */
  app: { name: string; protocol: string | null } | null;
}

export function answerRoute(providerId: string): AnswerRoute {
  switch (providerId.split(':')[0]) {
    case 'claude':
      return { web: 'https://claude.ai/new', app: { name: 'Claude Code', protocol: null } };
    case 'codex':
      return { web: 'https://chatgpt.com/codex', app: { name: 'Codex', protocol: null } };
    case 'cursor':
      return { web: 'https://cursor.com/dashboard', app: { name: 'Cursor', protocol: 'cursor://' } };
    case 'glm':
      return { web: 'https://chat.z.ai', app: null };
    default:
      return { web: null, app: null };
  }
}
