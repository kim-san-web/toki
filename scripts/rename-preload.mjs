/**
 * Move the compiled preload into place as `dist/preload/index.cjs`.
 *
 * Two facts force this dance, and both cost a debugging session to find:
 *
 *  1. The package is `"type": "module"`, so a `.js` file under `dist/` is
 *     treated as ESM by Node -- and an ESM preload fails at `require`, leaving
 *     the renderer with no `window.toki` and no error anyone sees.
 *  2. The preload is compiled as CommonJS but *type-imports* `src/shared`, so
 *     TypeScript pulls those files into its program. Emitting them beside the
 *     main build overwrites the ESM `dist/shared/*.js` with CommonJS copies,
 *     and the app dies at launch with "does not provide an export named ...".
 *
 * So the preload compiles into a scratch directory of its own, and only the one
 * file it actually owns is moved out. The scratch tree is then removed, because
 * a stale CommonJS `shared/` left lying in `dist/` is exactly the trap above.
 */
import { renameSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const scratch = join('dist', '.preload-build');
// A `.cts` source emits `.cjs`, which is already the extension we need --
// only its location is wrong.
const from = join(scratch, 'preload', 'index.cjs');
const to = join('dist', 'preload', 'index.cjs');

if (!existsSync(from)) {
  console.error('preload build produced nothing at', from);
  process.exit(1);
}

mkdirSync(join('dist', 'preload'), { recursive: true });
rmSync(to, { force: true });
renameSync(from, to);
rmSync(scratch, { recursive: true, force: true });
console.log('preload -> dist/preload/index.cjs');
