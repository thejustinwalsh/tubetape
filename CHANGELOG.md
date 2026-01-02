## [0.2.0] - 2026-01-02

### 🚀 Features

- Add Deno setup script and integrate with Tauri
- Adds unit tests for hooks and utils, adds ladle stories for components and visual testing with playwright
- Refines region logic and adds zoom with slider (#4)
- React-compiler (#5)

### 🐛 Bug Fixes

- Improve yt-dlp failures and add logging
- Ensure sample-accurate looping in playRegion method
- Missed db move update
- Add visual test snapshots

### 🚜 Refactor

- Scripts to build quickjs and bundle (#11)

### ⚙️ Miscellaneous Tasks

- Add git-cliff configuration for changelog generation
- Ci
- Fix test runner
- Remove outdated snapshot images and update Playwright config for snapshot paths
- Add code review instructions
- Add stage release workflow and semantic-release configuration (#6)
- Bump node for release
- Add conventional changelog support to semantic-release
- Enhance semantic-release configuration for version tagging and improve tag fetching
- Replace yq with dasel for version updates in Cargo.toml
- Update dasel command to use 'dasel version' for version check
- Dasel update for release staging
- Update version setting in Cargo.toml to use dasel
- Update version handling in tauri.conf.json and Cargo.toml using dasel
- Update release branch naming to use 'staging' instead of 'release'
- Improve version handling in stage-release workflow and update PR creation to draft
- Update release workflow to improve version tagging and streamline release branch handling
- Add script to determine next release version based on conventional commits
- Add cwd context to analyzeCommits function for improved path handling
- Update analyzeCommits integration to use conventional changelog preset for improved version bumping
- Cleanup version output
- Simplify dasel commands in version determination step
- Update release branch naming to include current version for clarity
- Replace dasel with jq for JSON parsing in version determination step
