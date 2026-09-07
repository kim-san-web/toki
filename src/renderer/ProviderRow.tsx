import type { JSX } from 'react';
import { useState } from 'react';
import type { CredentialMode, ProviderSnapshot } from '../shared/types.js';
import { statusMessage } from '../shared/copy.js';
import { toki } from './api.js';
import { Glyph } from './Glyph.js';

/**
 * One provider in Settings: whether it is on, where its credential comes from,
 * and how to give it one when there is nothing to borrow.
 *
 * The three modes are shown only when the provider really supports them, so the
 * row never offers a box that cannot work -- Codex, for instance, publishes no
 * endpoint an API key could query.
 */
export function ProviderRow({
  provider,
  enabled,
  mode,
  demo,
  onToggle,
  onMode,
  now
}: {
  provider: ProviderSnapshot;
  enabled: boolean;
  mode: CredentialMode;
  demo: boolean;
  onToggle: (enabled: boolean) => void;
  onMode: (mode: CredentialMode) => void;
  now: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const message = demo ? null : statusMessage(provider, now);
  const { support } = provider;
  const modes: { value: CredentialMode; label: string }[] = [
    { value: 'auto', label: 'Automatic' },
    ...(support.borrow ? [{ value: 'borrow' as const, label: 'Borrow' }] : []),
    ...(support.oauth ? [{ value: 'oauth' as const, label: 'Sign in' }] : []),
    ...(support.apiKey ? [{ value: 'apiKey' as const, label: 'API key' }] : [])
  ];

  const originText =
    provider.origin === 'borrowed'
      ? `Borrowed from ${provider.account?.source ?? support.borrowNote}`
      : provider.origin === 'oauth'
        ? 'Signed in to TOKI'
        : provider.origin === 'apiKey'
          ? 'Using your API key'
          : null;

  const signIn = async (): Promise<void> => {
    setBusy(true);
    setNotice('Your browser is opening. Approve access, then paste the code below.');
    await toki.beginSignIn(provider.id);
    setBusy(false);
  };

  const completeSignIn = async (): Promise<void> => {
    setBusy(true);
    const result = await toki.completeSignIn(provider.id, code);
    setBusy(false);
    setNotice(result.ok ? 'Signed in.' : (result.error ?? 'Sign-in failed'));
    if (result.ok) setCode('');
  };

  const saveKey = async (): Promise<void> => {
    setBusy(true);
    const result = await toki.setApiKey(provider.id, key);
    setBusy(false);
    setNotice(result.ok ? (key ? 'Key saved.' : 'Key removed.') : (result.error ?? 'Could not save'));
    if (result.ok) setKey('');
  };

  return (
    <li className={`prow${enabled ? '' : ' prow--off'}`}>
      <div className="prow__main">
        <span className="row__glyph">
          <Glyph glyph={provider.glyph} size={17} />
        </span>
        <div className="row__body">
          <span className="row__title">{provider.displayName}</span>
          <span className="row__note">
            {!enabled
              ? `Off. Would read ${support.borrowNote}.`
              : demo
                ? 'Showing sample data.'
                : (message ?? originText ?? support.borrowNote)}
          </span>
          {enabled && !demo && !message && provider.origin === 'borrowed' && (
            <span className="row__source">TOKI never signs in itself for this one.</span>
          )}
        </div>
        {modes.length > 1 && (
          <button
            type="button"
            className={`link${open ? ' link--on' : ''}`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Done' : 'Connect'}
          </button>
        )}
        <Switch checked={enabled} onChange={onToggle} label={provider.displayName} />
      </div>

      {open && (
        <div className="prow__panel">
          <div className="field field--tight">
            <div className="field__label">
              <span>Credential</span>
              <small>Automatic tries each one this provider supports, in order.</small>
            </div>
            <div className="field__control">
              <select value={mode} onChange={(e) => onMode(e.target.value as CredentialMode)}>
                {modes.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {support.oauth && (mode === 'auto' || mode === 'oauth') && (
            <div className="connect">
              <p className="connect__lead">
                Sign in to TOKI directly. Useful when the app that owns the login has not written a
                usable token.
              </p>
              <div className="connect__row">
                <button type="button" className="btn" disabled={busy} onClick={() => void signIn()}>
                  Open sign-in
                </button>
                <input
                  type="text"
                  placeholder="Paste the code here"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || code.trim().length === 0}
                  onClick={() => void completeSignIn()}
                >
                  Finish
                </button>
              </div>
            </div>
          )}

          {support.apiKey && (mode === 'auto' || mode === 'apiKey') && (
            <div className="connect">
              <p className="connect__lead">
                Paste a key. It is encrypted with your Windows account and never leaves this PC
                except to the provider it belongs to.
                {support.apiKeyUrl && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="link link--inline"
                      onClick={() => toki.openExternal(support.apiKeyUrl!)}
                    >
                      Get a key
                    </button>
                  </>
                )}
              </p>
              <div className="connect__row">
                <input
                  type="password"
                  placeholder={provider.hasStoredSecret ? 'A key is saved' : 'Paste your key'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button type="button" className="btn" disabled={busy} onClick={() => void saveKey()}>
                  Save
                </button>
              </div>
            </div>
          )}

          {provider.hasStoredSecret && (
            <button
              type="button"
              className="link link--danger"
              onClick={() => {
                void toki.clearCredentials(provider.id);
                setNotice('TOKI forgot what it held. The tool that owns the account is untouched.');
              }}
            >
              Forget what TOKI stored
            </button>
          )}

          {notice && <p className="connect__notice">{notice}</p>}
        </div>
      )}
    </li>
  );
}

function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? ' switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  );
}

export { Switch };
