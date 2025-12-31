# Project Flow & Caching Architecture

## Overview

This document outlines the project management flow, caching strategies, and data persistence architecture for Tubetape. The goal is to create a seamless, performant user experience with proper state management and intelligent caching.

## Current State

**Issues Identified:**
- Project/source management could be cleaner
- No caching of extracted audio between sessions
- Missing version control for projects
- Unclear state transitions in UI flow
- No duplicate detection for URLs

## Desired User Flow

```
1. User opens app
   ↓
2. Show recent projects (loaded from IndexedDB)
   ↓
3. User pastes YouTube URL
   ↓
4. [Check if URL already cached]
   ↓
5. If new: Download metadata + extract audio (with progress)
   If cached: Load from IndexedDB instantly
   ↓
6. Display waveform
   ↓
7. User creates samples by selecting regions
   ↓
8. Each sample saved to project with metadata
   ↓
9. User exports samples via native file dialog
   ↓
10. App remembers project for next session
```

## Data Model & IndexedDB Schema

### Collections

#### 1. **Projects**
```typescript
interface Project {
  id: string;                    // UUID
  name: string;                  // User-provided name
  createdAt: number;            // Timestamp
  updatedAt: number;            // Timestamp
  description?: string;          // Optional project notes
  version: number;              // For migrations
}

// Indexes:
// - createdAt (for sorting by recency)
// - updatedAt (for recently modified)
```

#### 2. **Sources** (Extracted Audio)
```typescript
interface AudioSource {
  id: string;                    // UUID
  url: string;                   // Original YouTube URL
  title: string;                 // Video title (from metadata)
  duration: number;              // Duration in seconds
  sampleRate: number;            // Audio sample rate
  bitDepth: number;              // Bit depth
  format: string;                // 'wav', 'mp3', etc.
  
  // Metadata from YouTube
  videoId: string;               // YouTube video ID
  uploader?: string;
  uploadDate?: string;
  thumbnail?: string;
  
  // Cached audio data
  audioBuffer: ArrayBuffer;      // Raw audio data (compressed in IDB)
  waveformData?: Float32Array;   // Pre-computed waveform for rendering
  
  // Analysis data
  detectedBPM?: number;
  key?: string;
  loudness?: number;
  
  // Housekeeping
  projectId: string;             // Associated project
  addedAt: number;              // When added to project
  cachedAt: number;             // When audio was extracted
  md5Hash: string;              // Hash of audio for dedup
}

// Indexes:
// - url (for duplicate detection)
// - projectId (to fetch sources for project)
// - cachedAt (for cache cleanup)
// - md5Hash (for dedup)
```

#### 3. **Samples**
```typescript
interface Sample {
  id: string;                    // UUID
  sourceId: string;              // Reference to AudioSource
  projectId: string;             // Reference to Project
  
  // Sample boundaries
  startTime: number;             // Start in seconds
  endTime: number;               // End in seconds
  duration: number;              // Computed: endTime - startTime
  
  // Loop information
  loopStartTime?: number;        // If different from sample start
  loopEndTime?: number;          // If different from sample end
  isLooped: boolean;
  
  // Metadata
  name: string;                  // User-provided name
  description?: string;
  tags?: string[];
  
  // Analysis
  detectedBPM?: number;          // BPM of this sample
  key?: string;
  
  // State
  createdAt: number;
  updatedAt: number;
  exportedAt?: number;           // Track exports
  exportPath?: string;           // Where it was last exported
}

// Indexes:
// - sourceId (fetch samples for a source)
// - projectId (fetch all samples in project)
// - createdAt (sort chronologically)
```

#### 4. **CacheMetadata** (Housekeeping)
```typescript
interface CacheMetadata {
  id: string;                    // Always 'cache_metadata'
  lastCleanupAt: number;
  totalCacheSize: number;
  versionInfo: {
    schemaVersion: number;       // For migrations
    appVersion: string;
  }
}
```

## State Management Architecture

### Frontend State

```typescript
// App-level state (consider Zustand or Redux)
interface AppState {
  // Active context
  currentProjectId?: string;
  currentSourceId?: string;
  
  // UI state
  isLoading: boolean;
  isExtracting: boolean;
  extractionProgress: number;    // 0-100
  error?: string;
  
  // Data
  projects: Project[];
  recentProjects: Project[];     // Last 5
  currentSource?: AudioSource;
  currentSamples: Sample[];
}

// Actions:
// - loadProjects()
// - createProject(name)
// - deleteProject(id)
// - setCurrentProject(id)
// - addSourceToProject(projectId, url)
// - extractAudio(url) - with progress
// - cacheLookup(url) - check if already extracted
// - createSample(startTime, endTime)
// - updateSample(id, updates)
// - deleteSample(id)
// - exportSample(sampleId, filePath)
```

