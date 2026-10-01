//! Pins the shape of mpv's volume curve.
//!
//! The UI sends a slider position and relies on mpv to apply the perceptual
//! taper. That is an assumption about somebody else's code, and the failure
//! mode if it ever changes is not a crash. It is a volume slider that silently
//! goes back to being linear and useless over most of its travel. So measure
//! it: render a full-scale tone through `ao=pcm` at several volumes and compare
//! the RMS of what comes out against the cubic curve `@ymusic/core` assumes.

use libmpv2::{events::Event, Mpv};
use std::path::{Path, PathBuf};
use ymusic_lib::playback::{
    limiter_reduction, measured_filter, stable_volume_filter, stable_volume_gain, MAX_BOOST_DB,
};
use ymusic_lib::settings::StableVolume;

/// Must match `VOLUME_CURVE_EXPONENT` in `packages/core/src/volume.ts`.
const VOLUME_CURVE_EXPONENT: f64 = 3.0;

#[test]
fn mpv_applies_the_cubic_taper_the_volume_slider_assumes() {
    let dir = std::env::temp_dir().join(format!("ymusic-volume-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    let tone = dir.join("tone.wav");
    write_full_scale_tone(&tone);
    let reference = render_at(&tone, &dir, 100.0);
    assert!(
        reference > 1000.0,
        "the reference tone should be near full scale, got {reference}"
    );

    // Well clear of both ends: at low volumes a cubed 16-bit sample rounds into
    // the noise floor, which would test quantisation rather than the curve.
    for percent in [75.0_f64, 50.0, 25.0] {
        let measured = render_at(&tone, &dir, percent) / reference;
        let expected = (percent / 100.0).powf(VOLUME_CURVE_EXPONENT);
        let error = (measured - expected).abs() / expected;
        assert!(
            error < 0.05,
            "at volume {percent} mpv rendered {measured:.5} of full scale, but the \
             slider's curve expects {expected:.5}. If mpv changed its taper, the \
             exponent in packages/core/src/volume.ts has to change with it."
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stable_volume_turns_a_loud_track_down_by_its_loudness() {
    let dir = std::env::temp_dir().join(format!("ymusic-stable-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    let tone = dir.join("tone.wav");
    write_full_scale_tone(&tone);
    let reference = render(&tone, &dir, 100.0, "");
    for mode in [StableVolume::On, StableVolume::LoudOnly] {
        let quieter =
            render(&tone, &dir, 100.0, &stable_volume_filter(mode, Some(6.0))) / reference;
        let expected = 10f64.powf(-6.0 / 20.0);
        assert!(
            (quieter - expected).abs() / expected < 0.05,
            "{mode:?}: a track 6 dB over the reference rendered at {quieter:.4} of \
             full scale, expected {expected:.4}"
        );
    }
    assert_eq!(
        stable_volume_filter(StableVolume::LoudOnly, Some(-3.0)),
        "",
        "only loud songs: quiet tracks are left alone"
    );
    assert_eq!(stable_volume_filter(StableVolume::Off, Some(6.0)), "");
    assert_eq!(stable_volume_filter(StableVolume::On, None), "");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stable_volume_turns_a_quiet_track_up_without_clipping() {
    let dir = std::env::temp_dir().join(format!("ymusic-boost-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    // A tone at -12 dBFS: the 4 dB boost leaves it well under the limiter, so
    // it should come out 4 dB louder. A sign slip would turn it down instead.
    let quiet = dir.join("quiet.wav");
    write_tone(&quiet, 10f64.powf(-12.0 / 20.0));
    let quiet_reference = render(&quiet, &dir, 100.0, "");
    let louder = render(
        &quiet,
        &dir,
        100.0,
        &stable_volume_filter(StableVolume::On, Some(-4.0)),
    ) / quiet_reference;
    let expected = 10f64.powf(4.0 / 20.0);
    assert!(
        (louder - expected).abs() / expected < 0.05,
        "a track 4 dB under the reference rendered at {louder:.4} of its level, \
         expected {expected:.4}"
    );

    // A full-scale tone standing in for a track YouTube measured 4 dB quiet:
    // quiet on average, peaks at the top. The boost must land in the limiter.
    let tone = dir.join("tone.wav");
    write_full_scale_tone(&tone);
    let reference = render(&tone, &dir, 100.0, "");
    let boosted = render(
        &tone,
        &dir,
        100.0,
        &stable_volume_filter(StableVolume::On, Some(-4.0)),
    );
    let ceiling = 10f64.powf(-1.0 / 20.0);
    assert!(
        boosted / reference <= ceiling * 1.02,
        "a boosted full-scale tone should be held at -1 dBFS, got {:.4} of full scale",
        boosted / reference
    );

    // And a boost never goes past the cap, however quiet YouTube says it is.
    assert_eq!(
        stable_volume_filter(StableVolume::On, Some(-20.0)),
        format!("lavfi=[volume={MAX_BOOST_DB:.2}dB,alimiter=limit=0.891:level=disabled]")
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stats_for_nerds_meters_either_side_of_a_boost() {
    let dir = std::env::temp_dir().join(format!("ymusic-stats-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    // The full-scale tone again, boosted 4 dB into the limiter: the input
    // meter reads 0 dBTP, the output meter the limiter's -1 dB ceiling.
    let tone = dir.join("tone.wav");
    write_full_scale_tone(&tone);
    let gain = stable_volume_filter(StableVolume::On, Some(-4.0));
    let (input, output) = meter(&tone, &measured_filter(&gain));
    let peak = true_peak_db(&input);
    let output_peak = true_peak_db(&output.expect("a meter after the gain"));
    assert!(
        peak.abs() < 0.5,
        "input true peak {peak:.2} dBTP, expected about 0"
    );
    assert!(
        (output_peak + 1.0).abs() < 0.5,
        "output true peak {output_peak:.2} dBTP, expected about -1"
    );
    let boost = stable_volume_gain(StableVolume::On, Some(-4.0)).expect("a boost");
    let reduction = limiter_reduction(peak, boost, output_peak);
    assert!(
        (reduction - 5.0).abs() < 0.5,
        "the limiter took off {reduction:.2} dB, expected about 5"
    );
    assert!(
        input.contains("lavfi.r128.I"),
        "no integrated loudness in {input}"
    );

    // With no gain there is only the one meter.
    let (_, output) = meter(&tone, &measured_filter(""));
    assert!(output.is_none());

    let _ = std::fs::remove_dir_all(&dir);
}

/// Plays the tone through `af` and returns what the `in` and `out` meters
/// last published.
fn meter(tone: &Path, af: &str) -> (String, Option<String>) {
    let mpv = Mpv::with_initializer(|init| {
        init.set_property("vid", "no")?;
        init.set_property("terminal", "no")?;
        init.set_property("ytdl", "no")?;
        init.set_property("ao", "null")?;
        init.set_property("ao-null-untimed", "yes")?;
        // Stay on the last frame, so the filters and their readings survive the end.
        init.set_property("keep-open", "yes")?;
        init.set_property("af", af)?;
        Ok(())
    })
    .expect("libmpv");
    mpv.command("loadfile", &[tone.to_str().expect("utf-8 path")])
        .expect("loadfile");
    for _ in 0..500 {
        if mpv.get_property::<bool>("eof-reached").unwrap_or(false) {
            break;
        }
        let _ = mpv.wait_event(0.02);
    }
    let input = mpv
        .get_property::<String>("af-metadata/in")
        .expect("a meter before the gain");
    (input, mpv.get_property::<String>("af-metadata/out").ok())
}

fn true_peak_db(json: &str) -> f64 {
    let values: std::collections::HashMap<String, String> =
        serde_json::from_str(json).expect("filter metadata is a JSON object");
    let linear: f64 = values["lavfi.r128.true_peak"].parse().expect("a number");
    20.0 * linear.log10()
}

fn render_at(tone: &Path, dir: &Path, percent: f64) -> f64 {
    render(tone, dir, percent, "")
}

/// Decodes the tone with mpv writing raw samples to a file, and returns the RMS.
fn render(tone: &Path, dir: &Path, percent: f64, af: &str) -> f64 {
    let out = dir.join(format!("out-{percent:.0}-{}.wav", af.len()));
    let _ = std::fs::remove_file(&out);

    let mpv = Mpv::with_initializer(|init| {
        init.set_property("vid", "no")?;
        init.set_property("terminal", "no")?;
        init.set_property("ytdl", "no")?;
        init.set_property("ao", "pcm")?;
        init.set_property("ao-pcm-file", out.to_str().expect("utf-8 path"))?;
        // Pinning the output format keeps the RMS comparable across runs and
        // makes the parser below a fixed 44-byte header plus i16 samples.
        init.set_property("audio-format", "s16")?;
        init.set_property("audio-samplerate", 48000)?;
        init.set_property("volume", percent)?;
        init.set_property("af", af)?;
        Ok(())
    })
    .expect("libmpv");

    mpv.command("loadfile", &[tone.to_str().expect("utf-8 path")])
        .expect("loadfile");
    loop {
        match mpv.wait_event(10.0) {
            Some(Ok(Event::EndFile(_))) | Some(Ok(Event::Shutdown)) | None => break,
            _ => {}
        }
    }
    drop(mpv);

    rms_of(&out)
}

fn rms_of(path: &Path) -> f64 {
    let bytes = std::fs::read(path).expect("mpv should have written a pcm file");
    let samples = pcm_data(&bytes, path);
    let sum: f64 = samples
        .chunks_exact(2)
        .map(|pair| {
            let sample = i16::from_le_bytes([pair[0], pair[1]]) as f64;
            sample * sample
        })
        .sum();
    (sum / (samples.len() / 2) as f64).sqrt()
}

/// The bytes of the `data` chunk.
///
/// Walking the chunk list rather than assuming a 44-byte header matters more
/// than it looks: header bytes read as `i16` are enormous, so a few of them
/// left in the slice are invisible at full volume and swamp the signal at a
/// quarter volume, which is exactly the measurement this test depends on.
fn pcm_data<'a>(bytes: &'a [u8], path: &Path) -> &'a [u8] {
    assert_eq!(&bytes[0..4], b"RIFF", "not a RIFF file: {}", path.display());
    assert_eq!(
        &bytes[8..12],
        b"WAVE",
        "not a WAVE file: {}",
        path.display()
    );
    let mut offset = 12;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().expect("4 bytes"));
        let start = offset + 8;
        if id == b"data" {
            // mpv writes the header before it knows the length, so a streamed
            // file can carry a placeholder size. Trust the file length instead.
            let end = (start + size as usize).min(bytes.len());
            let data = &bytes[start..end];
            assert!(!data.is_empty(), "no samples in {}", path.display());
            return data;
        }
        offset = start + size as usize + (size as usize & 1);
    }
    panic!("no data chunk in {}", path.display());
}

fn write_full_scale_tone(path: &PathBuf) {
    write_tone(path, 1.0);
}

/// A one-second sine peaking at `amplitude` of full scale, written by hand so
/// the test needs no ffmpeg and no committed binary fixture.
fn write_tone(path: &PathBuf, amplitude: f64) {
    const RATE: u32 = 48_000;
    const FRAMES: u32 = RATE;
    let mut pcm = Vec::with_capacity(FRAMES as usize * 2);
    for frame in 0..FRAMES {
        let phase = 2.0 * std::f64::consts::PI * 440.0 * frame as f64 / RATE as f64;
        pcm.extend_from_slice(&((phase.sin() * amplitude * i16::MAX as f64) as i16).to_le_bytes());
    }

    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * 2).to_le_bytes()); // byte rate
    wav.extend_from_slice(&2u16.to_le_bytes()); // block align
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(&pcm);

    std::fs::write(path, wav).expect("write tone");
}
