function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Blend a hex colour toward white by `amount` (0…1). */
function lighten(hex: string, amount: number) {
  const value = hex.replace('#', '');
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const red = mix(Number.parseInt(value.slice(0, 2), 16));
  const green = mix(Number.parseInt(value.slice(2, 4), 16));
  const blue = mix(Number.parseInt(value.slice(4, 6), 16));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function applyAccentColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  document.documentElement.style.setProperty('--accent', color);
  // A hover state that equals the base colour is invisible (issue #08). The
  // stylesheet's default pair is accent -> a lighter variant; custom accents
  // now get the same treatment instead of the runtime overwrite pinning both.
  document.documentElement.style.setProperty('--accent-hover', lighten(color, 0.12));
  document.documentElement.style.setProperty('--accent-subtle', hexToRgba(color, 0.14));
}
