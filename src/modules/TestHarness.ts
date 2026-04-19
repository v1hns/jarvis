import { NativeModules } from 'react-native';
import {
  parseCases,
  serializeCases,
  insertCase,
  removeCase,
  TestCase,
} from './TestHarnessCore';

export type { TestCase, ReplayResult } from './TestHarnessCore';
export { buildCase, MAX_CASES } from './TestHarnessCore';

const { MetaDATModule } = NativeModules;

export async function loadCases(): Promise<TestCase[]> {
  const json: string = await MetaDATModule.loadTestCasesJSON();
  return parseCases(json);
}

export async function saveCase(tc: TestCase): Promise<void> {
  const existing = await loadCases();
  await MetaDATModule.saveTestCasesJSON(serializeCases(insertCase(existing, tc)));
}

export async function deleteCase(id: string): Promise<void> {
  const existing = await loadCases();
  await MetaDATModule.saveTestCasesJSON(serializeCases(removeCase(existing, id)));
}
