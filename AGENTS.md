# AGENTS.md - Tubetape

## Project Overview

Tubetape is a Tauri v2 desktop application with a React 19 + TypeScript frontend and Rust backend.

Tubetape is a utility to extract the audio track from a youtube video from a pasted URL. The app should let the user paste a youtube link and unfurl from the link, and start extracting the audio. The app should render the sound wave and provide a component that lets the user sample clips of audio and export them. Each source could have multiple samples exported, so we should save the samples with an association to the video and a project. The sample data should be stored in indexedb, start, end, source, etc. So that we can export them from the source audio on demand in the app.

As this is a desktop app using tauri, we want to be sure to provide desktop experiences for exporting the samples, and we want to use rust for any heavy processing.

As an added bonus any utility we can bake into the component that is used to extract samples, like you would find in a DAW (abelton, bitwig) for making loops, or finding exact beats to start/end on, as well as any meta data about the BPMs etc would be super useful to make this app a unique and desirable tool.

**Tech Stack:**
- Frontend: React 19, Vite 7, Tailwind CSS v4, TypeScript 5.8
- Backend: Rust (Tauri v2)
- Package Manager: bun

---

## Build / Dev / Test Commands

### Frontend (JavaScript/TypeScript)

```bash
# Install dependencies
bun install

# Development server (frontend only, port 1420)
bun run dev

# Type check
bun run build   # runs tsc && vite build

# Build frontend for production
bun run build
```

### Tauri (Full Application)

```bash
# Development mode (launches app with hot reload)
bun run tauri dev

# Build production application
bun run tauri build

# Run Tauri CLI commands
bun run tauri --help
```

### Rust Backend

```bash
# Check Rust code
cd src-tauri && cargo check

# Build Rust backend
cd src-tauri && cargo build

# Format Rust code
cd src-tauri && cargo fmt

# Run Rust linter
cd src-tauri && cargo clippy

# Run Rust tests
cd src-tauri && cargo test

# Run a single Rust test
cd src-tauri && cargo test test_name
```

### No Test Framework Configured (Frontend)

Currently no test runner is set up for frontend code. If tests are added, use Vitest.

---

## Code Style Guidelines

### TypeScript/React

**tsconfig.json enforces:**
- `strict: true` - Full strict mode
- `noUnusedLocals: true` - No unused variables
- `noUnusedParameters: true` - No unused function parameters
- `noFallthroughCasesInSwitch: true` - Exhaustive switch cases

**Imports:**
```typescript
// React imports first
import { useState } from "react";

// Third-party imports
import { invoke } from "@tauri-apps/api/core";

// Local imports (relative paths)
import reactLogo from "./assets/react.svg";
import "./App.css";
```

**Component Style:**
```typescript
// Use function declarations for components
function App() {
  const [state, setState] = useState("");
  
  // Async functions inside component
  async function handleAction() {
    const result = await invoke("rust_command", { param });
  }
  
  return <main>...</main>;
}

export default App;
```

**Naming:**
- Components: PascalCase (`App`, `UserProfile`)
- Functions/variables: camelCase (`greetMsg`, `setName`)
- Constants: camelCase (no SCREAMING_CASE for JS constants)
- Files: Components in PascalCase.tsx, utilities in camelCase.ts

**Forbidden:**
- `as any` - Never suppress type errors
- `@ts-ignore` / `@ts-expect-error` - Fix the type instead
- Empty catch blocks - Always handle errors

### Tailwind CSS v4

Uses the new `@theme` block syntax for custom design tokens in `src/App.css`.

```css
@import "tailwindcss";

@theme {
  --color-neon-pink: #ff006e;
  --font-family-retro: 'Orbitron', ui-sans-serif, system-ui, sans-serif;
  --shadow-neon-cyan: 0 0 20px rgba(0, 245, 255, 0.5);
}
```

**Usage in JSX:**
```tsx
// Use Tailwind utility classes
<div className="min-h-screen pt-20 flex flex-col items-center">

// Custom colors from @theme
<h1 className="text-neon-pink bg-retro-surface">

// CSS variable references for gradients
<div className="bg-linear-to-r from-hot-pink to-(--color-laser-purple)">
```

### Rust (Tauri Backend)

**Commands:**
```rust
// Tauri commands use snake_case and #[tauri::command] macro
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}
```

**Registration:**
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![greet, other_command])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

**Calling Rust from Frontend:**
```typescript
import { invoke } from "@tauri-apps/api/core";

// Command name matches Rust function name
const result = await invoke("greet", { name: "World" });
```

**Style:**
- Use `cargo fmt` for formatting
- Use `cargo clippy` for linting
- Prefer `Result<T, E>` over panics in commands
- Use `serde` for serialization

---

## Project Structure

```
tubetape/
  src/                    # React frontend
    App.tsx              # Main React component
    App.css              # Tailwind + custom CSS
    main.tsx             # React entry point
    assets/              # Static assets (SVGs, images)
  src-tauri/             # Rust backend
    src/
      main.rs            # Tauri entry point
      lib.rs             # Tauri commands and logic
    Cargo.toml           # Rust dependencies
    tauri.conf.json      # Tauri configuration
  public/                # Static files served at root
    fonts/               # Custom font files
  index.html             # HTML entry point
  package.json           # JS dependencies
  tsconfig.json          # TypeScript configuration
  vite.config.ts         # Vite configuration
```

---

## Error Handling

**Frontend:**
```typescript
try {
  const result = await invoke("command");
} catch (error) {
  console.error("Command failed:", error);
  // Handle error appropriately - never silently swallow
}
```

**Rust:**
```rust
#[tauri::command]
fn fallible_command() -> Result<String, String> {
    // Return Err for error conditions
    Err("Something went wrong".into())
}
```

---

## Key Dependencies

**Frontend:**
- `@tauri-apps/api` - Tauri JavaScript API for invoking Rust commands
- `@tauri-apps/plugin-opener` - System URL/file opener plugin
- `react` / `react-dom` - React 19
- `tailwindcss` - Tailwind CSS v4 with Vite plugin

**Backend:**
- `tauri` - Tauri v2 framework
- `tauri-plugin-opener` - Opener plugin for Rust
- `serde` / `serde_json` - Serialization
