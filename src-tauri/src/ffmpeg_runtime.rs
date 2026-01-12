#![allow(non_camel_case_types)]
#![allow(non_upper_case_globals)]
#![allow(non_snake_case)]
#![allow(dead_code)]
#![allow(clippy::all)]

use libloading::Library;
use once_cell::sync::OnceCell;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_uint, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

include!(concat!(env!("OUT_DIR"), "/ffmpeg_bindings.rs"));

pub const AVMEDIA_TYPE_AUDIO: c_int = 1;
pub const AV_NOPTS_VALUE: i64 = 0x8000000000000000u64 as i64;

type FnAvformatOpenInput = unsafe extern "C" fn(
    *mut *mut AVFormatContext,
    *const c_char,
    *const c_void,
    *mut *mut AVDictionary,
) -> c_int;

type FnAvformatCloseInput = unsafe extern "C" fn(*mut *mut AVFormatContext);
type FnAvformatFindStreamInfo =
    unsafe extern "C" fn(*mut AVFormatContext, *mut *mut AVDictionary) -> c_int;
type FnAvformatAllocOutputContext2 = unsafe extern "C" fn(
    *mut *mut AVFormatContext,
    *const c_void,
    *const c_char,
    *const c_char,
) -> c_int;
type FnAvformatWriteHeader =
    unsafe extern "C" fn(*mut AVFormatContext, *mut *mut AVDictionary) -> c_int;
type FnAvWriteTrailer = unsafe extern "C" fn(*mut AVFormatContext) -> c_int;
type FnAvformatFreeContext = unsafe extern "C" fn(*mut AVFormatContext);
type FnAvFindBestStream = unsafe extern "C" fn(
    *mut AVFormatContext,
    c_int,
    c_int,
    c_int,
    *mut *const AVCodec,
    c_int,
) -> c_int;
type FnAvReadFrame = unsafe extern "C" fn(*mut AVFormatContext, *mut AVPacket) -> c_int;
type FnAvSeekFrame = unsafe extern "C" fn(*mut AVFormatContext, c_int, i64, c_int) -> c_int;
type FnAvInterleavedWriteFrame = unsafe extern "C" fn(*mut AVFormatContext, *mut AVPacket) -> c_int;
type FnAvformatNewStream =
    unsafe extern "C" fn(*mut AVFormatContext, *const AVCodec) -> *mut AVStream;
type FnAvioOpen = unsafe extern "C" fn(*mut *mut AVIOContext, *const c_char, c_int) -> c_int;
type FnAvioClosep = unsafe extern "C" fn(*mut *mut AVIOContext) -> c_int;

type FnAvcodecFindDecoder = unsafe extern "C" fn(c_int) -> *const AVCodec;
type FnAvcodecFindDecoderByName = unsafe extern "C" fn(*const c_char) -> *const AVCodec;
type FnAvcodecFindEncoder = unsafe extern "C" fn(c_int) -> *const AVCodec;
type FnAvcodecFindEncoderByName = unsafe extern "C" fn(*const c_char) -> *const AVCodec;
type FnAvcodecAllocContext3 = unsafe extern "C" fn(*const AVCodec) -> *mut AVCodecContext;
type FnAvcodecFreeContext = unsafe extern "C" fn(*mut *mut AVCodecContext);
type FnAvcodecParametersToContext =
    unsafe extern "C" fn(*mut AVCodecContext, *const AVCodecParameters) -> c_int;
type FnAvcodecParametersFromContext =
    unsafe extern "C" fn(*mut AVCodecParameters, *const AVCodecContext) -> c_int;
type FnAvcodecParametersCopy =
    unsafe extern "C" fn(*mut AVCodecParameters, *const AVCodecParameters) -> c_int;
type FnAvcodecOpen2 =
    unsafe extern "C" fn(*mut AVCodecContext, *const AVCodec, *mut *mut AVDictionary) -> c_int;
type FnAvcodecSendPacket = unsafe extern "C" fn(*mut AVCodecContext, *const AVPacket) -> c_int;
type FnAvcodecReceiveFrame = unsafe extern "C" fn(*mut AVCodecContext, *mut AVFrame) -> c_int;
type FnAvcodecSendFrame = unsafe extern "C" fn(*mut AVCodecContext, *const AVFrame) -> c_int;
type FnAvcodecReceivePacket = unsafe extern "C" fn(*mut AVCodecContext, *mut AVPacket) -> c_int;
type FnAvcodecFlushBuffers = unsafe extern "C" fn(*mut AVCodecContext);

