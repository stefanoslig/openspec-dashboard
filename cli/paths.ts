import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The package root is the nearest folder with a package.json, from cli/ or dist/cli/ alike.
function packageRoot(): string {
  let directory = import.meta.dirname;
  while (!existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('The openspec-desk package folder was not found.');
    directory = parent;
  }
  return directory;
}

const root = packageRoot();
export const appDir = path.join(root, 'dist/app');
export const demoDir = path.join(root, 'demo');
export const version: string = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
).version;
