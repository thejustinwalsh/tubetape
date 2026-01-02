---
applyTo: "**"
---

# Code Review Instructions

You are reviewing a Tauri v2 desktop app with React 19 + TypeScript frontend and Rust backend. Focus on issues that matter.

## Review Philosophy

**DO flag:** Bugs, race conditions, memory leaks, security issues, correctness problems, performance regressions.

**DO NOT flag:** Style preferences, missing comments, import ordering, naming suggestions, or any "consider adding" improvements.

## Critical Issues to Flag

### TypeScript/React

**Type Safety Violations**
- `as any`, `@ts-ignore`, `@ts-expect-error` - these hide real bugs
- Non-null assertions (`!`) without prior null check
- Unchecked `.data` access on potentially failed API responses

**React Anti-patterns**
- Missing dependency in `useEffect`/`useCallback`/`useMemo` that causes stale closures
- State updates on unmounted components (missing cleanup)
- Mutating state directly instead of using setter
- Infinite render loops from bad dependency arrays

**Async/Concurrency**
- Missing `await` on async operations
- Race conditions: multiple async calls without cancellation handling
- Unhandled promise rejections (missing `.catch()` or try/catch)
- `invoke()` calls to Rust without error handling

**Error Handling**
- Empty catch blocks `catch(e) {}`
- Swallowed errors without logging or user feedback
- Missing error boundaries for component trees

### Rust (Tauri Backend)

**Memory & Safety**
- `unwrap()` or `expect()` in Tauri commands (should return `Result`)
- Unbounded allocations from user input
- Missing input validation on command parameters

**Concurrency**
- Potential deadlocks with multiple mutex locks
- Missing `Send + Sync` bounds where needed
- Blocking the main thread with synchronous I/O

### Performance (Flag Only If Obvious)

- Creating objects/arrays inside render without memoization when passed as props
- `useEffect` running on every render due to object/array dependency
- Large data structures copied on each state update
- Synchronous operations blocking UI (file I/O, heavy computation)
- Missing cleanup causing memory leaks (intervals, subscriptions, event listeners)

## Comments Policy

**Ignore:** Missing comments, unclear code that "could use a comment"

**Flag only:** Comments that are now incorrect/misleading after the code change. Stale comments cause bugs.

## Response Format

Be direct. One sentence per issue. Include line reference.

**Good:** "`await` missing on `invoke()` - errors will be unhandled."

**Bad:** "Consider adding await here for better error handling. This would help ensure that any errors thrown by the invoke function are properly caught and handled by the surrounding try-catch block, which would improve the robustness of the code."