type FnAvFrameAlloc = unsafe extern "C" fn() -> *mut AVFrame;
type FnAvFrameFree = unsafe extern "C" fn(*mut *mut AVFrame);
type FnAvFrameUnref = unsafe extern "C" fn(*mut AVFrame);
type FnAvFrameGetBuffer = unsafe extern "C" fn(*mut AVFrame, c_int) -> c_int;
type FnAvPacketAlloc = unsafe extern "C" fn() -> *mut AVPacket;
type FnAvPacketFree = unsafe extern "C" fn(*mut *mut AVPacket);
type FnAvPacketUnref = unsafe extern "C" fn(*mut AVPacket);
type FnAvPacketRescaleTs = unsafe extern "C" fn(*mut AVPacket, AVRational, AVRational);
type FnAvRescaleQ = unsafe extern "C" fn(i64, AVRational, AVRational) -> i64;
type FnAvStrerror = unsafe extern "C" fn(c_int, *mut c_char, usize) -> c_int;
type FnAvMalloc = unsafe extern "C" fn(usize) -> *mut c_void;
type FnAvFree = unsafe extern "C" fn(*mut c_void);
type FnAvDictSet =
    unsafe extern "C" fn(*mut *mut AVDictionary, *const c_char, *const c_char, c_int) -> c_int;
type FnAvDictFree = unsafe extern "C" fn(*mut *mut AVDictionary);
type FnAvSamplesAllocArrayAndSamples =
    unsafe extern "C" fn(*mut *mut *mut u8, *mut c_int, c_int, c_int, c_int, c_int) -> c_int;
type FnAvChannelLayoutDefault = unsafe extern "C" fn(*mut AVChannelLayout, c_int);
type FnAvChannelLayoutCopy =
    unsafe extern "C" fn(*mut AVChannelLayout, *const AVChannelLayout) -> c_int;
type FnAvChannelLayoutUninit = unsafe extern "C" fn(*mut AVChannelLayout);

type FnSwrAlloc = unsafe extern "C" fn() -> *mut SwrContext;
type FnSwrFree = unsafe extern "C" fn(*mut *mut SwrContext);
type FnSwrAllocSetOpts2 = unsafe extern "C" fn(
    *mut *mut SwrContext,
    *const AVChannelLayout,
    c_int,
    c_int,
    *const AVChannelLayout,
    c_int,
    c_int,
    c_int,
    *mut c_void,
) -> c_int;
type FnSwrInit = unsafe extern "C" fn(*mut SwrContext) -> c_int;
type FnSwrConvert =
    unsafe extern "C" fn(*mut SwrContext, *mut *mut u8, c_int, *const *const u8, c_int) -> c_int;
type FnSwrGetDelay = unsafe extern "C" fn(*mut SwrContext, i64) -> i64;

type FnAvutilVersion = unsafe extern "C" fn() -> c_uint;
type FnAvcodecVersion = unsafe extern "C" fn() -> c_uint;
type FnAvformatVersion = unsafe extern "C" fn() -> c_uint;

pub struct FFmpegFunctions {
    pub avformat_open_input: FnAvformatOpenInput,
    pub avformat_close_input: FnAvformatCloseInput,
    pub avformat_find_stream_info: FnAvformatFindStreamInfo,
    pub avformat_alloc_output_context2: FnAvformatAllocOutputContext2,
    pub avformat_write_header: FnAvformatWriteHeader,
    pub av_write_trailer: FnAvWriteTrailer,
    pub avformat_free_context: FnAvformatFreeContext,
    pub av_find_best_stream: FnAvFindBestStream,
    pub av_read_frame: FnAvReadFrame,
    pub av_seek_frame: FnAvSeekFrame,
    pub av_interleaved_write_frame: FnAvInterleavedWriteFrame,
    pub avformat_new_stream: FnAvformatNewStream,
    pub avio_open: FnAvioOpen,
    pub avio_closep: FnAvioClosep,

    pub avcodec_find_decoder: FnAvcodecFindDecoder,
    pub avcodec_find_decoder_by_name: FnAvcodecFindDecoderByName,
    pub avcodec_find_encoder: FnAvcodecFindEncoder,
    pub avcodec_find_encoder_by_name: FnAvcodecFindEncoderByName,
    pub avcodec_alloc_context3: FnAvcodecAllocContext3,
    pub avcodec_free_context: FnAvcodecFreeContext,
    pub avcodec_parameters_to_context: FnAvcodecParametersToContext,
    pub avcodec_parameters_from_context: FnAvcodecParametersFromContext,
    pub avcodec_parameters_copy: FnAvcodecParametersCopy,
    pub avcodec_open2: FnAvcodecOpen2,
    pub avcodec_send_packet: FnAvcodecSendPacket,
    pub avcodec_receive_frame: FnAvcodecReceiveFrame,
    pub avcodec_send_frame: FnAvcodecSendFrame,
    pub avcodec_receive_packet: FnAvcodecReceivePacket,
    pub avcodec_flush_buffers: FnAvcodecFlushBuffers,

    pub av_frame_alloc: FnAvFrameAlloc,
    pub av_frame_free: FnAvFrameFree,
    pub av_frame_unref: FnAvFrameUnref,
    pub av_frame_get_buffer: FnAvFrameGetBuffer,
    pub av_packet_alloc: FnAvPacketAlloc,
    pub av_packet_free: FnAvPacketFree,
    pub av_packet_unref: FnAvPacketUnref,
    pub av_packet_rescale_ts: FnAvPacketRescaleTs,
    pub av_rescale_q: FnAvRescaleQ,
    pub av_strerror: FnAvStrerror,
    pub av_malloc: FnAvMalloc,
    pub av_free: FnAvFree,
    pub av_dict_set: FnAvDictSet,
    pub av_dict_free: FnAvDictFree,
    pub av_samples_alloc_array_and_samples: FnAvSamplesAllocArrayAndSamples,
    pub av_channel_layout_default: FnAvChannelLayoutDefault,
    pub av_channel_layout_copy: FnAvChannelLayoutCopy,
    pub av_channel_layout_uninit: FnAvChannelLayoutUninit,

