<div align="center">
  <h1>🎵 Tubetape</h1>
  <p><strong>Extract, Sample, and Loop Audio from YouTube Videos</strong></p>
  <p>A lightning-fast desktop app for music producers, beat makers, and audio enthusiasts</p>

  ![License](https://img.shields.io/badge/license-MIT-green.svg)
  ![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri)
  ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
  ![Rust](https://img.shields.io/badge/Rust-Latest-CE422B?logo=rust)
  ![OpenCode](https://img.shields.io/badge/⚡_OpenCode-OmO-7B3FF5?style=flat)

</div>

---

## ✨ What is Tubetape?

Remember making mixtapes? Tubetape brings that same creative energy to the digital age. Drop in a YouTube URL, and instantly extract the audio track with a beautiful waveform visualization. But here's where it gets interesting—**create precise audio samples with DAW-level controls**, complete with BPM detection and beat analysis.

Perfect for:
- 🎹 **Music Producers** seeking unique samples
- 🎧 **Beat Makers** looking for that perfect loop
- 🎼 **Sound Designers** hunting for audio textures
- 📻 **DJs** building their sample library

### 🎯 Key Features

- **Zero-Config Audio Extraction** - Paste a YouTube URL and get the audio track—no yt-dlp or ffmpeg installation required
- **Visual Waveform Editor** - See your audio, select precise regions with pixel-perfect accuracy
- **BPM Detection** - Automatic tempo analysis powered by aubio
- **Multiple Samples Per Source** - Extract as many clips as you need from a single video
- **Smart Caching** - Previously extracted audio loads instantly from local cache
- **Desktop-Native Export** - Save samples directly to your filesystem with native dialogs
- **Retro UI** - Beautiful 80s-inspired interface that's both functional and fun

> **👷 MVP -- Some Features Still in Development**
> <div align="center">
>  <img src="docs/assets/hero.gif" alt="Tubetape Demo" width="800">
> </div>

## 🛠️ Tech Stack

Built with modern, blazing-fast technologies:

- **Frontend**: React 19, TypeScript 5.8, Vite 7, Tailwind CSS v4
- **Backend**: Rust (Tauri v2)
- **Audio Extraction**: yt-dlp running in Pyodide (WebAssembly) + FFmpeg via dlopen
- **Audio Analysis**: aubio for BPM detection, custom Rust pipeline for waveform generation
- **Storage**: IndexedDB for local-first data and audio caching
- **Package Manager**: bun for lightning-fast installs

Why this stack? Because we wanted **native performance** with **web flexibility**, and Tauri delivers exactly that—a tiny binary, fast startup, and the full power of Rust for heavy audio processing.

---

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (or npm/yarn/pnpm)
- [Rust](https://rustup.rs/)
- [Tauri Prerequisites](https://tauri.app/v2/guides/prerequisites/)

### Installation

```bash
# Clone the repo
git clone https://github.com/thejustinwalsh/tubetape.git
cd tubetape

# Install dependencies
bun install

# Run in development mode
bun run tauri dev

# Build for production
bun run tauri build
```

That's it! The app will launch with hot reload enabled for development.

---

## 🎨 Features in Detail

### Audio Extraction
Paste any YouTube URL and Tubetape handles the rest—fetching metadata, extracting audio, and generating a waveform visualization. All processing happens locally on your machine for maximum speed and privacy.

**How it works under the hood:**
- yt-dlp runs inside Pyodide (Python compiled to WebAssembly)
- HTTP requests are routed through Rust to bypass CORS restrictions
- JavaScript challenges are solved in a sandboxed iframe (no external runtime needed)
- FFmpeg is bundled as a dylib and loaded via dlopen for audio conversion

### Sample Creation
Click and drag on the waveform to select regions. Each sample is stored in IndexedDB with:
- Start/end timestamps
- Duration
- Source video metadata
- Detected BPM

### Audio Analysis
Tubetape automatically analyzes your audio using a Rust processing pipeline:
- **Waveform Generation** - Peak data computed in chunks for responsive visualization
- **BPM Detection** - Tempo analysis via aubio for beat-aware sample creation

### Smart Caching
Previously extracted audio is cached locally. When you revisit a source, the audio loads instantly while waveforms and metadata are recomputed from the pipeline.

### Export
Use native file dialogs to export samples exactly where you need them. No cloud, no uploads—just fast, local file operations powered by Rust.

---

## 📋 Roadmap & TODOs

### Completed

- [x] **Pyodide Integration** - yt-dlp runs entirely in WebAssembly, no user installation required
- [x] **Sandboxed JS Challenges** - YouTube signature decryption via iframe sandbox (no QuickJS binary needed)
- [x] **FFmpeg via dlopen** - Bundled as shared libraries, loaded at runtime for LGPL compliance
- [x] **BPM Detection** - Automatic tempo analysis using aubio
- [x] **Audio Caching** - Previously extracted sources load from local cache
- [x] **Processing Pipeline** - Type-safe Rust pipeline with Tauri Specta for waveform and metadata generation
- [x] **Sample-accurate looping and playback**
- [x] **Visual waveform with region selection**

### In Progress

- [ ] **Loop Detection** - Automatically detect and suggest perfect loop points
- [ ] **Beat Snapping** - Snap sample boundaries to detected beats/tempo grid
- [ ] **Loop Markers** - Visual markers for loop start/end with auto-trimming
- [ ] **Waveform Zoom** - Multi-level zoom with detailed peak rendering
- [ ] **Grid/Ruler** - Temporal grid overlay for sample-accurate editing

### Future

- [ ] Project export/import functionality
- [ ] Key/root note detection
- [ ] Loudness analysis (LUFS)

**Details:** See [docs/DAW_FEATURES.md](docs/DAW_FEATURES.md)

---

## 🏗️ Development

```bash
# Frontend development server (port 1420)
bun run dev

# Type checking
bun run build

# Rust formatting
cd src-tauri && cargo fmt

# Rust linting
cd src-tauri && cargo clippy

# Rust tests
cd src-tauri && cargo test
```

### Developer Documentation

- [AGENTS.md](AGENTS.md) - Development guidelines and architecture overview
- [docs/pyodide-yt-dlp-guide.md](docs/pyodide-yt-dlp-guide.md) - How the Pyodide + yt-dlp integration works
- [docs/ffmpeg-library.md](docs/ffmpeg-library.md) - FFmpeg dlopen architecture and API
- [docs/build-scripts.md](docs/build-scripts.md) - Build system and dependency management

---

## 🎉 Credits & Vibes

This project started as a **"vibe-coded in a day"** experiment using some absolutely incredible tools:

- **[OpenCode](https://github.com/microsoft/opencode)** - Mad props for the AI-powered development workflow
- **[Oh My OpenCode](https://ohmyopencode.com)** - Taking the dev experience to the next level

Special shoutout to those teams for making modern development feel like magic. ✨

---

## 🤝 Contributing

Contributions are welcome! Whether it's:
- 🐛 Bug reports
- 💡 Feature requests
- 📖 Documentation improvements
- 🔧 Code contributions

Feel free to open an issue or submit a PR.

---

## 🌟 Show Your Support

If you find Tubetape useful, give it a ⭐️ on GitHub!

Built with 🖤 by [@thejustinwalsh](https://github.com/thejustinwalsh)

---

<div align="center">
  <sub>Made possible by Tauri, React, Rust, <s>coffee</s> claude ☕</sub>
</div>
