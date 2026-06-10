import { useState, useEffect, useCallback } from 'react';
import { ResumeMetadata } from '../types/resume';
import * as storage from '../storage/chromeStorage';
import { createLogger } from '../utils/logger';

const logger = createLogger('popup');

/**
 * React hook to manage resume metadata state, loading, errors, and storage interaction.
 */
export function useResume() {
  const [resumeMetadata, setResumeMetadata] = useState<ResumeMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load resume metadata on initialization
  useEffect(() => {
    let isMounted = true;
    async function loadMetadata() {
      try {
        setIsLoading(true);
        const data = await storage.getResumeMetadata();
        if (isMounted) {
          setResumeMetadata(data);
          setError(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load resume';
        if (isMounted) {
          setError(message);
          logger.error('Error loading resume metadata on init', err);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    loadMetadata();

    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Save a new resume's metadata to storage.
   */
  const saveResume = useCallback(async (fileName: string, fileSize: number): Promise<ResumeMetadata> => {
    setIsLoading(true);
    setError(null);
    try {
      const metadata: ResumeMetadata = {
        fileName,
        fileSize,
        uploadedAt: new Date().toISOString(),
      };
      await storage.saveResumeMetadata(metadata);
      setResumeMetadata(metadata);
      logger.info(`Uploaded and saved metadata for: ${fileName}`);
      return metadata;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save resume';
      setError(message);
      logger.error('Failed to save resume metadata', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Remove the resume's metadata from storage.
   */
  const clearResume = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await storage.removeResumeMetadata();
      setResumeMetadata(null);
      logger.info('Cleared resume from storage');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear resume';
      setError(message);
      logger.error('Failed to clear resume metadata', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    resumeMetadata,
    isLoading,
    error,
    saveResume,
    clearResume,
  };
}
export default useResume;
