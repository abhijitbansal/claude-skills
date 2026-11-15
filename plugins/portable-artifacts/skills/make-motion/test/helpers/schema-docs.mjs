// The motion.json reference is split by topic: references/schema.md is the index and references/schema/*.md the topics (PA-35). A test
// that looks for a phrase in "the schema docs" reads them all as one text with every run of whitespace collapsed to one space, because
// a long line may wrap anywhere. Not a test file.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Every file of the reference, index first, then the topics in name order. */
export function schemaFiles(root) {
  const topics = readdirSync(path.join(root, 'references/schema')).filter((f) => f.endsWith('.md')).sort();
  return [path.join(root, 'references/schema.md'), ...topics.map((f) => path.join(root, 'references/schema', f))];
}

/** The whole reference as one string, whitespace collapsed. */
export const readSchema = (root) => schemaFiles(root).map((file) => readFileSync(file, 'utf8')).join('\n').replace(/\s+/g, ' ');
