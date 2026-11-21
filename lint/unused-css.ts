// Fails when a class selector in web/src/**/*.css is never referenced from web/src/**/*.{ts,tsx}.
// Matching is by whole word, so a class built dynamically must still appear verbatim somewhere.
import { Glob } from "bun";

const root = new URL("../web/src/", import.meta.url).pathname;

async function read(pattern: string) {
  const files: { path: string; text: string }[] = [];
  for await (const path of new Glob(pattern).scan(root)) {
    files.push({ path, text: await Bun.file(root + path).text() });
  }
  return files;
}

const css = await read("**/*.css");
const source = await read("**/*.{ts,tsx}");
const words = new Set(source.flatMap((f) => f.text.match(/[A-Za-z][\w-]*/g) ?? []));

const unused: string[] = [];
for (const { path, text } of css) {
  const selectors = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{[^{}]*\}/g, "{}");
  const classes = new Set([...selectors.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
  for (const name of classes) if (!words.has(name)) unused.push(`${path}: .${name}`);
}

if (unused.length) {
  console.error(`Unused CSS classes:\n  ${unused.join("\n  ")}`);
  process.exit(1);
}
