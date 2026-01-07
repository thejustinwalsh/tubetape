# WASM Architecture Refinement - Complete Summary

## What Was Accomplished

I have refined the Tubetape WASM implementation plan with a unified dlopen approach for ffmpeg across all platforms, with yt-dlp as the authoritative orchestrator. Here's what was delivered:

---

## New Documents Created

### 1. **WASM_UNIFIED_DLOPEN_DESIGN.md** (Core Design)
The primary design specification for the refined architecture.

**Contains:**
- Complete architectural diagrams
- Key design principles (transparent proxy pattern)
- Full TypeScript and Rust code
- Advantages over platform-specific approaches
- Integration with existing phases
- Testing strategy
- Deployment considerations

**Purpose:** The "why" and "how" of the unified dlopen approach.

---

### 2. **WASM_REFINEMENTS_SUMMARY.md** (Executive Summary)
Quick comparison of before/after architecture.

**Contains:**
- Issues with the original plan
- Benefits of the refined approach
- Detailed comparison table
- Implementation structure
- Migration path

**Purpose:** Help stakeholders understand what changed and why.

---

### 3. **PHASE_4_IMPLEMENTATION.md** (Ready-to-Code)
Complete, copy-paste-ready code for Phase 4.

**Contains:**
- Phase 3.2: dlopen Adapter Patch (Python)
  - Full source with comments and error handling
- Phase 4: Unified dlopen FFmpeg Adapter (Rust)
  - Complete source with detailed documentation
  - Platform-specific library names (only difference)
  - Core implementation (identical across all platforms)
- TypeScript Bridge
  - Complete source
  - Tauri command handler integration
- Integration instructions
- Testing examples
- Key points summary

**Purpose:** Developers can copy code directly and implement it.

---

### 4. **WASM_INDEX.md** (Navigation Guide)
Complete index and quick start guide for all WASM documentation.

**Contains:**
- Overview of all WASM documents
- Quick start paths (for understanding, implementation, research)
- Key concepts explained
- File structure
- Implementation status table
- Q&A section
- Next steps

**Purpose:** Help users navigate and understand the complete documentation.

---

## Updated Documents

### WASM_ARCHITECTURE.md
- Added executive summary note about unified dlopen refinement
- Link to WASM_UNIFIED_DLOPEN_DESIGN.md for details
- Updated to reflect that all platforms use dlopen (not platform-specific branching)

### WASM_IMPLEMENTATION_PLAN.md
- Updated Phase 3.2 from "subprocess_patch.py" to "dlopen_adapter.py"
- Updated priority to reflect unified dlopen approach
- Prepared Phase 4 for the new dlopen implementation

---

## Key Architectural Changes

### Before (Original Plan Issues)
```
1. Platform-specific logic
   - Desktop: subprocess spawning
   - iOS: dlopen + FFI
   - Android: TBD

2. Hardcoded ffmpeg arguments
   - Native code decides: codec, bitrate, format
   - yt-dlp has no say in extraction strategy

3. Unclear responsibility
   - yt-dlp: decides WHAT to download
   - Native: decides HOW to extract audio
```

### After (Refined Plan Benefits)
```
1. Unified dlopen everywhere
   - All platforms: dlopen + ffmpeg_main(argc, argv)
   - Platform difference: library name only

2. yt-dlp is authoritative
   - yt-dlp passes ALL ffmpeg args
   - Native is transparent proxy (no modification)
   - Native doesn't interpret arguments

3. Clear responsibility
   - yt-dlp: makes all decisions (codec, bitrate, format, args)
   - Native: executes ffmpeg_main with args as-is
   - Single source of truth for extraction logic
```

---

## Design Principles

### 1. Transparent Proxy Pattern
```
Input:  command='ffmpeg', args=[arg1, arg2, ...] from yt-dlp
↓
Process: dlopen("libffmpeg.dylib/so/dll")
         ffmpeg_main(argc, argv)
↓
Output: {exit_code: 0, stdout: "", stderr: ""}
↓
yt-dlp handles result
```

**No interpretation, no modification, no hardcoding.**

### 2. Single Code Path
```rust
fn run_ffmpeg_via_dlopen(...) {
    // Same code on macOS, Linux, Windows, iOS, Android
    let lib_name = get_ffmpeg_lib_name();  // Only difference
    libc::dlopen(lib_name, ...)            // Same everywhere
    ffmpeg_main(argc, argv)                // Same everywhere
}
```

### 3. yt-dlp as Authority
- yt-dlp decides extraction strategy
- Native side has no business logic
- Changes to extraction = change yt-dlp, not native code

---

## Code Highlights

