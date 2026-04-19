import type { CactusLM } from 'cactus-react-native';
import { MetaDAT } from '../MetaDAT';
import { encodeEpisode } from './MemoryEncoder';
import { buildDailyPalace } from './DailyPalaceBuilder';
import {
  appendEpisode,
  deleteEpisodes,
  ensureRoot,
  findDaysNeedingCompression,
  loadEpisodes,
  savePalace,
  sweepOldDays,
  todayKey,
} from './MemoryStore';

const SAMPLE_INTERVAL_MS = 60_000;

export class MemoryOrchestrator {
  private memoryLM: CactusLM;
  private timer: ReturnType<typeof setInterval> | null = null;
  private encoding = false;
  private lastPlaceLabel: string | null = null;
  private rolloverRunning = false;

  constructor(memoryLM: CactusLM) {
    this.memoryLM = memoryLM;
  }

  async init(): Promise<void> {
    await ensureRoot();
    await sweepOldDays(todayKey());
    // Fire rollover check in the background; don't block init.
    this.runRollover().catch(err => console.warn('[MemoryOrchestrator] rollover failed:', err));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(err => console.warn('[MemoryOrchestrator] tick failed:', err));
    }, SAMPLE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.encoding) return;
    this.encoding = true;
    try {
      const image = await MetaDAT.capturePhoto();
      if (!image) return;
      const ts = Date.now();
      const episode = await encodeEpisode(this.memoryLM, image, ts, this.lastPlaceLabel);
      if (!episode) return;
      await appendEpisode(episode);
      this.lastPlaceLabel = episode.placeLabel;
    } finally {
      this.encoding = false;
    }
  }

  /**
   * Build palaces for any past day that has raw episodes but no palace,
   * then delete the raw episodes. Idempotent; safe to call repeatedly.
   */
  async runRollover(): Promise<void> {
    if (this.rolloverRunning) return;
    this.rolloverRunning = true;
    try {
      const today = todayKey();
      const pending = await findDaysNeedingCompression(today);
      for (const dayKey of pending) {
        const episodes = await loadEpisodes(dayKey);
        if (episodes.length === 0) {
          await deleteEpisodes(dayKey);
          continue;
        }
        const palace = await buildDailyPalace(this.memoryLM, dayKey, episodes);
        await savePalace(palace);
        await deleteEpisodes(dayKey);
      }
    } finally {
      this.rolloverRunning = false;
    }
  }
}
