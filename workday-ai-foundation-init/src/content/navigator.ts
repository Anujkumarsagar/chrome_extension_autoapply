import { FieldInfo } from './elementDetector';

/**
 * Detects the current page name or step by looking at headers and URLs.
 */
export function getCurrentStepName(): string {
  const url = window.location.href;
  
  // 1. Try URL clues
  if (url.includes('/login')) return 'Login Screen';
  if (url.includes('/contactInformation') || url.includes('/contact-info')) return 'Contact Information';
  if (url.includes('/myExperience') || url.includes('/experience')) return 'Work Experience & Education';
  if (url.includes('/voluntaryDisclosure') || url.includes('/disclosure')) return 'Voluntary Disclosures';
  if (url.includes('/review')) return 'Review Application';

  // 2. Try looking at section headings in the DOM
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, [class*="title"], [class*="heading"]'));
  for (const h of headings) {
    const text = (h.textContent || '').trim().toLowerCase();
    if (text.includes('contact information') || text.includes('personal information')) {
      return 'Contact Information';
    }
    if (text.includes('experience') || text.includes('education') || text.includes('history')) {
      return 'Work Experience & Education';
    }
    if (text.includes('disclosure') || text.includes('voluntary') || text.includes('diversity')) {
      return 'Voluntary Disclosures';
    }
    if (text.includes('review') || text.includes('summary')) {
      return 'Review Application';
    }
  }

  return 'Application Form';
}

/**
 * Finds and clicks the primary Workday "Save and Continue" or "Next" button.
 */
export async function clickNextButton(): Promise<boolean> {
  const nextSelectors = [
    '[data-automation-id="bottom-navigation-next-button"]',
    'button[data-automation-id="bottom-navigation-next-button"]',
    '[data-automation-id="pageFooterNextButton"]',
    'button[data-automation-id="pageFooterNextButton"]',
    'button:has(span:contains("Save and Continue"))',
    'button:has(span:contains("Next"))',
    'button:has(span:contains("Continue"))'
  ];

  let nextButton: HTMLElement | null = null;

  for (const selector of nextSelectors) {
    // Standard selector
    nextButton = document.querySelector(selector) as HTMLElement;
    if (nextButton) break;

    // text fallback
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text.includes('save and continue') || text === 'next' || text === 'continue') {
        nextButton = btn;
        break;
      }
    }
  }

  if (nextButton) {
    nextButton.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await new Promise(resolve => setTimeout(resolve, 200));
    nextButton.click();
    return true;
  }

  return false;
}

/**
 * Helper to group detected fields into repeatable sections (like education/experience)
 * based on their physical top-to-bottom layout coordinate sequence.
 */
export function groupRepeatableFields(
  fields: FieldInfo[],
  type: 'experience' | 'education'
): Map<number, FieldInfo[]> {
  const grouped = new Map<number, FieldInfo[]>();
  
  // Filter fields belonging to this section
  const sectionFields = fields.filter(f => {
    const text = (f.label + ' ' + (f.automationId || '')).toLowerCase();
    
    if (type === 'experience') {
      return text.includes('job') || text.includes('company') || text.includes('employer') || 
             text.includes('experience') || text.includes('role') || text.includes('description');
    } else {
      return text.includes('school') || text.includes('university') || text.includes('degree') || 
             text.includes('major') || text.includes('education') || text.includes('gpa');
    }
  });

  if (sectionFields.length === 0) return grouped;

  // Sort fields by their vertical offset top in the DOM layout
  const sorted = [...sectionFields].sort((a, b) => {
    const rectA = a.element.getBoundingClientRect();
    const rectB = b.element.getBoundingClientRect();
    return rectA.top - rectB.top;
  });

  // Group fields. We assume fields are repeated sequentially.
  // We detect boundary changes by mapping occurrences of the first field.
  // For instance, if 'company' or 'school' shows up again, it marks a new block.
  let currentGroupIndex = 0;
  const seenTypes = new Set<string>();

  for (const field of sorted) {
    const labelKey = field.label.toLowerCase() || field.automationId || '';
    
    // Simple similarity key for checking repetitions
    let keyType = 'other';
    if (labelKey.includes('company') || labelKey.includes('employer') || labelKey.includes('school') || labelKey.includes('university')) {
      keyType = 'heading';
    }

    if (keyType === 'heading' && seenTypes.has(keyType)) {
      currentGroupIndex++;
      seenTypes.clear();
    }

    if (keyType !== 'other') {
      seenTypes.add(keyType);
    }

    if (!grouped.has(currentGroupIndex)) {
      grouped.set(currentGroupIndex, []);
    }
    grouped.get(currentGroupIndex)!.push(field);
  }

  return grouped;
}