    pub swr_alloc: FnSwrAlloc,
    pub swr_free: FnSwrFree,
    pub swr_alloc_set_opts2: FnSwrAllocSetOpts2,
    pub swr_init: FnSwrInit,
    pub swr_convert: FnSwrConvert,
    pub swr_get_delay: FnSwrGetDelay,

    pub avutil_version: FnAvutilVersion,
    pub avcodec_version: FnAvcodecVersion,
    pub avformat_version: FnAvformatVersion,
}

struct LoadedLibraries {
    _avutil: Library,
    _swresample: Library,
    _avcodec: Library,
    _avformat: Library,
    functions: FFmpegFunctions,
}

unsafe impl Send for LoadedLibraries {}
unsafe impl Sync for LoadedLibraries {}

static FFMPEG: OnceCell<Result<LoadedLibraries, String>> = OnceCell::new();
static LIB_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn set_library_directory(path: PathBuf) {
    if let Ok(mut guard) = LIB_DIR.lock() {
        *guard = Some(path);
    }
}

fn get_library_directory() -> Option<PathBuf> {
    LIB_DIR.lock().ok().and_then(|g| g.clone())
}

#[cfg(target_os = "macos")]
fn lib_names() -> (&'static str, &'static str, &'static str, &'static str) {
    (
        "libavutil.dylib",
        "libswresample.dylib",
        "libavcodec.dylib",
        "libavformat.dylib",
    )
}

#[cfg(target_os = "linux")]
fn lib_names() -> (&'static str, &'static str, &'static str, &'static str) {
    (
        "libavutil.so",
        "libswresample.so",
        "libavcodec.so",
        "libavformat.so",
    )
}

#[cfg(target_os = "windows")]
fn lib_names() -> (&'static str, &'static str, &'static str, &'static str) {
    (
        "avutil-60.dll",
        "swresample-6.dll",
        "avcodec-62.dll",
        "avformat-62.dll",
    )
}

#[cfg(target_os = "ios")]
fn lib_names() -> (&'static str, &'static str, &'static str, &'static str) {
    (
        "libavutil.dylib",
        "libswresample.dylib",
        "libavcodec.dylib",
        "libavformat.dylib",
    )
}

