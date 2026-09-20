import { describe, expect, it } from "vitest";

import {
  amplitudeForVolume,
  decibelsForVolume,
  volumeForAmplitude,
} from "./volume.ts";

describe("volume curve", () => {
  it("is exponential, not linear, between the endpoints", () => {
    // The point of the taper: half travel is far quieter than half amplitude.
    expect(amplitudeForVolume(0.5)).toBeCloseTo(0.125, 6);
    expect(amplitudeForVolume(0.25)).toBeCloseTo(0.015625, 6);
  });

  it("pins the endpoints, so full means full and zero means silent", () => {
    expect(amplitudeForVolume(0)).toBe(0);
    expect(amplitudeForVolume(1)).toBe(1);
    expect(decibelsForVolume(1)).toBe(0);
    expect(decibelsForVolume(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("spaces the decibel steps far more evenly than a linear slider would", () => {
    const steps = [0.25, 0.5, 0.75, 1].map(decibelsForVolume);
    const gaps = steps.slice(1).map((db, i) => db - steps[i]!);
    // A linear slider's gaps over the same quarters are ~6, 3.5, 2.5 dB: the
    // last half of the travel barely changes anything. The taper's are within
    // a few dB of each other.
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(11);
    expect(gaps.every((gap) => gap > 0)).toBe(true);
  });

  it("round-trips through amplitude", () => {
    for (const position of [0, 0.1, 0.37, 0.5, 0.99, 1]) {
      expect(volumeForAmplitude(amplitudeForVolume(position))).toBeCloseTo(position, 10);
    }
  });

  it("clamps rather than producing a nonsense gain", () => {
    expect(amplitudeForVolume(1.5)).toBe(1);
    expect(amplitudeForVolume(-1)).toBe(0);
    expect(amplitudeForVolume(Number.NaN)).toBe(0);
  });
});
