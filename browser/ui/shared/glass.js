// Real refraction (SVG displacement through backdrop-filter) on the given elements, via
// kwlck/liquid-glass-web (MIT, vendored). Only Chromium renders it; that is what Hillium runs.
import { createLiquidGlass } from "../vendor/liquid-glass-web/liquid-glass.js";

export function glass(elements, options = {}) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const el of elements) {
    try {
      createLiquidGlass(el, { refraction: 70, blur: 1.5, light: 30, pointer: !calm, ...options });
    } catch {
      // Not a container element: leave it as it is.
    }
  }
}
