import { createLogger } from '../utils/logger';
import { MessageType } from '../constants/messageTypes';
import { ExtensionMessage, ExtensionResponse } from '../types/messages';
import { StructuredResume } from '../types/resume';
import { detectFormFields, FieldInfo } from './elementDetector';
import { mapFieldHeuristically } from './heuristicMapper';
import {
  fillTextInput,
  fillSelectDropdown,
  fillCheckbox,
  fillRadioGroup,
  fillDatePicker,
  scrapeDropdownOptions
} from './formFiller';
import { clickNextButton, getCurrentStepName } from './navigator';

const logger = createLogger('content');

// ─── Global State ──────────────────────────────────────────────────────────────
let isRunning = false;
let shouldStop = false;

// ─── Logging Relay ─────────────────────────────────────────────────────────────
function logToExtension(level: 'info' | 'warn' | 'error' | 'debug', message: string) {
  switch (level) {
    case 'warn':   logger.warn(message);  break;
    case 'error':  logger.error(message); break;
    case 'debug':  logger.debug(message); break;
    default:       logger.info(message);  break;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(
      { type: 'LOG_RELAY', payload: { level, message } },
      () => { if (chrome.runtime.lastError) { /* ignored — popup may be closed */ } }
    );
  }
}

logToExtension('info', `Workday AI Autofill content script loaded on: ${window.location.href}`);

// ─── Service Worker Wakeup ─────────────────────────────────────────────────────
// MV3 service workers sleep after ~30s. Sending a no-op ping wakes them before
// the actual LLM call, preventing undefined responses on the first message.
let serviceWorkerWarmedUp = false;
function ensureServiceWorkerAlive(): Promise<void> {
  if (serviceWorkerWarmedUp) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      logToExtension('warn', 'Service worker wakeup ping timed out.');
      resolve();
    }, 4000);

    chrome.runtime.sendMessage({ type: MessageType.PING }, () => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) { /* worker was asleep — it's awake now */ }
      serviceWorkerWarmedUp = true;
      resolve();
    });
  });
}

/**
 * Recursively sanitizes a DOM subtree by removing styles, classes, scripts,
 * graphics, and irrelevant attributes. Retains only high-value identifiers and
 * textual cues to minimize token consumption by up to 90%.
 */
function cleanDOMContext(element: HTMLElement): string {
  try {
    const clone = element.cloneNode(true) as HTMLElement;

    const stripNode = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tagName = el.tagName.toLowerCase();

        // Remove code, style, scripts, and graphical visual markers
        if (['script', 'style', 'svg', 'path', 'g', 'polygon', 'rect', 'circle', 'iframe', 'noscript', 'img', 'picture'].includes(tagName)) {
          el.remove();
          return;
        }

        // Clean attributes, preserving only functional identifiers and labels
        const attrs = Array.from(el.attributes);
        const allowedAttrs = ['id', 'name', 'placeholder', 'aria-label', 'data-automation-id', 'value', 'type', 'required', 'role'];
        for (const attr of attrs) {
          if (!allowedAttrs.includes(attr.name)) {
            el.removeAttribute(attr.name);
          }
        }
      }

      // Process children (in reverse order to handle deletions correctly)
      const children = Array.from(node.childNodes);
      for (let i = children.length - 1; i >= 0; i--) {
        stripNode(children[i]);
      }
    };

    stripNode(clone);
    return clone.outerHTML.replace(/\s+/g, ' ').trim().substring(0, 1000);
  } catch (err) {
    // Return standard fallback if cloning fails
    return element.outerHTML.replace(/\s+/g, ' ').substring(0, 800);
  }
}

// ─── LLM Bridge ────────────────────────────────────────────────────────────────
/**
 * Asks the background service-worker to run the ANALYZE_QUESTION handler.
 * Wakes the service worker if dormant, retries up to 2 times on failure.
 * Returns { value, confidence, reasoning } or null on total failure.
 */