fn load_libraries() -> Result<LoadedLibraries, String> {
    let lib_dir = get_library_directory().ok_or("Library directory not set")?;
    let (avutil_name, swresample_name, avcodec_name, avformat_name) = lib_names();

    unsafe {
        let avutil = Library::new(lib_dir.join(avutil_name))
            .map_err(|e| format!("Failed to load avutil: {}", e))?;
        let swresample = Library::new(lib_dir.join(swresample_name))
            .map_err(|e| format!("Failed to load swresample: {}", e))?;
        let avcodec = Library::new(lib_dir.join(avcodec_name))
            .map_err(|e| format!("Failed to load avcodec: {}", e))?;
        let avformat = Library::new(lib_dir.join(avformat_name))
            .map_err(|e| format!("Failed to load avformat: {}", e))?;

        let functions = FFmpegFunctions {
            avformat_open_input: *avformat
                .get(b"avformat_open_input\0")
                .map_err(|e| e.to_string())?,
            avformat_close_input: *avformat
                .get(b"avformat_close_input\0")
                .map_err(|e| e.to_string())?,
            avformat_find_stream_info: *avformat
                .get(b"avformat_find_stream_info\0")
                .map_err(|e| e.to_string())?,
            avformat_alloc_output_context2: *avformat
                .get(b"avformat_alloc_output_context2\0")
                .map_err(|e| e.to_string())?,
            avformat_write_header: *avformat
                .get(b"avformat_write_header\0")
                .map_err(|e| e.to_string())?,
            av_write_trailer: *avformat
                .get(b"av_write_trailer\0")
                .map_err(|e| e.to_string())?,
            avformat_free_context: *avformat
                .get(b"avformat_free_context\0")
                .map_err(|e| e.to_string())?,
            av_find_best_stream: *avformat
                .get(b"av_find_best_stream\0")
                .map_err(|e| e.to_string())?,
            av_read_frame: *avformat
                .get(b"av_read_frame\0")
                .map_err(|e| e.to_string())?,
            av_seek_frame: *avformat
                .get(b"av_seek_frame\0")
                .map_err(|e| e.to_string())?,
            av_interleaved_write_frame: *avformat
                .get(b"av_interleaved_write_frame\0")
                .map_err(|e| e.to_string())?,
            avformat_new_stream: *avformat
                .get(b"avformat_new_stream\0")
                .map_err(|e| e.to_string())?,
            avio_open: *avformat.get(b"avio_open\0").map_err(|e| e.to_string())?,
            avio_closep: *avformat.get(b"avio_closep\0").map_err(|e| e.to_string())?,

            avcodec_find_decoder: *avcodec
                .get(b"avcodec_find_decoder\0")
                .map_err(|e| e.to_string())?,
            avcodec_find_decoder_by_name: *avcodec
                .get(b"avcodec_find_decoder_by_name\0")
                .map_err(|e| e.to_string())?,
            avcodec_find_encoder: *avcodec
                .get(b"avcodec_find_encoder\0")
                .map_err(|e| e.to_string())?,
            avcodec_find_encoder_by_name: *avcodec
                .get(b"avcodec_find_encoder_by_name\0")
                .map_err(|e| e.to_string())?,
            avcodec_alloc_context3: *avcodec
                .get(b"avcodec_alloc_context3\0")
                .map_err(|e| e.to_string())?,
            avcodec_free_context: *avcodec
                .get(b"avcodec_free_context\0")
                .map_err(|e| e.to_string())?,
            avcodec_parameters_to_context: *avcodec
                .get(b"avcodec_parameters_to_context\0")
                .map_err(|e| e.to_string())?,
            avcodec_parameters_from_context: *avcodec
                .get(b"avcodec_parameters_from_context\0")
                .map_err(|e| e.to_string())?,
            avcodec_parameters_copy: *avcodec
                .get(b"avcodec_parameters_copy\0")
                .map_err(|e| e.to_string())?,
            avcodec_open2: *avcodec.get(b"avcodec_open2\0").map_err(|e| e.to_string())?,
            avcodec_send_packet: *avcodec
                .get(b"avcodec_send_packet\0")
                .map_err(|e| e.to_string())?,
            avcodec_receive_frame: *avcodec
                .get(b"avcodec_receive_frame\0")
                .map_err(|e| e.to_string())?,
            avcodec_send_frame: *avcodec
                .get(b"avcodec_send_frame\0")
                .map_err(|e| e.to_string())?,
            avcodec_receive_packet: *avcodec
                .get(b"avcodec_receive_packet\0")
                .map_err(|e| e.to_string())?,
            avcodec_flush_buffers: *avcodec
                .get(b"avcodec_flush_buffers\0")
                .map_err(|e| e.to_string())?,

            av_frame_alloc: *avutil.get(b"av_frame_alloc\0").map_err(|e| e.to_string())?,
            av_frame_free: *avutil.get(b"av_frame_free\0").map_err(|e| e.to_string())?,
            av_frame_unref: *avutil.get(b"av_frame_unref\0").map_err(|e| e.to_string())?,
            av_frame_get_buffer: *avutil
                .get(b"av_frame_get_buffer\0")
                .map_err(|e| e.to_string())?,
            av_packet_alloc: *avcodec
                .get(b"av_packet_alloc\0")
                .map_err(|e| e.to_string())?,
            av_packet_free: *avcodec
                .get(b"av_packet_free\0")
                .map_err(|e| e.to_string())?,
            av_packet_unref: *avcodec
                .get(b"av_packet_unref\0")
                .map_err(|e| e.to_string())?,
            av_packet_rescale_ts: *avcodec
                .get(b"av_packet_rescale_ts\0")
                .map_err(|e| e.to_string())?,
            av_rescale_q: *avutil.get(b"av_rescale_q\0").map_err(|e| e.to_string())?,
            av_strerror: *avutil.get(b"av_strerror\0").map_err(|e| e.to_string())?,
            av_malloc: *avutil.get(b"av_malloc\0").map_err(|e| e.to_string())?,
            av_free: *avutil.get(b"av_free\0").map_err(|e| e.to_string())?,
            av_dict_set: *avutil.get(b"av_dict_set\0").map_err(|e| e.to_string())?,
            av_dict_free: *avutil.get(b"av_dict_free\0").map_err(|e| e.to_string())?,
            av_samples_alloc_array_and_samples: *avutil
                .get(b"av_samples_alloc_array_and_samples\0")
                .map_err(|e| e.to_string())?,
            av_channel_layout_default: *avutil
                .get(b"av_channel_layout_default\0")
                .map_err(|e| e.to_string())?,
            av_channel_layout_copy: *avutil
                .get(b"av_channel_layout_copy\0")
                .map_err(|e| e.to_string())?,
            av_channel_layout_uninit: *avutil
                .get(b"av_channel_layout_uninit\0")
                .map_err(|e| e.to_string())?,

            swr_alloc: *swresample.get(b"swr_alloc\0").map_err(|e| e.to_string())?,
            swr_free: *swresample.get(b"swr_free\0").map_err(|e| e.to_string())?,
            swr_alloc_set_opts2: *swresample
                .get(b"swr_alloc_set_opts2\0")
                .map_err(|e| e.to_string())?,
            swr_init: *swresample.get(b"swr_init\0").map_err(|e| e.to_string())?,
            swr_convert: *swresample
                .get(b"swr_convert\0")
                .map_err(|e| e.to_string())?,
            swr_get_delay: *swresample
                .get(b"swr_get_delay\0")
                .map_err(|e| e.to_string())?,

            avutil_version: *avutil.get(b"avutil_version\0").map_err(|e| e.to_string())?,
            avcodec_version: *avcodec
                .get(b"avcodec_version\0")
                .map_err(|e| e.to_string())?,
            avformat_version: *avformat
                .get(b"avformat_version\0")
                .map_err(|e| e.to_string())?,
        };

        Ok(LoadedLibraries {
            _avutil: avutil,
            _swresample: swresample,
            _avcodec: avcodec,
            _avformat: avformat,
            functions,
        })
    }
}

