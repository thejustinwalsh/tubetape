#![allow(dead_code)]

use crate::ffmpeg_runtime::{self, get_ffmpeg};
use std::ffi::CString;
use std::os::raw::c_int;
use std::path::Path;

#[derive(Debug)]
pub struct ShimResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
enum FfprobeCommand {
    ListBitstreamFilters,
    ShowStreams { input: String },
    Version,
}

#[derive(Debug)]
struct FfmpegRemux {
    input: String,
    output: String,
    audio_codec: AudioCodec,
    output_format: String,
    no_video: bool,
    overwrite: bool,
}

#[derive(Debug, Clone)]
enum AudioCodec {
    Copy,
    Aac,
    Mp3,
    Flac,
    PcmS16Le,
}

impl AudioCodec {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "copy" => Some(AudioCodec::Copy),
            "aac" => Some(AudioCodec::Aac),
            "libmp3lame" | "mp3" => Some(AudioCodec::Mp3),
            "flac" => Some(AudioCodec::Flac),
            "pcm_s16le" => Some(AudioCodec::PcmS16Le),
            _ => None,
        }
    }
}

pub fn execute_ffprobe(args: &[String]) -> ShimResult {
    match parse_ffprobe_args(args) {
        Ok(cmd) => run_ffprobe(cmd),
        Err(e) => ShimResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: e,
        },
    }
}

pub fn execute_ffmpeg(args: &[String]) -> ShimResult {
    match parse_ffmpeg_args(args) {
        Ok(cmd) => run_ffmpeg_remux(cmd),
        Err(e) => ShimResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: e,
        },
    }
}

fn parse_ffprobe_args(args: &[String]) -> Result<FfprobeCommand, String> {
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-bsfs" => return Ok(FfprobeCommand::ListBitstreamFilters),
            "-version" => return Ok(FfprobeCommand::Version),
            "-show_streams" | "-show_format" => {
                let input = args.last().cloned().unwrap_or_default();
                return Ok(FfprobeCommand::ShowStreams { input });
            }
            _ => {}
        }
        i += 1;
    }
    Err("Unknown ffprobe command".to_string())
}

fn parse_ffmpeg_args(args: &[String]) -> Result<FfmpegRemux, String> {
    let mut input = None;
    let mut output = None;
    let mut audio_codec = AudioCodec::Copy;
    let mut output_format = String::new();
    let mut no_video = false;
    let mut overwrite = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-i" => {
                i += 1;
                if i < args.len() {
                    input = Some(args[i].clone());
                }
            }
            "-c:a" | "-acodec" => {
                i += 1;
                if i < args.len() {
                    audio_codec = AudioCodec::from_str(&args[i])
                        .ok_or_else(|| format!("Unknown audio codec: {}", args[i]))?;
                }
            }
            "-f" => {
                i += 1;
                if i < args.len() {
                    output_format = args[i].clone();
                }
            }
            "-vn" => no_video = true,
            "-y" => overwrite = true,
            "-v" | "-loglevel" | "-hide_banner" | "-nostdin" => {
                i += 1;
            }
            arg if !arg.starts_with('-') && i == args.len() - 1 => {
                output = Some(arg.to_string());
            }
            _ => {}
        }
        i += 1;
    }

    Ok(FfmpegRemux {
        input: input.ok_or("No input file specified")?,
        output: output.ok_or("No output file specified")?,
        audio_codec,
        output_format,
        no_video,
        overwrite,
    })
}

fn run_ffprobe(cmd: FfprobeCommand) -> ShimResult {
    match cmd {
        FfprobeCommand::ListBitstreamFilters => ShimResult {
            exit_code: 0,
            stdout: BITSTREAM_FILTERS.to_string(),
            stderr: ffmpeg_banner(),
        },
        FfprobeCommand::Version => ShimResult {
            exit_code: 0,
            stdout: String::new(),
            stderr: ffmpeg_banner(),
        },
        FfprobeCommand::ShowStreams { input } => run_ffprobe_streams(&input),
    }
}

