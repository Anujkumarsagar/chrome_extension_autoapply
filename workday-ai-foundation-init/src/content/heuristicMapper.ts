import { FieldInfo, normalizeText } from './elementDetector';
import { StructuredResume } from '../types/resume';

/**
 * Heuristic mapping result
 */
export interface MappingResult {
  value: string | string[] | null;
  confidence: number; // 0 to 100
  isDirectMapping: boolean;
}

// ─── Exclusion Guards ───────────────────────────────────────────────────────────
// Patterns that must NOT match a rule even if the rule's keywords appear.
// Checked against both normLabel and normAutoId.
const EXCLUSION_GUARDS: Record<string, RegExp[]> = {
  phone: [
    // Block only fields that refer to the country dialing prefix or are non-number fields.
    // NOTE: Workday's Country Phone Code field has automationId "countryPhoneCode"
    // which must NOT match the plain phone-number rules.
    /countryPhoneCode/i,        // Workday automationId for the country code picker
    /country.*code/i,           // "Country Phone Code", "countryCode" labels
    /country.*dialing/i,
    /dialing.*code/i,
    /phone.*code/i,             // "Phone Code" variants
    /^country$/i,               // bare label "Country"
    /extension/i,               // "Phone Extension" → skip
    /sms/i,                     // SMS opt-in
    /opt.?in/i,
  ],
  city: [
    /^country$/i,               // bare label "Country" dropdowns
    /country.*select/i,
  ],
};

function isExcluded(ruleKey: string, normLabel: string, normAutoId: string): boolean {
  const guards = EXCLUSION_GUARDS[ruleKey];
  if (!guards) return false;
  return guards.some(re => re.test(normLabel) || re.test(normAutoId));
}

// ─── Helper: extract country code from phone number ────────────────────────────
function extractCountryCode(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Matches +91, +1, +44, etc. at the start of the number
  const match = phone.match(/^(\+\d{1,3})/);
  return match ? match[1] : null;
}

// ─── Helper: strip country code and return local digits only ───────────────────
function extractLocalPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Remove country code prefix like +91-, +1 , +44 , etc.
  // Handles: +91-XXXXXXXX  |  +91 XXXXXXXX  |  +91XXXXXXXX
  const stripped = phone.replace(/^\+\d{1,3}[-\s]?/, '').trim();
  // Keep only digits (and optionally dashes/spaces that Workday expects)
  // Return the raw stripped string — Workday's phone field accepts digits + dashes
  return stripped || null;
}
// ─── Helper: extract city only from "City, State, Country" location string ────
function extractCity(location: string | null | undefined): string | null {
  if (!location) return null;
  return location.split(',')[0].trim() || null;
}

