<div align="center">
  <h1>🎵 Tubetape</h1>
  <p><strong>Extract, Sample, and Loop Audio from YouTube Videos</strong></p>
  <p>A lightning-fast desktop app for music producers, beat makers, and audio enthusiasts</p>
  
  ![License](https://img.shields.io/badge/license-MIT-green.svg)
  ![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri)
  ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
  ![Rust](https://img.shields.io/badge/Rust-Latest-CE422B?logo=rust)
  ![OpenCode](https://img.shields.io/badge/⚡_OpenCode-oMo-7B3FF5?style=flat)
  
</div>

---

## ✨ What is Tubetape?

Remember making mixtapes? Tubetape brings that same creative energy to the digital age. Drop in a YouTube URL, and instantly extract the audio track with a beautiful waveform visualization. But here's where it gets interesting—**create precise audio samples with DAW-level controls**, complete with loop detection, beat snapping, and BPM analysis.

Perfect for:
- 🎹 **Music Producers** seeking unique samples
- 🎧 **Beat Makers** looking for that perfect loop
- 🎼 **Sound Designers** hunting for audio textures
- 📻 **DJs** building their sample library

### 🎯 Key Features

- **Instant Audio Extraction** - Paste a YouTube URL and get the audio track in seconds
- **Visual Waveform Editor** - See your audio, select precise regions with pixel-perfect accuracy
- **Multiple Samples Per Source** - Extract as many clips as you need from a single video
- **Smart Project Management** - Organize samples by source video with automatic metadata
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
- **Storage**: IndexedDB (via RxDB) for local-first data
- **Audio**: Web Audio API for sample playback and visualization
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

### Sample Creation
Click and drag on the waveform to select regions. Each sample is stored in IndexedDB with:
- Start/end timestamps
- Duration
- Source video metadata
- Custom naming

### Project Organization
Samples are automatically grouped by their source video, creating a natural project structure. Switch between projects instantly and manage your entire sample library in one place.

### Export
Use native file dialogs to export samples exactly where you need them. No cloud, no uploads—just fast, local file operations powered by Rust.

---

## 📋 Roadmap & TODOs

### 1. yt-dlp Binary Distribution & EJS Script Handling
**Priority:** High | **Category:** Core Infrastructure

Enable fully self-contained binary distribution without relying on user's local environment.

**Tasks:**
- [ ] Integrate yt-dlp binary fetching from GitHub releases
- [ ] Implement EJS script handling for dynamic download URLs (see [yt-dlp EJS Wiki](https://github.com/yt-dlp/yt-dlp/wiki/EJS))
- [ ] Evaluate Deno bundling for EJS template processing
- [ ] Create Rust layer for secure binary execution with proper CLI argument passing
- [ ] Add binary caching and versioning mechanism
- [ ] Implement fallback strategy if binary fetch fails

**Details:** See [docs/YTDLP_INTEGRATION.md](docs/YTDLP_INTEGRATION.md)

---

### 2. Advanced DAW Features
**Priority:** High | **Category:** User Experience

Expand audio editing capabilities with professional DAW-like tools for sample creation.

**Tasks:**
- [ ] **Loop Detection** - Automatically detect and suggest perfect loop points
- [ ] **Beat Snapping** - Snap sample boundaries to detected beats/tempo grid
- [ ] **BPM Detection** - Analyze source audio and samples for tempo information
- [ ] **Loop Markers** - Visual markers for loop start/end with auto-trimming to loops
- [ ] **Waveform Zoom** - Multi-level zoom with detailed peak rendering
- [ ] **Grid/Ruler** - Temporal grid overlay for sample-accurate editing
- [ ] **Meta Display** - Show BPM, key, and other audio characteristics

**Completed Features:**
- [x] Sample-accurate looping and playback
- [x] Visual waveform with region selection

**Details:** See [docs/DAW_FEATURES.md](docs/DAW_FEATURES.md)

---

### 3. Project Flow & Caching Improvements
**Priority:** High | **Category:** Stability & Performance

Refine project management and implement intelligent caching for faster workflows.

**Tasks:**
- [ ] Load cached source audio if already extracted (check IndexedDB)
- [ ] Implement smart project state management
- [ ] Add project version/migration support
- [ ] Create proper cleanup mechanism for orphaned cache entries
- [ ] Improve source URL validation and duplicate detection
- [ ] Add project export/import functionality
- [ ] Optimize IndexedDB queries and indexing
- [ ] Implement proper error recovery for failed extractions

**Details:** See [docs/PROJECT_FLOW.md](docs/PROJECT_FLOW.md)

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

See [AGENTS.md](AGENTS.md) for detailed development guidelines and architecture documentation.

---

## 🎉 Credits & Vibes

This project was **vibe-coded in a day** using some absolutely incredible tools:

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
  <sub>Made possible by Tauri, React, Rust, and a whole lot of <s>coffee</s> claude ☕</sub>
</div>
