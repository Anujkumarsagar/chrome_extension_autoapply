import { MessageType } from '../constants/messageTypes';
import { ResumeMetadata, StructuredResume } from './resume';

export interface StartAutofillPayload {
  resumeMetadata: ResumeMetadata;
  structuredResume: StructuredResume;
}

export interface ParseResumePayload {
  rawText: string;
  settings?: {
    provider: 'openai' | 'gemini' | 'ollama';
    openaiApiKey: string;
    openaiModel: string;
    geminiApiKey: string;
    geminiModel: string;
    ollamaEndpoint: string;
    ollamaModel: string;
  };
}

export interface AnalyzeQuestionPayload {
  label: string;
  description?: string;
  options?: string[];
  containerHtml?: string;
  resumeJson: StructuredResume;
  pageContext?: Array<{ label: string; value: string }>;
}

export interface SyncStatusPayload {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  currentPage: string;
  progress: number;
  error?: string;
}

export interface ExecutionCommand {
  action: 'type' | 'select' | 'checkbox' | 'radio' | 'date';
  fieldId: string;
  value: string | boolean | null;
  reasoning?: string;
}

export interface GenerateExecutionPlanPayload {
  fields: Array<{
    id: string;
    label: string;
    description?: string;
    type: string;
    required: boolean;
    automationId?: string;
    options?: string[];
  }>;
  resumeJson: StructuredResume;
  containerHtml?: string;
  errorContext?: string;
}


/**
 * Union definition of all possible extension messages.
 */
export type ExtensionMessage =
  | { type: MessageType.START_AUTOFILL; payload: StartAutofillPayload }
  | { type: MessageType.STOP_AUTOFILL; payload?: never }
  | { type: MessageType.GET_STATUS; payload?: never }
  | { type: MessageType.PING; payload?: never }
  | { type: MessageType.PARSE_RESUME; payload: ParseResumePayload }
  | { type: MessageType.ANALYZE_QUESTION; payload: AnalyzeQuestionPayload }
  | { type: MessageType.SYNC_STATUS; payload: SyncStatusPayload }
  | { type: MessageType.GENERATE_EXECUTION_PLAN; payload: GenerateExecutionPlanPayload };

/**
 * Standard structured response for message handlers.
 */
export interface ExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

