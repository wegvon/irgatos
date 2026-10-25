import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn().mockResolvedValue(undefined),
}));
import { hslToRgb } from "../../../shared/lib/colorUtils";
import {
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_PALETTE_DEFAULT,
  THEME_PALETTE_SWATCHES,
  THEME_PALETTES,
} from "./appearance";

// Palette values live in index.css, the boot splash in index.html and the
// Settings swatches. These tests keep the three copies in step.
const css = readFileSync(new URL("../../../styles/index.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../../../index.html", import.meta.url), "utf8");
const LIGHT_BACKGROUND = 95;

function rule(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = source.slice(start, source.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
}

function hex(hue: number, saturation: number, lightness: number) {
  const { r, g, b } = hslToRgb(hue, saturation, lightness);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hslHex(value: string) {
  const [hue, saturation, lightness] = value
    .match(/hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/)!
    .slice(1)
    .map(Number);
  return hex(hue, saturation, lightness);
}

const others = THEME_PALETTES.filter((id) => id !== THEME_PALETTE_DEFAULT);

describe("colour palettes", () => {
  it.each(others)("%s swatches match index.css", (id) => {
    const dark = rule(css, `html.palette-${id}:not(.theme-light):not(.has-theme-tint)`);
    const darkInk = rule(css, `html.palette-${id}:not(.theme-light)`);
    const light = rule(css, `html.theme-light.palette-${id}:not(.has-theme-tint)`);
    const lightInk = rule(css, `html.theme-light.palette-${id}`);
    const swatch = THEME_PALETTE_SWATCHES[id];

    expect(swatch.dark.background).toBe(
      hex(
        Number(dark["--surface-hue"]),
        parseFloat(dark["--surface-saturation"]),
        parseFloat(dark["--background-lightness"] ?? `${THEME_DARK_LIGHTNESS_DEFAULT}`),
      ),
    );
    expect(swatch.dark.accent).toBe(hslHex(darkInk["--color-accent"]));
    expect(swatch.light.background).toBe(
      hex(
        Number(light["--surface-hue"]),
        parseFloat(light["--surface-saturation"]),
        parseFloat(light["--background-lightness"] ?? `${LIGHT_BACKGROUND}`),
      ),
    );
    expect(swatch.light.accent).toBe(hslHex(lightInk["--color-accent"]));
  });

  it.each(others)("%s boot splash matches index.css", (id) => {
    for (const selector of [
      `html.palette-${id}:not(.theme-light):not(.has-theme-tint)`,
      `html.theme-light.palette-${id}:not(.has-theme-tint)`,
    ]) {
      const fromCss = rule(css, selector);
      const fromHtml = rule(html, selector);
      for (const name of [
        "--surface-hue",
        "--surface-saturation",
        "--background-lightness",
      ]) {
        expect(fromHtml[name], `${selector} ${name}`).toBe(fromCss[name]);
      }
    }
  });

  it("boot script knows every palette", () => {
    const list = html.match(/\[([^\]]*)\]\.indexOf\(palette\)/)![1];
    expect(JSON.parse(`[${list}]`)).toEqual(others);
  });
});