async function queryAIForField(
  field: FieldInfo,
  resumeJson: StructuredResume,
  availableOptions?: string[]
): Promise<{ value: string | null; confidence: number; reasoning: string } | null> {
  // Clean HTML to save tokens
  const containerHtml = field.container
    ? cleanDOMContext(field.container)
    : undefined;

  const payload = {
    type: MessageType.ANALYZE_QUESTION,
    payload: {
      label: field.label,
      description: field.description || undefined,
      options: availableOptions && availableOptions.length > 0 ? availableOptions : undefined,
      containerHtml,
      resumeJson
    }
  };

  // Wake the service worker before the real call
  await ensureServiceWorkerAlive();

  const sendOnce = (): Promise<{ value: string | null; confidence: number; reasoning: string } | null> =>
    new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logToExtension('warn', `AI call timed out after 30 seconds for field "${field.label}".`);
          resolve(null);
        }
      }, 30000);

      chrome.runtime.sendMessage(
        payload,
        (response: ExtensionResponse<{ value: string | null; confidence: number; reasoning: string }>) => {
          clearTimeout(timer);
          if (resolved) return;
          resolved = true;

          if (chrome.runtime.lastError) {
            logToExtension('error', `LLM bridge error: ${chrome.runtime.lastError.message}`);
            resolve(null);
            return;
          }
          if (response?.success && response.data) {
            resolve(response.data);
          } else {
            logToExtension('warn', `LLM returned no usable data for field "${field.label}": ${response?.error ?? 'empty response'}`);
            resolve(null);
          }
        }
      );
    });

  // Retry up to 2 times on failure (handles service worker re-sleep between fields)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await sendOnce();
    if (result !== null) return result;

    if (attempt < 2) {
      logToExtension('warn', `Retry ${attempt} for field "${field.label}" (service worker may have slept)...`);
      serviceWorkerWarmedUp = false; // force re-ping on next attempt
      await ensureServiceWorkerAlive();
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return null;
}

// ─── Field Filler Dispatcher ───────────────────────────────────────────────────
/**
 * Routes the resolved value to the correct fill function based on the field type.
 * Returns true if the field was successfully filled.
 */
async function applyValueToField(field: FieldInfo, value: string): Promise<boolean> {
  logToExtension('debug', `Filling field "${field.label}" (type: ${field.type}) with value: "${value}"`);

  try {
    switch (field.type) {
      case 'text':
      case 'textarea':
        return await fillTextInput(field, value);

      case 'date':
        return await fillDatePicker(field, value);

      case 'checkbox': {
        const truthy = /^(yes|true|1|on|checked)$/i.test(value.trim());
        return await fillCheckbox(field, truthy);
      }

      case 'radio':
        return await fillRadioGroup(field, value);

      case 'select': {
        const result = await fillSelectDropdown(field, value);
        if (!result.success && result.optionsScraped && result.optionsScraped.length > 0) {
          logToExtension('warn', `No exact match for "${value}" in dropdown options: [${result.optionsScraped.slice(0, 5).join(', ')}...]`);
        }
        return result.success;
      }

      case 'file':
        logToExtension('info', `Skipping file-upload field "${field.label}" (manual action required).`);
        return false;

      default:
        logToExtension('warn', `Unknown field type for "${field.label}", attempting text fill.`);
        return await fillTextInput(field, value);
    }
  } catch (err: any) {
    logToExtension('error', `Error filling field "${field.label}": ${err.message}`);
    return false;
  }
}

// ─── Status Sync ───────────────────────────────────────────────────────────────
function syncStatus(
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed',
  progress: number,
  error?: string
) {
  chrome.runtime.sendMessage(
    {
      type: MessageType.SYNC_STATUS,
      payload: {
        status,
        currentPage: window.location.pathname,
        progress,
        error
      }
    },
    () => { if (chrome.runtime.lastError) { /* popup may be closed */ } }
  );
}

