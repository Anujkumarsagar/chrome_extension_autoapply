import { FieldInfo } from './elementDetector';

/**
 * Focuses an element, scrolls it into view, and dispatches focus event.
 */
export async function focusAndScroll(element: HTMLElement): Promise<void> {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.focus();
  element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 80));
}

/**
 * Sets a value on an input/textarea using the React-compatible native setter,
 * then fires the full sequence of events React expects.
 */
export function triggerReactEvents(element: HTMLElement, value: string): void {
  const isTextarea = element instanceof HTMLTextAreaElement;
  const prototype = isTextarea
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (valueSetter?.set) {
    valueSetter.set.call(element, value);
  } else {
    (element as HTMLInputElement).value = value;
  }

  element.dispatchEvent(new Event('input',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}

/**
 * Simulates genuine key-by-key typing into an input field.
 * Workday's React forms sometimes reject programmatic value setting unless
 * they see individual keydown → keypress → input → keyup sequences.
 */
async function simulateTyping(element: HTMLElement, value: string): Promise<void> {
  const input = element as HTMLInputElement;

  // Clear existing content first
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');

  // Select-all + delete simulation
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
  if (nativeSetter?.set) nativeSetter.set.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // Type each character
  for (const char of value) {
    input.dispatchEvent(new KeyboardEvent('keydown',  { key: char, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true, cancelable: true }));

    const current = input.value;
    if (nativeSetter?.set) nativeSetter.set.call(input, current + char);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await new Promise(r => setTimeout(r, 8)); // tiny delay per char
  }

  // Final change + blur to trigger validation
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}

/**
 * Fills a standard text or textarea input field.
 * Uses character-by-character simulation for inputs to satisfy Workday React validation.
 */
export async function fillTextInput(field: FieldInfo, value: string): Promise<boolean> {
  const element = field.element;
  await focusAndScroll(element);

  if (element.tagName.toLowerCase() === 'textarea') {
    // Textareas: bulk set is fine (React validation less strict)
    triggerReactEvents(element, value);
  } else {
    // Inputs: simulate typing to pass Workday's real-time validation
    await simulateTyping(element, value);
  }
  return true;
}

// ─── Dropdown Option Helpers ───────────────────────────────────────────────────

/** Wait until at least one listbox option appears in the DOM, or timeout. */
async function waitForOptions(timeoutMs = 2000): Promise<Element[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const opts = scrapeVisibleOptions();
    if (opts.length > 0) return opts;
    await new Promise(r => setTimeout(r, 80));
  }
  return [];
}

/** Collect all currently visible listbox options across the document. */
function scrapeVisibleOptions(): Element[] {
  return Array.from(document.querySelectorAll(
    '[role="option"], [role="listbox"] li, [data-automation-id*="option"], li[id*="listbox-option"], [class*="selectOption"], [class*="dropdownOption"]'
  )).filter(el => {
    const style = window.getComputedStyle(el as HTMLElement);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/** Fuzzy match: find the element whose text best matches the target. */
function findBestMatch(options: Element[], target: string): HTMLElement | null {
  const clean = target.toLowerCase().trim();
  let bestEl: HTMLElement | null = null;
  let bestScore = -1;

  for (const el of options) {
    const text = (el.textContent || '').toLowerCase().trim();
    if (!text) continue;

    let score = 0;
    if (text === clean) {
      score = 100;
    } else if (text.startsWith(clean) || clean.startsWith(text)) {
      score = 80;
    } else if (text.includes(clean) || clean.includes(text)) {
      score = 60;
    } else {
      // Word-level overlap
      const targetWords = clean.split(/\s+/);
      const textWords = text.split(/\s+/);
      const overlap = targetWords.filter(w => textWords.some(tw => tw.includes(w) || w.includes(tw)));
      score = Math.round((overlap.length / Math.max(targetWords.length, 1)) * 40);
    }

    if (score > bestScore) {
      bestScore = score;
      bestEl = el as HTMLElement;
    }
  }

  // Only return if we have at least a partial match
  return bestScore >= 40 ? bestEl : null;
}

/**
 * Scrapes all visible dropdown options WITHOUT changing field state.
 * Opens the dropdown, collects options, then closes it.
 * Returns an array of option text strings.
 */
export async function scrapeDropdownOptions(field: FieldInfo): Promise<string[]> {
  const trigger = field.element;
  await focusAndScroll(trigger);

  // Strategy A: if it's a combobox input, click to focus (this often opens the list)
  trigger.click();
  await new Promise(r => setTimeout(r, 100));

  const options = await waitForOptions(1500);

  // Close by pressing Escape or clicking away
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 100));

  return options.map(el => (el.textContent || '').trim()).filter(Boolean);
}

/**
 * Main dropdown fill function — three strategies tried in order:
 *
 *  1. TYPE to filter (works for searchable/combobox inputs — most Workday fields)
 *  2. CLICK-ONLY (works for button-triggered static lists)
 *  3. KEYBOARD NAVIGATION (arrow down + enter, fallback for stubborn dropdowns)
 */
export async function fillSelectDropdown(
  field: FieldInfo,
  targetValue: string
): Promise<{ success: boolean; optionsScraped?: string[] }> {
  const trigger = field.element;
  await focusAndScroll(trigger);

  // ── Strategy 1: Type to filter (searchable combobox) ──────────────────────
  // Workday's combobox inputs respond to keyboard input by filtering options.
  if (trigger.tagName.toLowerCase() === 'input' || trigger.getAttribute('role') === 'combobox') {
    // Clear existing value and type the target
    const inputEl = trigger as HTMLInputElement;

    // Open and clear
    inputEl.click();
    await new Promise(r => setTimeout(r, 120));

    // Set value and fire events (React-compatible)
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (nativeInputSetter?.set) nativeInputSetter.set.call(inputEl, targetValue);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    // Also simulate keydown for each char to trigger React handlers
    for (const char of targetValue) {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    }

    // Wait for filtered options to appear
    const filteredOptions = await waitForOptions(2000);
    const allOptionTexts = filteredOptions.map(el => (el.textContent || '').trim()).filter(Boolean);

    if (filteredOptions.length > 0) {
      const match = findBestMatch(filteredOptions, targetValue);
      if (match) {
        match.scrollIntoView({ block: 'nearest' });
        match.click();
        await new Promise(r => setTimeout(r, 200));
        return { success: true, optionsScraped: allOptionTexts };
      }

      // If typed filter produced options but none matched — try clicking the first one
      // (AI already chose this value so it should exist)
      const first = filteredOptions[0] as HTMLElement;
      first.scrollIntoView({ block: 'nearest' });
      first.click();
      await new Promise(r => setTimeout(r, 200));
      return { success: true, optionsScraped: allOptionTexts };
    }
  }

  // ── Strategy 2: Click trigger to open static listbox ──────────────────────
  trigger.click();
  await new Promise(r => setTimeout(r, 150));

  const clickOptions = await waitForOptions(2500);
  const clickOptionTexts = clickOptions.map(el => (el.textContent || '').trim()).filter(Boolean);

  if (clickOptions.length > 0) {
    const match = findBestMatch(clickOptions, targetValue);
    if (match) {
      match.scrollIntoView({ block: 'nearest' });
      match.click();
      await new Promise(r => setTimeout(r, 200));
      return { success: true, optionsScraped: clickOptionTexts };
    }
    // Close if no match
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    return { success: false, optionsScraped: clickOptionTexts };
  }

  // ── Strategy 3: Arrow-down keyboard navigation ─────────────────────────────
  trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise(r => setTimeout(r, 200));

  const arrowOptions = await waitForOptions(1000);
  if (arrowOptions.length > 0) {
    const arrowOptionTexts = arrowOptions.map(el => (el.textContent || '').trim()).filter(Boolean);
    const match = findBestMatch(arrowOptions, targetValue);
    if (match) {
      match.scrollIntoView({ block: 'nearest' });
      match.click();
      await new Promise(r => setTimeout(r, 200));
      return { success: true, optionsScraped: arrowOptionTexts };
    }
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { success: false, optionsScraped: arrowOptionTexts };
  }

  return { success: false };
}

/**
 * Handles checkbox selection.
 */
export async function fillCheckbox(field: FieldInfo, shouldCheck: boolean): Promise<boolean> {
  const checkbox = field.element as HTMLInputElement;
  const isCurrentlyChecked = checkbox.checked;

  if (isCurrentlyChecked !== shouldCheck) {
    await focusAndScroll(checkbox);
    checkbox.click();
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

/**
 * Handles radio button selection by locating matching choices inside the field container.
 */
export async function fillRadioGroup(field: FieldInfo, targetChoice: string): Promise<boolean> {
  const container = field.container;
  const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"], [role="radio"]'));

  if (radios.length === 0) return false;

  const cleanTarget = targetChoice.toLowerCase().trim();
  let bestRadio: HTMLElement | null = null;

  for (const radio of radios) {
    const parentLabel = radio.closest('label');
    const adjacentLabel = parentLabel
      ? parentLabel.textContent
      : container.querySelector(`label[for="${radio.id}"]`)?.textContent;

    const labelText = (adjacentLabel || radio.getAttribute('value') || '').toLowerCase();
    if (labelText.includes(cleanTarget) || cleanTarget.includes(labelText)) {
      bestRadio = radio;
      break;
    }
  }

  if (bestRadio) {
    await focusAndScroll(bestRadio);
    bestRadio.click();
    bestRadio.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  if (field.required) {
    const fallbackRadio = radios[0];
    await focusAndScroll(fallbackRadio);
    fallbackRadio.click();
    fallbackRadio.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  return false;
}

/**
 * Parses and fills date fields. Supports single input and multi-part (YYYY/MM/DD) splits.
 */
export async function fillDatePicker(field: FieldInfo, dateStr: string): Promise<boolean> {
  const element = field.element as HTMLInputElement;

  if (element.tagName.toLowerCase() === 'input') {
    await focusAndScroll(element);
    triggerReactEvents(element, dateStr);
    return true;
  }

  const container = field.container;
  const subInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]');

  if (subInputs.length >= 2) {
    const parts = dateStr.split('-'); // [YYYY, MM, DD]
    if (parts.length >= 2) {
      const year = parts[0];
      const month = parts[1];
      const day = parts[2] || '01';

      for (const input of Array.from(subInputs)) {
        const id = (input.getAttribute('data-automation-id') || input.id || '').toLowerCase();
        await focusAndScroll(input);
        if (id.includes('month')) {
          triggerReactEvents(input, month);
        } else if (id.includes('year')) {
          triggerReactEvents(input, year);
        } else if (id.includes('day')) {
          triggerReactEvents(input, day);
        }
      }
      return true;
    }
  }

  return false;
}
