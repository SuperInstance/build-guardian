/**
 * Shared types for @superinstance/build-guardian
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntryMetrics {
  entry: string;
  buildTimeMs: number;
  sizeBytes: number;
  memoryPeakBytes: number;
  modules?: ModuleEntry[];
  firstPartyBytes?: number;
  thirdPartyBytes?: number;
  timestamp: number;
  route?: string;
  isLazy?: boolean;
  chunkType?: 'entry' | 'chunk' | 'initial';
  hash?: string;
}

export interface ModuleEntry {
  name: string;
  sizeBytes: number;
}

export interface EntryBudget {
  entry: string;
  maxSizeBytes: number;
  maxBuildTimeMs?: number;
  maxMemoryBytes?: number;
}

export interface ConservationScore {
  entry: string;
  score: number;
  sizeNormalized: number;
  frequency: number;
  complexity: number;
}

export interface BloatAlert {
  entry: string;
  previousSizeBytes: number;
  currentSizeBytes: number;
  growthPercent: number;
  addedDependencies: string[];
  severity: 'warning' | 'critical';
}

export interface BudgetViolation {
  entry: string;
  budget: EntryBudget;
  actual: Pick<EntryMetrics, 'sizeBytes' | 'buildTimeMs' | 'memoryPeakBytes'>;
  reason: string;
}

export interface AlertRule {
  name: string;
  type: 'max-growth' | 'max-total-size' | 'max-entry-size' | 'max-build-time' | 'consecutive-growth';
  threshold: number;
  severity: 'warning' | 'critical' | 'fail';
  entryPattern?: string;
  consecutiveBuilds?: number;
}

export interface AlertResult {
  rule: AlertRule;
  message: string;
  entries?: string[];
}

export interface TrendPoint {
  entry: string;
  buildIndex: number;
  timestamp: number;
  sizeBytes: number;
}

export interface TrendAnalysis {
  entry: string;
  direction: 'growing' | 'shrinking' | 'stable';
  averageChangePerBuild: number;
  consecutiveGrowthCount: number;
  slope: number;
  points: TrendPoint[];
  summary: string;
}

export interface BuildReport {
  generatedAt: number;
  totalEntries: number;
  totalBuildTimeMs: number;
  totalSizeBytes: number;
  alerts: BloatAlert[];
  violations: BudgetViolation[];
  scores: ConservationScore[];
  entryMetrics: EntryMetrics[];
  ruleAlerts: AlertResult[];
  trends: TrendAnalysis[];
}

export interface HistoryEntry {
  timestamp: number;
  metrics: EntryMetrics[];
  label?: string;
}

export interface PersistenceOptions {
  filePath?: string;
  maxHistoryEntries?: number;
}

export interface ChunkAnalysis {
  name: string;
  totalSizeBytes: number;
  modules: ModuleEntry[];
  assetFile?: string;
  parents?: number[];
  isLazy?: boolean;
  hash?: string;
  entryOrigin?: string;
  children?: number[];
  moduleIds?: (string | number)[];
  chunkType?: 'entry' | 'chunk' | 'initial';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