// ─── Core Autofill Engine ──────────────────────────────────────────────────────
/**
 * Main orchestrator. Called when START_AUTOFILL is received.
 * 
 * Pipeline per field:
 *   1. detectFormFields()          — scan visible page DOM
 *   2. mapFieldHeuristically()     — fast pattern match against resume keys
 *   3. queryAIForField()           — LLM fallback for unknown / low-confidence fields
 *   4. applyValueToField()         — dispatch to type-specific filler
 */
// ─── Cyclic Autofill Engine Helpers ─────────────────────────────────────────────
/**
 * Detects if a form field already contains a valid, user-entered, or pre-filled value.
 */
function hasExistingValue(field: FieldInfo): boolean {
  if (!field.element) return false;
  
  if (field.type === 'text' || field.type === 'textarea') {
    const input = field.element as HTMLInputElement;
    return !!input.value && input.value.trim().length > 0;
  }
  
  if (field.type === 'select') {
    const valueText = field.element.textContent || '';
    const lowerVal = valueText.trim().toLowerCase();
    // Exclude default placeholder prompts like "select one...", "search...", or empty values
    return lowerVal !== '' && !lowerVal.includes('select') && !lowerVal.includes('search');
  }
  
  if (field.type === 'checkbox') {
    const input = field.element as HTMLInputElement;
    return input.checked;
  }
  
  if (field.type === 'radio') {
    const checkedRadio = field.container.querySelector('input[type="radio"]:checked');
    return !!checkedRadio;
  }
  
  return false;
}

/**
 * Polls the current tab state to detect when a page transition completes.
 * Returns true if the page URL changes or new DOM fields render within 8 seconds.
 */
async function waitForPageTransition(): Promise<boolean> {
  const startUrl = window.location.href;
  const startFieldsCount = detectFormFields().length;
  
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    
    if (window.location.href !== startUrl) {
      logToExtension('info', 'Page transition detected (URL changed).');
      return true;
    }
    
    const currentFields = detectFormFields();
    if (currentFields.length > 0 && currentFields.length !== startFieldsCount) {
      logToExtension('info', 'Page transition detected (Form inputs updated).');
      return true;
    }
  }
  return false;
}

// ─── Page Form Filler ──────────────────────────────────────────────────────────
/**
 * Scans and fills the active visible form fields on the current page section.
 * Returns true if processing finished successfully, false if cancelled/interrupted.
 */
