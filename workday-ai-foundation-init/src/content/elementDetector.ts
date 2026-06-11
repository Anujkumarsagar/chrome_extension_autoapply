export interface FieldInfo {
  id: string;
  label: string;
  description: string;
  type: 'text' | 'select' | 'checkbox' | 'radio' | 'date' | 'textarea' | 'file' | 'unknown' | 'number' | 'email' | 'tel' | 'url' | 'password';
  element: HTMLElement;
  required: boolean;
  automationId?: string;
  container: HTMLElement;
}

/**
 * Normalizes strings by converting to lowercase and stripping extra spaces.
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\*\:]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Searches for label text associated with a given input/select element.
 */
function findLabelForElement(element: HTMLElement, container: HTMLElement): { label: string; description: string } {
  let labelText = '';
  let descText = '';

  // 1. Prioritize legend or label tags inside the field container (descriptive headers)
  if (container) {
    const legendOrLabel = container.querySelector('legend, label');
    if (legendOrLabel) {
      labelText = legendOrLabel.textContent || '';
    }
  }

  // 2. Check html label elements with matching 'for' attribute
  if (!labelText) {
    const elementId = element.getAttribute('id');
    if (elementId) {
      const matchingLabel = document.querySelector(`label[for="${elementId}"]`);
      if (matchingLabel) {
        labelText = matchingLabel.textContent || '';
      }
    }
  }

  // 3. Check aria-label if it's descriptive and not generic select placeholder
  if (!labelText) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && !/^\s*(select one|select value|required)\s*$/i.test(ariaLabel)) {
      labelText = ariaLabel;
    }
  }

  // 4. Fallback search inside container class names matching label
  if (!labelText && container) {
    const labelEl = container.querySelector('[class*="label"], [id*="label"]');
    if (labelEl) {
      labelText = labelEl.textContent || '';
    }
  }

  // 5. Fallback to placeholder
  if (!labelText) {
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) {
      labelText = placeholder;
    }
  }

  // Look for description/helper text
  if (container) {
    const descEl = container.querySelector('[class*="help"], [class*="hint"], [class*="description"], [id*="help"]');
    if (descEl) {
      descText = descEl.textContent || '';
    }
  }

  // Clean and strip formatting tags (e.g. asterisks)
  return {
    label: labelText.replace(/\s+/g, ' ').replace(/Required/g, '').replace(/[\*\:]/g, '').trim(),
    description: descText.replace(/\s+/g, ' ').trim()
  };
}

/**
 * Identifies the field type of a given HTMLElement.
 */
function detectFieldType(element: HTMLElement): FieldInfo['type'] {
  const tagName = element.tagName.toLowerCase();
  
  if (tagName === 'textarea') {
    return 'textarea';
  }

  const role = element.getAttribute('role')?.toLowerCase();
  const hasPopup = element.getAttribute('aria-haspopup')?.toLowerCase();

  // Custom button dropdowns or generic select combobox controls
  if (
    role === 'combobox' ||
    hasPopup === 'listbox' ||
    hasPopup === 'true' ||
    hasPopup === 'menu' ||
    element.closest('[data-automation-id="select-selected-item"]') ||
    (tagName === 'button' && hasPopup)
  ) {
    return 'select';
  }

  if (tagName === 'input') {
    const typeAttr = element.getAttribute('type')?.toLowerCase();
    
    if (typeAttr === 'checkbox') return 'checkbox';
    if (typeAttr === 'radio') return 'radio';
    if (typeAttr === 'file') return 'file';
    if (typeAttr === 'date') return 'date';
    if (typeAttr === 'number') return 'number';
    if (typeAttr === 'email') return 'email';
    if (typeAttr === 'tel') return 'tel';
    if (typeAttr === 'url') return 'url';
    if (typeAttr === 'password') return 'password';
    
    // Check if parent indicates date picker
    if (element.closest('[class*="DatePicker"], [id*="date"], [data-automation-id*="date"]')) {
      return 'date';
    }

    return 'text';
  }

  return 'unknown';
}

/**
 * Scans the page DOM to locate all active Workday form fields.
 */
export function detectFormFields(): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const processedElements = new Set<HTMLElement>();

  // Query all potential interactive inputs/buttons
  const controls = document.querySelectorAll<HTMLElement>(
    'input, textarea, button[aria-haspopup], [role="combobox"], [data-automation-id="select-selected-item"]'
  );

  // Helper to find the nearest logical form container (fieldset, row, or group)
  const findFieldContainer = (control: HTMLElement): HTMLElement => {
    const matched = control.closest('fieldset, [data-automation-id*="formField-"], [class*="formRow"], [class*="form-row"], [class*="formField"], [class*="form-group"]');
    return (matched as HTMLElement) || control.parentElement || document.body;
  };

  controls.forEach((control) => {
    if (processedElements.has(control)) return;
    
    // Skip hidden or disabled elements
    const style = window.getComputedStyle(control);
    if (style.display === 'none' || style.visibility === 'hidden' || control.hasAttribute('disabled')) {
      return;
    }

    const container = findFieldContainer(control);

    // Skip helper inputs inside select dropdown containers to avoid duplicate registration
    if (control.tagName.toLowerCase() === 'input' && control.getAttribute('type') === 'text') {
      if (container.querySelector('button[aria-haspopup], [role="combobox"], [data-automation-id="select-selected-item"]')) {
        return;
      }
    }

    const { label, description } = findLabelForElement(control, container);
    const type = detectFieldType(control);

    // Only register the first radio button in the container to avoid duplicate groups
    if (type === 'radio') {
      const alreadyRegistered = fields.some(f => f.container === container && f.type === 'radio');
      if (alreadyRegistered) {
        processedElements.add(control);
        return;
      }
    }

    const required = control.getAttribute('required') === 'true' || 
                     control.getAttribute('aria-required') === 'true' || 
                     !!container.querySelector('[class*="required"], [class*="asterisk"]');
    
    const automationId = control.getAttribute('data-automation-id') || 
                           container.getAttribute('data-automation-id') || 
                           control.closest('[data-automation-id]')?.getAttribute('data-automation-id') || 
                           undefined;

    processedElements.add(control);

    fields.push({
      id: control.id || `field_${Math.random().toString(36).substring(7)}`,
      label,
      description,
      type,
      element: control,
      required,
      automationId,
      container
    });
  });

  // Remove fields with completely empty labels (except standard upload/etc where type is obvious)
  return fields.filter(f => f.label || f.automationId || f.type === 'file');
}


