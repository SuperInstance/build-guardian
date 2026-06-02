/**
 * Webpack Plugin — auto-runs BuildGuardian after compilation.
 *
 * Usage:
 *   // webpack.config.ts
 *   import { BuildGuardianWebpackPlugin } from './examples/webpack-plugin';
 *
 *   export default {
 *     plugins: [
 *       new BuildGuardianWebpackPlugin({
 *         budgets: [{ entry: 'main', maxSizeBytes: 250 * 1024 }],
 *         alertRules: [{ name: 'growth', type: 'max-growth', threshold: 0.20, severity: 'fail' }],
 *         persist: true,
 *       }),
 *     ],
 *   };
 */

import type { Compiler } from 'webpack';
import { BuildBudget, analyzeWebpackStats, toMarkdown, toPrometheus } from '../src/index';
import { PersistenceManager } from '../src/persistence';
import type { EntryBudget, AlertRule } from '../src/types';

export interface BuildGuardianWebpackPluginOptions {
  budgets?: EntryBudget[];
  alertRules?: AlertRule[];
  bloatThreshold?: number;
  persist?: boolean;
  historyFile?: string;
  prometheusOutput?: string;
  failOnError?: boolean;
}

class BuildGuardianWebpackPlugin {
  private options: BuildGuardianWebpackPluginOptions;

  constructor(options: BuildGuardianWebpackPluginOptions = {}) {
    this.options = options;
  }

  apply(compiler: Compiler): void {
    compiler.hooks.done.tap('BuildGuardianWebpackPlugin', (stats) => {
      const budget = new BuildBudget({ bloatThreshold: this.options.bloatThreshold });

      if (this.options.budgets) {
        budget.setBudgets(this.options.budgets);
      }

      if (this.options.alertRules) {
        budget.setAlertRules(this.options.alertRules);
      }

      // Load history if persisting
      if (this.options.persist) {
        const pm = new PersistenceManager({ filePath: this.options.historyFile });
        pm.load().then((history) => {
          budget.setHistory(history);

          const analyses = analyzeWebpackStats(stats.toJson());
          const startTime = stats.startTime ?? Date.now();
          const endTime = stats.endTime ?? Date.now();

          for (const chunk of analyses) {
            budget.recordEntry({
              entry: chunk.name,
              buildTimeMs: endTime - startTime,
              sizeBytes: chunk.totalSizeBytes,
              memoryPeakBytes: process.memoryUsage().rss,
              modules: chunk.modules,
              timestamp: Date.now(),
              isLazy: chunk.isLazy,
              hash: chunk.hash,
            });
          }

          const report = budget.finalizeBuild();
          console.log(toMarkdown(report));

          if (this.options.prometheusOutput) {
            const fs = require('fs');
            fs.writeFileSync(this.options.prometheusOutput, toPrometheus(report));
          }

          // Save history
          pm.save([...budget.getHistory()]);

          // Fail if configured
          if (this.options.failOnError && (report.violations.length > 0 ||
              report.ruleAlerts.some((r) => r.rule.severity === 'fail'))) {
            process.exit(1);
          }
        });
      } else {
        const analyses = analyzeWebpackStats(stats.toJson());
        const startTime = stats.startTime ?? Date.now();
        const endTime = stats.endTime ?? Date.now();

        for (const chunk of analyses) {
          budget.recordEntry({
            entry: chunk.name,
            buildTimeMs: endTime - startTime,
            sizeBytes: chunk.totalSizeBytes,
            memoryPeakBytes: process.memoryUsage().rss,
            modules: chunk.modules,
            timestamp: Date.now(),
          });
        }

        const report = budget.finalizeBuild();
        console.log(toMarkdown(report));

        if (this.options.failOnError && (report.violations.length > 0 ||
            report.ruleAlerts.some((r) => r.rule.severity === 'fail'))) {
          process.exit(1);
        }
      }
    });
  }
}

export { BuildGuardianWebpackPlugin };
