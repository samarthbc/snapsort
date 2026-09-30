// Builds the extension into dist/.
//   node scripts/build.mjs          one-off build
//   node scripts/build.mjs --watch  rebuild on change
//   node scripts/build.mjs --zip    build, then zip dist/ into snapsort-<version>.zip
//   node scripts/build.mjs --harness  also build the dev test harness into .harness/harness.js
//
// Content scripts can't be ES modules, so each entry is bundled as a self-contained IIFE.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const harness = process.argv.includes('--harness');

const copyPublic = {
  name: 'copy-public',
  setup(build) {
    build.onEnd(() => {
      cpSync(join(root, 'public'), dist, { recursive: true });
    });
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const options = {
  entryPoints: {
    content: join(root, 'src/content/index.tsx'),
    'main-world': join(root, 'src/main-world/index.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text' },
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  plugins: [copyPublic],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
  if (harness) {
    await esbuild.build({
      ...options,
      entryPoints: {
        harness: join(root, 'src/harness/index.ts'),
        'harness-api': join(root, 'src/harness/api.ts'),
      },
      outdir: join(root, '.harness'),
      plugins: [],
    });
  }
  if (zip) {
    const { version } = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'));
    const out = join(root, `snapsort-${version}.zip`);
    rmSync(out, { force: true });
    // tar on Windows 10+ and macOS/Linux can write zip archives.
    execFileSync('tar', ['-a', '-c', '-f', out, '-C', dist, '.'], { stdio: 'inherit' });
    console.log(`Wrote ${out}`);
  }
}
