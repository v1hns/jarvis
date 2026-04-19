import RNFS from 'react-native-fs';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  route?: string;
  timestampMs: number;
}

const FILE_PATH = `${RNFS.DocumentDirectoryPath}/conversation.json`;
const MAX_TURNS = 200;
const CONTEXT_WINDOW = 12;

export async function loadTurns(): Promise<ConversationTurn[]> {
  if (!(await RNFS.exists(FILE_PATH))) return [];
  try {
    const raw = await RNFS.readFile(FILE_PATH, 'utf8');
    return JSON.parse(raw) as ConversationTurn[];
  } catch (err) {
    console.warn('[ConversationMemory] parse failed:', err);
    return [];
  }
}

export async function appendTurn(turn: ConversationTurn): Promise<ConversationTurn[]> {
  const existing = await loadTurns();
  existing.push(turn);
  const trimmed = existing.slice(-MAX_TURNS);
  await RNFS.writeFile(FILE_PATH, JSON.stringify(trimmed), 'utf8');
  return trimmed;
}

export async function clearTurns(): Promise<void> {
  if (await RNFS.exists(FILE_PATH)) await RNFS.unlink(FILE_PATH);
}

export function contextWindow(turns: ConversationTurn[]): ConversationTurn[] {
  return turns.slice(-CONTEXT_WINDOW);
}
