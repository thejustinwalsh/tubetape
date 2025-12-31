# DAW Features for Tubetape

## Overview

Tubetape aims to include professional Digital Audio Workstation (DAW) capabilities for sample creation and editing. This document outlines current features, planned enhancements, and research on beat detection and BPM analysis.

## Current Features ✅

- **Sample-Accurate Looping** - Click and drag to select regions with frame-accurate precision
- **Visual Waveform** - Real-time waveform rendering with zoom
- **Region Playback** - Play selected regions with seamless looping
- **Multi-Sample Management** - Create multiple samples from a single source

## Planned Features

### 1. Loop Detection & Auto-Trimming

**Purpose:** Automatically identify and trim perfect loops from selected regions.

**Implementation Approach:**
- Use phase vocoder or cross-correlation to detect loop points
- Analyze audio for repeating patterns within selection
- Suggest loop boundaries to user with confidence score
- Auto-trim to suggested boundaries on user confirmation

**Libraries to Evaluate:**
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) - Native audio analysis
- [Essentia.js](https://github.com/MTG/essentia.js/) - Music information retrieval (MIR) in JS
- Rust backend for heavier analysis via Tauri commands

**Algorithm Considerations:**
```
1. Extract audio frames from selection
2. Compute autocorrelation function
3. Find peaks in ACF (potential loop periods)
4. Verify loop by cross-correlating beginning and end
5. Return candidates sorted by correlation strength
```

**UI/UX:**
- Show suggested loop points as markers on waveform
- Display correlation strength as percentage
- Allow manual adjustment of loop boundaries
- Preview loop before committing

---

### 2. Beat Snapping

**Purpose:** Snap sample boundaries to detected beats for aligned timing.

**Implementation Approach:**
- Detect beats/onsets in audio using onset detection
- Display beat grid over waveform
- Snap region selection to nearest beat boundary
- Configurable snap sensitivity and grid resolution

**Libraries to Evaluate:**
- [Essentia.js](https://essentia.upf.edu/js/) - Beat and onset detection
- [Madmom](https://github.com/CPJKU/madmom) - Python library (via REST API or Rust wrapper)
- STFT-based onset detection in Rust

**Algorithm:**
```
1. Compute spectrogram from audio
2. Calculate spectral flux (onset strength)
3. Apply peak picking to find onset candidates
4. Use tempo-based filtering if BPM known
5. Create beat grid from detected onsets
```

**UI/UX:**
- Visual grid overlay on waveform
- Grid density selector (1/4, 1/8, 1/16 notes based on tempo)
- Toggle snap on/off
- Show beat numbers for reference

---

### 3. BPM Detection

**Purpose:** Analyze audio for tempo information to inform editing and export.

**Implementation Approach:**
- Detect overall BPM of source and samples
- Display as metadata alongside samples
- Use for beat snapping and grid generation
- Export BPM with sample metadata

**Libraries to Evaluate:**
- [Essentia.js](https://essentia.upf.edu/js/) - BPM detection, tempo estimation
- [Librosa](https://librosa.org/) - Python (would need Rust wrapper)
- Custom onset-based tempo estimation in Rust

**Algorithm (Simplified):**
```
1. Detect onsets/peaks in energy domain
2. Calculate inter-onset intervals
3. Find most common interval (histogram peak)
4. Convert to BPM (60 * sample_rate / common_interval)
5. Validate against typical BPM range (80-200 for music)
6. Return primary BPM + alternatives
```

**UI/UX:**
- Display detected BPM prominently in project view
- Show confidence score with BPM
- Allow manual BPM override for samples
- Use detected BPM for beat grid calculation

---

### 4. Loop Markers

**Purpose:** Create visual markers for loop regions with precise control.

**Features:**
- Loop IN/OUT point markers on waveform
- Snap loop points to grid (if beat snapping enabled)
- Visual distinction between loop region and full sample
- Loop preview independent of sample boundaries

**UI/UX:**
- Draggable markers on waveform for loop boundaries
- Double-click to place markers at current playback position
- "Auto Loop" button to trigger loop detection
- Loop length display (in seconds and bars if BPM known)

---

### 5. Waveform Zoom

**Purpose:** Enable detailed editing at multiple zoom levels.

**Implementation:**
- Multi-level zoom (fit, 1:1, 2x, 4x, 8x, etc.)
- Horizontal scrolling for zoomed views
- Zoom to selection
- Mouse wheel zoom with position-aware focus

**Performance Considerations:**
- Peak caching at multiple resolutions
- Lazy rendering for off-screen regions
- WebGL acceleration for large waveforms

---

### 6. Grid & Ruler

**Purpose:** Temporal reference for sample-accurate editing.

**Features:**
- Horizontal ruler showing time (seconds, mm:ss.ms format)
- Optional beat grid overlay (bars and beats)
- Snap-to-grid for region boundaries
- Grid density based on zoom level and detected BPM

**UI/UX:**
- Toggle grid visibility
- Adjust grid density
- Color-code bars vs. beats
- Show grid in both time and musical notation

---

### 7. Audio Metadata Display

**Purpose:** Show detailed information about audio characteristics.

**Information to Display:**
- Sample rate (Hz)
- Bit depth
- Duration (seconds and bars if BPM known)
- Detected BPM with confidence
- Key/Root note (if analyzable)
- Loudness (LUFS)
- Dynamic range

**Implementation:**
- Cache metadata in IndexedDB with sample
- Display in sample inspector panel
- Show comparative analysis across samples from same source

---

## Research & References

### Beat Detection & Onset Detection
- **Essentia.js:** https://essentia.upf.edu/js/
  - Web-based, no server required
  - Implements multiple beat detection algorithms
  - Lightweight for browser audio analysis

- **Madmom:** https://github.com/CPJKU/madmom
  - Deep learning-based detection (very accurate)
  - Would require Rust bridge or HTTP API
  - Computationally heavier

- **Librosa:** https://librosa.org/
  - Comprehensive MIR toolkit
  - Python-based (would need REST API layer)
  - Excellent documentation

### BPM & Tempo Estimation
- **Onset-based methods:** Compute autocorrelation of onset strengths
- **Spectral methods:** Analyze periodicity in energy domain
- **Deep Learning:** Pre-trained models for tempo/beat/downbeat estimation

### Loop Detection
- **Cross-correlation:** Compare audio frames to find repeating patterns
- **Autocorrelation:** Detect periodicity in time-domain signal
- **Phase Vocoder:** For time-stretching and alignment verification

### Performance Optimization
- Use Web Workers for audio analysis in frontend
- Cache analysis results per sample
- Implement streaming analysis for large files
- Consider WASM for compute-heavy algorithms

## Implementation Roadmap

### Phase 1: Foundation (Current)
- ✅ Basic waveform visualization
- ✅ Sample-accurate region selection
- [ ] Simple BPM display (user input first)

### Phase 2: Smart Analysis
- [ ] Implement BPM detection (Essentia.js)
- [ ] Add beat grid overlay
- [ ] Basic loop detection
- [ ] Beat snapping for region selection

### Phase 3: Advanced Editing
- [ ] Loop trimming UI and auto-trim
- [ ] Loop markers with preview
- [ ] Enhanced waveform zoom
- [ ] Metadata display panel

### Phase 4: Polish & Performance
- [ ] WASM-based analysis algorithms
- [ ] Performance optimization for large samples
- [ ] Advanced grid customization
- [ ] A/B comparison for loop candidates

## Testing Strategy

**Unit Tests:**
- BPM detection accuracy on known tempos
- Loop detection on known loops vs. non-loops
- Grid generation correctness

**Integration Tests:**
- End-to-end sample creation with auto-features
- Performance with large audio files
- Cross-platform analysis consistency

**Manual Testing:**
- User studies on loop detection accuracy
- DAW feature usability comparison
- Performance benchmarking

## References

- [Web Audio API](https://www.w3.org/TR/webaudio/)
- [ESSENTIA Documentation](https://essentia.upf.edu/documentation.html)
- [Onset Detection Survey](https://en.wikipedia.org/wiki/Onset_(audio))
- [Tempo Estimation](https://en.wikipedia.org/wiki/Tempo)
- [Loop Detection in Music](https://www.jstor.org/stable/24819267)
