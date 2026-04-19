import type { Route } from './Router';

export interface TestCase {
  id: string;
  createdAt: string;
  /** Truncated transcript shown in list */
  label: string;
  audioSamples: number[];
  imageBase64?: string;
  capturedTranscript: string;
  capturedRoute: Route;
  capturedResponse: string;
}

export interface ReplayResult {
  caseId: string;
  newTranscript: string;
  newRoute: Route;
  newResponse: string;
}

export const MAX_CASES = 10;

/**
 * Parse a stored JSON blob. Returns an empty array for malformed or
 * non-array payloads — callers treat missing/corrupt storage as "no cases".
 */
export function parseCases(json: string): TestCase[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as TestCase[]) : [];
  } catch {
    return [];
  }
}

export function serializeCases(cases: TestCase[]): string {
  return JSON.stringify(cases);
}

/** Prepend `tc` (FIFO eviction at MAX_CASES). */
export function insertCase(existing: TestCase[], tc: TestCase): TestCase[] {
  return [tc, ...existing].slice(0, MAX_CASES);
}

export function removeCase(existing: TestCase[], id: string): TestCase[] {
  return existing.filter(tc => tc.id !== id);
}

export function buildCase(
  audioSamples: number[],
  transcript: string,
  route: Route,
  response: string,
  imageBase64?: string,
): TestCase {
  return {
    id: `tc_${Date.now()}`,
    createdAt: new Date().toISOString(),
    label: transcript.slice(0, 80) || (imageBase64 ? '(photo query)' : '(no speech)'),
    audioSamples,
    imageBase64,
    capturedTranscript: transcript,
    capturedRoute: route,
    capturedResponse: response,
  };
}
