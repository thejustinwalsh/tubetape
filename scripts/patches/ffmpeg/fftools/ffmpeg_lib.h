/*
 * FFmpeg Library Interface
 * 
 * This header defines the interface for calling FFmpeg and FFprobe as
 * library functions with custom stdio redirection and non-terminating
 * exit handling.
 *
 * Copyright (c) 2025 Tubetape Project
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef FFMPEG_LIB_H
#define FFMPEG_LIB_H

#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * I/O context for redirecting stdin, stdout, stderr
 * If any pointer is NULL, the standard stream is used.
 */
typedef struct FFmpegIOContext {
    FILE *stdin_fp;   /* Custom stdin, or NULL for default */
    FILE *stdout_fp;  /* Custom stdout, or NULL for default */
    FILE *stderr_fp;  /* Custom stderr, or NULL for default */
} FFmpegIOContext;

/**
 * Result structure returned by ffmpeg/ffprobe execution
 */
typedef struct FFmpegResult {
    int exit_code;        /* Exit code (0 = success) */
    int was_aborted;      /* 1 if execution was aborted (exit() called) */
    const char *error;    /* Error message if any, NULL otherwise */
} FFmpegResult;

/**
 * Callback function type for receiving log output
 * 
 * @param level    FFmpeg log level (AV_LOG_*)
 * @param msg      Log message
 * @param user_ctx User context passed to ffmpeg_lib_set_log_callback
 */
typedef void (*ffmpeg_log_callback)(int level, const char *msg, void *user_ctx);

/**
 * Initialize the FFmpeg library interface
 * Must be called once before any other functions.
 * Thread-safe for initialization.
 * 
 * @return 0 on success, negative error code on failure
 */
int ffmpeg_lib_init(void);

/**
 * Set custom I/O context for subsequent operations
 * Pass NULL to reset to default streams.
 * 
 * @param io_ctx  I/O context with custom FILE pointers
 */
void ffmpeg_lib_set_io(const FFmpegIOContext *io_ctx);

/**
 * Get custom stdin FILE pointer
 * @return Custom stdin FILE pointer, or default stdin if not set
 */
FILE *ffmpeg_lib_get_stdin(void);

/**
 * Get custom stdout FILE pointer
 * @return Custom stdout FILE pointer, or default stdout if not set
 */
FILE *ffmpeg_lib_get_stdout(void);

/**
 * Get custom stderr FILE pointer
 * @return Custom stderr FILE pointer, or default stderr if not set
 */
FILE *ffmpeg_lib_get_stderr(void);

/**
 * Set custom log callback for receiving FFmpeg log output
 * Pass NULL to disable custom logging.
 * 
 * @param callback  Callback function
 * @param user_ctx  User context passed to callback
 */
void ffmpeg_lib_set_log_callback(ffmpeg_log_callback callback, void *user_ctx);

/**
 * Run FFmpeg with the given arguments
 * 
 * The first argument should be "ffmpeg" (program name).
 * This function is NOT thread-safe - only one FFmpeg/FFprobe
 * operation can run at a time.
 * 
 * @param argc  Argument count (including program name)
 * @param argv  Argument array (argv[0] = "ffmpeg")
 * @return      Result structure with exit code and status
 */
FFmpegResult ffmpeg_lib_main(int argc, char **argv);

/**
 * Request cancellation of the currently running operation
 * Can be called from any thread.
 * The running operation will terminate at the next check point.
 */
void ffmpeg_lib_cancel(void);

/**
 * Check if cancellation has been requested
 * @return 1 if cancellation requested, 0 otherwise
 */
int ffmpeg_lib_check_cancel(void);

/**
 * Check if an operation is currently running
 * @return 1 if running, 0 otherwise
 */
int ffmpeg_lib_is_running(void);

/**
 * Cleanup and release all resources
 * Should be called before unloading the library.
 */
void ffmpeg_lib_cleanup(void);

/**
 * Get version string for the library interface
 * 
 * @return Version string (e.g., "1.0.0")
 */
const char *ffmpeg_lib_version(void);

#ifdef __cplusplus
}
#endif

#endif /* FFMPEG_LIB_H */
