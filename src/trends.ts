/**
 * Trend Analysis — linear regression on per-entry sizes over time.
 */

import type { HistoryEntry, TrendAnalysis, TrendPoint } from './types';
import { formatBytes } from './types';

export function analyzeTrends(history: HistoryEntry[]): TrendAnalysis[] {
  if (history.length < 2) return [];

  const entryNames = new Set<string>();
  for (const h of history) {
    for (const m of h.metrics) {
      entryNames.add(m.entry);
    }
  }

  const results: TrendAnalysis[] = [];
  for (const entry of entryNames) {
    const points: TrendPoint[] = [];
    for (let i = 0; i < history.length; i++) {
      const metric = history[i].metrics.find((m) => m.entry === entry);
      if (metric) {
        points.push({ entry, buildIndex: i, timestamp: history[i].timestamp, sizeBytes: metric.sizeBytes });
      }
    }
    if (points.length < 2) continue;
    results.push(computeTrend(entry, points));
  }

  return results;
}

function computeTrend(entry: string, points: TrendPoint[]): TrendAnalysis {
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += points[i].sizeBytes;
    sumXY += i * points[i].sizeBytes;
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;

  let totalChange = 0;
  let changeCount = 0;
  for (let i = 1; i < points.length; i++) {
    totalChange += points[i].sizeBytes - points[i - 1].sizeBytes;
    changeCount++;
  }
  const averageChangePerBuild = changeCount > 0 ? totalChange / changeCount : 0;

  let consecutiveGrowthCount = 0;
  for (let i = points.length - 1; i >= 1; i--) {
    if (points[i].sizeBytes > points[i - 1].sizeBytes) {
      consecutiveGrowthCount++;
    } else {
      break;
    }
  }

  const avgSize = sumY / n;
  const absSlope = Math.abs(slope);
  let direction: 'growing' | 'shrinking' | 'stable';
  if (absSlope < avgSize * 0.01) {
    direction = 'stable';
  } else {
    direction = slope > 0 ? 'growing' : 'shrinking';
  }

  const summary = buildTrendSummary(entry, direction, slope, consecutiveGrowthCount, points);
  return { entry, direction, averageChangePerBuild, consecutiveGrowthCount, slope, points, summary };
}

function buildTrendSummary(
  entry: string,
  direction: 'growing' | 'shrinking' | 'stable',
  slope: number,
  consecutiveGrowthCount: number,
  points: TrendPoint[],
): string {
  if (direction === 'stable') {
    return `${entry} is stable across ${points.length} builds (${formatBytes(points[points.length - 1].sizeBytes)}).`;
  }

  const absSlope = Math.abs(slope);
  const slopeStr = formatBytes(Math.round(absSlope));

  if (direction === 'growing') {
    let msg = `${entry} is growing at ~${slopeStr}/build across ${points.length} builds.`;
    if (consecutiveGrowthCount >= 3) {
      msg += ` Has grown ${consecutiveGrowthCount} consecutive builds.`;
    }
    return msg;
  }

  return `${entry} is shrinking at ~${slopeStr}/build across ${points.length} builds.`;
}
