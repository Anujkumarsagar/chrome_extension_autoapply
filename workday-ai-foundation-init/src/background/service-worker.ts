import { createLogger } from '../utils/logger';
import { MessageType } from '../constants/messageTypes';
import { ExtensionMessage, ExtensionResponse } from '../types/messages';

const logger = createLogger('background');

// Initialize Extension on Install
chrome.runtime.onInstalled.addListener((details) => {
  logger.info(`Workday AI Autofill installed successfully. Reason: ${details.reason}`);

  if (details.reason === 'install') {
    logger.info('Initializing extension workspace settings...');
    chrome.storage.local.set({
      installationTime: new Date().toISOString(),
      extensionStatus: 'initialized',
      ai_provider: 'openai',
      openAiModel: 'gpt-4o-mini',
      geminiModel: 'gemini-2.0-flash',
      ollama_endpoint: 'http://localhost:11434',
      ollamaModel: 'llama3'
    }, () => {
      logger.info('Startup parameters persisted to chrome.storage.local');
    });
  }
});

// Handle Startup
chrome.runtime.onStartup.addListener(() => {
  logger.info('Browser session started. Background Service Worker activated.');
});

interface ExtensionSettings {
  provider: 'openai' | 'gemini' | 'ollama';
  openaiApiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  ollamaEndpoint: string;
  ollamaModel: string;
}

/**
 * Helper to retrieve settings from storage
 */
async function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'ai_provider',
      'openai_api_key',
      'openAiModel',
      'gemini_api_key',
      'geminiModel',
      'ollama_endpoint',
      'ollamaModel'
    ], (result) => {
      resolve({
        provider: result.ai_provider || 'openai',
        openaiApiKey: result.openai_api_key || '',
        openaiModel: result.openAiModel || 'gpt-4o-mini',
        geminiApiKey: result.gemini_api_key || '',
        geminiModel: result.geminiModel || 'gemini-2.0-flash',
        ollamaEndpoint: result.ollama_endpoint || 'http://localhost:11434',
        ollamaModel: result.ollamaModel || 'llama3'
      });
    });
  });
}

/**
 * Retrieves the AI response cache from chrome.storage.local.
 */
async function getCache(): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ai_response_cache'], (result) => {
      resolve(result.ai_response_cache || {});
    });
  });
}

/**
 * Updates a key-value entry in the local AI response cache.
 */
async function updateCache(key: string, value: any): Promise<void> {
  const cache = await getCache();
  cache[key] = value;
  return new Promise((resolve) => {
    chrome.storage.local.set({ ai_response_cache: cache }, () => {
      resolve();
    });
  });
}

/**
 * Clears the stored AI response cache from local storage.
 */
async function clearCache(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['ai_response_cache'], () => {
      resolve();
    });
  });
}

/**
 * Helper to execute a fetch request with a specified timeout (defaults to 25s).
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 25000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  }
}

/**
 * Sends unified prompt to OpenAI, Gemini, or Ollama
 */
