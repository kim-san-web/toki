import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Settings window: an ordinary window, deliberately.
 *
 * The notch is a click-through overlay that cannot take focus, so it is the
 * wrong surface for typing and toggling. Settings gets a real, focusable window
 * that appears in Alt-Tab, and closing it never quits the app.
 */
export class SettingsWindow {
  private window: BrowserWindow | null = null;

  open(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 720,
      height: 660,
      minWidth: 560,
      minHeight: 520,
      show: false,
      title: 'TOKI',
      backgroundColor: '#0E1013',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(here, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    void window.loadFile(join(here, '../renderer/settings.html'));
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      this.window = null;
    });
    this.window = window;
  }

  close(): void {
    this.window?.close();
  }

  send(channel: string, payload: unknown): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(channel, payload);
  }

  get isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }
}