pub fn get_ffmpeg() -> Result<&'static FFmpegFunctions, String> {
    FFMPEG
        .get_or_init(load_libraries)
        .as_ref()
        .map(|l| &l.functions)
        .map_err(|e| e.clone())
}

pub fn ffmpeg_version() -> Result<String, String> {
    let ff = get_ffmpeg()?;
    unsafe {
        let avutil = (ff.avutil_version)();
        let avcodec = (ff.avcodec_version)();
        let avformat = (ff.avformat_version)();
        Ok(format!(
            "avutil: {}.{}.{}, avcodec: {}.{}.{}, avformat: {}.{}.{}",
            (avutil >> 16) & 0xFF,
            (avutil >> 8) & 0xFF,
            avutil & 0xFF,
            (avcodec >> 16) & 0xFF,
            (avcodec >> 8) & 0xFF,
            avcodec & 0xFF,
            (avformat >> 16) & 0xFF,
            (avformat >> 8) & 0xFF,
            avformat & 0xFF,
        ))
    }
}

pub fn av_error_string(errnum: c_int) -> String {
    if let Ok(ff) = get_ffmpeg() {
        let mut buf = [0u8; 256];
        unsafe {
            (ff.av_strerror)(errnum, buf.as_mut_ptr() as *mut c_char, buf.len());
        }
        let cstr = unsafe { CStr::from_ptr(buf.as_ptr() as *const c_char) };
        cstr.to_string_lossy().to_string()
    } else {
        format!("FFmpeg error {}", errnum)
    }
}

pub struct AudioFile {
    format_ctx: *mut AVFormatContext,
    codec_ctx: *mut AVCodecContext,
    stream_index: c_int,
    pub sample_rate: i32,
    pub channels: i32,
    pub duration_secs: f64,
}

impl AudioFile {
    pub fn open(path: &Path) -> Result<Self, String> {
        let ff = get_ffmpeg()?;
        let path_cstr =
            CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;

        unsafe {
            let mut format_ctx: *mut AVFormatContext = std::ptr::null_mut();
            let ret = (ff.avformat_open_input)(
                &mut format_ctx,
                path_cstr.as_ptr(),
                std::ptr::null(),
                std::ptr::null_mut(),
            );
            if ret < 0 {
                return Err(format!("Failed to open file: {}", av_error_string(ret)));
            }

            let ret = (ff.avformat_find_stream_info)(format_ctx, std::ptr::null_mut());
            if ret < 0 {
                (ff.avformat_close_input)(&mut format_ctx);
                return Err(format!(
                    "Failed to find stream info: {}",
                    av_error_string(ret)
                ));
            }

            let mut decoder: *const AVCodec = std::ptr::null();
            let stream_index =
                (ff.av_find_best_stream)(format_ctx, AVMEDIA_TYPE_AUDIO, -1, -1, &mut decoder, 0);
            if stream_index < 0 {
                (ff.avformat_close_input)(&mut format_ctx);
                return Err("No audio stream found".to_string());
            }

            if (*format_ctx).streams.is_null() {
                (ff.avformat_close_input)(&mut format_ctx);
                return Err("Format context has null streams".to_string());
            }
            let streams = std::slice::from_raw_parts(
                (*format_ctx).streams,
                (*format_ctx).nb_streams as usize,
            );
            let stream = *streams
                .get(stream_index as usize)
                .ok_or("Invalid stream index")?;
            let codecpar = (*stream).codecpar;

            let codec_ctx = (ff.avcodec_alloc_context3)(decoder);
            if codec_ctx.is_null() {
                (ff.avformat_close_input)(&mut format_ctx);
                return Err("Failed to allocate codec context".to_string());
            }

            let ret = (ff.avcodec_parameters_to_context)(codec_ctx, codecpar);
            if ret < 0 {
                (ff.avcodec_free_context)(&mut (codec_ctx as *mut _));
                (ff.avformat_close_input)(&mut format_ctx);
                return Err(format!(
                    "Failed to copy codec params: {}",
                    av_error_string(ret)
                ));
            }

            let ret = (ff.avcodec_open2)(codec_ctx, decoder, std::ptr::null_mut());
            if ret < 0 {
                (ff.avcodec_free_context)(&mut (codec_ctx as *mut _));
                (ff.avformat_close_input)(&mut format_ctx);
                return Err(format!("Failed to open codec: {}", av_error_string(ret)));
            }

            let sample_rate = (*codec_ctx).sample_rate;
            let channels = (*codec_ctx).ch_layout.nb_channels;
            let time_base = (*stream).time_base;
            let duration = (*stream).duration;
            let duration_secs = if duration != AV_NOPTS_VALUE {
                duration as f64 * time_base.num as f64 / time_base.den as f64
            } else {
                (*format_ctx).duration as f64 / AV_TIME_BASE as f64
            };

            Ok(AudioFile {
                format_ctx,
                codec_ctx,
                stream_index,
                sample_rate,
                channels,
                duration_secs,
            })
        }
    }