fn run_ffprobe_streams(input: &str) -> ShimResult {
    let path = Path::new(input);
    match ffmpeg_runtime::AudioFile::open(path) {
        Ok(file) => {
            let stdout = format!(
                r#"[STREAM]
index=0
codec_type=audio
sample_rate={}
channels={}
[/STREAM]
[FORMAT]
duration={}
[/FORMAT]
"#,
                file.sample_rate, file.channels, file.duration_secs
            );
            ShimResult {
                exit_code: 0,
                stdout,
                stderr: ffmpeg_banner(),
            }
        }
        Err(e) => ShimResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!("{}: {}", input, e),
        },
    }
}

fn run_ffmpeg_remux(cmd: FfmpegRemux) -> ShimResult {
    let mut stderr = ffmpeg_banner();
    stderr.push_str(&format!("Input #0, from '{}':\n", cmd.input));

    let input_path = Path::new(&cmd.input);
    let output_path = Path::new(&cmd.output);

    if !input_path.exists() {
        return ShimResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!("{}: No such file or directory", cmd.input),
        };
    }

    if output_path.exists() && !cmd.overwrite {
        return ShimResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!(
                "File '{}' already exists. Overwrite? [y/N] Not overwriting - exiting",
                cmd.output
            ),
        };
    }

    let ff = match get_ffmpeg() {
        Ok(f) => f,
        Err(e) => {
            return ShimResult {
                exit_code: 1,
                stdout: String::new(),
                stderr: format!("Failed to load FFmpeg: {}", e),
            }
        }
    };

    let result = match cmd.audio_codec {
        AudioCodec::Copy => remux_audio_copy(ff, &cmd, &mut stderr),
        _ => transcode_audio(ff, &cmd, &mut stderr),
    };

    match result {
        Ok(stats) => {
            stderr.push_str(&format!(
                "size={:>8}kB time={} bitrate={:>6.1}kbits/s speed={:.2}x\n",
                stats.size_kb,
                format_time(stats.duration_secs),
                stats.bitrate_kbps,
                stats.speed
            ));
            stderr.push_str(&format!(
                "video:0kB audio:{}kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: unknown\n",
                stats.size_kb
            ));
            ShimResult {
                exit_code: 0,
                stdout: String::new(),
                stderr,
            }
        }
        Err(e) => ShimResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: format!("{}\nConversion failed: {}", stderr, e),
        },
    }
}

struct RemuxStats {
    size_kb: u64,
    duration_secs: f64,
    bitrate_kbps: f64,
    speed: f64,
}

