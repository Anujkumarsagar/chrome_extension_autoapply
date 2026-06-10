import { ResumeMetadata, StructuredResume } from '../types/resume';

const STORAGE_KEYS = {
  RESUME_METADATA: 'resume_metadata',
  STRUCTURED_RESUME: 'structured_resume',
} as const;

/**
 * Saves the resume metadata to chrome.storage.local (with fallback to localStorage for local dev).
 */
export async function saveResumeMetadata(metadata: ResumeMetadata): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEYS.RESUME_METADATA]: metadata }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } else {
    // Development fallback
    localStorage.setItem(STORAGE_KEYS.RESUME_METADATA, JSON.stringify(metadata));
    return Promise.resolve();
  }
}

/**
 * Retrieves the resume metadata from chrome.storage.local (with fallback to localStorage for local dev).
 */
export async function getResumeMetadata(): Promise<ResumeMetadata | null> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([STORAGE_KEYS.RESUME_METADATA], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve((result[STORAGE_KEYS.RESUME_METADATA] as ResumeMetadata) || null);
        }
      });
    });
  } else {
    // Development fallback
    const data = localStorage.getItem(STORAGE_KEYS.RESUME_METADATA);
    if (!data) return null;
    try {
      return JSON.parse(data) as ResumeMetadata;
    } catch {
      return null;
    }
  }
}

/**
 * Removes the resume metadata from chrome.storage.local (with fallback to localStorage for local dev).
 */
export async function removeResumeMetadata(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([STORAGE_KEYS.RESUME_METADATA], () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } else {
    // Development fallback
    localStorage.removeItem(STORAGE_KEYS.RESUME_METADATA);
    return Promise.resolve();
  }
}

/**
 * Saves the structured resume JSON.
 */
export async function saveStructuredResume(resume: StructuredResume): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEYS.STRUCTURED_RESUME]: resume }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } else {
    localStorage.setItem(STORAGE_KEYS.STRUCTURED_RESUME, JSON.stringify(resume));
    return Promise.resolve();
  }
}

/**
 * Retrieves the structured resume JSON.
 */
export async function getStructuredResume(): Promise<StructuredResume | null> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([STORAGE_KEYS.STRUCTURED_RESUME], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve((result[STORAGE_KEYS.STRUCTURED_RESUME] as StructuredResume) || null);
        }
      });
    });
  } else {
    const data = localStorage.getItem(STORAGE_KEYS.STRUCTURED_RESUME);
    if (!data) return null;
    try {
      return JSON.parse(data) as StructuredResume;
    } catch {
      return null;
    }
  }
}

/**
 * Removes the structured resume JSON.
 */
export async function removeStructuredResume(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([STORAGE_KEYS.STRUCTURED_RESUME], () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } else {
    localStorage.removeItem(STORAGE_KEYS.STRUCTURED_RESUME);
    return Promise.resolve();
  }
}

/**
 * Clears all storage keys managed by the extension (with fallback to localStorage for local dev).
 */
export async function clearStorage(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } else {
    // Development fallback
    localStorage.clear();
    return Promise.resolve();
  }
}