async function processCurrentPage(resume: StructuredResume): Promise<boolean> {
  logToExtension('info', `── Processing form section: "${getCurrentStepName()}" ──`);

  const fields = detectFormFields();
  logToExtension('info', `Detected ${fields.length} actionable form field(s) on this page.`);

  if (fields.length === 0) {
    logToExtension('warn', 'No fields found. Waiting for page content...');
    return true; // Return true so we poll again on transition
  }

  let filled = 0;
  let skipped = 0;
  let failed = 0;
  let consecutiveErrors = 0;

  for (let i = 0; i < fields.length; i++) {
    if (shouldStop) {
      logToExtension('warn', 'Autofill stopped by user request.');
      syncStatus('paused', Math.round((i / fields.length) * 100));
      return false;
    }

    const field = fields[i];
    const progress = Math.round((i / fields.length) * 100);
    syncStatus('running', progress);

    // Skip if field already has a value to avoid double-filling or overwriting edits
    if (hasExistingValue(field)) {
      logToExtension('debug', `Field "${field.label || 'unlabelled'}" already has a value. Skipping.`);
      skipped++;
      continue;
    }

    logToExtension('info', `[${i + 1}/${fields.length}] Processing field: "${field.label || field.automationId || 'unlabelled'}" (${field.type})`);

    // ── Step 1: Heuristic mapping ──
    const heuristicResult = mapFieldHeuristically(field, resume);

    let finalValue: string | null = null;
    let source = 'heuristic';

    // confidence=100 + value=null → explicit skip (e.g. SMS opt-in, phone extension)
    if (heuristicResult.value === null && heuristicResult.confidence === 100) {
      skipped++;
      logToExtension('debug', `⟳ Intentional skip for "${field.label}" (field excluded by rules).`);
      await new Promise(r => setTimeout(r, 60));
      continue;
    }

    if (heuristicResult.value !== null && heuristicResult.confidence >= 70) {
      finalValue = Array.isArray(heuristicResult.value)
        ? heuristicResult.value.join(', ')
        : heuristicResult.value;
      logToExtension('debug', `Heuristic match for "${field.label}": "${finalValue}" (confidence: ${heuristicResult.confidence}%)`);
    } else {
      // ── Step 2: LLM fallback ──
      logToExtension('info', `Low heuristic confidence (${heuristicResult.confidence}%) for "${field.label}". Querying AI...`);
      source = 'llm';

      // For dropdowns, pre-scrape available options to give the LLM full context
      let availableOptions: string[] | undefined;
      if (field.type === 'select') {
        availableOptions = await scrapeDropdownOptions(field);
        logToExtension('debug', `Scraped ${availableOptions.length} dropdown options for LLM: [${availableOptions.slice(0, 6).join(' | ')}${availableOptions.length > 6 ? '...' : ''}]`);
      }

      const llmResult = await queryAIForField(field, resume, availableOptions);

      if (!llmResult) {
        logToExtension('warn', `⚠ AI call failed for "${field.label}" (no response from background). Check API key / model settings.`);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          logToExtension('error', 'Too many consecutive AI errors or timeouts. Pausing autofill.');
          syncStatus('paused', Math.round((i / fields.length) * 100));
          return false;
        }
      } else {
        consecutiveErrors = 0;
        if (llmResult.value && llmResult.confidence >= 40) {
          finalValue = llmResult.value;
          logToExtension('info', `AI answer for "${field.label}": "${finalValue}" (confidence: ${llmResult.confidence}%) — ${llmResult.reasoning}`);
        } else if (!llmResult.value) {
          logToExtension('debug', `AI returned null for "${field.label}" — field not in resume data.`);
        } else {
          logToExtension('warn', `AI confidence too low (${llmResult.confidence}%) for "${field.label}". Skipping.`);
        }
      }
    }

    // ── Step 3: Apply value or skip ──
    if (finalValue !== null && finalValue.trim() !== '') {
      const success = await applyValueToField(field, finalValue);
      if (success) {
        filled++;
        logToExtension('info', `✔ Filled "${field.label}" via ${source}.`);
      } else {
        failed++;
        logToExtension('warn', `✘ Failed to fill "${field.label}" (value: "${finalValue}", source: ${source}).`);
      }
    } else {
      skipped++;
      logToExtension('debug', `⟳ Skipped "${field.label}" — no usable value found.`);
    }

    // Small delay between fields to avoid overwhelming the page
    await new Promise(r => setTimeout(r, 120));
  }

  logToExtension('info', `Form section completed — Filled: ${filled} | Skipped: ${skipped} | Failed: ${failed} out of ${fields.length} fields.`);
  return true;
}

// ─── Cyclic Autofill Engine Loop ────────────────────────────────────────────────
/**
 * Runs a cyclic auto-navigation pipeline to process multiple Workday forms.
 */
