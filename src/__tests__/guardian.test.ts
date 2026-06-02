import {
  BuildBudget,
  type EntryMetrics,
  type AlertRule,
} from '../index';
import { analyzeWebpackStats, analyzeEsbuildMetafile, normalizeEntryName, isThirdParty, getTopModules } from '../analyzer';
import { analyzeViteOutput, analyzeRollupOutput } from '../adapters/vite-rollup';
import { generateReport, generateSummary } from '../reporter';
import { toPrometheus } from '../export/prometheus';
import { toSlack } from '../export/slack';
import { toMarkdown } from '../export/markdown';
import { toGitHubComment } from '../export/github-comment';
import { PersistenceManager } from '../persistence';
import { analyzeTrends } from '../trends';
import { evaluateAlertRules, presetRules } from '../alerting';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<EntryMetrics> & { entry: string }): EntryMetrics {
  return {
    buildTimeMs: 1000,
    sizeBytes: 50 * 1024,
    memoryPeakBytes: 100 * 1024 * 1024,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BuildBudget — recording & finalizing
// ---------------------------------------------------------------------------

describe('BuildBudget', () => {
  it('records entries and finalizes a build', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'home' }));
    budget.recordEntry(makeEntry({ entry: 'about' }));

    const report = budget.finalizeBuild();
    expect(report.totalEntries).toBe(2);
    expect(report.entryMetrics).toHaveLength(2);
    expect(report.totalBuildTimeMs).toBe(2000);
    expect(report.ruleAlerts).toBeDefined();
    expect(report.trends).toBeDefined();
  });

  it('tracks history across multiple builds', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'a' }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({ entry: 'a', sizeBytes: 60 * 1024 }));
    budget.finalizeBuild();

    expect(budget.getHistory().length).toBe(2);
  });

  it('supports reset to start a new build cycle', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'a' }));
    budget.finalizeBuild();

    budget.reset();
    budget.recordEntry(makeEntry({ entry: 'b' }));
    const report = budget.finalizeBuild();

    expect(report.totalEntries).toBe(1);
    expect(report.entryMetrics[0].entry).toBe('b');
  });

  it('supports setHistory for loading persisted data', () => {
    const budget = new BuildBudget();
    budget.setHistory([
      { timestamp: Date.now() - 10000, metrics: [makeEntry({ entry: 'old' })] },
    ]);

    expect(budget.getHistory().length).toBe(1);
    budget.recordEntry(makeEntry({ entry: 'new', sizeBytes: 60 * 1024 }));
    const report = budget.finalizeBuild();
    expect(report.totalEntries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bloat detection
// ---------------------------------------------------------------------------

describe('bloat detection', () => {
  it('detects entries that grew > 20%', () => {
    const budget = new BuildBudget({ bloatThreshold: 0.20 });

    budget.recordEntry(makeEntry({
      entry: 'dashboard',
      sizeBytes: 42 * 1024,
      modules: [{ name: './Dashboard.tsx', sizeBytes: 42 * 1024 }],
    }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({
      entry: 'dashboard',
      sizeBytes: 78 * 1024,
      modules: [
        { name: './Dashboard.tsx', sizeBytes: 15 * 1024 },
        { name: 'd3-full', sizeBytes: 45 * 1024 },
        { name: 'moment', sizeBytes: 18 * 1024 },
      ],
    }));
    const report = budget.finalizeBuild();

    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0].entry).toBe('dashboard');
    expect(report.alerts[0].growthPercent).toBeCloseTo(0.857, 1);
    expect(report.alerts[0].addedDependencies).toContain('d3-full');
    expect(report.alerts[0].addedDependencies).toContain('moment');
    expect(report.alerts[0].severity).toBe('critical');
  });

  it('does not alert for entries under threshold', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 100 }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 115 }));
    const report = budget.finalizeBuild();

    expect(report.alerts).toHaveLength(0);
  });

  it('returns empty alerts on first build (no history)', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'a' }));
    const report = budget.finalizeBuild();
    expect(report.alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

describe('budget enforcement', () => {
  it('violates when entry exceeds size budget', () => {
    const budget = new BuildBudget();
    budget.addBudget({ entry: 'heavy', maxSizeBytes: 10 * 1024 });
    budget.recordEntry(makeEntry({ entry: 'heavy', sizeBytes: 50 * 1024 }));

    const report = budget.finalizeBuild();
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].reason).toContain('exceeds budget');
  });

  it('violates on build time budget', () => {
    const budget = new BuildBudget();
    budget.addBudget({ entry: 'slow', maxSizeBytes: Infinity, maxBuildTimeMs: 500 });
    budget.recordEntry(makeEntry({ entry: 'slow', buildTimeMs: 2000 }));

    const report = budget.finalizeBuild();
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].reason).toContain('Build time');
  });

  it('violates on memory budget', () => {
    const budget = new BuildBudget();
    budget.addBudget({
      entry: 'memoryhog',
      maxSizeBytes: Infinity,
      maxMemoryBytes: 50 * 1024 * 1024,
    });
    budget.recordEntry(makeEntry({ entry: 'memoryhog', memoryPeakBytes: 200 * 1024 * 1024 }));

    const report = budget.finalizeBuild();
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].reason).toContain('Memory');
  });

  it('supports glob patterns for entry matching', () => {
    const budget = new BuildBudget();
    budget.addBudget({ entry: 'admin/*', maxSizeBytes: 10 * 1024 });
    budget.recordEntry(makeEntry({ entry: 'admin/settings', sizeBytes: 50 * 1024 }));

    const report = budget.finalizeBuild();
    expect(report.violations).toHaveLength(1);
  });

  it('no violations when within budget', () => {
    const budget = new BuildBudget();
    budget.addBudget({ entry: 'fine', maxSizeBytes: 100 * 1024 });
    budget.recordEntry(makeEntry({ entry: 'fine', sizeBytes: 50 * 1024 }));

    const report = budget.finalizeBuild();
    expect(report.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Conservation scores
// ---------------------------------------------------------------------------

describe('conservation scores', () => {
  it('ranks entries by composite score', () => {
    const budget = new BuildBudget();
    budget.setFrequencyEstimates(new Map([
      ['popular', 10000],
      ['obscure', 10],
    ]));

    budget.recordEntry(makeEntry({
      entry: 'popular',
      sizeBytes: 100 * 1024,
      modules: [{ name: 'a', sizeBytes: 50 * 1024 }, { name: 'b', sizeBytes: 50 * 1024 }],
    }));
    budget.recordEntry(makeEntry({
      entry: 'obscure',
      sizeBytes: 200 * 1024,
      modules: [{ name: 'c', sizeBytes: 200 * 1024 }],
    }));

    const report = budget.finalizeBuild();
    expect(report.scores[0].entry).toBe('popular');
  });

  it('returns empty scores when no entries recorded', () => {
    const budget = new BuildBudget();
    const report = budget.finalizeBuild();
    expect(report.scores).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// compareEntry
// ---------------------------------------------------------------------------

describe('compareEntry', () => {
  it('generates human-readable comparison text', () => {
    const budget = new BuildBudget();

    budget.recordEntry(makeEntry({
      entry: 'dashboard',
      sizeBytes: 42 * 1024,
      modules: [{ name: './Dashboard.tsx', sizeBytes: 42 * 1024 }],
    }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({
      entry: 'dashboard',
      sizeBytes: 78 * 1024,
      modules: [
        { name: './Dashboard.tsx', sizeBytes: 15 * 1024 },
        { name: 'd3-full', sizeBytes: 45 * 1024 },
        { name: 'moment', sizeBytes: 18 * 1024 },
      ],
    }));

    const comparison = budget.compareEntry('dashboard');
    expect(comparison).toContain('grew from');
    expect(comparison).toContain('+86%');
    expect(comparison).toContain('d3-full');
    expect(comparison).toContain('moment');
  });

  it('returns null on first build', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'x' }));
    expect(budget.compareEntry('x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Analyzer (Webpack — enhanced)
// ---------------------------------------------------------------------------

describe('analyzeWebpackStats', () => {
  it('extracts chunk analyses from stats', () => {
    const stats = {
      chunks: [
        { id: 0, names: ['dashboard'], size: 78000 },
        { id: 1, names: ['index'], size: 15000 },
      ],
      modules: [
        { name: './Dashboard.tsx', size: 15000, chunks: [0] },
        { name: 'node_modules/d3-full/index.js', size: 45000, chunks: [0] },
        { name: './Home.tsx', size: 15000, chunks: [1] },
      ],
      assets: [
        { name: 'static/dashboard.js', chunks: [0], size: 78000 },
        { name: 'static/index.js', chunks: [1], size: 15000 },
      ],
    };

    const analyses = analyzeWebpackStats(stats);
    expect(analyses).toHaveLength(2);

    const dashboard = analyses.find((a) => a.name === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.modules).toHaveLength(2);
    expect(dashboard!.assetFile).toBe('static/dashboard.js');
  });

  it('handles concatenated modules', () => {
    const stats = {
      chunks: [{ id: 0, names: ['test'], size: 5000 }],
      modules: [{
        name: './concatenated',
        size: 5000,
        chunks: [0],
        modules: [
          { name: './a.tsx', size: 3000 },
          { name: './b.tsx', size: 2000 },
        ],
      }],
    };

    const analyses = analyzeWebpackStats(stats);
    expect(analyses[0].modules).toHaveLength(2);
  });

  it('handles multi-compiler output (array of stats)', () => {
    const stats1 = {
      chunks: [{ id: 0, names: ['client'], size: 50000 }],
      modules: [{ name: './Client.tsx', size: 50000, chunks: [0] }],
    };
    const stats2 = {
      chunks: [{ id: 0, names: ['server'], size: 30000 }],
      modules: [{ name: './Server.tsx', size: 30000, chunks: [0] }],
    };

    const analyses = analyzeWebpackStats([stats1, stats2]);
    expect(analyses).toHaveLength(2);
    expect(analyses.find((a) => a.name === 'client')).toBeDefined();
    expect(analyses.find((a) => a.name === 'server')).toBeDefined();
  });

  it('detects lazy-loaded chunks', () => {
    const stats = {
      chunks: [
        { id: 0, names: ['main'], size: 30000, initial: true },
        { id: 1, names: ['admin-lazy'], size: 20000, initial: false, rendered: false },
      ],
      modules: [
        { name: './Main.tsx', size: 30000, chunks: [0] },
        { name: './Admin.tsx', size: 20000, chunks: [1] },
      ],
    };

    const analyses = analyzeWebpackStats(stats);
    const lazy = analyses.find((a) => a.name === 'admin-lazy');
    expect(lazy).toBeDefined();
    expect(lazy!.isLazy).toBe(true);

    const main = analyses.find((a) => a.name === 'main');
    expect(main!.isLazy).toBeFalsy();
  });

  it('handles code-split chunks with parent info', () => {
    const stats = {
      chunks: [
        { id: 0, names: ['app'], size: 30000, children: [1] },
        { id: 1, names: ['vendors'], size: 50000, parents: [0] },
      ],
      modules: [
        { name: './App.tsx', size: 30000, chunks: [0] },
        { name: 'react', size: 50000, chunks: [1] },
      ],
    };

    const analyses = analyzeWebpackStats(stats);
    const vendors = analyses.find((a) => a.name === 'vendors');
    expect(vendors).toBeDefined();
    expect(vendors!.parents).toContain(0);
  });

  it('handles chunksByEntryPoint', () => {
    const stats = {
      chunks: [
        { id: 0, names: ['main'], size: 30000 },
        { id: 1, names: ['chunk-1'], size: 10000 },
      ],
      modules: [
        { name: './Main.tsx', size: 30000, chunks: [0] },
        { name: './Utils.ts', size: 10000, chunks: [1] },
      ],
      chunksByEntryPoint: { main: [0, 1] },
    };

    const analyses = analyzeWebpackStats(stats);
    expect(analyses.every((a) => a.entryOrigin === 'main')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vite adapter
// ---------------------------------------------------------------------------

describe('analyzeViteOutput', () => {
  it('parses Vite build output chunks', () => {
    const output: import('../adapters/vite-rollup').ViteBuildOutput = {
      output: [
        {
          type: 'chunk',
          fileName: 'assets/index-abc123.js',
          name: 'index',
          isEntry: true,
          facadeModuleId: '/src/main.ts',
          modules: {
            '/src/main.ts': { renderedLength: 5000, originalLength: 6000 },
            '/src/App.vue': { renderedLength: 3000, originalLength: 4000 },
          },
          code: 'console.log("hello")',
        },
        {
          type: 'chunk',
          fileName: 'assets/admin-def456.js',
          name: 'admin',
          isDynamicEntry: true,
          modules: {
            '/src/pages/Admin.vue': { renderedLength: 8000, originalLength: 10000 },
          },
        },
        {
          type: 'asset',
          fileName: 'assets/logo.png',
        },
      ],
    };

    const analyses = analyzeViteOutput(output);
    // Only chunks, not assets
    expect(analyses).toHaveLength(2);

    const index = analyses.find((a) => a.name === 'index');
    expect(index).toBeDefined();
    expect(index!.modules).toHaveLength(2);
    expect(index!.isLazy).toBe(false);

    const admin = analyses.find((a) => a.name === 'admin');
    expect(admin).toBeDefined();
    expect(admin!.isLazy).toBe(true);
    expect(admin!.hash).toBe('def456');
  });

  it('accepts array of chunks directly', () => {
    const chunks = [
      {
        type: 'chunk' as const,
        fileName: 'bundle.js',
        name: 'bundle',
        isEntry: true,
        modules: { './index.ts': { renderedLength: 1000, originalLength: 1200 } },
      },
    ];

    const analyses = analyzeViteOutput(chunks);
    expect(analyses).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rollup adapter
// ---------------------------------------------------------------------------

describe('analyzeRollupOutput', () => {
  it('parses Rollup plugin metadata', () => {
    const meta = {
      chunks: [
        {
          fileName: 'chunk-abc.js',
          name: 'vendor',
          isEntry: false,
          modules: {
            'node_modules/lodash/index.js': { renderedLength: 70000 },
            'node_modules/react/index.js': { renderedLength: 45000 },
          },
        },
      ],
    };

    const analyses = analyzeRollupOutput(meta);
    expect(analyses).toHaveLength(1);
    expect(analyses[0].modules).toHaveLength(2);
    expect(analyses[0].name).toBe('vendor');
  });

  it('handles array of metadata', () => {
    const metas = [
      { chunks: [{ fileName: 'a.js', modules: { './a.ts': { renderedLength: 1000 } } }] },
      { chunks: [{ fileName: 'b.js', modules: { './b.ts': { renderedLength: 2000 } } }] },
    ];

    const analyses = analyzeRollupOutput(metas);
    expect(analyses).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Analyzer utilities
// ---------------------------------------------------------------------------

describe('normalizeEntryName', () => {
  it('converts various path formats to clean names', () => {
    expect(normalizeEntryName('pages/dashboard.js')).toBe('dashboard');
    expect(normalizeEntryName('pages/index.js')).toBe('index');
    expect(normalizeEntryName('src/pages/api/users.js')).toBe('api/users');
    expect(normalizeEntryName('src/pages/settings/index.tsx')).toBe('settings');
    expect(normalizeEntryName('dist/bundle.mjs')).toBe('bundle');
  });
});

describe('isThirdParty', () => {
  it('identifies third-party modules', () => {
    expect(isThirdParty('node_modules/lodash/index.js')).toBe(true);
    expect(isThirdParty('react')).toBe(true);
    expect(isThirdParty('./components/Button.tsx')).toBe(false);
    expect(isThirdParty('/app/utils.ts')).toBe(false);
  });
});

describe('getTopModules', () => {
  it('returns largest modules across all chunks', () => {
    const analyses = [
      { name: 'a', totalSizeBytes: 100, modules: [{ name: 'x', sizeBytes: 50 }, { name: 'y', sizeBytes: 50 }] },
      { name: 'b', totalSizeBytes: 200, modules: [{ name: 'x', sizeBytes: 100 }, { name: 'z', sizeBytes: 100 }] },
    ];

    const top = getTopModules(analyses, 2);
    expect(top).toHaveLength(2);
    expect(top[0].name).toBe('x');
    expect(top[0].sizeBytes).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

describe('generateReport', () => {
  it('produces valid markdown', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'home', buildTimeMs: 800, sizeBytes: 15 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'dashboard', buildTimeMs: 3200, sizeBytes: 78 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'settings', buildTimeMs: 1100, sizeBytes: 22 * 1024 }));

    const report = budget.finalizeBuild();
    const md = generateReport(report);

    expect(md).toContain('# Build Budget Report');
    expect(md).toContain('home');
    expect(md).toContain('dashboard');
    expect(md).toContain('Per-Entry Breakdown');
  });
});

describe('generateSummary', () => {
  it('produces a one-paragraph executive summary', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'home', buildTimeMs: 800, sizeBytes: 15 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'dashboard', buildTimeMs: 3200, sizeBytes: 78 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'settings', buildTimeMs: 1100, sizeBytes: 22 * 1024 }));

    const report = budget.finalizeBuild();
    const summary = generateSummary(report);

    expect(summary).toContain('Your build takes');
    expect(summary).toContain('3 entries account for');
    expect(summary).toContain('largest');
  });

  it('mentions bloat in summary', () => {
    const budget = new BuildBudget();

    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 40 * 1024, modules: [{ name: 'a', sizeBytes: 40 * 1024 }] }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 80 * 1024, modules: [{ name: 'a', sizeBytes: 40 * 1024 }, { name: 'b', sizeBytes: 40 * 1024 }] }));
    const report = budget.finalizeBuild();

    const summary = generateSummary(report);
    expect(summary).toContain('grew');
  });

  it('mentions violations in summary', () => {
    const budget = new BuildBudget();
    budget.addBudget({ entry: 'big', maxSizeBytes: 10 });
    budget.recordEntry(makeEntry({ entry: 'big', sizeBytes: 9999 }));

    const report = budget.finalizeBuild();
    const summary = generateSummary(report);
    expect(summary).toContain('exceed their budget');
  });
});

// ---------------------------------------------------------------------------
// Prometheus export
// ---------------------------------------------------------------------------

describe('toPrometheus', () => {
  it('produces valid Prometheus text format', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'home', sizeBytes: 15 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'dashboard', sizeBytes: 78 * 1024 }));

    const report = budget.finalizeBuild();
    const prom = toPrometheus(report);

    expect(prom).toContain('# TYPE build_guardian_total_entries gauge');
    expect(prom).toContain('build_guardian_total_entries 2');
    expect(prom).toContain('build_guardian_entry_size_bytes{entry="home"}');
    expect(prom).toContain('build_guardian_entry_size_bytes{entry="dashboard"}');
    expect(prom).toContain('# HELP build_guardian_total_size_bytes');
  });

  it('includes bloat alert metrics when present', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 10 * 1024 }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 50 * 1024 }));
    const report = budget.finalizeBuild();

    const prom = toPrometheus(report);
    expect(prom).toContain('build_guardian_bloat_growth_percent');
  });
});

// ---------------------------------------------------------------------------
// Slack export
// ---------------------------------------------------------------------------

describe('toSlack', () => {
  it('produces Slack Block Kit blocks', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'home', sizeBytes: 15 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'dashboard', sizeBytes: 78 * 1024 }));

    const report = budget.finalizeBuild();
    const blocks = toSlack(report);

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].type).toBe('header');
    expect(blocks.some((b) => b.type === 'section')).toBe(true);
  });

  it('includes alert blocks when present', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 10 * 1024 }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 50 * 1024 }));
    const report = budget.finalizeBuild();

    const blocks = toSlack(report);
    const hasDivider = blocks.some((b) => b.type === 'divider');
    expect(hasDivider).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

