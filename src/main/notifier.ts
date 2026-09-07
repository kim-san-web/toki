import { Notification, shell } from 'electron';
import { join } from 'node:path';
import type { AgentSession, ProviderActivity, Settings } from '../shared/types.js';
import { answerRoute } from '../shared/routes.js';
import { log } from './log.js';

/**
 * Tells you when an agent has stopped and is waiting on you.
 *
 * The point of the notch is answering "is it still working?" at a glance, but a
 * glance only helps if you happen to look. A session that is blocked on a
 * yes/no is the one state where waiting costs real time, so it is the one state
 * worth interrupting for.
 *
 * Deliberately conservative about *when* it fires:
 *
 *  - only on the transition into `waiting`, never repeatedly while it stays there
 *  - once per session; a session that goes busy -> waiting -> busy -> waiting is
 *    a new question each time, but the same unanswered question is not
 *  - never for a session that was already waiting when TOKI started, since that
 *    notification would be about something that happened before it was watching
 */
export { answerRoute, type AnswerRoute } from '../shared/routes.js';

export class Notifier {
  /** Sessions already announced, so the same question is not raised twice. */
  private announced = new Set<string>();
  /** Seen at least once, so a session already waiting at launch is not announced. */
  private known = new Set<string>();
  private primed = false;

  constructor(
    private readonly settingsOf: () => Settings,
    private readonly onOpen: (providerId: string) => void
  ) {}

  /**
   * Compare the latest activity against what was already announced.
   *
   * The first call only records what is there. Anything waiting at that moment
   * predates TOKI watching, and announcing it would mean a notification every
   * launch for a question the user has already seen.
   */
  update(activity: ProviderActivity[]): void {
    const settings = this.settingsOf();
    const live = new Set<string>();

    for (const provider of activity) {
      for (const session of provider.sessions) {
        live.add(session.id);
        const isNew = !this.known.has(session.id);
        this.known.add(session.id);

        if (session.state !== 'waiting') {
          // Answered, or moved on: the next question from this session is a new
          // one and deserves its own notification.
          this.announced.delete(session.id);
          continue;
        }
        if (!this.primed) continue;
        if (this.announced.has(session.id)) continue;
        // A session first seen *already* waiting mid-run is still worth raising:
        // it means an agent started and blocked between two polls.
        void isNew;

        this.announced.add(session.id);
        if (settings.notifyOnWaiting) this.notify(provider.providerId, session);
      }
    }

    // Forget sessions that have gone entirely, so ids cannot accumulate.
    for (const id of [...this.known]) if (!live.has(id)) this.known.delete(id);
    for (const id of [...this.announced]) if (!live.has(id)) this.announced.delete(id);
    this.primed = true;
  }

  private notify(providerId: string, session: AgentSession): void {
    if (!Notification.isSupported()) return;
    try {
      const notification = new Notification({
        title: `${session.name} needs you`,
        body: session.waitingFor ?? 'Waiting for your answer',
        silent: false,
        timeoutType: 'default'
      });
      // Clicking opens TOKI itself, where the question and its routes are shown
      // -- the notification is a pointer to the answer, not the answer.
      notification.on('click', () => this.onOpen(providerId));
      notification.show();
      log.debug('notify', `raised for ${providerId}`);
    } catch (error) {
      log.error('notify', `could not raise: ${String(error)}`);
    }
  }

  /** Open the provider's web chat, where the question can be answered. */
  static openWeb(providerId: string): void {
    const route = answerRoute(providerId);
    if (!route.web) return;
    void shell.openExternal(route.web);
  }

  /** Bring the owning app forward, when it registers a protocol we can use. */
  static openApp(providerId: string, cwd: string | null): void {
    const route = answerRoute(providerId);
    if (route.app?.protocol) {
      const target = cwd ? `${route.app.protocol}file/${encodeURI(cwd)}` : route.app.protocol;
      void shell.openExternal(target).catch(() => {
        /* not installed, or the protocol is not registered */
      });
      return;
    }
    // No protocol to launch: the session lives in a terminal, so the honest
    // thing is to open the folder it is running in rather than pretend.
    if (cwd) void shell.openPath(cwd);
  }

  static revealFolder(path: string): void {
    void shell.openPath(join(path));
  }
}
