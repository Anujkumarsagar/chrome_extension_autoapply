# Workday AI Autofill

Automate Workday job applications using AI-powered resume understanding.

## Features
- **Client-Side Document Parsing**: Extracts text from PDF and DOCX files directly in the browser.
- **Hybrid Mapping Pipeline**: Maps form fields locally using fast regex heuristics, falling back to LLMs only when needed to optimize cost.
- **Multi-Model Support**: Securely connect to OpenAI, Google Gemini, or run locally on your machine with Ollama.
- **React-Compatible Auto-Filler**: Simulates native React inputs and key-by-key typing to bypass form reset behaviors and pass client-side validations.
- **Visual Progress Tracker**: Injects an overlay directly on Workday pages to track status, view logs, and ask for manual confirmations on low-confidence queries.

---

## 1. Setup & Installation

### Prerequisites
- **Node.js**: v18 or higher.
- **npm**: v9 or higher.
- **Google Chrome** (or Chromium-based alternative).

### Install Dependencies
```bash
npm install
```

### Build the Extension
```bash
npm run build
```
This command compiles the React popup UI, the background service worker, and the content scripts into the `dist/` directory.

### Loading in Chrome
1. Go to `chrome://extensions/` in Chrome.
2. Enable **Developer mode** in the upper right.
3. Click **Load unpacked** in the upper left.
4. Select the `dist` folder generated inside your project.

---

## 2. Configuration & AI Prompting

Click the extension icon in the toolbar and click **⚙️ Settings** to configure your backend:

- **OpenAI**: Requires API Key (`sk-...`) and choice of model (e.g., `gpt-4o-mini`).
- **Gemini**: Requires API Key (`AIzaSy...`) and model name (e.g., `gemini-2.0-flash`).
- **Ollama**: Requires running Ollama locally (`http://localhost:11434`) and pulling your target model (e.g., `ollama pull llama3`).

### System Prompts
1. **Resume Parser**: Directs the LLM to extract unstructured resume text into a strict schema matching `StructuredResume` fields.
2. **Form Mapper**: Evaluates a form field with its label, description, type, and list of options to find the best-matched value from the structured resume.

---

## 3. Architecture

- **Popup UI (`src/popup/`)**: Renders the React control panel. Handles document parsing via `pdfjs-dist` and `mammoth`.
- **Background Service Worker (`src/background/service-worker.ts`)**: Acts as a secure LLM API gateway, manages settings, routing, and response caching.
- **Content Scripts (`src/content/`)**: 
  - `elementDetector.ts`: Locates and classifies form controls.
  - `heuristicMapper.ts`: Applies regex heuristics for fast matches.
  - `formFiller.ts`: Handles input focus, keystroke simulation, and select element dropdown scraping and matching.
  - `navigator.ts`: Coordinates section name discovery, clicks continue button, and handles repeatable groups (history items).
  - `floatingPanel.ts`: Renders the inline panel injected into the host page.

---

## 4. System Limitations

- **Selector Fragility**: Relies on specific Workday CSS selectors and automation markers. Major Workday updates might require updating selector keys.
- **Legal/Consent Guards**: Explicitly skips legal agreements, data privacy policies, and background check consents. These must be checked manually by the applicant.
- **No File Uploads**: Browser sandboxes block automatic selection of local files. Candidates must upload files (resume copy, transcripts, etc.) manually.
- **Dynamic Options**: Dropdowns containing dependencies loaded dynamically through sluggish endpoints can occasionally time out or require manual retry.