fn remux_audio_copy(
    ff: &ffmpeg_runtime::FFmpegFunctions,
    cmd: &FfmpegRemux,
    stderr: &mut String,
) -> Result<RemuxStats, String> {
    use ffmpeg_runtime::*;

    let input_cstr = CString::new(cmd.input.as_str()).map_err(|e| e.to_string())?;
    let output_cstr = CString::new(cmd.output.as_str()).map_err(|e| e.to_string())?;
    let format_cstr = if cmd.output_format.is_empty() {
        None
    } else {
        Some(CString::new(cmd.output_format.as_str()).map_err(|e| e.to_string())?)
    };

    let start_time = std::time::Instant::now();

    unsafe {
        let mut input_ctx: *mut AVFormatContext = std::ptr::null_mut();
        let ret = (ff.avformat_open_input)(
            &mut input_ctx,
            input_cstr.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
        );
        if ret < 0 || input_ctx.is_null() {
            return Err(format!("Failed to open input: {}", av_error_string(ret)));
        }

        let ret = (ff.avformat_find_stream_info)(input_ctx, std::ptr::null_mut());
        if ret < 0 {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!(
                "Failed to find stream info: {}",
                av_error_string(ret)
            ));
        }

        let mut decoder: *const AVCodec = std::ptr::null();
        let audio_idx =
            (ff.av_find_best_stream)(input_ctx, AVMEDIA_TYPE_AUDIO, -1, -1, &mut decoder, 0);
        if audio_idx < 0 {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("No audio stream found".to_string());
        }

        if (*input_ctx).streams.is_null() {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Input context has null streams".to_string());
        }
        let in_streams =
            std::slice::from_raw_parts((*input_ctx).streams, (*input_ctx).nb_streams as usize);
        let in_stream = *in_streams.get(audio_idx as usize).ok_or("Invalid stream")?;
        if in_stream.is_null() {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Input stream pointer is null".to_string());
        }
        let in_codecpar = (*in_stream).codecpar;
        if in_codecpar.is_null() {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Input stream codecpar is null".to_string());
        }
        let in_time_base = (*in_stream).time_base;
        let in_duration = (*in_stream).duration;

        let duration_secs = if in_duration != AV_NOPTS_VALUE {
            in_duration as f64 * in_time_base.num as f64 / in_time_base.den as f64
        } else {
            (*input_ctx).duration as f64 / AV_TIME_BASE as f64
        };

        stderr.push_str(&format!(
            "  Duration: {}, bitrate: N/A\n",
            format_time(duration_secs)
        ));
        stderr.push_str(&format!("  Stream #0:0: Audio\n"));

        let mut output_ctx: *mut AVFormatContext = std::ptr::null_mut();
        let ret = (ff.avformat_alloc_output_context2)(
            &mut output_ctx,
            std::ptr::null(),
            format_cstr
                .as_ref()
                .map(|c| c.as_ptr())
                .unwrap_or(std::ptr::null()),
            output_cstr.as_ptr(),
        );
        if ret < 0 || output_ctx.is_null() {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!(
                "Failed to create output context: {}",
                av_error_string(ret)
            ));
        }

        let out_stream = (ff.avformat_new_stream)(output_ctx, std::ptr::null());
        if out_stream.is_null() {
            (ff.avformat_free_context)(output_ctx);
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Failed to create output stream".to_string());
        }
        let out_codecpar = (*out_stream).codecpar;
        if out_codecpar.is_null() {
            (ff.avformat_free_context)(output_ctx);
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Output stream codecpar is null".to_string());
        }

        let ret = (ff.avcodec_parameters_copy)(out_codecpar, in_codecpar);
        if ret < 0 {
            (ff.avformat_free_context)(output_ctx);
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!(
                "Failed to copy codec params: {}",
                av_error_string(ret)
            ));
        }

        (*out_stream).time_base = in_time_base;
        let out_time_base = (*out_stream).time_base;

        stderr.push_str(&format!(
            "Output #0, {} to '{}':\n",
            cmd.output_format, cmd.output
        ));
        stderr.push_str("  Stream #0:0: Audio (copy)\n");
        stderr.push_str("Stream mapping:\n");
        stderr.push_str("  Stream #0:0 -> #0:0 (copy)\n");

        let ret = (ff.avio_open)(
            &mut (*output_ctx).pb,
            output_cstr.as_ptr(),
            AVIO_FLAG_WRITE as c_int,
        );
        if ret < 0 {
            (ff.avformat_free_context)(output_ctx);
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!("Failed to open output: {}", av_error_string(ret)));
        }

        let ret = (ff.avformat_write_header)(output_ctx, std::ptr::null_mut());
        if ret < 0 {
            (ff.avio_closep)(&mut (*output_ctx).pb);
            (ff.avformat_free_context)(output_ctx);
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!("Failed to write header: {}", av_error_string(ret)));
        }

        let packet = (ff.av_packet_alloc)();
        if packet.is_null() {
            (ff.avio_closep)(&mut (*output_ctx).pb);
            (ff.avformat_free_context)(output_ctx);
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Failed to allocate packet".to_string());
        }
        let mut total_size: u64 = 0;

        while (ff.av_read_frame)(input_ctx, packet) >= 0 {
            if (*packet).stream_index != audio_idx {
                (ff.av_packet_unref)(packet);
                continue;
            }

            (*packet).stream_index = 0;
            (ff.av_packet_rescale_ts)(packet, in_time_base, out_time_base);

            total_size += (*packet).size as u64;

            let ret = (ff.av_interleaved_write_frame)(output_ctx, packet);
            (ff.av_packet_unref)(packet);
            if ret < 0 {
                break;
            }
        }

        (ff.av_write_trailer)(output_ctx);
        (ff.av_packet_free)(&mut (packet as *mut _));
        (ff.avio_closep)(&mut (*output_ctx).pb);
        (ff.avformat_free_context)(output_ctx);
        (ff.avformat_close_input)(&mut input_ctx);

        let elapsed = start_time.elapsed().as_secs_f64();
        let size_kb = total_size / 1024;
        let bitrate_kbps = if duration_secs > 0.0 {
            (total_size as f64 * 8.0) / duration_secs / 1000.0
        } else {
            0.0
        };
        let speed = if elapsed > 0.0 {
            duration_secs / elapsed
        } else {
            1.0
        };

        Ok(RemuxStats {
            size_kb,
            duration_secs,
            bitrate_kbps,
            speed,
        })
    }
}

