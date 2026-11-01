/**
 * Perceptual microphone-level mapping for the flow-bar widget.
 *
 * The recorder measures RMS amplitude in the 0…1 range, but that number is
 * not perceptually uniform: with the OS-level DSP chain active
 * (echoCancellation + noiseSuppression — both are requested in
 * `requestAudioStream`), normal speech lands around RMS 0.01–0.08, and a
 * linear multiplier (`rms * 3`) leaves the widget's bars pinned at their
 * minimum until the user nearly shouts into the microphone.
 *
 * This maps RMS onto 0…1 on a decibel scale across the speech-relevant
 * window: -60 dB (near silence) → 0, -20 dB (loud speech) → 1. On that
 * curve, quiet speech (RMS ≈ 0.003) reaches ~0.25 and normal speech
 * (RMS ≈ 0.01–0.03) reaches 0.5–0.75, so the bars track a conversation
 * instead of its peaks.
 *
 * Keep this file dependency-free: it is loaded directly by
 * `node --test` through the in-memory TypeScript transpiler.
 */

const FLOOR_DB = -60;
const CEILING_DB = -20;

export function micLevelFromRms(rms: number): number {
  if (typeof rms !== 'number' || Number.isNaN(rms) || rms <= 0) return 0;
  if (rms === Number.POSITIVE_INFINITY) return 1;
  const db = 20 * Math.log10(rms);
  if (db <= FLOOR_DB) return 0;
  if (db >= CEILING_DB) return 1;
  return (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB);
}
