import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'node:path';
import type { NotchEdge, Settings } from '../shared/types.js';
import { log } from './log.js';

/**
 * The tray icon, and the only always-available way to reach the app.
 *
 * The notch cannot take focus and can be hidden entirely, so without this there
 * would be a running process with no way to open Settings or quit it. When the
 * user asks for no tray icon, the notch's own settings orb becomes the route --
 * and that is why "hidden notch" and "no tray icon" cannot both be chosen.
 */
export interface TrayActions {
  refresh: () => void;
  openSettings: () => void;
  setEdge: (edge: NotchEdge) => void;
  setVisibility: (visibility: Settings['visibility']) => void;
  quit: () => void;
}

export class TrayIcon {
  private tray: Tray | null = null;

  constructor(
    private readonly resourcesDir: string,
    private readonly actions: TrayActions
  ) {}

  show(settings: Settings): void {
    if (!this.tray) {
      const image = nativeImage.createFromPath(join(this.resourcesDir, 'icons', 'tray.ico'));
      try {
        this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
      } catch (error) {
        log.error('tray', `could not create tray icon: ${String(error)}`);
        return;
      }
      this.tray.setToolTip('TOKI');
      this.tray.on('click', () => this.actions.openSettings());
    }
    this.tray.setContextMenu(this.menu(settings));
  }

  hide(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  update(settings: Settings): void {
    if (this.tray) this.tray.setContextMenu(this.menu(settings));
  }

  private menu(settings: Settings): Menu {
    const edges: NotchEdge[] = ['top', 'right', 'bottom', 'left'];
    return Menu.buildFromTemplate([
      { label: `TOKI ${app.getVersion()}`, enabled: false },
      { label: 'by Faisal Albusaidi', enabled: false },
      { type: 'separator' },
      { label: 'Refresh now', click: () => this.actions.refresh() },
      {
        label: 'Edge',
        submenu: edges.map((edge) => ({
          label: edge.charAt(0).toUpperCase() + edge.slice(1),
          type: 'radio' as const,
          checked: settings.edge === edge,
          click: () => this.actions.setEdge(edge)
        }))
      },
      {
        label: 'Show notch',
        submenu: (['hover', 'always', 'hidden'] as const).map((visibility) => ({
          label: visibility === 'hover' ? 'On hover' : visibility === 'always' ? 'Always' : 'Never',
          type: 'radio' as const,
          checked: settings.visibility === visibility,
          click: () => this.actions.setVisibility(visibility)
        }))
      },
      { type: 'separator' },
      { label: 'Settings...', click: () => this.actions.openSettings() },
      { label: 'Quit TOKI', click: () => this.actions.quit() }
    ]);
  }
}
