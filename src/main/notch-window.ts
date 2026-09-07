import { BrowserWindow, screen, type Display } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { NotchEdge, Settings } from '../shared/types.js';
import { toRect, type WorkArea } from './geometry.js';
import { windowSize } from './layout.js';
import { pointerInside, type HitRect } from '../shared/hit.js';
import { log } from './log.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The notch itself: a frameless, transparent, always-on-top window pinned to a
 * screen edge.
 *
 * Two behaviours make it feel like part of the desktop rather than a window
 * parked on top of one:
 *
 *  - It is **click-through by default**. The renderer reports which region is
 *    actually drawn, and only then does the window accept the mouse -- so a
 *    transparent window covering the top of the screen never eats a click meant
 *    for what is underneath.
 *  - It is pinned to the *work area*, not the display bounds, so a bottom notch
 *    rests on the taskbar and follows it when the taskbar moves or auto-hides.
 */
export class NotchWindow {
  private window: BrowserWindow | null = null;
  private providerCount = 1;
  private interactive = false;
  /** The drawn region, in window-relative CSS pixels, as the renderer measures it. */
  private hitRect: HitRect | null = null;
  private cursorTimer: NodeJS.Timeout | null = null;
  private pointerInside = false;
  private onPointer: ((inside: boolean) => void) | null = null;

  constructor(private settings: () => Settings) {}

  create(): BrowserWindow {
    const window = new BrowserWindow({
      width: 200,
      height: 60,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      // A transparent overlay must not paint over another app's fullscreen
      // video by default; 'screen-saver' keeps it above ordinary windows
      // without claiming the topmost slot outright.
      alwaysOnTop: true,
      acceptFirstMouse: true,
      webPreferences: {
        preload: join(here, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Click-through until the renderer says otherwise. `forward: true` keeps
    // mouse-move events arriving, which is the only way a hover-to-expand notch
    // can know the pointer has reached it while ignoring clicks.
    window.setIgnoreMouseEvents(true, { forward: true });

    void window.loadFile(join(here, '../renderer/notch.html'));
    window.once('ready-to-show', () => {
      this.reposition();
      if (this.settings().visibility !== 'hidden') window.show();
    });

    this.window = window;
    return window;
  }

  get browserWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Whether the window accepts the mouse.
   *
   * Driven by the renderer, which is the only side that knows where content is
   * actually drawn. The window is sized for its worst case and is mostly empty
   * transparent space, so it must stay click-through by default or it would eat
   * clicks meant for whatever is underneath.
   *
   * `forward: true` while click-through is what keeps mouse-move arriving, and
   * is the only reason a hover-to-expand overlay can notice the pointer at all.
   * Forwarding is turned off once interactive, or a drag inside the notch would
   * also be delivered to the desktop behind it.
   */
  setInteractive(interactive: boolean): void {
    if (!this.window || this.window.isDestroyed() || this.interactive === interactive) return;
    this.interactive = interactive;
    this.window.setIgnoreMouseEvents(!interactive, { forward: !interactive });
  }

  /**
   * How many rings the window must be able to draw.
   *
   * Note what this does *not* take: hover state. The window is sized for its
   * worst case and left alone, so expanding and collapsing is pure CSS inside a
   * window that never moves. Resizing per hover is what made the notch tear
   * when the pointer crossed between two rings.
   */
  setProviderCount(providerCount: number): void {
    if (this.providerCount === providerCount) return;
    this.providerCount = providerCount;
    this.reposition();
  }

  /** The display the notch lives on: the chosen one, or the primary. */
  private display(): Display {
    const { displayId } = this.settings();
    if (displayId !== null) {
      const match = screen.getAllDisplays().find((d) => d.id === displayId);
      if (match) return match;
    }
    return screen.getPrimaryDisplay();
  }

  reposition(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const settings = this.settings();
    const display = this.display();
    // The *work* area: what is left after the taskbar, so a bottom notch rests
    // on the taskbar rather than under it.
    const area: WorkArea = display.workArea;
    const size = windowSize(settings.edge, this.providerCount, settings.scale);
    const rect = toRect(settings.edge, size, settings.offset, area);
    try {
      this.window.setBounds(rect, false);
    } catch (error) {
      log.error('notch', `could not position: ${String(error)}`);
    }
  }

  /**
   * Track the pointer against the drawn region, in the main process.
   *
   * Electron's `setIgnoreMouseEvents(..., { forward: true })` is documented to
   * forward move events to a click-through window, but on Windows those do not
   * reliably surface as DOM `mouseenter` on a transparent, non-focusable
   * overlay -- so a notch that waits for one can simply never open. Polling the
   * OS cursor is deterministic: it works regardless of focus, hit-testing or
   * which app is in front, and it is the only signal that cannot silently stop
   * arriving.
   *
   * 16ms is deliberate. This is the input path for the whole app, and a slower
   * poll is felt directly as lag when reaching for the notch; a cursor read is
   * a cheap syscall, and nothing else happens unless the answer changes.
   */
  watchPointer(onPointer: (inside: boolean) => void): void {
    this.onPointer = onPointer;
    if (this.cursorTimer) return;
    this.cursorTimer = setInterval(() => this.samplePointer(), 16);
  }

  private samplePointer(): void {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return;
    const rect = this.hitRect;
    if (!rect) return;

    // `getBounds` and `getCursorScreenPoint` are both in the same DIP space that
    // the renderer lays out in, so the drawn region maps across with a plain
    // offset -- no scale-factor arithmetic, which is exactly the sort of thing
    // that quietly breaks on a mixed-DPI setup.
    const bounds = this.window.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const inside = pointerInside(cursor, bounds, rect);

    if (inside === this.pointerInside) return;
    this.pointerInside = inside;
    // Accepting the mouse only while the pointer is genuinely over content is
    // what keeps a window this large from eating clicks meant for other apps.
    this.setInteractive(inside);
    this.onPointer?.(inside);
  }

  /** The renderer's own measurement of what it draws. */
  setHitRect(rect: HitRect | null): void {
    this.hitRect = rect;
  }

  setVisible(visible: boolean): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (visible && !this.window.isVisible()) this.window.showInactive();
    if (!visible && this.window.isVisible()) this.window.hide();
  }

  send(channel: string, payload: unknown): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(channel, payload);
  }

  destroy(): void {
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    this.cursorTimer = null;
    this.window?.destroy();
    this.window = null;
  }
}

export function edgeLabel(edge: NotchEdge): string {
  return edge.charAt(0).toUpperCase() + edge.slice(1);
}