    pub fn seek(&mut self, timestamp_secs: f64) -> Result<(), String> {
        let ff = get_ffmpeg()?;
        unsafe {
            let timestamp = (timestamp_secs * AV_TIME_BASE as f64) as i64;
            let ret = (ff.av_seek_frame)(
                self.format_ctx,
                -1,
                timestamp,
                AVSEEK_FLAG_BACKWARD as c_int,
            );
            if ret < 0 {
                return Err(format!("Failed to seek: {}", av_error_string(ret)));
            }
            (ff.avcodec_flush_buffers)(self.codec_ctx);
            Ok(())
        }
    }
}

impl Drop for AudioFile {
    fn drop(&mut self) {
        if let Ok(ff) = get_ffmpeg() {
            unsafe {
                if !self.codec_ctx.is_null() {
                    (ff.avcodec_free_context)(&mut self.codec_ctx);
                }
                if !self.format_ctx.is_null() {
                    (ff.avformat_close_input)(&mut self.format_ctx);
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioFormat {
    Mp3,
    Aac,
    Flac,
    Wav,
}

impl AudioFormat {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "mp3" => Some(AudioFormat::Mp3),
            "aac" | "m4a" => Some(AudioFormat::Aac),
            "flac" => Some(AudioFormat::Flac),
            "wav" => Some(AudioFormat::Wav),
            _ => None,
        }
    }

    fn encoder_name(&self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "libmp3lame",
            AudioFormat::Aac => "aac",
            AudioFormat::Flac => "flac",
            AudioFormat::Wav => "pcm_s16le",
        }
    }

    fn format_name(&self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::Aac => "adts",
            AudioFormat::Flac => "flac",
            AudioFormat::Wav => "wav",
        }
    }
}

pub fn export_sample(
    input_path: &Path,
    output_path: &Path,
    start_secs: f64,
    end_secs: f64,
) -> Result<(), String> {
    let ff = get_ffmpeg()?;
    let duration = end_secs - start_secs;
    if duration <= 0.0 {
        return Err("Invalid time range".to_string());
    }

    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3");
    let format = AudioFormat::from_extension(ext).unwrap_or(AudioFormat::Mp3);

    let input_cstr =
        CString::new(input_path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    let output_cstr =
        CString::new(output_path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    let format_cstr = CString::new(format.format_name()).unwrap();
    let encoder_cstr = CString::new(format.encoder_name()).unwrap();

    unsafe {
        let mut input_ctx: *mut AVFormatContext = std::ptr::null_mut();
        let ret = (ff.avformat_open_input)(
            &mut input_ctx,
            input_cstr.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
        );
        if ret < 0 {
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
        let audio_stream_idx =
            (ff.av_find_best_stream)(input_ctx, AVMEDIA_TYPE_AUDIO, -1, -1, &mut decoder, 0);
        if audio_stream_idx < 0 {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("No audio stream found".to_string());
        }

        if (*input_ctx).streams.is_null() {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Input context has null streams".to_string());
        }
        let streams =
            std::slice::from_raw_parts((*input_ctx).streams, (*input_ctx).nb_streams as usize);
        let in_stream = match streams.get(audio_stream_idx as usize) {
            Some(s) => *s,
            None => {
                (ff.avformat_close_input)(&mut input_ctx);
                return Err("Invalid stream".to_string());
            }
        };

        let dec_ctx = (ff.avcodec_alloc_context3)(decoder);
        if dec_ctx.is_null() {
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Failed to allocate decoder context".to_string());
        }

        let ret = (ff.avcodec_parameters_to_context)(dec_ctx, (*in_stream).codecpar);
        if ret < 0 {
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!(
                "Failed to copy decoder params: {}",
                av_error_string(ret)
            ));
        }

        let ret = (ff.avcodec_open2)(dec_ctx, decoder, std::ptr::null_mut());
        if ret < 0 {
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!("Failed to open decoder: {}", av_error_string(ret)));
        }

        let mut output_ctx: *mut AVFormatContext = std::ptr::null_mut();
        let ret = (ff.avformat_alloc_output_context2)(
            &mut output_ctx,
            std::ptr::null(),
            format_cstr.as_ptr(),
            output_cstr.as_ptr(),
        );
        if ret < 0 || output_ctx.is_null() {
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!(
                "Failed to create output context: {}",
                av_error_string(ret)
            ));
        }

        let encoder = (ff.avcodec_find_encoder_by_name)(encoder_cstr.as_ptr());
        if encoder.is_null() {
            (ff.avformat_free_context)(output_ctx);
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!("Encoder {} not found", format.encoder_name()));
        }

        let out_stream = (ff.avformat_new_stream)(output_ctx, std::ptr::null());
        if out_stream.is_null() {
            (ff.avformat_free_context)(output_ctx);
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Failed to create output stream".to_string());
        }

        let enc_ctx = (ff.avcodec_alloc_context3)(encoder);
        if enc_ctx.is_null() {
            (ff.avformat_free_context)(output_ctx);
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err("Failed to allocate encoder context".to_string());
        }

        (*enc_ctx).sample_rate = (*dec_ctx).sample_rate;
        (*enc_ctx).time_base = AVRational {
            num: 1,
            den: (*dec_ctx).sample_rate,
        };
        (ff.av_channel_layout_copy)(&mut (*enc_ctx).ch_layout, &(*dec_ctx).ch_layout);

        (*enc_ctx).sample_fmt = match format {
            AudioFormat::Mp3 => AVSampleFormat_AV_SAMPLE_FMT_S16P as i32,
            AudioFormat::Aac => AVSampleFormat_AV_SAMPLE_FMT_FLTP as i32,
            AudioFormat::Flac => AVSampleFormat_AV_SAMPLE_FMT_S16 as i32,
            AudioFormat::Wav => AVSampleFormat_AV_SAMPLE_FMT_S16 as i32,
        };

        if !(*output_ctx).oformat.is_null() {
            let oformat = &*(*output_ctx).oformat;
            if oformat.flags & (AVFMT_GLOBALHEADER as c_int) != 0 {
                (*enc_ctx).flags |= AV_CODEC_FLAG_GLOBAL_HEADER as c_int;
            }
        }

        let ret = (ff.avcodec_open2)(enc_ctx, encoder, std::ptr::null_mut());
        if ret < 0 {
            (ff.avcodec_free_context)(&mut (enc_ctx as *mut _));
            (ff.avformat_free_context)(output_ctx);
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!("Failed to open encoder: {}", av_error_string(ret)));
        }

