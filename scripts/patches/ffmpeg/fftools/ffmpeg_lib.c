/*
 * FFmpeg Library Interface Implementation
 * Copyright (c) 2025 Tubetape Project
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"
#include "ffmpeg_lib.h"

#include <setjmp.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

#include "libavutil/log.h"
#include "libavutil/mem.h"
#include "libavformat/avformat.h"

#ifdef CONFIG_AVDEVICE
#include "libavdevice/avdevice.h"
#endif

#define FFMPEG_LIB_VERSION "1.0.0"

static pthread_mutex_t g_lib_mutex = PTHREAD_MUTEX_INITIALIZER;
static atomic_int g_initialized = 0;
static atomic_int g_running = 0;
static atomic_int g_cancel_requested = 0;

static FILE *g_stdin_fp = NULL;
static FILE *g_stdout_fp = NULL;
static FILE *g_stderr_fp = NULL;

static ffmpeg_log_callback g_log_callback = NULL;
static void *g_log_user_ctx = NULL;

static __thread jmp_buf g_exit_jmp;
static __thread int g_exit_code = 0;
static __thread int g_exit_jumped = 0;

extern int ffmpeg_main_internal(int argc, char **argv);
extern void ffmpeg_cleanup_internal(int ret);
extern int ffprobe_main_internal(int argc, char **argv);
extern void ffprobe_cleanup_internal(void);

static void custom_log_callback(void *avcl, int level, const char *fmt, va_list vl) {
    if (!g_log_callback && !g_stderr_fp) {
        av_log_default_callback(avcl, level, fmt, vl);
        return;
    }
    
    if (level > av_log_get_level())
        return;
    
    char buf[4096];
    vsnprintf(buf, sizeof(buf), fmt, vl);
    
    if (g_log_callback) {
        g_log_callback(level, buf, g_log_user_ctx);
    } else if (g_stderr_fp) {
        fputs(buf, g_stderr_fp);
    }
}

void ffmpeg_lib_exit_handler(int code);
void ffmpeg_lib_exit_handler(int code) {
    g_exit_code = code;
    g_exit_jumped = 1;
    longjmp(g_exit_jmp, 1);
}

int ffmpeg_lib_check_cancel(void) {
    return atomic_load(&g_cancel_requested);
}

FILE *ffmpeg_lib_get_stdin(void) {
    return g_stdin_fp ? g_stdin_fp : stdin;
}

FILE *ffmpeg_lib_get_stdout(void) {
    return g_stdout_fp ? g_stdout_fp : stdout;
}

FILE *ffmpeg_lib_get_stderr(void) {
    return g_stderr_fp ? g_stderr_fp : stderr;
}

int ffmpeg_lib_init(void) {
    int expected = 0;
    if (!atomic_compare_exchange_strong(&g_initialized, &expected, 1)) {
        return 0;
    }
    
    pthread_mutex_lock(&g_lib_mutex);
    
#ifdef CONFIG_AVDEVICE
    avdevice_register_all();
#endif
    avformat_network_init();
    
    av_log_set_callback(custom_log_callback);
    
    pthread_mutex_unlock(&g_lib_mutex);
    return 0;
}

void ffmpeg_lib_set_io(const FFmpegIOContext *io_ctx) {
    pthread_mutex_lock(&g_lib_mutex);
    
    if (io_ctx) {
        g_stdin_fp = io_ctx->stdin_fp;
        g_stdout_fp = io_ctx->stdout_fp;
        g_stderr_fp = io_ctx->stderr_fp;
    } else {
        g_stdin_fp = NULL;
        g_stdout_fp = NULL;
        g_stderr_fp = NULL;
    }
    
    pthread_mutex_unlock(&g_lib_mutex);
}

void ffmpeg_lib_set_log_callback(ffmpeg_log_callback callback, void *user_ctx) {
    pthread_mutex_lock(&g_lib_mutex);
    g_log_callback = callback;
    g_log_user_ctx = user_ctx;
    pthread_mutex_unlock(&g_lib_mutex);
}

FFmpegResult ffmpeg_lib_main(int argc, char **argv) {
    FFmpegResult result = {0, 0, NULL};
    
    int expected = 0;
    if (!atomic_compare_exchange_strong(&g_running, &expected, 1)) {
        result.exit_code = -1;
        result.error = "Another FFmpeg operation is already running";
        return result;
    }
    
    atomic_store(&g_cancel_requested, 0);
    g_exit_jumped = 0;
    g_exit_code = 0;
    
    if (setjmp(g_exit_jmp) == 0) {
        result.exit_code = ffmpeg_main_internal(argc, argv);
    } else {
        result.exit_code = g_exit_code;
        result.was_aborted = 1;
    }
    
    ffmpeg_cleanup_internal(result.exit_code);
    
    atomic_store(&g_running, 0);
    return result;
}

FFmpegResult ffprobe_lib_main(int argc, char **argv) {
    FFmpegResult result = {0, 0, NULL};
    
    int expected = 0;
    if (!atomic_compare_exchange_strong(&g_running, &expected, 1)) {
        result.exit_code = -1;
        result.error = "Another FFmpeg operation is already running";
        return result;
    }
    
    atomic_store(&g_cancel_requested, 0);
    g_exit_jumped = 0;
    g_exit_code = 0;
    
    if (setjmp(g_exit_jmp) == 0) {
        result.exit_code = ffprobe_main_internal(argc, argv);
    } else {
        result.exit_code = g_exit_code;
        result.was_aborted = 1;
    }
    
    ffprobe_cleanup_internal();
    atomic_store(&g_running, 0);
    return result;
}

void ffmpeg_lib_cancel(void) {
    atomic_store(&g_cancel_requested, 1);
}

int ffmpeg_lib_is_running(void) {
    return atomic_load(&g_running);
}

void ffmpeg_lib_cleanup(void) {
    if (!atomic_load(&g_initialized))
        return;
    
    pthread_mutex_lock(&g_lib_mutex);
    
    avformat_network_deinit();
    av_log_set_callback(av_log_default_callback);
    
    g_stdin_fp = NULL;
    g_stdout_fp = NULL;
    g_stderr_fp = NULL;
    g_log_callback = NULL;
    g_log_user_ctx = NULL;
    
    atomic_store(&g_initialized, 0);
    
    pthread_mutex_unlock(&g_lib_mutex);
}

const char *ffmpeg_lib_version(void) {
    return FFMPEG_LIB_VERSION;
}
