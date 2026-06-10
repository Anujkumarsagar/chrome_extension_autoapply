type LogSource = 'popup' | 'background' | 'content';

/**
 * Reusable structured logger for the extension.
 */
export class Logger {
  private source: LogSource;

  constructor(source: LogSource) {
    this.source = source;
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatLog(level: string, message: string): string {
    return `[${this.getTimestamp()}] [${this.source.toUpperCase()}] [${level.toUpperCase()}]: ${message}`;
  }

  /**
   * Log an informational message.
   */
  info(message: string, ...args: unknown[]): void {
    console.info(this.formatLog('info', message), ...args);
  }

  /**
   * Log a warning message.
   */
  warn(message: string, ...args: unknown[]): void {
    console.warn(this.formatLog('warn', message), ...args);
  }

  /**
   * Log an error message.
   */
  error(message: string, ...args: unknown[]): void {
    console.error(this.formatLog('error', message), ...args);
  }

  /**
   * Log a debug message.
   */
  debug(message: string, ...args: unknown[]): void {
    console.debug(this.formatLog('debug', message), ...args);
  }
}

/**
 * Factory function to create a logger instance for a specific extension context.
 */
export const createLogger = (source: LogSource): Logger => {
  return new Logger(source);
};