async function callLLM(
  settings: ExtensionSettings,
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = true
): Promise<any> {
  const provider = settings.provider;

  if (provider === 'openai') {
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API Key is missing. Please set it in the extension settings.');
    }
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openaiApiKey}`
    };
    const body: any = {
      model: settings.openaiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    };
    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI error: ${errorData?.error?.message || response.statusText}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content returned from OpenAI');
    return JSON.parse(content);

  } else if (provider === 'gemini') {
    if (!settings.geminiApiKey) {
      throw new Error('Gemini API Key is missing. Please set it in the extension settings.');
    }

    // Use v1beta for gemini-2.0-flash and newer; v1 for older models
    const apiVersion = 'v1beta';
    const modelName = settings.geminiModel || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${settings.geminiApiKey}`;

    const body: any = {
      contents: [
        {
          parts: [
            {
              // Combine system + user prompt since older models may not support systemInstruction
              text: `${systemPrompt}\n\n${userPrompt}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        // responseMimeType forces JSON output — supported in gemini-1.5+ and gemini-2.0+
        responseMimeType: 'application/json'
      }
    };

    logger.info(`Calling Gemini model: ${modelName} via ${apiVersion}`);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errMsg = errorData?.error?.message || response.statusText;
      logger.error(`Gemini API error: ${errMsg}`);
      throw new Error(`Gemini error: ${errMsg}`);
    }

    const data = await response.json();
    let content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('No content returned from Gemini');

    // Strip markdown code fences if present
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(content);

  } else if (provider === 'ollama') {
    const cleanEndpoint = settings.ollamaEndpoint.replace(/\/+$/, '');
    const url = `${cleanEndpoint}/api/chat`;
    const body: any = {
      model: settings.ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      options: {
        temperature: 0.1
      }
    };
    if (jsonMode) {
      body.format = 'json';
    }

    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (err: any) {
      // Fallback for Windows IPv6 localhost resolution mismatch issues
      if (url.includes('localhost')) {
        const fallbackUrl = url.replace('localhost', '127.0.0.1');
        logger.info(`Ollama connection failed on localhost. Retrying fallback: ${fallbackUrl}`);
        response = await fetchWithTimeout(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        throw new Error(`Ollama connection failed: ${err.message || err}`);
      }
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error || response.statusText;
      if (response.status === 404) {
        throw new Error(`Ollama model "${settings.ollamaModel}" not found. Please run "ollama pull ${settings.ollamaModel}" in your terminal first.`);
      }
      throw new Error(`Ollama error: HTTP ${response.status} - ${errMsg}`);
    }

    const data = await response.json();
    let content = data.message?.content;
    if (!content) throw new Error('No content returned from Ollama');

    // Strip markdown code fences if present
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(content);
  }

  throw new Error(`Unsupported AI Provider: ${provider}`);
}

/**
 * Main message router & logging relay
 */
chrome.runtime.onMessage.addListener((
  message: ExtensionMessage | { type: 'LOG_RELAY'; payload?: { level: string; message: string } },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionResponse<any>) => void
) => {
  const origin = sender.tab ? `content script at tab ${sender.tab.id}` : 'popup';

  // Intercept and handle logging relays
  if (message.type === 'LOG_RELAY') {
    const payload = message.payload;
    if (payload) {
      const level = payload.level || 'info';
      const logMsg = payload.message || '';

      switch (level) {
        case 'warn':
          logger.warn(`[Relayed Log] ${logMsg}`);
          break;
        case 'error':
          logger.error(`[Relayed Log] ${logMsg}`);
          break;
        case 'debug':
          logger.debug(`[Relayed Log] ${logMsg}`);
          break;
        case 'info':
        default:
          logger.info(`[Relayed Log] ${logMsg}`);
          break;
      }
    }
    sendResponse({ success: true });
    return true;
  }

  logger.info(`Message received from ${origin}: ${JSON.stringify(message)}`);

  // Handle standard commands
  switch (message.type) {
    case MessageType.PING:
      sendResponse({ success: true, data: 'PONG' });
      break;

    case MessageType.START_AUTOFILL:
      if (!sender.tab) {
        logger.info('Relaying START_AUTOFILL command from popup to content scripts...');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, message, (response) => {
              if (chrome.runtime.lastError) {
                logger.error(`Failed to relay message to tab ${activeTab.id}: ${chrome.runtime.lastError.message}`);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                logger.info(`Successfully relayed START_AUTOFILL to tab ${activeTab.id}`);
                sendResponse(response || { success: true });
              }
            });
          } else {
            logger.warn('No active tab found to relay message');
            sendResponse({ success: false, error: 'No active tab found' });
          }
        });
        return true;
      }
      break;

    case MessageType.PARSE_RESUME:
      (async () => {
        try {
          const storageSettings = await getSettings();
          const settings = message.payload.settings
            ? { ...storageSettings, ...message.payload.settings }
            : storageSettings;
          logger.info(`PARSE_RESUME trigger: active provider is "${settings.provider}". settings details: ${JSON.stringify({ ...settings, openaiApiKey: settings.openaiApiKey ? 'PRESENT' : 'MISSING', geminiApiKey: settings.geminiApiKey ? 'PRESENT' : 'MISSING' })}`);
          const systemPrompt = `You are a high-accuracy resume parsing assistant. Parse the unstructured resume text into a strict structured JSON matching this schema:
{
  "personalInfo": {
    "firstName": "string (or null)",
    "lastName": "string (or null)",
    "email": "string (or null)",
    "phone": "string (or null)",
    "location": "string (or null) e.g., 'City, State, Country'",
    "linkedin": "string url (or null)",
    "github": "string url (or null)",
    "website": "string url (or null)"
  },
  "skills": ["string"],
  "experience": [
    {
      "company": "string",
      "title": "string",
      "location": "string (or null)",
      "startDate": "string (YYYY-MM format or null)",
      "endDate": "string (YYYY-MM format, or 'Present', or null)",
      "description": "string (or null)"
    }
  ],
  "education": [
    {
      "school": "string",
      "degree": "string (or null)",
      "fieldOfStudy": "string (or null)",
      "startDate": "string (YYYY-MM or YYYY format or null)",
      "endDate": "string (YYYY-MM or YYYY format, or 'Present', or null)",
      "gpa": "string (or null)"
    }
  ],
  "certifications": ["string"],
  "summary": "string overview (or null)"
}
Return ONLY a valid JSON object. No markdown block wraps, no explanation text.`;

          const userPrompt = `Here is the unstructured resume text to parse:\n\n${message.payload.rawText}`;

          logger.info(`Calling LLM (${settings.provider}) to parse resume text...`);
          const structuredData = await callLLM(settings, systemPrompt, userPrompt, true);
          logger.info(`Successfully parsed resume using ${settings.provider}.`);
          await clearCache();
          logger.info('AI response cache cleared due to new resume upload.');
          sendResponse({ success: true, data: structuredData });
        } catch (error: any) {
          logger.error('Error in PARSE_RESUME:', error);
          sendResponse({ success: false, error: error.message || 'Failed to parse resume.' });
        }
      })();
      return true;

    case MessageType.ANALYZE_QUESTION:
      (async () => {
        try {
          const settings = await getSettings();
          const { label, description, options, containerHtml, resumeJson, pageContext } = message.payload;

          // Compute deterministic cache key
          const cacheOptionsKey = options && options.length > 0 ? options.join('|') : '';
          const cacheKey = `field:${label.trim().toLowerCase()}::desc:${(description || '').trim().toLowerCase()}::opts:${cacheOptionsKey}`;

          // Check Cache
          const cache = await getCache();
          if (cache[cacheKey]) {
            logger.info(`AI Cache HIT for field: "${label}". Returning cached response.`);
            sendResponse({ success: true, data: cache[cacheKey] });
            return;
          }

          const systemPrompt = `You are an expert job application assistant with deep knowledge of ATS (Applicant Tracking System) form structures, particularly Workday. Your task is to determine the single best value to fill into a specific form field based on a candidate's structured resume data.

═══════════════════════════════════════════════════════
CORE PRINCIPLES
═══════════════════════════════════════════════════════
1. ACCURACY OVER COMPLETION — Return null rather than guess. A wrong answer causes form validation errors; a null answer simply leaves the field empty.
2. EVIDENCE-BASED — Every value you return must be directly supported by the resume JSON. Do not invent, infer beyond reason, or use general knowledge to fill gaps.
3. EXACT OPTION MATCHING — If "Available Options" are provided, your "value" field MUST be the verbatim text of one of those options (case-sensitive). Never return a value not in the list.
4. FIELD AWARENESS — Read the label, description, and DOM HTML carefully. A field labelled "Country Phone Code" wants only the dialing prefix (e.g., "+91"), NOT the full number.

═══════════════════════════════════════════════════════
FIELD TYPE CLASSIFICATION & RULES
═══════════════════════════════════════════════════════
• TEXT / TEXTAREA fields:
  - Return the most relevant string verbatim from the resume.
  - For "Summary" or "Cover Letter" fields: write 2-3 professional sentences based on the candidate's experience and skills.
  - For "Address Line 1": return street address only if present, else null.
  - For "City": return just the city name (not "City, State, Country").
  - For "Postal Code" / "ZIP Code": return the numeric code only if found in resume, else null.

• PHONE fields:
  - "Phone Number" → return ONLY the local digits without country code (e.g., "8923851448" not "+91-8923851448").
  - "Country Phone Code" / "Dialing Code" → return ONLY the country prefix (e.g., "+91").
  - "Phone Extension" → return null unless the resume explicitly lists an extension.

• DATE fields:
  - Return in YYYY-MM-DD format when day is known, YYYY-MM when only month/year, YYYY when only year.
  - "Present" / "Current" employment → return today's date for end date if needed: ${new Date().toISOString().slice(0, 10)}.

• DROPDOWN / SELECT / RADIO (options provided):
  - Your "value" MUST be verbatim from the options list. Compare case-insensitively then return the exact casing from the list.
  - For "Country": match the candidate's location country to the option (e.g., "India", "United States").
  - For "State / Province": match the state from the candidate's location.
  - For "Employment Type": infer from job descriptions (full-time positions → "Full-Time").
  - For "Highest Education": map degree to options (B.Tech/B.E → "Bachelor's Degree", M.Tech → "Master's Degree").
  - For "Years of Experience": calculate from earliest job start date to today.
  - For "Willing to relocate": return "Yes" or best matching option.

• CHECKBOX / YES-NO fields:
  - "Authorized to work": "Yes" (always, unless resume explicitly mentions visa issues).
  - "Require sponsorship": "No" for candidates already in the country, "Yes" if on student/work visa.
  - "Have a preferred name": "No" unless the resume shows a nickname distinct from legal name.
  - "SMS opt-in": return null (do not touch consent fields).

• LEGAL / COMPLIANCE fields:
  - "Agree to terms": return null (do not auto-check legal agreements).
  - "Background check consent": return null.

═══════════════════════════════════════════════════════
CONFIDENCE CALIBRATION
═══════════════════════════════════════════════════════
90–100: Resume contains exact data matching the field (e.g., first name → resume.personalInfo.firstName).
70–89:  Strong semantic match with minor inference (e.g., deriving country from city name).
50–69:  Reasonable inference with some uncertainty (e.g., employment type from job description).
30–49:  Weak match, significant uncertainty — still return the best guess.
0–29:   Cannot answer from resume — return null as value.

═══════════════════════════════════════════════════════
OUTPUT CONTRACT — STRICT JSON, NO EXCEPTIONS
═══════════════════════════════════════════════════════
Return ONLY this JSON object. No markdown fences, no prose before or after:
{
  "value": "<string matching exactly one option if options provided, or free-form string, or null>",
  "confidence": <integer 0–100>,
  "reasoning": "<one concise sentence explaining your choice or why you returned null>"
}`;

          const userPrompt = `════════════════════════════════════
CANDIDATE RESUME DATA
════════════════════════════════════
${JSON.stringify(resumeJson, null, 2)}

════════════════════════════════════
FORM FIELD TO FILL
════════════════════════════════════
Label: ${label}
Description / Helper Text: ${description || 'None'}
Field Type Hint: ${options && options.length > 0 ? 'DROPDOWN/SELECT/RADIO' : 'FREE TEXT'}
Available Options: ${options && options.length > 0 ? JSON.stringify(options, null, 2) : 'None — free text input'}
${containerHtml ? `\nDOM Context (field HTML structure):\n${containerHtml}` : ''}
${pageContext && pageContext.length > 0 ? `\n════════════════════════════════════\nNEIGHBORING FIELDS & CURRENT VALUES ON FORM\n════════════════════════════════════\n${JSON.stringify(pageContext, null, 2)}` : ''}

Instruction: Analyse the resume and provide the best possible value for this specific field. Pay close attention to the NEIGHBORING FIELDS to understand the context (for example, if a neighboring field is filled with a specific school name or company name, this field is related to that school or company). Follow the output contract exactly.`;

          logger.info(`Analyzing field: "${label}" using LLM (${settings.provider})...`);
          const matchResult = await callLLM(settings, systemPrompt, userPrompt, true);
          logger.info(`AI mapping result for "${label}": value="${matchResult.value}", confidence=${matchResult.confidence}%`);

          // Update Cache on successful LLM response
          await updateCache(cacheKey, matchResult);

          sendResponse({ success: true, data: matchResult });
        } catch (error: any) {
          logger.error('Error in ANALYZE_QUESTION:', error);
          sendResponse({ success: false, error: error.message || 'Failed to analyze question.' });
        }
      })();
      return true;

    case MessageType.GENERATE_EXECUTION_PLAN:
      (async () => {
        try {
          const settings = await getSettings();
          const { fields, resumeJson, containerHtml, errorContext } = message.payload;

          logger.info(`GENERATE_EXECUTION_PLAN trigger: active provider is "${settings.provider}".`);

          const systemPrompt = `You are a high-accuracy job application automation agent. Your job is to output a sequence of instructions (an Execution Plan) to fill out a page form based on the candidate's structured resume data.

You will be provided:
1. The candidate's structured resume JSON.
2. A list of form fields present on the current page. Each field has:
   - "id": The internal field identifier (which you must reference in your commands).
   - "label": The visible name of the field.
   - "description": Additional helper text.
   - "type": The field type ("text", "select", "checkbox", "radio", "date", "textarea").
   - "required": Boolean indicating if it must be filled.
   - "automationId": Workday identifier.
   - "options": For select/dropdown fields, the list of valid choices.
3. Sanity-cleaned DOM HTML context of the form container.

CORE RULES:
1. Map candidate resume details accurately to the form fields.
2. If a field is a dropdown/select, the "value" you provide MUST match one of the available options exactly and verbatim (case-sensitive). Select the best semantic option match.
3. For checkbox fields, value must be a boolean (true or false).
4. Return instructions ONLY for fields where you have clear, high-confidence matching data in the resume. If you are unsure or the data is missing, return null as the value for that field command, or omit the field command.
5. Never agree to terms, submit consents, opt-in to SMS, or fill file-upload fields. Leave these fields out of your plan.
6. For "Summary", "Bio", or "Cover Letter" textareas, generate a professional 2-3 sentence overview based on the candidate's experience.

OUTPUT CONTRACT:
Return ONLY a valid JSON array of objects representing commands. No markdown prose or code block fences.
Each object in the array must match this schema:
{
  "action": "type" | "select" | "checkbox" | "radio" | "date",
  "fieldId": "string (the exact ID of the field from the input list)",
  "value": "string | boolean | null",
  "reasoning": "string (one concise sentence explaining your choice)"
}`;

          const userPrompt = `════════════════════════════════════
CANDIDATE RESUME DATA
════════════════════════════════════
${JSON.stringify(resumeJson, null, 2)}

════════════════════════════════════
FORM FIELDS TO FILL
════════════════════════════════════
${JSON.stringify(fields, null, 2)}

${containerHtml ? `\nDOM Context:\n${containerHtml}` : ''}
${errorContext ? `\n════════════════════════════════════\nACTIVE VALIDATION ERRORS ON PAGE\n════════════════════════════════════\n${errorContext}\n\nNote: The form submission previously failed with the above validation errors. Please pay close attention to resolving these specific fields accurately based on the candidate's resume.` : ''}

Instruction: Generate the execution plan array matching the schema exactly.`;


          logger.info(`Calling LLM (${settings.provider}) to generate execution plan for ${fields.length} fields...`);
          const plan = await callLLM(settings, systemPrompt, userPrompt, true);
          logger.info(`Successfully generated execution plan. Actions count: ${Array.isArray(plan) ? plan.length : 0}`);
          sendResponse({ success: true, data: plan });
        } catch (error: any) {
          logger.error('Error in GENERATE_EXECUTION_PLAN:', error);
          sendResponse({ success: false, error: error.message || 'Failed to generate execution plan.' });
        }
      })();
      return true;


    case MessageType.SYNC_STATUS:
      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });
      sendResponse({ success: true });
      break;

    default:
      logger.warn(`Service worker received unsupported message: ${message.type}`);
      sendResponse({ success: false, error: `Unsupported command: ${message.type}` });
      break;
  }

  return true;
});
