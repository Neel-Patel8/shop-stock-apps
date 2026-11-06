// Builds the www/ folder that goes inside the Android app: the shared app files plus the Android bridge.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
rmSync('www', { recursive: true, force: true });
mkdirSync('www/lib', { recursive: true });
for (const f of ['app.css', 'data.js', 'app.js', 'views.js']) cpSync('app/' + f, 'www/' + f);
cpSync('app/lib', 'www/lib', { recursive: true });
let html = readFileSync('app/index.html', 'utf8');
html = html.replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, viewport-fit=cover"');
html = html.replace('<script src="lib/papaparse.min.js"></script>', '<script src="platform.bundle.js"></script>\n<script src="lib/papaparse.min.js"></script>');
writeFileSync('www/index.html', html);
await build({ entryPoints: ['src/platform.js'], bundle: true, minify: true, format: 'iife', target: 'chrome100', outfile: 'www/platform.bundle.js' });
console.log('www built');
