import { NativeModules } from 'react-native';
import type { Route } from './Router';

const { MetaDATModule } = NativeModules;

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

const MAX_CASES = 10;

export async function loadCases(): Promise<TestCase[]> {
  const json: string = await MetaDATModule.loadTestCasesJSON();
  return JSON.parse(json) as TestCase[];
}

export async function saveCase(tc: TestCase): Promise<void> {
  const existing = await loadCases();
  const updated = [tc, ...existing].slice(0, MAX_CASES);
  await MetaDATModule.saveTestCasesJSON(JSON.stringify(updated));
}

export async function deleteCase(id: string): Promise<void> {
  const existing = await loadCases();
  await MetaDATModule.saveTestCasesJSON(
    JSON.stringify(existing.filter(tc => tc.id !== id)),
  );
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
