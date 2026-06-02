# Changelog

All notable changes to `@superinstance/build-guardian` will be documented in this file.

## [0.2.0] — 2026-06-02

### Added

- **Webpack full stats adapter** — Multi-compiler support, code-split chunks, lazy-loaded routes, parent/child relationships, `chunksByEntryPoint`
- **Vite/Rollup adapter** — Parse Vite build output and Rollup plugin metadata
- **Persistence** — `PersistenceManager` class to save/load build history to JSON, per-route size history tracking
- **Export formats**:
  - `toPrometheus()` — Prometheus text-format metrics for Grafana
  - `toSlack()` — Slack Block Kit blocks for CI notifications
  - `toMarkdown()` — Refined markdown report format
  - `toGitHubComment()` — GitHub PR comment with collapsible sections
- **Configurable alerting** — `AlertRule` system with 5 rule types: `max-growth`, `max-total-size`, `max-entry-size`, `max-build-time`, `consecutive-growth`. Includes preset rules for common CI scenarios.
- **Trend analysis** — Linear regression on per-entry sizes over time, consecutive growth detection, human-readable trend summaries
- **Integration examples**:
  - `examples/webpack-plugin.ts` — Webpack plugin
  - `examples/vite-plugin.ts` — Vite plugin
  - `examples/github-action.ts` — CI integration
  - `examples/cli-usage.ts` — CLI usage
- **GitHub Actions CI** — Test on Node 18/20/22, type-check, build
- **Full documentation** — README with complete API reference, architecture, and plugins guide
- `BuildBudget.reset()` — Clear current metrics for a new build cycle
- `BuildBudget.setHistory()` — Load history without async persistence
- 55 comprehensive tests covering all features

### Changed

- Moved shared types to `src/types.ts` for cleaner imports
- `BuildBudget` class extracted to `src/budget.ts`
- `ChunkAnalysis` interface extended with `chunkType`, `hash`, `entryOrigin`, `children`, `moduleIds`
- `EntryMetrics` extended with `route`, `isLazy`, `chunkType`, `hash`
- `BuildReport` now includes `ruleAlerts` and `trends`
- `finalizeBuild()` accepts optional `label` parameter

## [0.1.0] — 2026-06-02

### Added

- Initial release
- Core `BuildBudget` class with entry recording, bloat detection, budget enforcement
- Conservation scores (size × frequency × complexity)
- Basic Webpack stats and esbuild metafile analyzers
- Markdown report generation
- Jest test suite (30 tests)