// ─── Main Heuristic Rule Table ─────────────────────────────────────────────────
// Rules are matched top-to-bottom. First match wins.
// `excludeKey` references an EXCLUSION_GUARDS entry to skip false positives.
const HEURISTIC_MAPS: Array<{
  keys: string[];                 // automationId substrings
  patterns: string[];             // label exact or substring matches
  resolver: (resume: StructuredResume) => string | string[] | null | undefined;
  excludeKey?: string;            // name of exclusion guard to apply
}> = [
  // ── Personal info ──────────────────────────────────────────────────────────
  {
    keys: ['firstname', 'givenname', 'legalnameform_firstname', 'legalfirstname', 'localgivenname'],
    patterns: ['first name', 'given name', 'first (given) name', 'local given name'],
    resolver: (r) => r.personalInfo.firstName
  },
  {
    keys: ['lastname', 'familyname', 'legalnameform_lastname', 'legalfamilyname', 'localfamilyname'],
    patterns: ['last name', 'family name', 'last (family) name', 'surname', 'local family name'],
    resolver: (r) => r.personalInfo.lastName
  },
  {
    keys: ['email', 'emailaddress', 'contactinformation_email'],
    patterns: ['email', 'e-mail', 'email address'],
    resolver: (r) => r.personalInfo.email
  },

  // ── Phone — country code (MUST come before the plain phone rule) ──────────────
  // Matches fields specifically named for the country dialing prefix
  {
    keys: ['countrycode', 'countrydialing', 'country_phone_code', 'phonecountrycode'],
    patterns: ['country phone code', 'country code', 'dialing code', 'phone country code', 'country dial'],
    resolver: (r) => extractCountryCode(r.personalInfo.phone),
  },

  // ── Phone — plain number (excludes extension / country code / sms / country label) ──────────
  {
    keys: ['phonenumber', 'mobile', 'cellphone', 'contactinformation_phone'],
    patterns: ['phone number', 'mobile number', 'telephone number', 'cell number'],
    resolver: (r) => extractLocalPhone(r.personalInfo.phone),
    excludeKey: 'phone'
  },
  // Also match bare "phone*" label — but exclude extension/code/sms/country
  {
    keys: ['phone'],
    patterns: ['phone', 'mobile', 'telephone'],
    resolver: (r) => extractLocalPhone(r.personalInfo.phone),
    excludeKey: 'phone'
  },

  // ── Address ────────────────────────────────────────────────────────────────
  {
    keys: ['addressline1', 'address_line1', 'streetaddress', 'addresssection_addressline1'],
    patterns: ['address line 1', 'street address', 'address 1'],
    resolver: (r) => r.personalInfo.location // best effort if resume has full address
  },
  {
    keys: ['city', 'addresssection_city'],
    patterns: ['city', 'town'],
    resolver: (r) => extractCity(r.personalInfo.location),
    excludeKey: 'city'
  },

  // ── Social links ───────────────────────────────────────────────────────────
  {
    keys: ['linkedin', 'social_linkedin'],
    patterns: ['linkedin', 'linkedin profile', 'linkedin url'],
    resolver: (r) => r.personalInfo.linkedin
  },
  {
    keys: ['github', 'social_github'],
    patterns: ['github', 'github profile', 'github url'],
    resolver: (r) => r.personalInfo.github
  },
  {
    keys: ['website', 'portfolio', 'social_website'],
    patterns: ['website', 'portfolio', 'personal website', 'portfolio url'],
    resolver: (r) => r.personalInfo.website
  },
  {
    keys: ['skills', 'skillssection', 'addskill', 'typetoaddskills'],
    patterns: ['skills', 'key skills', 'technical skills', 'type to add skills', 'add skills'],
    resolver: (r) => r.skills.join(', ')
  },

  // ── Education — standalone rules (pull from resume.education[0]) ────────────
  // Handles Workday education section pages where there's no repeatableContext
  {
    keys: ['school', 'university', 'college', 'institution', 'schoolname'],
    patterns: ['school or university', 'school', 'university', 'college', 'institution', 'school name'],
    resolver: (r) => r.education?.[0]?.school || null
  },
  {
    keys: ['degree', 'diploma', 'degreetype'],
    patterns: ['degree', 'degree type', 'diploma', 'qualification', 'level of education'],
    resolver: (r) => r.education?.[0]?.degree || null
  },
  {
    keys: ['fieldofstudy', 'major', 'discipline', 'studyfield'],
    patterns: ['field of study', 'major', 'discipline', 'area of study', 'subject'],
    resolver: (r) => r.education?.[0]?.fieldOfStudy || null
  },
  {
    keys: ['gpa', 'overallresult', 'grade', 'cgpa', 'marks', 'result'],
    patterns: ['gpa', 'overall result', 'overall result (gpa)', 'cgpa', 'grade point', 'grade', 'marks'],
    resolver: (r) => r.education?.[0]?.gpa || null
  },
  {
    keys: ['education.*startyear', 'education.*startdate', 'education_startyear', 'education_startdate', 'startyear'],
    patterns: ['education start year', 'education start date', 'year attended from', 'from year', 'year started'],
    resolver: (r) => r.education?.[0]?.startDate ? r.education[0].startDate.split('-')[0] : null
  },
  {
    keys: ['education.*endyear', 'education.*enddate', 'education_endyear', 'education_enddate', 'endyear', 'graduationyear', 'graduationdate'],
    patterns: ['education end year', 'education end date', 'year attended to', 'to year', 'graduation year', 'year ended', 'year graduated', 'graduation date'],
    resolver: (r) => r.education?.[0]?.endDate ? (r.education[0].endDate === 'Present' ? new Date().getFullYear().toString() : r.education[0].endDate.split('-')[0]) : null
  },

  // ── Experience — standalone rules (pull from resume.experience[0]) ──────────
  {
    keys: ['jobtitle', 'jobrole', 'positiontitle'],
    patterns: ['job title', 'position title', 'role title', 'current title'],
    resolver: (r) => r.experience?.[0]?.title || null
  },
  {
    keys: ['currentemployer', 'currentcompany', 'employername'],
    patterns: ['current employer', 'current company', 'employer name', 'company name'],
    resolver: (r) => r.experience?.[0]?.company || null
  },
  {
    keys: ['experience.*startyear', 'experience.*startdate', 'experience_startyear', 'experience_startdate'],
    patterns: ['experience start year', 'experience start date'],
    resolver: (r) => r.experience?.[0]?.startDate ? r.experience[0].startDate.split('-')[0] : null
  },
  {
    keys: ['experience.*endyear', 'experience.*enddate', 'experience_endyear', 'experience_enddate'],
    patterns: ['experience end year', 'experience end date'],
    resolver: (r) => r.experience?.[0]?.endDate ? (r.experience[0].endDate === 'Present' ? new Date().getFullYear().toString() : r.experience[0].endDate.split('-')[0]) : null
  },

  // ── Summary / Cover Letter ──────────────────────────────────────────────────
  {
    keys: ['summary', 'professionalsummary', 'coverlettertext', 'aboutme'],
    patterns: ['summary', 'professional summary', 'about me', 'brief bio', 'cover letter'],
    resolver: (r) => r.summary || null
  }
];

