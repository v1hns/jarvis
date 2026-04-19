import RNFS from 'react-native-fs';
import type { EpisodeRecord, DailyMemoryPalace } from './types';

const ROOT = `${RNFS.DocumentDirectoryPath}/memory`;
const RETENTION_DAYS = 7;

export function dayKeyFromTimestamp(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return dayKeyFromTimestamp(Date.now());
}

function dayDir(dayKey: string): string {
  return `${ROOT}/${dayKey}`;
}

function episodesPath(dayKey: string): string {
  return `${dayDir(dayKey)}/episodes.json`;
}

function palacePath(dayKey: string): string {
  return `${dayDir(dayKey)}/palace.json`;
}

async function ensureDir(path: string): Promise<void> {
  const exists = await RNFS.exists(path);
  if (!exists) await RNFS.mkdir(path);
}

export async function ensureRoot(): Promise<void> {
  await ensureDir(ROOT);
}

export async function appendEpisode(ep: EpisodeRecord): Promise<void> {
  await ensureDir(dayDir(ep.dayKey));
  const p = episodesPath(ep.dayKey);
  const existing = await loadEpisodes(ep.dayKey);
  existing.push(ep);
  await RNFS.writeFile(p, JSON.stringify(existing), 'utf8');
}

export async function loadEpisodes(dayKey: string): Promise<EpisodeRecord[]> {
  const p = episodesPath(dayKey);
  if (!(await RNFS.exists(p))) return [];
  try {
    const raw = await RNFS.readFile(p, 'utf8');
    return JSON.parse(raw) as EpisodeRecord[];
  } catch (err) {
    console.warn('[MemoryStore] failed to parse episodes', dayKey, err);
    return [];
  }
}

export async function savePalace(palace: DailyMemoryPalace): Promise<void> {
  await ensureDir(dayDir(palace.dayKey));
  await RNFS.writeFile(palacePath(palace.dayKey), JSON.stringify(palace), 'utf8');
}

export async function loadPalace(dayKey: string): Promise<DailyMemoryPalace | null> {
  const p = palacePath(dayKey);
  if (!(await RNFS.exists(p))) return null;
  try {
    const raw = await RNFS.readFile(p, 'utf8');
    return JSON.parse(raw) as DailyMemoryPalace;
  } catch {
    return null;
  }
}

export async function hasPalace(dayKey: string): Promise<boolean> {
  return RNFS.exists(palacePath(dayKey));
}

export async function deleteEpisodes(dayKey: string): Promise<void> {
  const p = episodesPath(dayKey);
  if (await RNFS.exists(p)) await RNFS.unlink(p);
}

export async function listStoredDays(): Promise<string[]> {
  await ensureRoot();
  const entries = await RNFS.readDir(ROOT);
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

/** Returns day keys that have raw episodes but are older than `today` and lack a palace. */
export async function findDaysNeedingCompression(today: string): Promise<string[]> {
  const days = await listStoredDays();
  const out: string[] = [];
  for (const d of days) {
    if (d >= today) continue;
    const epExists = await RNFS.exists(episodesPath(d));
    const palaceExists = await RNFS.exists(palacePath(d));
    if (epExists && !palaceExists) out.push(d);
  }
  return out;
}

/** Drops days older than retention window entirely. */
export async function sweepOldDays(today: string): Promise<void> {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffKey = dayKeyFromTimestamp(cutoff.getTime());
  const days = await listStoredDays();
  for (const d of days) {
    if (d < cutoffKey) {
      await RNFS.unlink(dayDir(d)).catch(() => {});
    }
  }
}
