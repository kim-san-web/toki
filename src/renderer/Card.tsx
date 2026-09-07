import type { JSX } from 'react';
import type { AgentSession, ProviderActivity, ProviderSnapshot } from '../shared/types.js';
import { bandColor, headline } from '../shared/bands.js';
import { qualifier } from '../shared/types.js';
import {
  blockSummary,
  elapsedCopy,
  resetCopy,
  staleWindowNote,
  statusMessage,
  windowSummary
} from '../shared/copy.js';
import { Glyph } from './Glyph.js';

/**
 * The detail card for one provider: every limit window, when each resets, and
 * every live session by name.
 *
 * The card leads with whatever is *stopping* you. A reached limit outranks the
 * headline percentage, because "84% left" and "paused until 4:13 PM" can both
 * be true at once and only one of them explains why nothing is happening.
 */
export function Card({
  snapshot,
  activity,
  now
}: {
  snapshot: ProviderSnapshot;
  activity: ProviderActivity | undefined;
  now: number;
}): JSX.Element {
  const message = statusMessage(snapshot, now);
  const head = headline(snapshot);
  const sessions = activity?.sessions ?? [];
  const stale = snapshot.status.kind === 'stale' ? snapshot.status.since : null;

  return (
    <div className="card">
      <header className="card__head">
        <span className="card__glyph">
          <Glyph glyph={snapshot.glyph} size={15} />
        </span>
        <h2 className="card__title">{snapshot.displayName}</h2>
        {snapshot.account?.plan && <span className="card__plan">{snapshot.account.plan}</span>}
      </header>

      {snapshot.block && (
        <div className="card__block">{blockSummary(snapshot.block.reason, snapshot.block.resetsAt, now)}</div>
      )}

      {message ? (
        <p className="card__message">{message}</p>
      ) : (
        <ul className="card__windows">
          {snapshot.windows.map((window) => {
            const isHead = window.id === head?.id;
            return (
              <li key={window.id} className={`window${isHead ? ' window--head' : ''}`}>
                <div className="window__row">
                  <span className="window__label">{window.label}</span>
                  <span className="window__value">
                    {window.usedFraction === null && window.remaining === null && window.used === null
                      ? 'Reset'
                      : `${qualifier(snapshot.fidelity)}${windowSummary(window)}`}
                  </span>
                </div>
                <div className="window__track">
                  <div
                    className="window__fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, (window.usedFraction ?? 0) * 100))}%`,
                      background: bandColor(window.usedFraction)
                    }}
                  />
                </div>
                <span className="window__reset">
                  {window.usedFraction === null && window.remaining === null && window.used === null
                    ? // The figure was withheld because its window rolled over.
                      // Say what to do, rather than leaving a blank that reads
                      // as either broken or zero.
                      staleWindowNote(snapshot.displayName)
                    : resetCopy(window.resetsAt, now)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {sessions.length > 0 && (
        <ul className="card__sessions">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} now={now} />
          ))}
        </ul>
      )}

      <footer className="card__foot">
        {stale !== null ? (
          <span className="card__stale">Read {elapsedCopy(stale, now)}</span>
        ) : snapshot.readAt !== null ? (
          <span>Updated {elapsedCopy(snapshot.readAt, now)}</span>
        ) : (
          <span>{snapshot.sourceNote}</span>
        )}
      </footer>
    </div>
  );
}

function SessionRow({ session, now }: { session: AgentSession; now: number }): JSX.Element {
  return (
    <li className={`session session--${session.state}`}>
      <span className="session__dot" aria-hidden="true" />
      <span className="session__body">
        <span className="session__name">{session.name}</span>
        <span className="session__detail">{session.waitingFor ?? session.detail}</span>
      </span>
      <span className="session__since">{elapsedCopy(session.since, now)}</span>
    </li>
  );
}
