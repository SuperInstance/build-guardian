# @superinstance/build-guardian

**Build Budget Guardian** — tracks build resource usage, enforces budgets, detects bloat trends, and integrates with any JS/TS bundler and CI pipeline.

[![npm version](https://img.shields.io/npm/v/@superinstance/build-guardian.svg)](https://www.npmjs.com/package/@superinstance/build-guardian)
[![CI](https://github.com/SuperInstance/build-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/SuperInstance/build-guardian/actions/workflows/ci.yml)

## Why?

Builds grow. Bundles bloat. Nobody notices until it's too late. Build Guardian watches your build output over time and tells you when things are getting out of hand — before your users notice.

## Features

- **Multi-bundler support** — Webpack (multi-compiler, code-split, lazy routes), Vite/Rollup, esbuild
- **Budget enforcement** — Set size, time, and memory limits per entry
- **Bloat detection** — Automatic alerts when entries grow beyond threshold
- **Configurable alerting rules** — Fail CI on growth, warn on total size, detect consecutive growth
- **Trend analysis** — Linear regression on per-entry sizes over time
- **Persistence** — Save/load build history to JSON, track per-route size over time
- **4 export formats** — Markdown, Prometheus/Grafana, Slack blocks, GitHub PR comments
- **Conservation scores** — Prioritize optimization targets by size × frequency × complexity
- **Zero dependencies** — Pure TypeScript, no runtime deps

## Install

```bash
npm install @superinstance/build-guardian
```

## Quick Start

```typescript
import { BuildBudget } from '@superinstance/build-guardian';

const budget = new BuildBudget({ bloatThreshold: 0.20 });

// Set budgets
budget.addBudget({ entry: 'dashboard', maxSizeBytes: 100 * 1024 });
budget.addBudget({ entry: 'admin/*', maxSizeBytes: 250 * 1024 });

// Record entries from your build
budget.recordEntry({
  entry: 'dashboard',
  buildTimeMs: 1200,
  sizeBytes: 78 * 1024,
  memoryPeakBytes: 150 * 1024 * 1024,
  modules: [
    { name: './Dashboard.tsx', sizeBytes: 15000 },
    { name: 'd3-full', sizeBytes: 45000 },
    { name: 'moment', sizeBytes: 18000 },
  ],
  timestamp: Date.now(),
});

// Finalize and get report
const report = budget.finalizeBuild();
console.log(report.totalSizeBytes);   // 78 * 1024
console.log(report.alerts.length);    // 0 (first build, no history)
console.log(report.violations.length); // 0 (within budget)
```

## API Reference

### `BuildBudget`

Main class for tracking build metrics.

```typescript
const budget = new BuildBudget({ bloatThreshold: 0.20 });
```

#### Methods

| Method | Description |
|--------|-------------|
| `recordEntry(metrics)` | Record metrics for a single entry |
| `finalizeBuild(label?)` | Finalize build, run detection, return `BuildReport` |
| `addBudget(budget)` | Add an entry budget |
| `setBudgets(budgets)` | Replace all budgets |
| `addAlertRule(rule)` | Add an alert rule |
| `setAlertRules(rules)` | Replace all alert rules |
| `setFrequencyEstimates(estimates)` | Set usage frequency per entry |
| `compareEntry(entry)` | Get human-readable comparison text |
| `loadHistory(pm)` | Load persisted history |
| `saveHistory(pm)` | Save history to persistence |
| `getHistory()` | Get build history |
| `setHistory(history)` | Set history (e.g. from persistence) |
| `reset()` | Clear current metrics for new build cycle |

### Entry Metrics

```typescript
interface EntryMetrics {
  entry: string;           // Entry name (e.g. "dashboard")
  buildTimeMs: number;     // Build time in milliseconds
  sizeBytes: number;       // Output size in bytes
  memoryPeakBytes: number; // Peak memory in bytes
  modules?: ModuleEntry[]; // Per-module breakdown
  timestamp: number;       // Measurement timestamp
  route?: string;          // Route path for code-split entries
  isLazy?: boolean;        // Is this lazy-loaded?
  chunkType?: 'entry' | 'chunk' | 'initial';
  hash?: string;           // Chunk hash
}
```

### Alert Rules

```typescript
import { presetRules } from '@superinstance/build-guardian';

budget.setAlertRules([
  presetRules.failOnLargeGrowth(),       // Fail if any route grows > 20%
  presetRules.warnTotalBundle500kb(),    // Warn if total > 500KB
  presetRules.failEntrySize250kb(),      // Fail if any entry > 250KB
  presetRules.warnBuildTime60s(),        // Warn if build > 60s
  presetRules.warnConsecutiveGrowth(),   // Warn on 3+ consecutive growth builds
]);
```

Custom rules:

```typescript
budget.addAlertRule({
  name: 'admin-size',
  type: 'max-entry-size',
  threshold: 100 * 1024,
  severity: 'fail',
  entryPattern: 'admin/*',  // glob pattern
});
```

Rule types: `max-growth`, `max-total-size`, `max-entry-size`, `max-build-time`, `consecutive-growth`.

### Bundler Adapters

#### Webpack

```typescript
import { analyzeWebpackStats } from '@superinstance/build-guardian';

// Works with stats.toJson() or raw stats JSON
const analyses = analyzeWebpackStats(stats.toJson());

// Multi-compiler support
const analyses = analyzeWebpackStats([clientStats, serverStats]);
```

Supports: multi-compiler, code-split chunks, lazy-loaded routes, parent/child chunks, `chunksByEntryPoint`.

#### Vite / Rollup

```typescript
import { analyzeViteOutput } from '@superinstance/build-guardian';

const result = await viteBuild();
const analyses = analyzeViteOutput(result);
```

#### esbuild

```typescript
import { analyzeEsbuildMetafile } from '@superinstance/build-guardian';

const analyses = analyzeEsbuildMetafile(metafile);
```

### Export Formats

```typescript
import { toMarkdown, toPrometheus, toSlack, toGitHubComment } from '@superinstance/build-guardian';

const report = budget.finalizeBuild();

// Markdown report
console.log(toMarkdown(report));

// Prometheus metrics for Grafana
fs.writeFileSync('/metrics/build-guardian.txt', toPrometheus(report));

// Slack Block Kit for CI notifications
const blocks = toSlack(report);
await slackClient.chat.postMessage({ channel: '#builds', blocks });

// GitHub PR comment
const comment = toGitHubComment(report);
await octokit.issues.createComment({ owner, repo, issue_number: pr, body: comment });
```

### Persistence

```typescript
import { PersistenceManager } from '@superinstance/build-guardian';

const pm = new PersistenceManager({
  filePath: './build-history.json',
  maxHistoryEntries: 100,
});

// Load history before recording
await budget.loadHistory(pm);

// ... record entries and finalize ...

// Save after finalizing
await budget.saveHistory(pm);

// Get per-route size history over time
const routeHistory = await pm.getRouteSizeHistory();
```

### Trend Analysis

```typescript
import { analyzeTrends } from '@superinstance/build-guardian';

// Automatically computed during finalizeBuild()
const report = budget.finalizeBuild();

for (const trend of report.trends) {
  console.log(`${trend.entry}: ${trend.direction}`);
  console.log(`  Slope: ${trend.slope} bytes/build`);
  console.log(`  ${trend.summary}`);
}
```

### Conservation Scores

Prioritize optimization targets by composite score (size × frequency × complexity):

```typescript
budget.setFrequencyEstimates(new Map([
  ['home', 50000],       // Very popular
  ['admin', 100],        // Rarely used
]));

const report = budget.finalizeBuild();
// report.scores sorted by score descending
```

## Integration Examples

### Webpack Plugin

```typescript
// webpack.config.ts
import { BuildGuardianWebpackPlugin } from '@superinstance/build-guardian/examples/webpack-plugin';

export default {
  plugins: [
    new BuildGuardianWebpackPlugin({
      budgets: [{ entry: 'main', maxSizeBytes: 250 * 1024 }],
      persist: true,
      failOnError: true,
    }),
  ],
};
```

### Vite Plugin

```typescript
// vite.config.ts
import { buildGuardianVitePlugin } from '@superinstance/build-guardian/examples/vite-plugin';

export default defineConfig({
  plugins: [buildGuardianVitePlugin({ persist: true })],
});
```

### GitHub Actions

See `.github/workflows/ci.yml` for the full CI workflow. The key integration:

```typescript
import { BuildBudget, toGitHubComment, presetRules } from '@superinstance/build-guardian';

// ... after build ...
const report = budget.finalizeBuild();
const comment = toGitHubComment(report);
await octokit.issues.createComment({ ... });
```

### CLI

```bash
npx ts-node examples/cli-usage.ts --stats ./build-stats.json --format prometheus --fail-on-violation
```

## Architecture

```
src/
├── types.ts              # Shared types and utilities
├── budget.ts             # BuildBudget class (core)
├── analyzer.ts           # Webpack & esbuild analyzers
├── reporter.ts           # Markdown report generation
├── alerting.ts           # Configurable alert rules
├── trends.ts             # Trend analysis (linear regression)
├── persistence.ts        # JSON file persistence
├── adapters/
│   └── vite-rollup.ts    # Vite & Rollup adapters
├── export/
│   ├── prometheus.ts     # Prometheus text format
│   ├── slack.ts          # Slack Block Kit
│   ├── markdown.ts       # Refined markdown
│   └── github-comment.ts # GitHub PR comments
└── __tests__/
    └── guardian.test.ts  # 55 tests
```

## Plugins Guide

Build Guardian is designed to be extensible. The `BuildBudget` class is the core; adapters feed it data, and export formats read its reports.

To create a new adapter:

1. Create a function that takes your bundler's output
2. Return `ChunkAnalysis[]` (see `analyzer.ts`)
3. Convert each `ChunkAnalysis` to `EntryMetrics` and call `budget.recordEntry()`

To create a new export format:

1. Create a function that takes a `BuildReport`
2. Return your desired format (string, object, etc.)
3. See existing exports in `src/export/` for patterns

## License

MIT © [SuperInstance](https://github.com/SuperInstance)
