/**
 * Metadata about the uploaded resume file.
 */
export interface ResumeMetadata {
  fileName: string;
  fileSize: number;
  uploadedAt: string; // ISO string
}

/**
 * Log entry for activity tracking within the popup.
 */
export interface ActivityLog {
  id: string;
  timestamp: string; // ISO string
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  message: string;
  source: 'popup' | 'background' | 'content';
}

/**
 * Status of the autofill automation process.
 */
export interface AutomationStatus {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  currentPage: string;
  progress: number; // 0 to 100
  startedAt?: string; // ISO string
  completedAt?: string; // ISO string
  error?: string;
}

export interface EducationEntry {
  school: string;
  degree?: string;
  fieldOfStudy?: string;
  startDate?: string; // YYYY-MM or YYYY
  endDate?: string;   // YYYY-MM or YYYY
  gpa?: string;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  location?: string;
  startDate?: string; // YYYY-MM
  endDate?: string;   // YYYY-MM (or "Present")
  description?: string;
}

export interface StructuredResume {
  personalInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: string[];
  summary?: string;
}
