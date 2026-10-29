import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareRelease } from '../scripts/prepare-release.mjs';

test('Docker build context excludes live database, passwords, caches and nested env files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  for (const name of ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'index.html', 'vite.config.js']) fs.writeFileSync(path.join(source, name), 'fixture');
  for (const name of ['src', 'server', 'bootstrap', 'scripts', 'works', 'works/pdf-ocr', '.data', 'node_modules', '.git']) fs.mkdirSync(path.join(source, name));
  fs.writeFileSync(path.join(source, 'server', 'app.mjs'), 'public-code');
  fs.writeFileSync(path.join(source, 'works', 'pdf-ocr', 'index.html'), 'work-page');
  for (const name of ['.env', '.data/local-admin-password', '.data/resellers.sqlite', 'src/.env.production', '.git/config', 'node_modules/dependency.js']) fs.writeFileSync(path.join(source, name), 'must-not-ship');
  const output = prepareRelease(source, path.join(root, 'out'));
  assert.equal(fs.readFileSync(path.join(output, 'server/app.mjs'), 'utf8'), 'public-code');
  assert.equal(fs.readFileSync(path.join(output, 'works/pdf-ocr/index.html'), 'utf8'), 'work-page');
  for (const name of ['.env', '.data', 'node_modules', '.git', 'src/.env.production']) assert.equal(fs.existsSync(path.join(output, name)), false);
  fs.symlinkSync(path.join(source, '.data/local-admin-password'), path.join(source, 'src/leak.json'));
  assert.throws(() => prepareRelease(source, path.join(root, 'invalid')), /符号链接/);
});