// ─── Experience / Education repeatable field maps ───────────────────────────────
const EXPERIENCE_FIELDS: Record<string, string[]> = {
  title:       ['title', 'jobtitle', 'position', 'role'],
  company:     ['company', 'employer', 'organization', 'companyname'],
  location:    ['location', 'city', 'joblocation'],
  description: ['description', 'summary', 'details', 'responsibilities', 'duties'],
  startYear:   ['startyear', 'start_year'],
  startMonth:  ['startmonth', 'start_month'],
  endYear:     ['endyear', 'end_year'],
  endMonth:    ['endmonth', 'end_month']
};

const EDUCATION_FIELDS: Record<string, string[]> = {
  school:      ['school', 'university', 'college', 'institution'],
  degree:      ['degree', 'diploma'],
  fieldOfStudy:['fieldofstudy', 'major', 'discipline', 'subject'],
  gpa:         ['gpa', 'grade', 'marks'],
  startYear:   ['startyear', 'start_year'],
  endYear:     ['endyear', 'end_year']
};

// ─── Fields to explicitly SKIP (return null so the LLM is not called either) ──
// These are checkbox/toggle fields where the safest default is no-op.
const SKIP_PATTERNS: RegExp[] = [
  /sms.*opt/,
  /opt.*in/,
  /preferred.*name/,           // "I have a preferred name" → leave unchecked
  /phone.*extension/,          // Extension is optional, skip if no data
  /extension.*phone/,
];

/**
 * Attempts to resolve a field's value locally using fast heuristic patterns.
 * Returns { value: null, confidence: 0 } to trigger AI fallback.
 * Returns { value: 'SKIP', confidence: 100 } to explicitly skip a field.
 */
