import type { JSX } from 'react';
import type { PendingQuestion } from '../shared/types.js';
import { elapsedCopy } from '../shared/copy.js';
import { toki } from './api.js';

/**
 * Everything currently blocked on you, and the ways to answer it.
 *
 * Shown above the rings because it outranks them: a percentage is something to
 * glance at, an unanswered question is something to act on. TOKI cannot answer
 * for you -- these tools take input in their own terminal or app -- so it does
 * the next most useful thing and puts the question and the route to it in one
 * place, rather than making you hunt for which window is waiting.
 */
export function Questions({
  questions,
  now
}: {
  questions: PendingQuestion[];
  now: number;
}): JSX.Element | null {
  if (questions.length === 0) return null;
  return (
    <div className="asks">
      {questions.map((question) => (
        <div className="ask" key={question.sessionId}>
          <div className="ask__head">
            <span className="ask__dot" aria-hidden="true" />
            <span className="ask__who">{question.sessionName}</span>
            <span className="ask__when">{elapsedCopy(question.since, now)}</span>
          </div>
          <p className="ask__q">{question.question}</p>
          <div className="ask__routes">
            {question.routes.appName && (
              <button
                type="button"
                className="ask__btn ask__btn--primary"
                onClick={() => toki.answerInApp(question.providerId, question.cwd)}
              >
                Open {question.routes.appName}
              </button>
            )}
            {question.routes.web && (
              <button
                type="button"
                className="ask__btn"
                onClick={() => toki.answerOnWeb(question.providerId)}
              >
                Open chat
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
