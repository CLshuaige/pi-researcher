#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const settingsSchema = JSON.parse(readFileSync(new URL('../../../config/research-modules.schema.json', import.meta.url), 'utf8'));
const spec = settingsSchema.properties;
export const DEFAULT_SOURCES = [...spec.literature.properties.sources.default];
const knownSources = new Set(DEFAULT_SOURCES);
export const toolSource = source => {
  const canonical = source === 'semantic' ? 'semantic_scholar' : source;
  const entry = spec.literature.properties.sources.items.oneOf.find(item => item.const === canonical);
  if (!entry) throw new Error('Unknown academic source: ' + source);
  return entry['x-tool-value'];
};
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function getSettings(root) {
  const file = join(root, '.pi/research-modules.json');
  const input = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (!isObject(input)) throw new Error('Expected JSON object');
  for (const key of Object.keys(input)) if (!Object.hasOwn(spec, key)) throw new Error('Unknown setting: ' + key);
  if (input.$schema !== undefined && typeof input.$schema !== 'string') throw new Error('$schema must be a string');
  const interactionMode = input.interactionMode === undefined ? spec.interactionMode.default : input.interactionMode;
  if (!spec.interactionMode.enum.includes(interactionMode)) throw new Error('interactionMode must be auto or review');
  const lit = input.literature === undefined ? {} : input.literature;
  if (!isObject(lit)) throw new Error('literature must be an object');
  for (const key of Object.keys(lit)) if (!Object.hasOwn(spec.literature.properties, key)) throw new Error('Unknown literature setting: ' + key);
  const rawSources = lit.sources === undefined ? [...DEFAULT_SOURCES] : lit.sources;
  if (!Array.isArray(rawSources) || rawSources.some(x => typeof x !== 'string')) throw new Error('literature.sources must be an array of source names');
  const sources = rawSources.map(x => x === 'semantic' ? 'semantic_scholar' : x);
  if (sources.some(x => !knownSources.has(x))) throw new Error('literature.sources must contain only: ' + DEFAULT_SOURCES.join(', '));
  if (new Set(sources).size !== sources.length) throw new Error('literature.sources has duplicates');
  const writeReview = lit.writeReview === undefined ? spec.literature.properties.writeReview.default : lit.writeReview;
  if (typeof writeReview !== 'boolean') throw new Error('literature.writeReview must be boolean');
  return { source: existsSync(file) ? '.pi/research-modules.json' : 'defaults', interactionMode, literature: { sources, writeReview } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--describe') console.log(JSON.stringify(settingsSchema, null, 2));
    else {
      if (args.length && (args.length !== 2 || args[0] !== '--workspace' || !args[1] || args[1].startsWith('--'))) {
        throw new Error('Usage: node check-settings.mjs [--workspace PATH | --describe]');
      }
      console.log(JSON.stringify(getSettings(resolve(args[1] || '.')), null, 2));
    }
  } catch (error) { console.error('Configuration error: ' + error.message); process.exitCode = 1; }
}
