// Builds the extension into dist/.
//   node scripts/build.mjs          one-off build
//   node scripts/build.mjs --watch  rebuild on change
//   node scripts/build.mjs --zip    build, then zip dist/ into snapsort-<version>.zip
//   node scripts/build.mjs --harness  also build the dev test harness into .harness/harness.js
//   node scripts/build.mjs --firefox  also build dist-firefox/ and snapsort-firefox-<version>.zip
//
// Content scripts can't be ES modules, so each entry is bundled as a self-contained IIFE.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const harness = process.argv.includes('--harness');
const firefox = process.argv.includes('--firefox');

/** Zips the contents of `dir` into `out` (bsdtar on Windows 10+, `zip` elsewhere). */
function zipDir(dir, out) {
  rmSync(out, { force: true });
  if (process.platform === 'win32') {
    // Use Windows' bsdtar explicitly: Git Bash's GNU tar can't write zips and misreads "D:\".
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-a', '-c', '-f', out, '-C', dir, ...readdirSync(dir)], {
      stdio: 'inherit',
    });
  } else {
    execFileSync('zip', ['-r', '-q', out, '.'], { cwd: dir, stdio: 'inherit' });
  }
  console.log(`Wrote ${out}`);
}

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
  const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'));
  if (zip) {
    zipDir(dist, join(root, `snapsort-${manifest.version}.zip`));
  }
  if (firefox) {
    // Same code, plus the add-on ID Firefox requires. data_collection_permissions needs
    // Firefox 140 (desktop) / 142 (Android).
    const ffDir = join(root, 'dist-firefox');
    rmSync(ffDir, { recursive: true, force: true });
    cpSync(dist, ffDir, { recursive: true });
    const ffManifest = {
      ...manifest,
      browser_specific_settings: {
        gecko: {
          id: 'snapsort@samarthbc.github.io',
          strict_min_version: '140.0',
          // SnapSort sends nothing anywhere except Google Photos itself.
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    };
    writeFileSync(join(ffDir, 'manifest.json'), JSON.stringify(ffManifest, null, 2));
    zipDir(ffDir, join(root, `snapsort-firefox-${manifest.version}.zip`));
  }
}
