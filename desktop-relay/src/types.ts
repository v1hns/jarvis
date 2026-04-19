export type BridgeEventType = 'progress' | 'needs_confirmation' | 'result' | 'error';

export interface BridgeEvent {
  type: BridgeEventType;
  payload: string;
}

export interface TaskPayload {
  task: string;
  context?: Array<{ role: 'user' | 'assistant'; content: string }>;
  confirm_before?: string[];
  session_id?: string;
}

export interface ConfirmPayload {
  session_id: string;
  answer: 'CONFIRMED' | 'CANCELLED';
}

export interface OpenClawJsonResult {
  response?: string;
  text?: string;
  content?: string;
  error?: string;
}
