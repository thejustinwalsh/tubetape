# Tubetape WASM Architecture - Complete Documentation Index

## Overview

This directory contains the complete specification and implementation plan for Tubetape's WASM-based hybrid architecture. The system combines Pyodide (Python in WASM) for yt-dlp, native ffmpeg via dlopen, and pre-bundled runtime assets for fast, offline-first operation.

**Key Principles:**
1. yt-dlp (in WASM) is the authoritative orchestrator
2. Native ffmpeg adapter is a transparent proxy
3. Runtime is pre-bundled at build time (no runtime downloads/patching)

---

## Quick Start

```bash
# 1. Install and bundle Pyodide + yt-dlp
bun install
bun run bundle:pyodide --update

# 2. Run development
bun run tauri dev

# 3. See PYODIDE_RUNTIME_SETUP.md for complete guide
```

---

## Documents

### 1. **WASM_ARCHITECTURE.md**
**Status:** Reference Document  
**Purpose:** High-level overview of the architecture

Contains:
- Executive summary of the hybrid approach
- Current architecture (desktop-only)
- Proposed architecture (WASM + native)
- Detailed component descriptions
- Bundle size analysis
- Platform compatibility matrix
- Security considerations
- References

**Read this if:** You want to understand WHY we're using WASM + native ffmpeg, not JUST WASM or JUST native binaries.

---

### 2. **WASM_RESEARCH_SUMMARY.md**
**Status:** Reference Document  
**Purpose:** Research findings that led to the architecture

Contains:
- Proof that dlPro browser extension runs yt-dlp in Pyodide
- CORS bypass strategy using Tauri HTTP plugin
- OTA update feasibility analysis
- ffmpeg.wasm vs native performance comparison
- Data flow diagrams
- Risk assessment
- Implementation priority ranking

**Read this if:** You want to understand the research and evidence behind the design decisions.

---

### 3. **PYODIDE_BUNDLING.md** ⭐ NEW
**Status:** Design Specification  
**Purpose:** Explains pre-bundling strategy for Pyodide + yt-dlp

Contains:
- Why bundle at build time instead of runtime
- Bundle structure and directory layout
- Build script design
- Loader and patch architecture
- Advantages over runtime patching
- Testing and validation
- Deployment considerations

**Read this if:** You want to understand how we bundle Pyodide + yt-dlp at build time for fast, offline-first operation.

---

### 4. **PYODIDE_RUNTIME_SETUP.md** ⭐ NEW
**Status:** Setup Guide  
**Purpose:** Complete guide to building and using the bundled runtime

Contains:
- Quick start commands
- What gets bundled and where
- Using PyodideClient in React
- Build script usage (`bundle:pyodide`, `bundle:pyodide:update`)
- How patches work at runtime
- Tauri integration requirements
- Version updates
- Troubleshooting
- CI/CD integration

**Read this if:** You're ready to build the Pyodide bundle and integrate it into the app.

---

### 5. **PYODIDE_BUNDLING_COMPLETE.md** ⭐ NEW
**Status:** Implementation Summary  
**Purpose:** Summary of what was built and how to use it

Contains:
- Files created summary
- Build-time vs runtime comparison
- Bundle structure
- Usage examples
- Python patches explained
- Commands reference
- Testing guide
- Next steps

**Read this if:** You want a quick summary of the complete bundling implementation.

---

### 6. **WASM_UNIFIED_DLOPEN_DESIGN.md**
**Status:** Design Specification  
**Purpose:** Explains the refined unified dlopen approach

Contains:
- Overview of unified dlopen across all platforms
- Architecture diagrams
- Key design principles
  - Transparent proxy pattern
  - yt-dlp as authoritative orchestrator
  - Single code path (all platforms)
- TypeScript bridge details
- Rust implementation details
- Advantages over platform-specific approaches
- Integration with existing plan
- Testing strategy
- Deployment considerations

**Read this if:** You want to understand the REFINED architecture with unified dlopen and yt-dlp as orchestrator.

---

### 7. **WASM_REFINEMENTS_SUMMARY.md**
**Status:** Executive Summary  
**Purpose:** Explains what changed and why

Contains:
- Before/after comparison
- Issues with the original plan
  - Platform-specific branching
  - Hardcoded ffmpeg arguments
  - Unclear responsibility division
- Benefits of refined plan
  - Unified dlopen everywhere
  - yt-dlp owns decisions
  - Transparent proxy pattern