fn transcode_audio(
    _ff: &ffmpeg_runtime::FFmpegFunctions,
    cmd: &FfmpegRemux,
    stderr: &mut String,
) -> Result<RemuxStats, String> {
    stderr.push_str("Transcoding via ffmpeg_runtime::export_sample\n");

    let input_path = Path::new(&cmd.input);
    let output_path = Path::new(&cmd.output);

    let file = ffmpeg_runtime::AudioFile::open(input_path)?;
    let duration = file.duration_secs;
    drop(file);

    ffmpeg_runtime::export_sample(input_path, output_path, 0.0, duration)?;

    let size_kb = std::fs::metadata(&cmd.output)
        .map(|m| m.len() / 1024)
        .unwrap_or(0);

    Ok(RemuxStats {
        size_kb,
        duration_secs: duration,
        bitrate_kbps: if duration > 0.0 {
            (size_kb as f64 * 8.0) / duration
        } else {
            0.0
        },
        speed: 1.0,
    })
}

fn av_error_string(errnum: c_int) -> String {
    ffmpeg_runtime::av_error_string(errnum)
}

fn ffmpeg_banner() -> String {
    let version = ffmpeg_runtime::ffmpeg_version().unwrap_or_else(|_| "unknown".to_string());
    format!(
        "ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers\n  built with Rust shim\n  {}\n",
        version
    )
}

fn format_time(secs: f64) -> String {
    let hours = (secs / 3600.0) as u32;
    let mins = ((secs % 3600.0) / 60.0) as u32;
    let s = secs % 60.0;
    format!("{:02}:{:02}:{:05.2}", hours, mins, s)
}