## User Flow Details

### 1. App Launch

**Goals:**
- Restore recent projects instantly
- Check for cache cleanup needs
- Validate cached audio integrity

**Implementation:**
```typescript
async function initializeApp() {
  // 1. Load recent projects (limit 5)
  const recentProjects = await db.projects
    .orderBy('updatedAt')
    .reverse()
    .limit(5)
    .toArray();
  
  // 2. Check cache size and health
  const metadata = await getCacheMetadata();
  if (shouldCleanupCache(metadata)) {
    await performCacheCleanup();
  }
  
  // 3. Validate audio integrity (sample check)
  await validateCacheIntegrity();
  
  setAppState({ projects: recentProjects, isReady: true });
}
```

### 2. URL Paste & Duplicate Detection

**Goals:**
- Prevent duplicate extractions
- Detect already-cached audio
- Provide fast experience for re-using sources

**Implementation:**
```typescript
async function handleUrlPaste(url: string) {
  // 1. Normalize URL
  const normalized = normalizeYouTubeURL(url);
  
  // 2. Check if already in any project
  const existingSource = await db.sources
    .where('url')
    .equals(normalized)
    .first();
  
  if (existingSource) {
    // Source already cached!
    // Show option to reuse or import to current project
    return showCacheHitUI(existingSource);
  }
  
  // 3. If not cached, trigger extraction
  startAudioExtraction(normalized);
}
```

**Cache Hit UI:**
- "Found cached audio from [date]"
- Option to "Use cached version" or "Re-extract"
- Show audio preview instantly if cached

### 3. Audio Extraction with Progress

**Goals:**
- Show real-time progress to user
- Handle errors gracefully
- Store audio efficiently

**Implementation:**
```typescript
async function extractAudio(url: string) {
  setLoading(true);
  setProgress(0);
  
  try {
    // 1. Fetch metadata (10% progress)
    const metadata = await fetchYouTubeMetadata(url);
    setProgress(10);
    
    // 2. Ensure yt-dlp binary (20%)
    const binaryPath = await ensureYtDlpBinary();
    setProgress(20);
    
    // 3. Extract audio (60-90%)
    const audioBuffer = await extractAudioStream(url, (progress) => {
      setProgress(20 + progress * 0.7); // Scale to 20-90%
    });
    
    // 4. Analyze audio (90-95%)
    const analysisData = await analyzeAudio(audioBuffer);
    setProgress(95);
    
    // 5. Store in IndexedDB (95-100%)
    const sourceId = await storeAudioSource({
      url,
      audioBuffer,
      metadata,
      analysisData,
      projectId: currentProjectId,
    });
    setProgress(100);
    
    // 6. Transition to waveform view
    setCurrentSource(sourceId);
    
  } catch (error) {
    handleExtractionError(error);
  } finally {
    setLoading(false);
  }
}
```

### 4. Sample Creation & Storage

**Goals:**
- Create samples with metadata
- Instantly reflect in UI
- Enable bulk operations

**Implementation:**
```typescript
async function createSample(
  sourceId: string,
  startTime: number,
  endTime: number
) {
  // Generate deterministic name if not provided
  const name = `Sample_${Math.floor(startTime)}-${Math.floor(endTime)}`;
  
  const sample: Sample = {
    id: generateUUID(),
    sourceId,
    projectId: currentProjectId,
    startTime,
    endTime,
    duration: endTime - startTime,
    name,
    isLooped: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  // Store in IndexedDB
  await db.samples.add(sample);
  
  // Update local state
  setCurrentSamples([...currentSamples, sample]);
}
```

### 5. Export Flow

**Goals:**
- Use native file dialogs
- Support batch exports
- Remember export locations

**Implementation:**
```typescript
async function exportSample(sampleId: string) {
  const sample = currentSamples.find(s => s.id === sampleId);
  if (!sample) return;
  
  // 1. Get source audio
  const source = await db.sources.get(sample.sourceId);
  
  // 2. Extract sample region
  const sampleBuffer = extractAudioRegion(
    source.audioBuffer,
    sample.startTime,
    sample.endTime
  );
  
  // 3. Encode to desired format
  const encoded = await encodeAudio(sampleBuffer, {
    format: 'wav',
    sampleRate: source.sampleRate,
  });
  
  // 4. Open native save dialog
  const path = await tauri.dialog.save({
    defaultPath: `${sample.name}.wav`,
  });
  
  if (path) {
    // 5. Write file
    await tauri.fs.writeBinaryFile(path, encoded);
    
    // 6. Update sample metadata
    await db.samples.update(sampleId, {
      exportedAt: Date.now(),
      exportPath: path,
    });
  }
}
```