- Detailed comparison table
- Implementation structure
- Migration path
- Testing simplification

**Read this if:** You want a quick summary of how the plan improved.

---

### 8. **WASM_IMPLEMENTATION_PLAN.md**
**Status:** Partially Updated  
**Purpose:** Phased implementation roadmap

Contains:
- Phase 0: Foundation (HTTP plugin config)
- Phase 1: HTTP Bridge (Rust + TypeScript)
- Phase 2: Pyodide Integration (Web Worker) - **NOW USES PRE-BUNDLED APPROACH** ✅
- Phase 3: yt-dlp Integration (patches) - **NOW BUNDLED AT BUILD TIME** ✅
- Phase 3.2: dlopen Adapter Patch (UPDATED ✅)
- Phase 4: FFmpeg Adapter (READY FOR UPDATE)
- Phase 5: JS Sandbox - **NO LONGER NEEDED** (removed QuickJS requirement)
- Phase 6: OTA Updates

**Status Notes:**
- Phases 0-3.2 have been refined ✅
- Phase 4 is now documented in PHASE_4_IMPLEMENTATION.md
- Phases 2-3 now use build-time bundling instead of runtime setup
- Phase 5 removed (no more QuickJS binary needed)

**Read this if:** You need a step-by-step implementation guide.

---

### 9. **PHASE_4_IMPLEMENTATION.md**
**Status:** Ready to Code  
**Purpose:** Complete code for Phase 4 (FFmpeg Adapter)

Contains:
- Phase 3.2: dlopen Adapter Patch (Python)
  - Full source code with comments
  - Design explanation
  - Error handling
- Phase 4: Unified dlopen FFmpeg Adapter (Rust)
  - Full source code with detailed comments
  - Platform-specific library names
  - Core implementation (identical across platforms)
  - Tauri command handler integration
- TypeScript Bridge
  - Full source code
  - FFmpeg result interface
  - Usage examples
- Integration instructions
- Testing examples (unit + integration)
- Key points summary

**Read this if:** You're ready to implement Phase 4. Copy-paste ready code.

---

## Quick Start Guide

### For Building the Runtime
1. **PYODIDE_RUNTIME_SETUP.md** - Complete setup guide
   ```bash
   bun install
   bun run bundle:pyodide --update
   bun run tauri dev
   ```
2. **PYODIDE_BUNDLING.md** - Understand the bundling architecture
3. **PYODIDE_BUNDLING_COMPLETE.md** - Quick summary of what was built

### For Understanding the Architecture
1. Start with **WASM_REFINEMENTS_SUMMARY.md** (5 min read)
2. Then **PYODIDE_BUNDLING.md** (15 min read - bundling strategy)
3. Then **WASM_UNIFIED_DLOPEN_DESIGN.md** (15 min read - dlopen design)
4. Reference **WASM_ARCHITECTURE.md** as needed

### For Implementation
1. Follow **PYODIDE_RUNTIME_SETUP.md** to build the Pyodide bundle
2. Follow **WASM_IMPLEMENTATION_PLAN.md** for phases 0-1 (HTTP bridge)
3. Use **PHASE_4_IMPLEMENTATION.md** for Phase 4 code (dlopen ffmpeg)
4. Return to **WASM_UNIFIED_DLOPEN_DESIGN.md** for design questions

### For Research/Decision-Making
1. Read **WASM_RESEARCH_SUMMARY.md** for evidence
2. Check **WASM_ARCHITECTURE.md** for comparisons
3. See **WASM_REFINEMENTS_SUMMARY.md** for trade-offs
4. See **PYODIDE_BUNDLING.md** for bundling strategy

---

## Key Concepts

### Pre-Bundled Runtime (NEW ⭐)
Instead of downloading Pyodide and yt-dlp at runtime:
- Build script downloads and bundles everything at build time
- Bundle includes Pyodide WASM, yt-dlp source, and pre-written patches
- Runtime loads from disk (fast, offline-first)
- No runtime downloads or patching needed

### Unified dlopen Approach
All platforms (macOS, Linux, Windows, iOS, Android) use the same dlopen mechanism:
- Load library via `dlopen()`
- Get function pointer via `dlsym()`
- Call `ffmpeg_main(argc, argv)`
- Difference: only the library name varies by platform

### yt-dlp as Authoritative Orchestrator
- yt-dlp (running in Pyodide/WASM) decides:
  - Which audio codec to use
  - Bitrate and quality settings
  - Output format
  - Post-processing options
