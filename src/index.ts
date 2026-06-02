/**
 * @superinstance/build-guardian — Build Budget Guardian v0.2.0
 */

export {
  EntryMetrics, ModuleEntry, EntryBudget, ConservationScore,
  BloatAlert, BudgetViolation, AlertRule, AlertResult,
  TrendPoint, TrendAnalysis, BuildReport, HistoryEntry,
  PersistenceOptions, ChunkAnalysis, formatBytes,
} from './types';

export { analyzeWebpackStats, analyzeEsbuildMetafile, normalizeEntryName, isThirdParty, getTopModules, buildChunkTree } from './analyzer';
export type { WebpackStatsJson } from './analyzer';
export { analyzeViteOutput, analyzeRollupOutput } from './adapters/vite-rollup';
export type { ViteBuildOutput, ViteOutputChunk, RollupPluginMeta } from './adapters/vite-rollup';
export { generateReport, generateSummary } from './reporter';
export { toPrometheus, toPrometheusMetrics } from './export/prometheus';
export type { PrometheusMetric } from './export/prometheus';
export { toSlack } from './export/slack';
export type { SlackBlock } from './export/slack';
export { toMarkdown } from './export/markdown';
export { toGitHubComment } from './export/github-comment';
export { PersistenceManager } from './persistence';
export { analyzeTrends } from './trends';
export { evaluateAlertRules, presetRules } from './alerting';
export { BuildBudget } from './budget';

// BuildBudget is the main class — also export from here for convenience
import { BuildBudget } from './budget';
const _default = { BuildBudget };
export { BuildBudget as default };
