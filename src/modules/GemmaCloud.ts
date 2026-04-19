import { GEMMA_API_KEY, GEMMA_CLOUD_MODEL } from '@env';
import { cloudCompleteWith, CloudCompleteOptions } from './GemmaCloudCore';

export type { CloudMessage, CloudCompleteOptions } from './GemmaCloudCore';

const DEFAULT_MODEL = 'gemma-4-27b-it';

export function isCloudConfigured(): boolean {
  return typeof GEMMA_API_KEY === 'string' && GEMMA_API_KEY.length > 0;
}

export function cloudModelName(): string {
  return GEMMA_CLOUD_MODEL || DEFAULT_MODEL;
}

export async function cloudComplete(opts: CloudCompleteOptions): Promise<string> {
  if (!isCloudConfigured()) {
    throw new Error('GEMMA_API_KEY not set — cannot call cloud Gemma.');
  }
  return cloudCompleteWith({ apiKey: GEMMA_API_KEY, model: cloudModelName() }, opts);
}
