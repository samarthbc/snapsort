// Dev-only offline demo of the SnapSort UI, with the Google Photos API replaced by
// src/demo/mockApi.ts and generated sample pictures. No Google account involved.
//   node scripts/demo.mjs            → http://localhost:5179
//   node scripts/demo.mjs --bundle   → prints the demo script to stdout (for a standalone page)

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockApi = join(root, 'src/demo/mockApi.ts');

// Every `import … from '../api'` in the app resolves to the mock instead.
const useMockApi = {
  name: 'use-mock-api',
  setup(build) {
    build.onResolve({ filter: /^\.\.\/api$/ }, (args) =>
      args.importer.includes(`${join('src', 'demo')}`) ? undefined : { path: mockApi },
    );
  },
};

const result = await esbuild.build({
  entryPoints: [join(root, 'src/demo/main.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text' },
  plugins: [useMockApi],
});
const js = result.outputFiles[0].text;

if (process.argv.includes('--bundle')) {
  process.stdout.write(js);
  process.exit(0);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SnapSort demo</title>
<style>body{margin:0;min-height:100vh;background:#202124;color:#9aa0a6;font:15px system-ui;display:grid;place-items:center}</style>
</head><body><p>Google Photos would be here. Click the SnapSort button.</p>
<script src="/demo.js"></script></body></html>`;

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/demo.js')
    return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(js);
  res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
}).listen(5179, '127.0.0.1', () => console.log('SnapSort demo on http://localhost:5179'));
