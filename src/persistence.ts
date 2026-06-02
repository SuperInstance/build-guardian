/**
 * Persistence — save/load build history to JSON.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { HistoryEntry, PersistenceOptions } from './types';

export class PersistenceManager {
  private filePath: string;
  private maxEntries: number;

  constructor(opts?: PersistenceOptions) {
    this.filePath = opts?.filePath ?? './build-guardian-history.json';
    this.maxEntries = opts?.maxHistoryEntries ?? 100;
  }

  async save(history: HistoryEntry[]): Promise<void> {
    const trimmed = history.slice(-this.maxEntries);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = JSON.stringify({
      version: '0.2.0',
      savedAt: Date.now(),
      history: trimmed,
    }, null, 2);
    fs.writeFileSync(this.filePath, data, 'utf-8');
  }

  async load(): Promise<HistoryEntry[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const data = JSON.parse(raw);
    return data.history ?? [];
  }

  async getRouteSizeHistory(): Promise<Map<string, Array<{ timestamp: number; sizeBytes: number }>>> {
    const history = await this.load();
    const routeMap = new Map<string, Array<{ timestamp: number; sizeBytes: number }>>();

    for (const entry of history) {
      for (const metric of entry.metrics) {
        if (!routeMap.has(metric.entry)) {
          routeMap.set(metric.entry, []);
        }
        routeMap.get(metric.entry)!.push({
          timestamp: entry.timestamp,
          sizeBytes: metric.sizeBytes,
        });
      }
    }

    return routeMap;
  }

  async clear(): Promise<void> {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  getFilePath(): string {
    return this.filePath;
  }
}