        let ret = (ff.avcodec_parameters_from_context)((*out_stream).codecpar, enc_ctx);
        if ret < 0 {
            (ff.avcodec_free_context)(&mut (enc_ctx as *mut _));
            (ff.avformat_free_context)(output_ctx);
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!(
                "Failed to copy encoder params: {}",
                av_error_string(ret)
            ));
        }
        (*out_stream).time_base = (*enc_ctx).time_base;

        let ret = (ff.avio_open)(
            &mut (*output_ctx).pb,
            output_cstr.as_ptr(),
            AVIO_FLAG_WRITE as c_int,
        );
        if ret < 0 {
            (ff.avcodec_free_context)(&mut (enc_ctx as *mut _));
            (ff.avformat_free_context)(output_ctx);
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!(
                "Failed to open output file: {}",
                av_error_string(ret)
            ));
        }

        let ret = (ff.avformat_write_header)(output_ctx, std::ptr::null_mut());
        if ret < 0 {
            (ff.avio_closep)(&mut (*output_ctx).pb);
            (ff.avcodec_free_context)(&mut (enc_ctx as *mut _));
            (ff.avformat_free_context)(output_ctx);
            (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
            (ff.avformat_close_input)(&mut input_ctx);
            return Err(format!("Failed to write header: {}", av_error_string(ret)));
        }

        let start_ts = (start_secs * AV_TIME_BASE as f64) as i64;
        (ff.av_seek_frame)(input_ctx, -1, start_ts, AVSEEK_FLAG_BACKWARD as c_int);
        (ff.avcodec_flush_buffers)(dec_ctx);

        let packet = (ff.av_packet_alloc)();
        let frame = (ff.av_frame_alloc)();
        let mut samples_written: i64 = 0;
        let max_samples = (duration * (*enc_ctx).sample_rate as f64) as i64;

        let needs_resample = (*dec_ctx).sample_fmt != (*enc_ctx).sample_fmt;
        let mut swr_ctx: *mut SwrContext = std::ptr::null_mut();

        if needs_resample {
            let ret = (ff.swr_alloc_set_opts2)(
                &mut swr_ctx,
                &(*enc_ctx).ch_layout,
                (*enc_ctx).sample_fmt,
                (*enc_ctx).sample_rate,
                &(*dec_ctx).ch_layout,
                (*dec_ctx).sample_fmt,
                (*dec_ctx).sample_rate,
                0,
                std::ptr::null_mut(),
            );
            if ret < 0 || swr_ctx.is_null() {
                (ff.av_frame_free)(&mut (frame as *mut _));
                (ff.av_packet_free)(&mut (packet as *mut _));
                (ff.av_write_trailer)(output_ctx);
                (ff.avio_closep)(&mut (*output_ctx).pb);
                (ff.avcodec_free_context)(&mut (enc_ctx as *mut _));
                (ff.avformat_free_context)(output_ctx);
                (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
                (ff.avformat_close_input)(&mut input_ctx);
                return Err("Failed to allocate resampler".to_string());
            }
            (ff.swr_init)(swr_ctx);
        }

        let out_frame = (ff.av_frame_alloc)();
        (*out_frame).format = (*enc_ctx).sample_fmt;
        (*out_frame).sample_rate = (*enc_ctx).sample_rate;
        (ff.av_channel_layout_copy)(&mut (*out_frame).ch_layout, &(*enc_ctx).ch_layout);

        'decode: while (ff.av_read_frame)(input_ctx, packet) >= 0 {
            if (*packet).stream_index != audio_stream_idx {
                (ff.av_packet_unref)(packet);
                continue;
            }

            let pkt_time = (*packet).pts as f64 * (*in_stream).time_base.num as f64
                / (*in_stream).time_base.den as f64;
            if pkt_time < start_secs {
                (ff.av_packet_unref)(packet);
                continue;
            }
            if pkt_time >= end_secs {
                (ff.av_packet_unref)(packet);
                break;
            }

            let ret = (ff.avcodec_send_packet)(dec_ctx, packet);
            (ff.av_packet_unref)(packet);
            if ret < 0 {
                continue;
            }

            while (ff.avcodec_receive_frame)(dec_ctx, frame) >= 0 {
                if samples_written >= max_samples {
                    (ff.av_frame_unref)(frame);
                    break 'decode;
                }

                let encode_frame = if needs_resample {
                    (*out_frame).format = (*enc_ctx).sample_fmt;
                    (*out_frame).sample_rate = (*enc_ctx).sample_rate;
                    (ff.av_channel_layout_copy)(&mut (*out_frame).ch_layout, &(*enc_ctx).ch_layout);
                    (*out_frame).nb_samples = (*frame).nb_samples;
                    (ff.av_frame_get_buffer)(out_frame, 0);
                    (ff.swr_convert)(
                        swr_ctx,
                        (*out_frame).data.as_mut_ptr(),
                        (*out_frame).nb_samples,
                        (*frame).data.as_ptr() as *const *const u8,
                        (*frame).nb_samples,
                    );
                    (*out_frame).pts = samples_written;
                    out_frame
                } else {
                    (*frame).pts = samples_written;
                    frame
                };

                samples_written += (*encode_frame).nb_samples as i64;

                let ret = (ff.avcodec_send_frame)(enc_ctx, encode_frame);
                if needs_resample {
                    (ff.av_frame_unref)(out_frame);
                }
                (ff.av_frame_unref)(frame);

                if ret < 0 {
                    continue;
                }

                while (ff.avcodec_receive_packet)(enc_ctx, packet) >= 0 {
                    (ff.av_packet_rescale_ts)(
                        packet,
                        (*enc_ctx).time_base,
                        (*out_stream).time_base,
                    );
                    (*packet).stream_index = 0;
                    (ff.av_interleaved_write_frame)(output_ctx, packet);
                    (ff.av_packet_unref)(packet);
                }
            }
        }

        (ff.avcodec_send_frame)(enc_ctx, std::ptr::null());
        while (ff.avcodec_receive_packet)(enc_ctx, packet) >= 0 {
            (ff.av_packet_rescale_ts)(packet, (*enc_ctx).time_base, (*out_stream).time_base);
            (*packet).stream_index = 0;
            (ff.av_interleaved_write_frame)(output_ctx, packet);
            (ff.av_packet_unref)(packet);
        }

        (ff.av_write_trailer)(output_ctx);

        if !swr_ctx.is_null() {
            (ff.swr_free)(&mut swr_ctx);
        }
        (ff.av_frame_free)(&mut (out_frame as *mut _));
        (ff.av_frame_free)(&mut (frame as *mut _));
        (ff.av_packet_free)(&mut (packet as *mut _));
        (ff.avio_closep)(&mut (*output_ctx).pb);
        (ff.avcodec_free_context)(&mut (enc_ctx as *mut _));
        (ff.avformat_free_context)(output_ctx);
        (ff.avcodec_free_context)(&mut (dec_ctx as *mut _));
        (ff.avformat_close_input)(&mut input_ctx);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_lib_dir() -> bool {
        let cwd = std::env::current_dir().unwrap();
        let paths = [
            cwd.join("binaries/ffmpeg"),
            cwd.join("src-tauri/binaries/ffmpeg"),
        ];
        for path in paths {
            if path.join(lib_names().0).exists() {
                set_library_directory(path);
                return true;
            }
        }
        false
    }

    #[test]
    fn test_load_ffmpeg() {
        if !setup_lib_dir() {
            eprintln!("Skipping: FFmpeg libraries not found");
            return;
        }
        let result = get_ffmpeg();
        assert!(result.is_ok(), "Failed to load FFmpeg: {:?}", result.err());
    }

    #[test]
    fn test_ffmpeg_version() {
        if !setup_lib_dir() {
            eprintln!("Skipping: FFmpeg libraries not found");
            return;
        }
        let version = ffmpeg_version();
        assert!(version.is_ok());
        let v = version.unwrap();
        assert!(v.contains("avutil"));
        assert!(v.contains("avcodec"));
        assert!(v.contains("avformat"));
    }
}
