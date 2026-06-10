export interface FieldInfo {
  id: string;
  label: string;
  description: string;
  type: 'text' | 'select' | 'checkbox' | 'radio' | 'date' | 'textarea' | 'file' | 'unknown';
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

  // 1. Check aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    labelText = ariaLabel;
  }

  // 2. Check html label elements with matching 'for' attribute
  const elementId = element.getAttribute('id');
  if (elementId) {
    const matchingLabel = document.querySelector(`label[for="${elementId}"]`);
    if (matchingLabel) {
      labelText = matchingLabel.textContent || '';
    }
  }

  // 3. Search up the DOM tree inside the field container
  if (!labelText && container) {
    // Look for elements with label tags or classes that sound like labels
    const labelEl = container.querySelector('label, [class*="label"], [id*="label"]');
    if (labelEl) {
      labelText = labelEl.textContent || '';
    }

    // Look for description/helper text
    const descEl = container.querySelector('[class*="help"], [class*="hint"], [class*="description"], [id*="help"]');
    if (descEl) {
      descText = descEl.textContent || '';
    }
  }

  // 4. Fallback to placeholder
  if (!labelText) {
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) {
      labelText = placeholder;
    }
  }

  return {
    label: labelText.replace(/\s+/g, ' ').trim(),
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

  if (tagName === 'input') {
    const typeAttr = element.getAttribute('type')?.toLowerCase();
    
    if (typeAttr === 'checkbox') return 'checkbox';
    if (typeAttr === 'radio') return 'radio';
    if (typeAttr === 'file') return 'file';
    if (typeAttr === 'date') return 'date';
    
    // Check if parent indicates date picker
    if (element.closest('[class*="DatePicker"], [id*="date"], [data-automation-id*="date"]')) {
      return 'date';
    }

    return 'text';
  }

  // Check if it is a Workday custom select/combobox
  const role = element.getAttribute('role')?.toLowerCase();
  const hasPopup = element.getAttribute('aria-haspopup')?.toLowerCase();
  if (role === 'combobox' || hasPopup === 'true' || element.closest('[data-automation-id="select-selected-item"]')) {
    return 'select';
  }

  return 'unknown';
}

/**
 * Scans the page DOM to locate all active Workday form fields.
 */
export function detectFormFields(): FieldInfo[] {
  const fields: FieldInfo[] = [];

  // Workday typically wraps fields inside form group rows or containers
  const containers = document.querySelectorAll(
    '[class*="formRow"], [class*="form-row"], [class*="formField"], [class*="form-group"], div:has(> label)'
  );

  const processedElements = new Set<HTMLElement>();

  // Helper to register a field
  const registerField = (element: HTMLElement, container: HTMLElement) => {
    if (processedElements.has(element)) return;
    
    // Skip hidden or disabled elements
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || element.hasAttribute('disabled')) {
      return;
    }

    const { label, description } = findLabelForElement(element, container);
    const type = detectFieldType(element);
    const required = element.getAttribute('required') === 'true' || 
                     element.getAttribute('aria-required') === 'true' || 
                     !!container.querySelector('[class*="required"], [class*="asterisk"]');
    
    const automationId = element.getAttribute('data-automation-id') || 
                           container.getAttribute('data-automation-id') || 
                           element.closest('[data-automation-id]')?.getAttribute('data-automation-id') || 
                           undefined;

    processedElements.add(element);

    fields.push({
      id: element.id || `field_${Math.random().toString(36).substring(7)}`,
      label,
      description,
      type,
      element,
      required,
      automationId,
      container
    });
  };

  // 1. Process items inside known form rows/containers
  containers.forEach((container) => {
    const inputControls = container.querySelectorAll<HTMLElement>('input, textarea, [role="combobox"], [data-automation-id="select-selected-item"]');
    inputControls.forEach((control) => {
      registerField(control, container as HTMLElement);
    });
  });

  // 2. Global fallback scan for loose input/select/textarea controls not inside containers
  const allControls = document.querySelectorAll<HTMLElement>('input, textarea, [role="combobox"]');
  allControls.forEach((control) => {
    if (!processedElements.has(control)) {
      const container = control.parentElement || document.body;
      registerField(control, container);
    }
  });

  // Remove fields with completely empty labels (except standard upload/etc where type is obvious)
  return fields.filter(f => f.label || f.automationId || f.type === 'file');
}