- Native side just executes `ffmpeg_main` with args passed from yt-dlp
- No hardcoded extraction logic on native side

### Transparent Proxy Pattern
```
yt-dlp: "ffmpeg [arg1] [arg2] [arg3]"
  ↓
Native: "dlopen + call ffmpeg_main(argc, argv)"
  ↓
yt-dlp: "Process result"
```

The native side doesn't understand or interpret the arguments—it just passes them through.

---

## File Structure

```
docs/
├── WASM_ARCHITECTURE.md              [High-level overview]
├── WASM_RESEARCH_SUMMARY.md          [Evidence & analysis]
├── WASM_UNIFIED_DLOPEN_DESIGN.md     [⭐ Refined design]
├── WASM_REFINEMENTS_SUMMARY.md       [⭐ What changed & why]
├── WASM_IMPLEMENTATION_PLAN.md       [Phased roadmap]
├── PHASE_4_IMPLEMENTATION.md         [⭐ Ready-to-code specs]
└── README.md                         [This file]
```

---

## Implementation Status

| Phase | Component | Status |
|-------|-----------|--------|
| 0 | Foundation | ✅ Designed |
| 1 | HTTP Bridge | ✅ Designed |
| 2 | Pyodide Integration | ✅ Designed |
| 3 | yt-dlp Integration | ✅ Designed |
| 3.2 | dlopen Patch | ✅ Code Ready |
| 4 | FFmpeg Adapter | ✅ Code Ready |
| 5 | JS Sandbox | ✅ Designed |
| 6 | OTA Updates | ✅ Designed |

All phases have specifications. Phases 0-4 have detailed code.

---

## Key Improvements (vs. Original Plan)

| Aspect | Before | After |
|--------|--------|-------|
| FFmpeg across platforms | Desktop subprocess + iOS dlopen | Unified dlopen everywhere |
| Responsibility for extraction | Split between yt-dlp and native | yt-dlp only (native is proxy) |
| Hardcoded args | Yes, on native side | No, transparent proxy |
| Code paths to test | 2+ | 1 |
| Platform-specific logic | Multiple branches | Library name only |

---

## Testing Strategy

### Unit Tests
- Test dlopen loading (each platform library name)
- Test arg passing (no modification)
- Test exit code handling

### Integration Tests
- Test yt-dlp calling native ffmpeg
- Test actual audio extraction
- Test error handling

### E2E Tests
- Full flow: URL → Pyodide → native ffmpeg → audio file

All tests can use the single `run_ffmpeg_via_dlopen()` implementation.

---

## Questions & Answers

**Q: Why unified dlopen instead of platform-specific approaches?**  
A: Single code path = easier to test, fewer bugs, works on all platforms identically. Platform differences are only in library names, not implementation logic.

**Q: Why is yt-dlp the authority on ffmpeg arguments?**  
A: yt-dlp already knows how to extract audio optimally. The native side is just an executor, not a decision-maker. This keeps logic in one place (Pyodide).

**Q: How does dlopen work on iOS?**  
A: dlopen is a public iOS API. The app bundles `libffmpeg.dylib` and calls `dlopen("libffmpeg.dylib")` at runtime.

**Q: What about Android?**  
A: Same approach: bundle `libffmpeg.so` and call `dlopen("libffmpeg.so")`. The build system handles architecture-specific compilation.

**Q: Why not use subprocess everywhere?**  
A: iOS doesn't allow process spawning. dlopen is the only way on iOS, so we use it everywhere for consistency.

**Q: What if ffmpeg library is not found?**  
A: Clear error message directing user to install/bundle ffmpeg. Future: add fallback to server-side processing.

---

## Next Steps

1. **Code Phase 0-3**: Use WASM_IMPLEMENTATION_PLAN.md
2. **Code Phase 4**: Use PHASE_4_IMPLEMENTATION.md (copy-paste ready)
3. **Test**: Validate each phase
4. **Deploy**: Follow deployment considerations in WASM_UNIFIED_DLOPEN_DESIGN.md

---

## Contact & Discussion

This architecture evolved through:
- Research (dlPro browser extension reference)
- Analysis (CORS, OTA, platform constraints)
- Refinement (unified dlopen, transparent proxy)

The unified dlopen approach emerged as the "correct" architecture that satisfies all constraints while keeping code simple and maintainable.
