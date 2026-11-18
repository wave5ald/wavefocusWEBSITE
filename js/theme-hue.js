/* ==========================================================================
   Theme hue
   The settings colour slider rotates the accent palette. Surfaces and text
   stay neutral, so only the accents (buttons, rings, chips, glows) change.
   ========================================================================== */

const BASE = { primary: 199, secondary: 239, tertiary: 38 };

const wrap = (value) => ((value % 360) + 360) % 360;

/**
 * CSS custom properties for a hue [shift] (degrees) in dark or light mode.
 * Mirrors the HSL conversion used by the desktop and Android builds.
 */
export function hueTokens(shift = 0, dark = true) {
  const primary = wrap(BASE.primary + shift);
  const secondary = wrap(BASE.secondary + shift);
  const tertiary = wrap(BASE.tertiary + shift);
  const hsl = (h, s, l) => `hsl(${h.toFixed(1)} 92% ${l}%)`;

  return {
    '--primary': dark ? hsl(primary, 92, 60) : hsl(primary, 96, 39),
    '--primary-soft': `hsla(${primary.toFixed(1)}, 92%, 60%, ${dark ? 0.14 : 0.1})`,
    '--secondary': dark ? hsl(secondary, 91, 74) : hsl(secondary, 75, 58),
    '--tertiary': dark ? hsl(tertiary, 96, 56) : hsl(tertiary, 95, 44),
    '--glow-1': `hsla(${primary.toFixed(1)}, 90%, 60%, ${dark ? 0.12 : 0.1})`,
    '--glow-2': `hsla(${secondary.toFixed(1)}, 85%, 65%, ${dark ? 0.1 : 0.07})`,
  };
}

/** Paint [root] with the hue palette. A zero shift hands control back to CSS. */
export function applyHue(root, shift = 0, dark = true) {
  if (!root) return;
  if (!shift) {
    Object.keys(hueTokens(0, dark)).forEach((name) => root.style.removeProperty(name));
    return;
  }
  Object.entries(hueTokens(shift, dark)).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}

/** The accent colour a given shift produces, for previews in the slider. */
export function hueSwatch(shift = 0, dark = true) {
  return hueTokens(shift, dark)['--primary'];
}