async function runAutofillLoop(resume: StructuredResume): Promise<void> {
  logToExtension('info', '── Cyclic Autofill Engine Loop Initiated ──');

  let lastUnfilledCount = -1;
  let consecutiveRetries = 0;

  while (isRunning && !shouldStop) {
    const stepName = getCurrentStepName();
    logToExtension('info', `Form section identified: "${stepName}"`);

    // 1. Process and autofill the current page
    const success = await processCurrentPage(resume);
    if (!success) {
      logToExtension('warn', 'Form filling loop paused or terminated.');
      break;
    }

    if (shouldStop) break;

    // 2. Scan for missing required fields (prevent clicking continue if validation failed)
    const currentFields = detectFormFields();
    const unfilledRequired = currentFields.filter(f => f.required && !hasExistingValue(f));
    
    if (unfilledRequired.length > 0) {
      const missingLabels = unfilledRequired.map(f => f.label || f.automationId || 'unlabelled required field').join(', ');
      logToExtension('warn', `Form contains ${unfilledRequired.length} required fields that are still empty: [${missingLabels}]. Re-processing current page...`);
      
      if (lastUnfilledCount === unfilledRequired.length) {
        consecutiveRetries++;
      } else {
        consecutiveRetries = 1;
        lastUnfilledCount = unfilledRequired.length;
      }

      if (consecutiveRetries >= 2) {
        logToExtension('warn', `Unable to automatically fill the remaining required fields: [${missingLabels}]. Pausing autofill for manual input.`);
        syncStatus('paused', 100);
        break;
      }

      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // Reset retry counters if we successfully cleared or have no unfilled required fields
    consecutiveRetries = 0;
    lastUnfilledCount = -1;

    // 3. Stop and request manual confirmation if on the final "Review Application" page
    if (stepName === 'Review Application' || window.location.href.includes('/review')) {
      logToExtension('info', '🎉 Final review page reached. Auto-clicker paused so you can verify details before manual submission.');
      syncStatus('completed', 100);
      break;
    }

    // 4. Click the "Continue" / "Next" button automatically
    logToExtension('info', 'Page autofilled successfully. Automatically clicking Continue...');
    const clicked = await clickNextButton();
    if (!clicked) {
      logToExtension('warn', 'Could not locate the continue navigation button. Pausing loop.');
      syncStatus('paused', 100);
      break;
    }

    // 5. Wait for the page transition to complete
    logToExtension('info', 'Waiting for page navigation to update...');
    const transitioned = await waitForPageTransition();
    if (!transitioned) {
      logToExtension('warn', 'Page navigation transition timed out. Re-evaluating current page fields...');
    }

    // Allow the DOM state to settle down before scanning again
    await new Promise(r => setTimeout(r, 800));
  }
}

// ─── Message Listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionResponse<any>) => void
) => {
  logToExtension('debug', `Received message: ${message.type}`);

  switch (message.type) {
    case MessageType.PING:
      logToExtension('info', 'PING received — content script is alive.');
      sendResponse({ success: true, data: 'PONG_CONTENT' });
      break;

    case MessageType.START_AUTOFILL: {
      if (isRunning) {
        logToExtension('warn', 'Autofill is already running. Ignoring duplicate start request.');
        sendResponse({ success: false, error: 'Autofill already in progress.' });
        break;
      }

      const { resumeMetadata, structuredResume } = message.payload;
      logToExtension('info', `START_AUTOFILL received. Resume: "${resumeMetadata?.fileName}"`);

      if (!structuredResume) {
        logToExtension('error', 'No structured resume data found in the START_AUTOFILL payload.');
        sendResponse({ success: false, error: 'Structured resume data is missing. Please re-parse your resume.' });
        break;
      }

      isRunning = true;
      shouldStop = false;

      // Immediately acknowledge so the popup doesn't time-out waiting
      sendResponse({ success: true, data: { message: 'Autofill engine started.' } });

      // Run asynchronously in the cyclic loop
      runAutofillLoop(structuredResume)
        .catch((err) => {
          logToExtension('error', `Autofill engine crashed: ${err.message}`);
          syncStatus('failed', 0, err.message);
        })
        .finally(() => {
          isRunning = false;
          shouldStop = false;
        });

      break;
    }

    case MessageType.STOP_AUTOFILL:
      logToExtension('warn', 'STOP_AUTOFILL received. Halting after current field...');
      shouldStop = true;
      isRunning = false;
      sendResponse({ success: true, data: 'Stop signal sent.' });
      break;

    default:
      logToExtension('warn', `Unrecognised message: ${message.type}`);
      sendResponse({ success: false, error: 'Command not recognised.' });
      break;
  }

  return true; // Keep async channel open
});
