import type { JSX } from 'react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CredentialMode, NotchEdge, Settings } from '../shared/types.js';
import { toki } from './api.js';
import { useDashboard, useNow } from './useDashboard.js';
import { useTheme } from './useTheme.js';
import { elapsedCopy } from '../shared/copy.js';
import { TokiMark } from './Glyph.js';
import { ProviderRow, Switch } from './ProviderRow.js';
import { ThemePicker } from './ThemePicker.js';
import './theme.css';
import './settings.css';

type Tab = 'providers' | 'appearance' | 'placement' | 'about';

/**
 * Settings.
 *
 * Tabbed rather than one long scroll: the provider list is the part people
 * return to, and burying it under a 36-theme gallery would make the common task
 * the slowest one.
 */
function SettingsApp(): JSX.Element | null {
  const state = useDashboard();
  const now = useNow(20_000);
  const [tab, setTab] = useState<Tab>('providers');
  const [displays, setDisplays] = useState<{ id: number; label: string; primary: boolean }[]>([]);
  const [hooksBusy, setHooksBusy] = useState(false);

  useTheme(state?.settings);

  useEffect(() => {
    void toki.displays().then(setDisplays);
  }, []);

  if (!state) return null;
  const { settings, providers } = state;

  const patch = (next: Partial<Settings>): void => {
    void toki.setSettings(next);
  };

  return (
    <div className="settings">
      <header className="settings__head">
        <span className="settings__mark">
          <TokiMark size={26} />
        </span>
        <div>
          <h1>TOKI</h1>
          <p>Your AI coding limits, on the edge of the screen.</p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void toki.refresh()}
          disabled={state.refreshing}
        >
          {state.refreshing ? 'Refreshing...' : 'Refresh now'}
        </button>
      </header>

      <nav className="tabs">
        {(
          [
            ['providers', 'Providers'],
            ['appearance', 'Appearance'],
            ['placement', 'Placement'],
            ['about', 'About']
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab${tab === id ? ' tab--on' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'providers' && (
        <>
          <Section title="Providers" note="Nothing is read until you switch it on.">
            <ul className="rows">
              {providers.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  enabled={settings.providers[provider.id]?.enabled ?? false}
                  mode={settings.providers[provider.id]?.mode ?? 'auto'}
                  demo={settings.demoMode}
                  onToggle={(enabled) =>
                    patch({
                      providers: {
                        [provider.id]: {
                          enabled,
                          mode: settings.providers[provider.id]?.mode ?? 'auto'
                        }
                      }
                    })
                  }
                  onMode={(mode: CredentialMode) =>
                    patch({
                      providers: {
                        [provider.id]: {
                          enabled: settings.providers[provider.id]?.enabled ?? false,
                          mode
                        }
                      }
                    })
                  }
                  now={now}
                />
              ))}
            </ul>
          </Section>

          <Section title="Activity" note="How TOKI knows an agent is working or waiting on you.">
            <div className="row">
              <div className="row__body">
                <span className="row__title">Claude Code hooks</span>
                <span className="row__note">
                  Lets Claude Code tell TOKI when a session starts, finishes, or needs you. Your
                  existing hooks are kept.
                </span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={hooksBusy}
                onClick={() => {
                  setHooksBusy(true);
                  void toki
                    .installClaudeHooks(!settings.claudeHooksInstalled)
                    .finally(() => setHooksBusy(false));
                }}
              >
                {settings.claudeHooksInstalled ? 'Remove hooks' : 'Install hooks'}
              </button>
            </div>
            <Toggle
              label="Notify me when an agent is waiting"
              note="A desktop notification the moment something blocks on your answer."
              checked={settings.notifyOnWaiting}
              onChange={(notifyOnWaiting) => patch({ notifyOnWaiting })}
            />
            <p className="hint">
              Codex and Cursor need no setup - TOKI reads the activity they already record here.
            </p>
          </Section>
        </>
      )}

      {tab === 'appearance' && (
        <Section title="Theme" note="Pick one, or build your own and save it.">
          <ThemePicker settings={settings} onChange={patch} />
        </Section>
      )}

      {tab === 'placement' && (
        <>
          <Section title="Placement">
            <Field label="Edge">
              <Segmented
                value={settings.edge}
                options={(['top', 'right', 'bottom', 'left'] as NotchEdge[]).map((edge) => ({
                  value: edge,
                  label: edge.charAt(0).toUpperCase() + edge.slice(1)
                }))}
                onChange={(edge) => patch({ edge: edge as NotchEdge })}
              />
            </Field>

            <Field label="Position" hint="Where along that edge the notch sits.">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.offset}
                onChange={(event) => patch({ offset: Number(event.target.value) })}
              />
            </Field>

            <Field label="Show notch">
              <Segmented
                value={settings.visibility}
                options={[
                  { value: 'hover', label: 'On hover' },
                  { value: 'always', label: 'Always' },
                  { value: 'hidden', label: 'Never' }
                ]}
                onChange={(visibility) =>
                  patch({ visibility: visibility as Settings['visibility'] })
                }
              />
            </Field>

            <Field label="Size">
              <Segmented
                value={String(settings.scale)}
                options={[
                  { value: '0.9', label: 'Small' },
                  { value: '1', label: 'Default' },
                  { value: '1.15', label: 'Large' }
                ]}
                onChange={(scale) => patch({ scale: Number(scale) })}
              />
            </Field>

            {displays.length > 1 && (
              <Field label="Display">
                <select
                  value={settings.displayId === null ? 'primary' : String(settings.displayId)}
                  onChange={(event) =>
                    patch({
                      displayId:
                        event.target.value === 'primary' ? null : Number(event.target.value)
                    })
                  }
                >
                  <option value="primary">Primary display</option>
                  {displays.map((display) => (
                    <option key={display.id} value={display.id}>
                      {display.label}
                      {display.primary ? ' (primary)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </Section>

          <Section title="App">
            <Toggle
              label="Start with Windows"
              note="TOKI launches hidden and waits on the edge."
              checked={settings.launchAtLogin}
              onChange={(launchAtLogin) => patch({ launchAtLogin })}
            />
            <Toggle
              label="Tray icon"
              note="The only way back to Settings when the notch is hidden."
              checked={settings.presence === 'tray'}
              disabled={settings.visibility === 'hidden'}
              onChange={(on) => patch({ presence: on ? 'tray' : 'none' })}
            />
            <Toggle
              label="Demo data"
              note="Fixed sample readings. No provider is read while this is on."
              checked={settings.demoMode}
              onChange={(demoMode) => patch({ demoMode })}
            />
          </Section>
        </>
      )}

      {tab === 'about' && (
        <Section title="About">
          <div className="about">
            <TokiMark size={44} />
            <h2>TOKI</h2>
            <p className="about__by">Developed by Faisal Albusaidi</p>
            <p className="about__blurb">
              A screen-edge dashboard for AI coding tools. TOKI reads what the tools on this PC
              already know about your usage, and tells you when one of them is waiting on you.
            </p>
            <p className="about__note">
              Every reading is borrowed from a credential a tool here already holds, or from one you
              gave TOKI yourself. Nothing is read until you switch it on.
            </p>
          </div>
        </Section>
      )}

      <footer className="settings__foot">
        <span>
          {state.sweptAt > 0 ? `Last checked ${elapsedCopy(state.sweptAt, now)}` : 'Not checked yet'}
        </span>
        <button type="button" className="btn btn--ghost" onClick={() => toki.quit()}>
          Quit TOKI
        </button>
      </footer>
    </div>
  );
}

function Section({
  title,
  note,
  children
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="section">
      <div className="section__head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="field__control">{children}</div>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segmented__item${value === option.value ? ' segmented__item--on' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  note,
  checked,
  disabled,
  onChange
}: {
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className={`row${disabled ? ' row--off' : ''}`}>
      <div className="row__body">
        <span className="row__title">{label}</span>
        {note && <span className="row__note">{note}</span>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>
  );
}