describe('toMarkdown', () => {
  it('produces refined markdown', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'home', sizeBytes: 15 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'dashboard', sizeBytes: 78 * 1024 }));

    const report = budget.finalizeBuild();
    const md = toMarkdown(report);

    expect(md).toContain('# Build Budget Report');
    expect(md).toContain('Per-Entry Breakdown');
    expect(md).toContain('| home |');
    expect(md).toContain('| dashboard |');
  });
});

// ---------------------------------------------------------------------------
// GitHub Comment export
// ---------------------------------------------------------------------------

describe('toGitHubComment', () => {
  it('produces GitHub-flavored markdown for PR comments', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'home', sizeBytes: 15 * 1024 }));
    budget.recordEntry(makeEntry({ entry: 'dashboard', sizeBytes: 78 * 1024 }));

    const report = budget.finalizeBuild();
    const comment = toGitHubComment(report);

    expect(comment).toContain('## ✅ Build Guardian — All Clear');
    expect(comment).toContain('| **Entries** | 2 |');
    expect(comment).toContain('<details>');
    expect(comment).toContain('@superinstance/build-guardian');
  });

  it('shows failures when violations exist', () => {
    const budget = new BuildBudget();
    budget.addBudget({ entry: 'big', maxSizeBytes: 10 });
    budget.recordEntry(makeEntry({ entry: 'big', sizeBytes: 9999 }));

    const report = budget.finalizeBuild();
    const comment = toGitHubComment(report);

    expect(comment).toContain('❌');
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('PersistenceManager', () => {
  it('saves and loads history', async () => {
    const pm = new PersistenceManager({ filePath: '/tmp/bg-test-history.json' });
    await pm.clear();

    const history = [
      { timestamp: Date.now() - 2000, metrics: [makeEntry({ entry: 'a', sizeBytes: 1000 })] },
      { timestamp: Date.now(), metrics: [makeEntry({ entry: 'a', sizeBytes: 2000 })] },
    ];

    await pm.save(history);
    const loaded = await pm.load();

    expect(loaded).toHaveLength(2);
    expect(loaded[0].metrics[0].entry).toBe('a');
    expect(loaded[1].metrics[0].sizeBytes).toBe(2000);

    await pm.clear();
  });

  it('returns empty array when no file exists', async () => {
    const pm = new PersistenceManager({ filePath: '/tmp/bg-nonexistent.json' });
    await pm.clear();

    const loaded = await pm.load();
    expect(loaded).toEqual([]);
  });

  it('trims history to maxEntries', async () => {
    const pm = new PersistenceManager({ filePath: '/tmp/bg-test-trim.json', maxHistoryEntries: 3 });
    await pm.clear();

    const history = Array.from({ length: 10 }, (_, i) => ({
      timestamp: Date.now() + i * 1000,
      metrics: [makeEntry({ entry: `entry-${i}` })],
    }));

    await pm.save(history);
    const loaded = await pm.load();

    expect(loaded).toHaveLength(3);
    // Should keep the last 3
    expect(loaded[0].metrics[0].entry).toBe('entry-7');
    expect(loaded[2].metrics[0].entry).toBe('entry-9');

    await pm.clear();
  });

  it('provides per-route size history', async () => {
    const pm = new PersistenceManager({ filePath: '/tmp/bg-test-route.json' });
    await pm.clear();

    const history = [
      { timestamp: 1000, metrics: [makeEntry({ entry: 'home', sizeBytes: 1000 }), makeEntry({ entry: 'about', sizeBytes: 2000 })] },
      { timestamp: 2000, metrics: [makeEntry({ entry: 'home', sizeBytes: 1200 }), makeEntry({ entry: 'about', sizeBytes: 2100 })] },
    ];

    await pm.save(history);
    const routeHistory = await pm.getRouteSizeHistory();

    expect(routeHistory.get('home')).toHaveLength(2);
    expect(routeHistory.get('home')![1].sizeBytes).toBe(1200);
    expect(routeHistory.get('about')!).toHaveLength(2);

    await pm.clear();
  });
});

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

describe('analyzeTrends', () => {
  it('detects growing trends', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      timestamp: Date.now() + i * 10000,
      metrics: [makeEntry({ entry: 'admin', sizeBytes: 10000 + i * 5000 })],
    }));

    const trends = analyzeTrends(history);
    expect(trends).toHaveLength(1);
    expect(trends[0].entry).toBe('admin');
    expect(trends[0].direction).toBe('growing');
    expect(trends[0].slope).toBeGreaterThan(0);
    expect(trends[0].consecutiveGrowthCount).toBe(4);
    expect(trends[0].summary).toContain('growing');
  });

  it('detects shrinking trends', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      timestamp: Date.now() + i * 10000,
      metrics: [makeEntry({ entry: 'admin', sizeBytes: 50000 - i * 5000 })],
    }));

    const trends = analyzeTrends(history);
    expect(trends[0].direction).toBe('shrinking');
    expect(trends[0].slope).toBeLessThan(0);
  });

  it('detects stable trends', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      timestamp: Date.now() + i * 10000,
      metrics: [makeEntry({ entry: 'static', sizeBytes: 10000 + (i % 2 === 0 ? 5 : -5) })],
    }));

    const trends = analyzeTrends(history);
    expect(trends[0].direction).toBe('stable');
  });

  it('returns empty for insufficient history', () => {
    const trends = analyzeTrends([]);
    expect(trends).toHaveLength(0);

    const trends1 = analyzeTrends([{ timestamp: Date.now(), metrics: [makeEntry({ entry: 'a' })] }]);
    expect(trends1).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------

describe('evaluateAlertRules', () => {
  it('max-growth rule triggers on large growth', () => {
    const budget = new BuildBudget();
    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 10 * 1024 }));
    budget.finalizeBuild();

    budget.recordEntry(makeEntry({ entry: 'x', sizeBytes: 50 * 1024 }));
    budget.finalizeBuild();

    const rules: AlertRule[] = [
      { name: 'no-large-growth', type: 'max-growth', threshold: 0.20, severity: 'fail' },
    ];

    const results = evaluateAlertRules(rules, budget.getHistory()[1].metrics, [...budget.getHistory()]);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('grew');
    expect(results[0].entries).toContain('x');
  });

  it('max-total-size rule triggers on large bundle', () => {
    const metrics = [
      makeEntry({ entry: 'a', sizeBytes: 300 * 1024 }),
      makeEntry({ entry: 'b', sizeBytes: 300 * 1024 }),
    ];

    const rules: AlertRule[] = [
      { name: 'total-size', type: 'max-total-size', threshold: 500 * 1024, severity: 'warning' },
    ];

    const results = evaluateAlertRules(rules, metrics, []);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('600.0KB');
  });

  it('max-entry-size rule triggers on large entries', () => {
    const metrics = [
      makeEntry({ entry: 'small', sizeBytes: 10 * 1024 }),
      makeEntry({ entry: 'huge', sizeBytes: 500 * 1024 }),
    ];

    const rules: AlertRule[] = [
      { name: 'entry-size', type: 'max-entry-size', threshold: 250 * 1024, severity: 'fail' },
    ];

    const results = evaluateAlertRules(rules, metrics, []);
    expect(results).toHaveLength(1);
    expect(results[0].entries).toContain('huge');
  });

  it('max-build-time rule triggers on slow builds', () => {
    const metrics = [
      makeEntry({ entry: 'a', buildTimeMs: 35000 }),
      makeEntry({ entry: 'b', buildTimeMs: 35000 }),
    ];

    const rules: AlertRule[] = [
      { name: 'build-time', type: 'max-build-time', threshold: 60000, severity: 'warning' },
    ];

    const results = evaluateAlertRules(rules, metrics, []);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('70.0s');
  });

  it('consecutive-growth rule triggers after N builds', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      timestamp: Date.now() + i * 10000,
      metrics: [makeEntry({ entry: 'admin', sizeBytes: 10000 + i * 2000 })],
    }));

    const rules: AlertRule[] = [
      { name: 'consecutive', type: 'consecutive-growth', threshold: 0, consecutiveBuilds: 3, severity: 'warning' },
    ];

    const results = evaluateAlertRules(rules, history[history.length - 1].metrics, history);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('consecutive builds');
    expect(results[0].entries).toContain('admin');
  });

  it('entryPattern scopes rules to matching entries', () => {
    const metrics = [
      makeEntry({ entry: 'admin/users', sizeBytes: 500 * 1024 }),
      makeEntry({ entry: 'home', sizeBytes: 500 * 1024 }),
    ];

    const rules: AlertRule[] = [
      { name: 'admin-size', type: 'max-entry-size', threshold: 250 * 1024, entryPattern: 'admin/*', severity: 'fail' },
    ];

    const results = evaluateAlertRules(rules, metrics, []);
    expect(results).toHaveLength(1);
    expect(results[0].entries).toContain('admin/users');
  });

  it('presetRules produce valid AlertRule objects', () => {
    expect(presetRules.failOnLargeGrowth().type).toBe('max-growth');
    expect(presetRules.warnTotalBundle500kb().threshold).toBe(500 * 1024);
    expect(presetRules.failEntrySize250kb().type).toBe('max-entry-size');
    expect(presetRules.warnBuildTime60s().threshold).toBe(60_000);
    expect(presetRules.warnConsecutiveGrowth().consecutiveBuilds).toBe(3);
  });
});
