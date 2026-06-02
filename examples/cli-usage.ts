/**
 * CLI Usage — example of using BuildGuardian from the command line.
 *
 * Usage:
 *   npx ts-node examples/cli-usage.ts --stats ./build-stats.json --history ./history.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { BuildBudget, toMarkdown, toPrometheus, toSlack, toGitHubComment } from '../src/index';
import { PersistenceManager } from '../src/persistence';
import { presetRules } from '../src/alerting';
import type { EntryMetrics } from '../src/types';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const statsPath = getArg('stats') ?? './build-stats.json';
const historyPath = getArg('history') ?? './build-guardian-history.json';
const format = getArg('format') ?? 'markdown'; // markdown | prometheus | slack | github
const failOnViolation = args.includes('--fail-on-violation');
const bloatThreshold = parseFloat(getArg('bloat-threshold') ?? '0.20');

async function main() {
  if (!fs.existsSync(statsPath)) {
    console.error(`Stats file not found: ${statsPath}`);
    process.exit(1);
  }

  const budget = new BuildBudget({ bloatThreshold });
  const pm = new PersistenceManager({ filePath: historyPath });

  // Load history
  await budget.loadHistory(pm);

  // Set default alert rules
  budget.setAlertRules([
    presetRules.failOnLargeGrowth(),
    presetRules.warnTotalBundle500kb(),
  ]);

  // Read and record stats
  const stats: { entries: EntryMetrics[] } = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
  for (const entry of stats.entries) {
    budget.recordEntry(entry);
  }

  const report = budget.finalizeBuild();

  // Output in requested format
  switch (format) {
    case 'prometheus':
      console.log(toPrometheus(report));
      break;
    case 'slack': {
      const blocks = toSlack(report);
      console.log(JSON.stringify(blocks, null, 2));
      break;
    }
    case 'github':
      console.log(toGitHubComment(report));
      break;
    default:
      console.log(toMarkdown(report));
  }

  // Save history
  await budget.saveHistory(pm);

  // Exit code
  if (failOnViolation && (report.violations.length > 0 ||
      report.ruleAlerts.some((r) => r.rule.severity === 'fail'))) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