const BITSTREAM_FILTERS: &str = r#"Bitstream filters:
aac_adtstoasc
av1_frame_merge
av1_frame_split
av1_metadata
chomp
dca_core
dts2pts
dump_extra
dv_error_marker
eac3_core
evc_frame_merge
extract_extradata
filter_units
h264_metadata
h264_mp4toannexb
h264_redundant_pps
hapqa_extract
hevc_metadata
hevc_mp4toannexb
imxdump
media100_to_mjpegb
mjpeg2jpeg
mjpegadump
mov2textsub
mp3decomp
mpeg2_metadata
mpeg4_unpack_bframes
noise
null
opus_metadata
pcm_rechunk
pgs_frame_merge
prores_metadata
remove_extra
setts
showinfo
text2movsub
trace_headers
truehd_core
vp9_metadata
vp9_raw_reorder
vp9_superframe
vp9_superframe_split
vvc_metadata
vvc_mp4toannexb
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ffprobe_bsfs() {
        let args = vec!["-bsfs".to_string()];
        let cmd = parse_ffprobe_args(&args).unwrap();
        assert!(matches!(cmd, FfprobeCommand::ListBitstreamFilters));
    }

    #[test]
    fn test_parse_ffmpeg_remux() {
        let args = vec![
            "-i".to_string(),
            "/path/to/input.mp4".to_string(),
            "-vn".to_string(),
            "-c:a".to_string(),
            "copy".to_string(),
            "-f".to_string(),
            "adts".to_string(),
            "-y".to_string(),
            "/path/to/output.aac".to_string(),
        ];
        let cmd = parse_ffmpeg_args(&args).unwrap();
        assert_eq!(cmd.input, "/path/to/input.mp4");
        assert_eq!(cmd.output, "/path/to/output.aac");
        assert!(matches!(cmd.audio_codec, AudioCodec::Copy));
        assert_eq!(cmd.output_format, "adts");
        assert!(cmd.no_video);
        assert!(cmd.overwrite);
    }

    #[test]
    fn test_format_time() {
        assert_eq!(format_time(0.0), "00:00:00.00");
        assert_eq!(format_time(65.5), "00:01:05.50");
        assert_eq!(format_time(3661.25), "01:01:01.25");
    }

    #[test]
    fn test_ffprobe_bsfs_execution() {
        let cwd = std::env::current_dir().unwrap();
        let lib_paths = [
            cwd.join("binaries/ffmpeg"),
            cwd.join("src-tauri/binaries/ffmpeg"),
        ];
        for path in lib_paths {
            if path.join("libavutil.60.dylib").exists() || path.join("libavutil.so.60").exists() {
                crate::ffmpeg_runtime::set_library_directory(path);
                break;
            }
        }

        let result = execute_ffprobe(&["-bsfs".to_string()]);
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("Bitstream filters:"));
        assert!(result.stdout.contains("aac_adtstoasc"));
        assert!(result.stderr.contains("ffmpeg version"));
    }

    #[test]
    fn test_ffmpeg_remux_integration() {
        let cwd = std::env::current_dir().unwrap();
        let lib_paths = [
            cwd.join("binaries/ffmpeg"),
            cwd.join("src-tauri/binaries/ffmpeg"),
        ];
        for path in &lib_paths {
            if path.join("libavutil.60.dylib").exists() || path.join("libavutil.so.60").exists() {
                crate::ffmpeg_runtime::set_library_directory(path.clone());
                break;
            }
        }

        let home = std::env::var("HOME").unwrap_or_default();
        let test_input = format!(
            "{}/Library/Application Support/dev.tjw.tubetape/audio/-fDfwpghvcg_raw.mp4",
            home
        );

        if !std::path::Path::new(&test_input).exists() {
            eprintln!("Skipping integration test: test file not found");
            return;
        }

        let test_output = std::env::temp_dir().join("ffmpeg_shim_test.aac");
        let _ = std::fs::remove_file(&test_output);

        let args = vec![
            "-i".to_string(),
            test_input,
            "-vn".to_string(),
            "-c:a".to_string(),
            "copy".to_string(),
            "-f".to_string(),
            "adts".to_string(),
            "-y".to_string(),
            test_output.to_string_lossy().to_string(),
        ];

        let result = execute_ffmpeg(&args);

        eprintln!("Exit code: {}", result.exit_code);
        eprintln!("Stderr:\n{}", result.stderr);

        assert_eq!(result.exit_code, 0, "FFmpeg failed: {}", result.stderr);
        assert!(test_output.exists(), "Output file was not created");
        assert!(result.stderr.contains("Stream mapping:"));
        assert!(result.stderr.contains("speed="));

        let _ = std::fs::remove_file(&test_output);
    }
}
