/**
 * Types of messages sent between popup, background, and content scripts.
 */
export enum MessageType {
  START_AUTOFILL = 'START_AUTOFILL',
  STOP_AUTOFILL = 'STOP_AUTOFILL',
  GET_STATUS = 'GET_STATUS',
  PING = 'PING',
  PARSE_RESUME = 'PARSE_RESUME',
  ANALYZE_QUESTION = 'ANALYZE_QUESTION',
  SYNC_STATUS = 'SYNC_STATUS',
}