export function mapFieldHeuristically(
  field: FieldInfo,
  resume: StructuredResume,
  repeatableContext?: { type: 'experience' | 'education'; index: number }
): MappingResult {
  const normLabel  = normalizeText(field.label);
  const normAutoId = field.automationId ? field.automationId.toLowerCase() : '';

  // ── 0. Explicit skip rules (do nothing, don't call AI) ──────────────────────
  if (SKIP_PATTERNS.some(re => re.test(normLabel) || re.test(normAutoId))) {
    return { value: null, confidence: 100, isDirectMapping: false };
    // confidence:100 means "we know the answer is nothing — don't call AI"
  }

  // ── 1. Repeatable section context (experience / education) ───────────────────
  if (repeatableContext) {
    if (repeatableContext.type === 'experience') {
      const exp = resume.experience[repeatableContext.index];
      if (exp) {
        for (const [key, aliases] of Object.entries(EXPERIENCE_FIELDS)) {
          if (aliases.some(alias => normLabel.includes(alias) || normAutoId.includes(alias))) {
            const val = getExperienceValue(exp, key);
            if (val) return { value: val, confidence: 95, isDirectMapping: true };
          }
        }
      }
    } else if (repeatableContext.type === 'education') {
      const edu = resume.education[repeatableContext.index];
      if (edu) {
        for (const [key, aliases] of Object.entries(EDUCATION_FIELDS)) {
          if (aliases.some(alias => normLabel.includes(alias) || normAutoId.includes(alias))) {
            const val = getEducationValue(edu, key);
            if (val) return { value: val, confidence: 95, isDirectMapping: true };
          }
        }
      }
    }
  }

  // ── 2. Standard profile fields ───────────────────────────────────────────────
  for (const rule of HEURISTIC_MAPS) {
    if (rule.excludeKey && isExcluded(rule.excludeKey, normLabel, normAutoId)) continue;

    // automationId key match: check if any key appears as substring in normAutoId
    const isAutoIdMatch = rule.keys.some(key => {
      // Support simple regex-like keys (containing *)
      if (key.includes('.*')) {
        try { return new RegExp(key).test(normAutoId); } catch { return false; }
      }
      return normAutoId.includes(key);
    });

    const isLabelMatch = rule.patterns.some(
      pattern => normLabel === pattern || normLabel.includes(pattern)
    );

    if (isAutoIdMatch || isLabelMatch) {
      const value = rule.resolver(resume);
      if (value != null && value !== '') {
        return {
          value,
          confidence: isAutoIdMatch ? 98 : 90,
          isDirectMapping: true
        };
      }
    }
  }

  // ── 3. Static yes/no rules for common legal / work-auth questions ─────────────
  if (normLabel.includes('authorized to work') || normLabel.includes('legally authorized')) {
    return { value: 'Yes', confidence: 85, isDirectMapping: false };
  }
  if (
    normLabel.includes('require sponsorship') ||
    normLabel.includes('visa sponsorship') ||
    (normLabel.includes('sponsorship') && !normLabel.includes('authorized'))
  ) {
    return { value: 'No', confidence: 85, isDirectMapping: false };
  }

  return { value: null, confidence: 0, isDirectMapping: false };
}

// ─── Value Extractors ──────────────────────────────────────────────────────────

function getExperienceValue(exp: any, key: string): string | null {
  switch (key) {
    case 'title':       return exp.title    || null;
    case 'company':     return exp.company  || null;
    case 'location':    return exp.location || null;
    case 'description': return exp.description || null;
    case 'startYear':   return exp.startDate ? exp.startDate.split('-')[0] : null;
    case 'startMonth':  return exp.startDate ? exp.startDate.split('-')[1] : null;
    case 'endYear':     return (exp.endDate && exp.endDate !== 'Present') ? exp.endDate.split('-')[0] : null;
    case 'endMonth':    return (exp.endDate && exp.endDate !== 'Present') ? exp.endDate.split('-')[1] : null;
    default:            return null;
  }
}

function getEducationValue(edu: any, key: string): string | null {
  switch (key) {
    case 'school':       return edu.school       || null;
    case 'degree':       return edu.degree       || null;
    case 'fieldOfStudy': return edu.fieldOfStudy || null;
    case 'gpa':          return edu.gpa          || null;
    case 'startYear':    return edu.startDate ? edu.startDate.split('-')[0] : null;
    case 'endYear':      return (edu.endDate && edu.endDate !== 'Present') ? edu.endDate.split('-')[0] : null;
    default:             return null;
  }
}
