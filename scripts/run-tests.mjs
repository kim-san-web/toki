/**
 * Run the compiled test files.
 *
 * Deliberately not `node --test dist/test/` or `node --test "dist/test/*.js"`:
 * what a bare directory and what a glob mean to `--test` both changed between
 * Node versions, so each of those spellings passes on one Node and fails on
 * another. Handing it an explicit list of files means the same thing on every
 * version this project supports.
 *
 * It also fails loudly on an empty directory. The failure mode worth avoiding is
 * a test command that exits 0 because it found nothing to run.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = join('dist', 'test');

let files;
try {
  files = readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => join(dir, name));
} catch {
  console.error(`No ${dir} directory. Run \`npm run build:main\` first.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`No compiled tests in ${dir}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
