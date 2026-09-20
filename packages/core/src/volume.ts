/**
 * Loudness is perceived roughly logarithmically, so a slider that maps linearly
 * to amplitude wastes most of its travel: the top half all sounds much the same
 * and everything interesting is crushed into the last few pixels. Cubing the
 * position is the usual audio taper — the handle then moves in steps that sound
 * evenly spaced, and amplitude follows the curve the ear expects.
 *
 * This is also exactly the curve mpv applies to its own `volume` property, so
 * the position travels through the IPC layer uncubed and mpv does the work.
 * That is measured rather than assumed: `tests/volume.rs` renders a full-scale
 * tone through mpv at several volumes and fails if the curve is not this one.
 */
export const VOLUME_CURVE_EXPONENT = 3;

/** The amplitude multiplier a slider position produces. */
export function amplitudeForVolume(position: number): number {
  return clamp01(position) ** VOLUME_CURVE_EXPONENT;
}

/** The slider position that produces a given amplitude. Inverse of the above. */
export function volumeForAmplitude(amplitude: number): number {
  return clamp01(amplitude) ** (1 / VOLUME_CURVE_EXPONENT);
}

/**
 * Attenuation in decibels at a slider position, for display and for reasoning
 * about the curve in tests. Negative infinity at silence.
 */
export function decibelsForVolume(position: number): number {
  const amplitude = amplitudeForVolume(position);
  return amplitude === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(amplitude);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