## Caching Strategy

### Cache Cleanup Triggers

1. **On App Launch:**
   - Check if last cleanup > 7 days ago
   - If yes, run cleanup

2. **On Source Deletion:**
   - Remove audio data if no other projects use it
   - Update cache metadata

3. **On Project Deletion:**
   - Check if any sources are orphaned
   - Remove orphaned audio

### Cleanup Algorithm

```typescript
async function performCacheCleanup() {
  // 1. Find all orphaned sources (not in any project)
  const allSources = await db.sources.toArray();
  const orphaned = await findOrphanedSources(allSources);
  
  // 2. Find unused sources (not accessed in 30 days)
  const unused = orphaned.filter(
    s => Date.now() - s.cachedAt > 30 * 24 * 60 * 60 * 1000
  );
  
  // 3. Delete unused
  for (const source of unused) {
    await db.sources.delete(source.id);
    cacheSize -= source.audioBuffer.byteLength;
  }
  
  // 4. Update metadata
  await updateCacheMetadata({
    lastCleanupAt: Date.now(),
    totalCacheSize: cacheSize,
  });
}
```

### Cache Size Management

**Limits:**
- Max cache size: 2GB (configurable)
- When exceeded: Remove oldest unused sources until under limit
- User notification when cache > 80%

**Compression:**
- Store audio as compressed formats in IndexedDB if possible
- Keep lossless for high-quality exports
- Consider FLAC or ALAC for compression

## Project Migration & Versioning

### Schema Migrations

```typescript
const migrations = {
  1: (old) => ({
    ...old,
    // Initial schema
  }),
  2: (old) => ({
    ...old,
    // Added sample.loopStartTime, loopEndTime
  }),
  3: (old) => ({
    ...old,
    // Added source.md5Hash for dedup
  }),
};

async function runMigrations() {
  const metadata = await getCacheMetadata();
  const currentVersion = metadata.versionInfo.schemaVersion;
  
  for (let v = currentVersion + 1; v <= LATEST_VERSION; v++) {
    const migration = migrations[v];
    if (migration) {
      // Apply migration to all affected data
      console.log(`Running migration ${v}...`);
    }
  }
}
```

## Error Recovery

### Audio Extraction Failures

**Strategies:**
1. Auto-retry with exponential backoff (up to 3x)
2. Show clear error message with recovery options
3. Log error for debugging
4. Allow manual retry or skip

### Cache Corruption

**Detection:**
- MD5 hash mismatch on load
- Audio buffer length mismatch

**Recovery:**
- Re-extract from source if possible
- Show user notification
- Remove corrupted cache entry

### State Inconsistency

**Prevention:**
- Use transactions for multi-step operations
- Validate referential integrity
- Periodic validation on app launch

## Implementation Checklist

### Phase 1: Data Model & Storage
- [ ] Design final IndexedDB schema
- [ ] Implement database initialization
- [ ] Create migration system
- [ ] Add cache metadata tracking

### Phase 2: Core Flow
- [ ] Implement duplicate URL detection
- [ ] Add cache lookup before extraction
- [ ] Build extraction progress tracking
- [ ] Implement sample creation & storage

### Phase 3: Cleanup & Optimization
- [ ] Implement cache cleanup algorithm
- [ ] Add cache size monitoring
- [ ] Build orphan detection
- [ ] Compress audio in storage

### Phase 4: UI/UX Polish
- [ ] Show cache hit feedback
- [ ] Display extraction progress
- [ ] Cache management UI
- [ ] Project organization UI

### Phase 5: Error Handling & Recovery
- [ ] Implement retry logic
- [ ] Add corruption detection
- [ ] Error logging & reporting
- [ ] User-friendly error messages

## Performance Targets

- **App Launch:** < 1 second
- **Cache Hit (URL already extracted):** < 500ms
- **Audio Extraction:** 30-120s (varies by video length)
- **Sample Creation:** < 50ms
- **Waveform Render:** < 200ms
- **Export:** < 10s (for typical sample)

## References

- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Dexie.js](https://dexie.org/) - IndexedDB wrapper
- [Cache Invalidation Patterns](https://en.wikipedia.org/wiki/Cache_invalidation)
- [Audio Codec Comparison](https://en.wikipedia.org/wiki/Audio_codec)