### Python (Pyodide/WASM)
```python
def patched_popen_run(cls, args, **kwargs):
    """Intercept ffmpeg subprocess calls and route to native."""
    if args[0] in ('ffmpeg', 'ffprobe'):
        # Route to native, passing args unchanged
        result = run_sync(nativeFFmpegAdapter(args[0], args[1:]))
        # Return subprocess-compatible result
        return subprocess.CompletedProcess(
            args=args,
            returncode=result['exit_code'],
            stdout=result.get('stdout', b''),
            stderr=result.get('stderr', b'')
        )
```

### Rust (Tauri)
```rust
fn run_ffmpeg_via_dlopen(command: &str, args: Vec<String>) {
    unsafe {
        // Load library (platform-specific name only)
        let lib = libc::dlopen(get_ffmpeg_lib_name(), libc::RTLD_NOW);
        
        // Get function pointer
        let ffmpeg_main = libc::dlsym(lib, "ffmpeg_main");
        
        // Build argv from command + args (no modification)
        let argv = build_argv(command, args);
        
        // Call ffmpeg_main with args from yt-dlp
        let exit_code = ffmpeg_main(argv.len(), argv.as_ptr());
        
        libc::dlclose(lib);
        Ok(FFmpegResult { exit_code, ... })
    }
}
```

---

## Comparison: Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| FFmpeg delivery | Desktop subprocess + iOS dlopen | Unified dlopen (all platforms) |
| Code paths | 2-3 (platform-specific) | 1 (unified) |
| Platform branching | Implementation logic differs | Only library names differ |
| Arg handling | Hardcoded on native side | Transparent proxy from yt-dlp |
| Authority | Split between yt-dlp and native | yt-dlp only |
| Testing | Test each platform | Test once, works everywhere |
| New platforms | Add new cfg branch + logic | Add new cfg block with lib name |
| Maintenance | Multiple code paths | Single implementation |
| Bugs | Can be platform-specific | Cannot be platform-specific |

---

## Files for Implementation

When implementing, you'll need:

1. **For Phase 3.2:**
   - `src/wasm/patches/dlopen_adapter.py` (see PHASE_4_IMPLEMENTATION.md)

2. **For Phase 4:**
   - `src-tauri/src/ffmpeg_dlopen.rs` (see PHASE_4_IMPLEMENTATION.md)
   - `src/wasm/worker/ffmpeg-dlopen-bridge.ts` (see PHASE_4_IMPLEMENTATION.md)
   - Update: `src-tauri/src/lib.rs` (add dlopen_ffmpeg to handler)

All code is ready to copy-paste from PHASE_4_IMPLEMENTATION.md.

---

## Documentation Map

```
For Understanding:
  1. WASM_REFINEMENTS_SUMMARY.md (5 min overview)
  2. WASM_UNIFIED_DLOPEN_DESIGN.md (deep dive)

For Implementation:
  1. WASM_IMPLEMENTATION_PLAN.md (phases 0-3)
  2. PHASE_4_IMPLEMENTATION.md (phase 4 code)

For Reference:
  1. WASM_ARCHITECTURE.md (high-level)
  2. WASM_RESEARCH_SUMMARY.md (evidence)
  3. WASM_INDEX.md (navigation)
```

---

## Key Benefits of This Approach

✅ **Unified implementation** - Same code on all platforms (macOS, Linux, Windows, iOS, Android)

✅ **Clear responsibility** - yt-dlp owns decisions, native executes

✅ **Transparent proxy** - No business logic on native side

✅ **Minimal branching** - Only platform-specific library names

✅ **Easy to test** - Single code path = single test path

✅ **Easy to maintain** - Changes in one place

✅ **Future-proof** - New platforms automatically supported

✅ **yt-dlp authority** - Extraction strategy lives where it should

---

## Next Steps

1. **Review** the architecture documents
2. **Validate** the design with stakeholders
3. **Implement** using code from PHASE_4_IMPLEMENTATION.md
4. **Test** each phase as implemented
5. **Deploy** following deployment considerations in WASM_UNIFIED_DLOPEN_DESIGN.md

---

## Questions to Ask

- Does yt-dlp as authoritative orchestrator make sense?
- Is the transparent proxy pattern acceptable?
- Are there any platform-specific ffmpeg needs we're missing?
- Should we capture ffmpeg output in real-time (progress tracking)?
- How should we handle ffmpeg not being found at runtime?

---

## Conclusion

This refined architecture:
- **Simplifies** the implementation (single code path)
- **Clarifies** responsibilities (yt-dlp decides, native executes)
- **Improves** maintainability (less branching)
- **Reduces** bugs (consistent behavior)
- **Enables** testing (test once, applies everywhere)

It's the architecture that naturally emerges when asking: **"What's the simplest way to let yt-dlp stay in control while using native ffmpeg?"**

The answer: **A transparent proxy via dlopen on all platforms.**
