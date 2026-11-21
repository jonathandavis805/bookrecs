import { describe, expect, test } from "bun:test";
import { contrast, onAccent, type Palette, PRESETS, randomTheme } from "./theme";

function expectReadable(c: Palette) {
  expect(contrast(c.text, c.card)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(c.muted, c.card)).toBeGreaterThanOrEqual(3);
  expect(contrast(c.accent, c.card)).toBeGreaterThanOrEqual(3);
  expect(contrast(onAccent(c), c.accent)).toBeGreaterThanOrEqual(3);
  expect(contrast(onAccent(c), c.danger)).toBeGreaterThanOrEqual(3);
}

describe("themes", () => {
  for (const preset of PRESETS) {
    test(`${preset.name} is readable`, () => expectReadable(preset.colors));
  }

  test("random themes are readable", () => {
    let seed = 1;
    // Deterministic LCG so a failure reproduces
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 500; i++) {
      const t = randomTheme(rand);
      if (!t.colors) throw new Error("random theme has no colors");
      expectReadable(t.colors);
    }
  });
});
