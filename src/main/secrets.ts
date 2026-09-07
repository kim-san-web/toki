import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { readJson, writeAtomic } from './atomic.js';
import { log } from './log.js';

/**
 * Secrets TOKI is given directly -- an API key typed into Settings, or a token
 * from an OAuth sign-in it performed itself.
 *
 * Borrowed credentials never come here. Those stay in the file the owning tool
 * wrote and are read inside a request; storing a copy would mean holding a
 * second, staler version of somebody else's secret.
 *
 * Encrypted with Electron's `safeStorage`, which on Windows is DPAPI scoped to
 * the logged-in account: the file is unreadable by another user on the same
 * machine, and unreadable if copied elsewhere. When the OS refuses to provide
 * encryption, TOKI **stores nothing at all** rather than falling back to
 * plaintext -- an unencrypted key on disk is worse than asking again.
 */
/**
 * The OS encryption this store depends on.
 *
 * Injected rather than imported from `electron` directly so the store can be
 * tested under plain Node: importing `electron` outside a running app resolves
 * to a path string, not a module, and every test touching secrets would fail on
 * something unrelated to what it is testing.
 */
export interface Crypto {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class SecretStore {
  private readonly path: string;
  private cache = new Map<string, string>();
  private readonly crypto: Crypto;
  /** Null until first asked; see `available`. */
  private encryption: boolean | null = null;
  private loaded = false;

  constructor(dir: string, crypto: Crypto) {
    this.path = join(dir, 'secrets.bin');
    this.crypto = crypto;
    // Deliberately no probing here -- see `available`.
  }

  /**
   * Whether the OS will encrypt for us, asked **lazily**.
   *
   * `safeStorage.isEncryptionAvailable()` returns `false` until Electron is
   * ready and only becomes `true` afterwards. Probing it in the constructor
   * therefore latched "unavailable" forever if the store happened to be built
   * during module initialisation, and every save was refused with "Windows
   * would not encrypt" on a machine where encryption works perfectly well.
   *
   * Asking on first use instead means the answer is taken when it is
   * meaningful, whatever order the app happens to construct things in. The
   * result is cached only once it is `true`, so an early `false` can never
   * become permanent.
   */
  private get available(): boolean {
    if (this.encryption === true) return true;
    const now = this.crypto.isEncryptionAvailable();
    if (now) {
      this.encryption = true;
      // Nothing on disk could be decrypted while encryption was unavailable, so
      // this is the first moment a stored secret can actually be recovered.
      this.load();
    } else if (this.encryption === null) {
      log.warn('secrets', 'OS encryption not available yet');
      this.encryption = false;
    }
    return now;
  }

  /** Whether secrets can be persisted at all on this machine. */
  get canStore(): boolean {
    return this.available;
  }

  private load(): void {
    // Guarded by `loaded` rather than by `available`, because `available` calls
    // this on the transition to encrypted -- checking it here would recurse.
    if (this.loaded || !existsSync(this.path)) return;
    this.loaded = true;
    const stored = readJson<Record<string, string>>(this.path, {});
    for (const [id, encrypted] of Object.entries(stored)) {
      try {
        this.cache.set(id, this.crypto.decryptString(Buffer.from(encrypted, 'base64')));
      } catch {
        // Written by a different Windows account, or after a credential reset.
        // Dropping it is right: the user is asked once rather than shown a
        // permanent error about a value nobody can read.
        log.warn('secrets', `discarding an unreadable secret for ${id}`);
      }
    }
  }

  private flush(): void {
    if (!this.available) return;
    const out: Record<string, string> = {};
    for (const [id, value] of this.cache) {
      out[id] = this.crypto.encryptString(value).toString('base64');
    }
    try {
      writeAtomic(this.path, JSON.stringify(out));
    } catch (error) {
      log.error('secrets', `could not persist: ${String(error)}`);
    }
  }

  /**
   * Reads touch `available` first, deliberately.
   *
   * It is what loads the file, and it can only do so once the OS is willing to
   * decrypt. Reading the cache directly would report "no secret" on any lookup
   * that happened to land before that point -- which is the same class of bug
   * as probing encryption in the constructor.
   */
  get(id: string): string | null {
    void this.available;
    return this.cache.get(id) ?? null;
  }

  has(id: string): boolean {
    void this.available;
    return this.cache.has(id);
  }

  set(id: string, value: string): boolean {
    if (!this.available) return false;
    this.cache.set(id, value);
    this.flush();
    return true;
  }

  delete(id: string): void {
    this.cache.delete(id);
    if (this.cache.size === 0) {
      // Nothing left to protect: remove the file rather than leave an empty
      // encrypted blob implying something is still stored.
      try {
        if (existsSync(this.path)) unlinkSync(this.path);
      } catch {
        /* best effort */
      }
      return;
    }
    this.flush();
  }

  /** Which ids have a stored secret. Never the values. */
  ids(): string[] {
    return [...this.cache.keys()];
  }
}
