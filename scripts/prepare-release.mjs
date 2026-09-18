import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const files = ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'index.html', 'vite.config.js'];
const directories = ['src', 'server', 'bootstrap', 'scripts'];
const extensions = new Set(['.js', '.mjs', '.jsx', '.css', '.json', '.png', '.svg']);

export function prepareRelease(root, destination) {
  if (fs.existsSync(destination)) throw new Error('发布目录已存在，请使用新的目录');
  const copy = (source, target) => {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error('发布资料不能包含符号链接');
    if (stat.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(source)) {
        if (name.startsWith('.') || ['node_modules', 'npm-cache'].includes(name)) continue;
        const sourceFile = path.join(source, name);
        if (fs.lstatSync(sourceFile).isDirectory() || extensions.has(path.extname(name))) copy(sourceFile, path.join(target, name));
      }
    } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
  };
  for (const name of [...files, ...directories]) copy(path.join(root, name), path.join(destination, name));
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const destination = process.argv[2] || path.join(root, '.release', new Date().toISOString().replaceAll(':', '-'));
  console.log('Clean Docker build context:', prepareRelease(root, destination));
}
