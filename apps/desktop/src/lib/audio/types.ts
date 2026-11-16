interface ChannelLevel {
  /** Sample peak in dBFS. `-Infinity` is digital silence. */
  peakDb: number;
  /** RMS level in dBFS, when the source measures it. */
  rmsDb?: number;
}

/** One metering update: one entry per channel (1 = mono, 2 = stereo). */
export interface MeterFrame {
  channels: ChannelLevel[];
}

/** Anything that can push frames to subscribers. */
export interface FrameSource<T> {
  subscribe: (listener: (frame: T) => void) => () => void;
}

export type MeterZoneName = "ok" | "warn" | "clip";

/** A colour zone of a meter, starting at `fromDb` and running to the next zone. */
export interface MeterZone {
  fromDb: number;
  zone: MeterZoneName;
}
