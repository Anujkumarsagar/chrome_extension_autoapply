import React, { useState, useEffect, useRef } from 'react';
import './Popup.css';
import useResume from '../hooks/useResume';
import { MessageType } from '../constants/messageTypes';
import { ActivityLog, AutomationStatus, StructuredResume } from '../types/resume';
import { ExtensionResponse } from '../types/messages';
import { parsePdf, parseDocx } from '../utils/parser';
import * as storage from '../storage/chromeStorage';

export default function Popup() {
  const { resumeMetadata, isLoading: metadataLoading, error: storageError, saveResume, clearResume } = useResume();
  
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isWorkdayPage, setIsWorkdayPage] = useState<boolean>(false);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [backgroundConnected, setBackgroundConnected] = useState<boolean>(false);
  const [automation, setAutomation] = useState<AutomationStatus>({
    status: 'idle',
    currentPage: 'Initial State',
    progress: 0,
  });

  // API Settings State
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [provider, setProvider] = useState<'openai' | 'gemini' | 'ollama'>('openai');
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('gpt-4o-mini');
  
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [geminiModel, setGeminiModel] = useState<string>('gemini-1.5-flash');

  const [ollamaEndpoint, setOllamaEndpoint] = useState<string>('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState<string>('llama3');

  // Resume State
  const [structuredResume, setStructuredResume] = useState<StructuredResume | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logConsoleRef = useRef<HTMLDivElement>(null);

  // Helper to add logs locally
  const addLog = (level: 'info' | 'warn' | 'error' | 'debug' | 'success', message: string, source: 'popup' | 'background' | 'content' = 'popup') => {
    const newLog: ActivityLog = {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
      level,
      message,
      source,
    };
    setLogs((prev) => [...prev, newLog]);
  };

  // Scroll console to bottom on new log
  useEffect(() => {
    if (logConsoleRef.current) {
      logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
    }
  }, [logs]);

  // Load API Keys & Structured Resume on startup
  useEffect(() => {
    async function loadStorageDetails() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([
          'ai_provider',
          'openai_api_key',
          'openAiModel',
          'gemini_api_key',
          'geminiModel',
          'ollama_endpoint',
          'ollamaModel'
        ], (result) => {
          if (result.ai_provider) setProvider(result.ai_provider);
          if (result.openai_api_key) setApiKey(result.openai_api_key);
          if (result.openAiModel) setModel(result.openAiModel);
          if (result.gemini_api_key) setGeminiApiKey(result.gemini_api_key);
          if (result.geminiModel) setGeminiModel(result.geminiModel);
          if (result.ollama_endpoint) setOllamaEndpoint(result.ollama_endpoint);
          if (result.ollamaModel) setOllamaModel(result.ollamaModel);
        });
      } else {
        const storedProvider = localStorage.getItem('ai_provider') as any;
        if (storedProvider) setProvider(storedProvider);
        const storedKey = localStorage.getItem('openai_api_key');
        if (storedKey) setApiKey(storedKey);
        const storedGeminiKey = localStorage.getItem('gemini_api_key');
        if (storedGeminiKey) setGeminiApiKey(storedGeminiKey);
      }

      const structData = await storage.getStructuredResume();
      if (structData) {
        setStructuredResume(structData);
      }
    }
    loadStorageDetails();
  }, []);

  // Save Settings
  const handleSaveSettings = () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        ai_provider: provider,
        openai_api_key: apiKey,
        openAiModel: model,
        gemini_api_key: geminiApiKey,
        geminiModel: geminiModel,
        ollama_endpoint: ollamaEndpoint,
        ollamaModel: ollamaModel
      }, () => {
        addLog('info', `AI Configurations saved. Active provider: ${provider.toUpperCase()}`);
        setShowSettings(false);
      });
    } else {
      localStorage.setItem('ai_provider', provider);
      localStorage.setItem('openai_api_key', apiKey);
      localStorage.setItem('gemini_api_key', geminiApiKey);
      addLog('info', 'Settings saved locally (dev mode).');
      setShowSettings(false);
    }
  };

  // Initial checks and state setup
  useEffect(() => {
    addLog('info', 'Workday AI Autofill Popup Initialized');

    const isExtension = typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query;

    const handleRuntimeMessage = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (r: any) => void) => {
      const source = sender.tab ? 'content' : 'background';
      
      if (message.type === 'LOG_RELAY') {
        addLog(message.payload?.level || 'info', message.payload?.message || '', source);
        sendResponse({ success: true });
      } else if (message.type === MessageType.SYNC_STATUS) {
        const payload = message.payload;
        setAutomation({
          status: payload.status,
          currentPage: payload.currentPage,
          progress: payload.progress,
          error: payload.error
        });
        sendResponse({ success: true });
      }
    };

    if (isExtension) {
      // Get current tab details
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab) {
          // Always capture the tab ID so sendMessage works regardless of URL
          setCurrentTabId(activeTab.id ?? null);

          const url = activeTab.url || '';
          const isOnWorkday =
            url.includes('myworkdayjobs.com') ||
            url.includes('myworkday.com') ||
            url.includes('wd3.myworkday.com') ||
            url.includes('wd5.myworkday.com') ||
            url.includes('workday.com');

          setIsWorkdayPage(isOnWorkday);

          if (isOnWorkday) {
            addLog('info', `Tab active: Workday portal detected (Tab #${activeTab.id})`, 'content');
          } else {
            addLog('warn', `Active tab is not a Workday portal. URL: ${url || '(unknown)'}`);
          }
        }
      });

      // 2. Ping background service worker to check health
      chrome.runtime.sendMessage({ type: MessageType.PING }, (response: ExtensionResponse) => {
        if (chrome.runtime.lastError) {
          setBackgroundConnected(false);
          addLog('error', `Background connection failed: ${chrome.runtime.lastError.message}`, 'background');
        } else if (response && response.success) {
          setBackgroundConnected(true);
          addLog('info', 'Background service worker connection active', 'background');
        }
      });

      // 3. Listen for status update messages from background/content
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    } else {
      // Local web/Vite development testing mode
      setIsWorkdayPage(true);
      setBackgroundConnected(true);
      addLog('info', 'Running in mock environment (Chrome API simulated)');
    }

    return () => {
      if (isExtension) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
    };
  }, []);

  // Format file size
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format date
  const formatDate = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  // Handle Drag & Drop
  const [dragActive, setDragActive] = useState(false);
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  // Process selected file
  const processSelectedFile = async (file: File) => {
    const validExtensions = ['.pdf', '.docx'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!validExtensions.includes(fileExtension)) {
      addLog('error', `Invalid file type. Supported types: PDF, DOCX`);
      return;
    }

    // Verify key configured for selected provider
    if (provider === 'openai' && !apiKey) {
      addLog('error', 'Please configure your OpenAI API Key first inside settings.');
      setShowSettings(true);
      return;
    }
    if (provider === 'gemini' && !geminiApiKey) {
      addLog('error', 'Please configure your Google Gemini API Key first inside settings (Free tiers available).');
      setShowSettings(true);
      return;
    }

    setIsParsing(true);
    addLog('info', `Reading resume text locally: ${file.name}...`);

    try {
      // 1. Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      
      // 2. Extract plain text locally in popup
      let rawText = '';
      if (fileExtension === '.pdf') {
        rawText = await parsePdf(arrayBuffer);
      } else {
        rawText = await parseDocx(arrayBuffer);
      }

      if (!rawText.trim()) {
        throw new Error('No text content could be extracted from the file.');
      }

      addLog('info', `Extracted ${rawText.length} characters of raw text. AI Parsing started (${provider.toUpperCase()})...`);

      // 3. Send text to background worker to build structured JSON
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        addLog('info', `Sending request to background service worker: provider="${provider.toUpperCase()}"`);
        chrome.runtime.sendMessage({
          type: MessageType.PARSE_RESUME,
          payload: { 
            rawText,
            settings: {
              provider,
              openaiApiKey: apiKey,
              openaiModel: model,
              geminiApiKey: geminiApiKey,
              geminiModel,
              ollamaEndpoint,
              ollamaModel
            }
          }
        }, async (response: ExtensionResponse<StructuredResume>) => {
          setIsParsing(false);
          
          if (response && response.success && response.data) {
            // Save structured resume & metadata
            await storage.saveStructuredResume(response.data);
            await saveResume(file.name, file.size);
            setStructuredResume(response.data);
            addLog('success', `Resume parsed and stored successfully!`);
          } else {
            addLog('error', `AI Parsing failed: ${response?.error || 'Unknown error'}`);
          }
        });
      } else {
        // Dev fallback simulation
        setTimeout(async () => {
          const mockData: StructuredResume = {
            personalInfo: {
              firstName: 'John',
              lastName: 'Doe',
              email: 'john.doe@example.com',
              phone: '555-0199',
              location: 'San Francisco, CA',
              linkedin: 'https://linkedin.com/in/johndoe'
            },
            skills: ['React', 'TypeScript', 'Node.js', 'Vite', 'Chrome Extensions'],
            experience: [
              { company: 'Acme Corp', title: 'Senior Developer', startDate: '2022-01', endDate: 'Present', description: 'React architecture and extension developments' }
            ],
            education: [
              { school: 'Stanford University', degree: 'BS', fieldOfStudy: 'Computer Science', endDate: '2021-06' }
            ],
            certifications: ['AWS Cloud Practitioner']
          };
          await storage.saveStructuredResume(mockData);
          await saveResume(file.name, file.size);
          setStructuredResume(mockData);
          setIsParsing(false);
          addLog('success', `Simulated resume parsed and stored successfully.`);
        }, 1500);
      }
    } catch (err: any) {
      setIsParsing(false);
      addLog('error', `Parsing failed: ${err.message}`);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processSelectedFile(e.target.files[0]);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  // Fires START_AUTOFILL after a successful PING
  const fireStartAutofill = (tabId: number) => {
    addLog('info', 'Content script alive. Sending START_AUTOFILL...');
    setAutomation({
      status: 'running',
      currentPage: 'Starting automation...',
      progress: 5,
      startedAt: new Date().toISOString(),
    });

    chrome.tabs.sendMessage(
      tabId,
      {
        type: MessageType.START_AUTOFILL,
        payload: { resumeMetadata, structuredResume },
      },
      (response: ExtensionResponse) => {
        if (chrome.runtime.lastError) {
          const errMsg = `Connection lost after ping: ${chrome.runtime.lastError.message}`;
          addLog('error', errMsg);
          setAutomation(prev => ({ ...prev, status: 'failed', error: errMsg }));
        } else if (response?.success) {
          addLog('info', '✔ Autofill engine running in content tab.', 'content');
        } else {
          const errMsg = response?.error || 'Content script rejected the request.';
          addLog('warn', `⚠ ${errMsg}`);
          setAutomation(prev => ({ ...prev, status: 'failed', error: errMsg }));
        }
      }
    );
  };

  // Injects content.js programmatically then retries PING
  const injectAndRetry = (tabId: number) => {
    addLog('info', 'Auto-injecting content script into tab...');
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content.js'] },
      () => {
        if (chrome.runtime.lastError) {
          const errMsg = `Injection failed: ${chrome.runtime.lastError.message}. Try refreshing the Workday tab manually.`;
          addLog('error', errMsg);
          setAutomation(prev => ({ ...prev, status: 'failed', error: errMsg }));
          return;
        }

        addLog('info', 'Content script injected. Retrying PING...');
        // Wait briefly for script to initialise
        setTimeout(() => {
          chrome.tabs.sendMessage(
            tabId,
            { type: MessageType.PING },
            (retryPing: ExtensionResponse) => {
              if (chrome.runtime.lastError || !retryPing?.success) {
                const errMsg = 'Content script still not reachable after injection. Please refresh the Workday tab and try again.';
                addLog('error', errMsg);
                setAutomation(prev => ({ ...prev, status: 'failed', error: errMsg }));
                return;
              }
              fireStartAutofill(tabId);
            }
          );
        }, 600);
      }
    );
  };

  // Start Autofill — PING first, auto-inject on failure, then fire
  const handleStartAutofill = () => {
    if (!resumeMetadata || !structuredResume) return;

    const hasExtension =
      typeof chrome !== 'undefined' &&
      !!chrome.tabs &&
      !!chrome.tabs.sendMessage &&
      currentTabId !== null;

    if (!hasExtension) {
      // Dev / mock simulation mode
      addLog('info', 'Autofill triggered (dev simulation mode)...');
      setAutomation({ status: 'running', currentPage: 'Starting automation...', progress: 5, startedAt: new Date().toISOString() });
      let progress = 15;
      const interval = setInterval(() => {
        progress += 25;
        if (progress >= 100) {
          clearInterval(interval);
          setAutomation({ status: 'completed', currentPage: 'Review Page', progress: 100, completedAt: new Date().toISOString() });
          addLog('info', 'Autofill simulation completed successfully!');
        } else {
          const pages: Record<number, string> = { 40: 'Personal Details Form', 65: 'Work Experience Form', 90: 'Review Application' };
          const currentPage = pages[progress] || 'Uploading Resume Info';
          setAutomation(prev => ({ ...prev, currentPage, progress }));
          addLog('info', `Autofilling form page: ${currentPage}`);
        }
      }, 1000);
      return;
    }

    // ── Step 1: PING content script ──
    addLog('info', `Pinging content script on Tab #${currentTabId}...`);
    chrome.tabs.sendMessage(
      currentTabId!,
      { type: MessageType.PING },
      (pingResponse: ExtensionResponse) => {
        if (chrome.runtime.lastError || !pingResponse?.success) {
          // ── Step 1b: PING failed → auto-inject then retry ──
          addLog('warn', 'Content script not found. Attempting auto-injection...');
          injectAndRetry(currentTabId!);
          return;
        }

        // ── Step 2: PING succeeded → fire autofill directly ──
        fireStartAutofill(currentTabId!);
      }
    );
  };

  // Stop Autofill
  const handleStopAutofill = () => {
    addLog('warn', 'Autofill stopped by user');
    setAutomation(prev => ({
      ...prev,
      status: 'idle',
      progress: 0,
      completedAt: new Date().toISOString(),
    }));

    const hasExtension = typeof chrome !== 'undefined' && chrome.tabs && currentTabId !== null;
    console.log("has extension: ", hasExtension)
    if (hasExtension) {
      chrome.tabs.sendMessage(currentTabId, { type: MessageType.STOP_AUTOFILL }, () => {
        console.log("Stop autofill")

        if (chrome.runtime.lastError) {
          addLog('error', `Failed to send stop signal: ${chrome.runtime.lastError.message}`);
        } else {
          addLog('info', 'Content automation script confirmed halt', 'content');
        }
      });
    }
  };

  const handleClearResume = async () => {
    try {
      await clearResume();
      await storage.removeStructuredResume();
      setStructuredResume(null);
      addLog('info', 'Resume database cleared');
      if (automation.status === 'running') {
        handleStopAutofill();
      }
    } catch {
      addLog('error', 'Could not clear resume metadata');
    }
  };

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? null : section);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="brand">
          <div className="logo-glow">W</div>
          <div className="brand-text">
            <h1>Workday AI Autofill</h1>
            <span>Core Foundation Shell v0.3.0</span>
          </div>
        </div>
        <button className="settings-toggle-btn" onClick={() => setShowSettings(!showSettings)}>
          ⚙️ Settings
        </button>
      </header>

      {/* Settings Drawer */}
      {showSettings && (
        <section className="section-card">
          <div className="section-title">AI Provider Configuration</div>
          <div className="settings-drawer">
            <div className="form-group">
              <label htmlFor="ai-provider">AI Service Provider</label>
              <select
                id="ai-provider"
                className="form-control"
                value={provider}
                onChange={(e) => setProvider(e.target.value as any)}
              >
                <option value="openai">OpenAI (GPT Models)</option>
                <option value="gemini">Google Gemini (Free Tier Key)</option>
                <option value="ollama">Ollama (100% Free Local AI)</option>
              </select>
            </div>

            {/* Provider Specific Settings */}
            {provider === 'openai' && (
              <>
                <div className="form-group">
                  <label htmlFor="openai-key">OpenAI API Key</label>
                  <input
                    id="openai-key"
                    type="password"
                    className="form-control"
                    placeholder="sk-proj-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="openai-model">LLM Model</label>
                  <select
                    id="openai-model"
                    className="form-control"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini (Recommended)</option>
                    <option value="gpt-4o">gpt-4o</option>
                  </select>
                </div>
              </>
            )}

            {provider === 'gemini' && (
              <>
                <div className="form-group">
                  <label htmlFor="gemini-key">Gemini API Key</label>
                  <input
                    id="gemini-key"
                    type="password"
                    className="form-control"
                    placeholder="AIzaSy..."
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="gemini-model">Gemini Model</label>
                  <input
                    id="gemini-model"
                    type="text"
                    className="form-control"
                    placeholder="gemini-1.5-flash"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                  />
                  <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>
                    E.g., gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash
                  </span>
                </div>
              </>
            )}

            {provider === 'ollama' && (
              <>
                <div className="form-group">
                  <label htmlFor="ollama-endpoint">Ollama Local API URL</label>
                  <input
                    id="ollama-endpoint"
                    type="text"
                    className="form-control"
                    placeholder="http://localhost:11434"
                    value={ollamaEndpoint}
                    onChange={(e) => setOllamaEndpoint(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="ollama-model">Ollama Model Tag</label>
                  <input
                    id="ollama-model"
                    type="text"
                    className="form-control"
                    placeholder="llama3"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="waa-btn-group" style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button className="btn btn-primary" style={{ flexGrow: 1 }} onClick={handleSaveSettings}>
                Save Settings
              </button>
              <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Connection & Context Badges */}
      <section className="status-pill-group">
        <div className={`status-badge ${isWorkdayPage ? 'badge-active' : 'badge-inactive'}`}>
          <span className="status-dot"></span>
          <span>{isWorkdayPage ? 'On Workday Portal' : 'Not Workday'}</span>
        </div>
        <div className={`status-badge ${backgroundConnected ? 'badge-active' : 'badge-disabled'}`}>
          <span className="status-dot"></span>
          <span>{backgroundConnected ? 'Core Worker Active' : 'Core Worker Offline'}</span>
        </div>
        {automation.status === 'running' && (
          <div className="status-badge badge-active">
            <span className="status-dot"></span>
            <span>Autofill Running</span>
          </div>
        )}
      </section>

      {/* Error Banners */}
      {(storageError || automation.error) && (
        <div className="error-banner">
          <span className="error-banner-icon">⚠️</span>
          <span>{storageError || automation.error}</span>
        </div>
      )}

      {/* Resume Section */}
      <section className="section-card">
        <div className="section-title">
          <span>Resume Database</span>
          {resumeMetadata && <span style={{ color: 'var(--color-success)', fontSize: '10px' }}>Loaded</span>}
        </div>

        {metadataLoading || isParsing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px', gap: '8px' }}>
            <div className="loading-spinner"></div>
            {isParsing && <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Extracting & parsing resume...</span>}
          </div>
        ) : resumeMetadata ? (
          <div className="resume-meta-card">
            <div className="file-details">
              <span className="file-details-icon">📄</span>
              <div className="file-details-info">
                <div className="file-name" title={resumeMetadata.fileName}>
                  {resumeMetadata.fileName}
                </div>
                <div className="file-size">{formatBytes(resumeMetadata.fileSize)}</div>
              </div>
            </div>
            
            {/* Structured Resume Visualizer Accordions */}
            {structuredResume && (
              <div className="resume-preview-list">
                <div className="resume-accordion-item">
                  <div className="resume-accordion-header" onClick={() => toggleSection('personal')}>
                    <span>👤 Personal Info</span>
                    <span>{openSection === 'personal' ? '▲' : '▼'}</span>
                  </div>
                  {openSection === 'personal' && (
                    <div className="resume-accordion-content">
                      Name: {structuredResume.personalInfo.firstName} {structuredResume.personalInfo.lastName}
                      Email: {structuredResume.personalInfo.email}
                      Phone: {structuredResume.personalInfo.phone}
                      Location: {structuredResume.personalInfo.location}
                    </div>
                  )}
                </div>

                <div className="resume-accordion-item">
                  <div className="resume-accordion-header" onClick={() => toggleSection('skills')}>
                    <span>🛠️ Skills</span>
                    <span>{openSection === 'skills' ? '▲' : '▼'}</span>
                  </div>
                  {openSection === 'skills' && (
                    <div className="resume-accordion-content">
                      {structuredResume.skills.join(', ') || 'None found'}
                    </div>
                  )}
                </div>

                <div className="resume-accordion-item">
                  <div className="resume-accordion-header" onClick={() => toggleSection('experience')}>
                    <span>💼 Experience ({structuredResume.experience.length})</span>
                    <span>{openSection === 'experience' ? '▲' : '▼'}</span>
                  </div>
                  {openSection === 'experience' && (
                    <div className="resume-accordion-content">
                      {structuredResume.experience.map((exp, idx) => (
                        <div key={idx} style={{ marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
                          <strong>{exp.title}</strong> at {exp.company}
                          <div>{exp.startDate} - {exp.endDate}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="resume-accordion-item">
                  <div className="resume-accordion-header" onClick={() => toggleSection('education')}>
                    <span>🎓 Education ({structuredResume.education.length})</span>
                    <span>{openSection === 'education' ? '▲' : '▼'}</span>
                  </div>
                  {openSection === 'education' && (
                    <div className="resume-accordion-content">
                      {structuredResume.education.map((edu, idx) => (
                        <div key={idx} style={{ marginBottom: '4px' }}>
                          <strong>{edu.degree || 'Degree'}</strong> in {edu.fieldOfStudy || 'Major'}
                          <div>{edu.school}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="uploaded-time" style={{ marginTop: '4px' }}>
              <span>📅 Uploaded:</span>
              <span>{formatDate(resumeMetadata.uploadedAt)}</span>
            </div>
          </div>
        ) : (
          <div 
            className={`dropzone ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileUpload}
          >
            <input 
              ref={fileInputRef}
              type="file" 
              className="file-input" 
              accept=".pdf,.docx"
              onChange={handleFileChange}
            />
            <span className="dropzone-icon">📥</span>
            <div className="dropzone-text">Upload Resume</div>
            <div className="dropzone-subtext">Drag & drop PDF or DOCX file here</div>
          </div>
        )}
      </section>

      {/* Controller actions */}
      <section className="section-card">
        <div className="section-title">
          <span>Autofill Control</span>
          {automation.status !== 'idle' && (
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              {automation.currentPage} ({automation.progress}%)
            </span>
          )}
        </div>

        <div className="actions-group">
          {automation.status === 'running' ? (
            <button className="btn btn-stop" onClick={handleStopAutofill}>
              🛑 Stop Autofill Execution
            </button>
          ) : (
            <button 
              className="btn btn-primary" 
              disabled={!resumeMetadata || !isWorkdayPage || metadataLoading || isParsing}
              onClick={handleStartAutofill}
            >
              ⚡ Start AI Autofill
            </button>
          )}

          <button 
            className="btn btn-secondary" 
            disabled={!resumeMetadata || metadataLoading || isParsing}
            onClick={handleClearResume}
          >
            🗑️ Clear Uploaded Resume
          </button>
        </div>

        {automation.status === 'running' && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
              <div 
                style={{ 
                  width: `${automation.progress}%`, 
                  background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Logs Console */}
      <section className="section-card">
        <div className="section-title">
          <span>Developer Activity Log</span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{logs.length} events</span>
        </div>
        <div className="log-console" ref={logConsoleRef}>
          {logs.length === 0 ? (
            <div className="log-empty">No activity events yet</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="log-entry">
                <span className="log-entry-time">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="log-entry-source">[{log.source}]</span>
                <span className={`log-entry-${log.level}`}>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
