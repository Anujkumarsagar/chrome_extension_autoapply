/**
 * Glassmorphic Floating Control Panel UI
 * Scoped styling injected dynamically into the host page to avoid layout clashes.
 */

const CSS_STYLES = `
  #waa-floating-panel {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 340px;
    max-height: 90vh;
    background: rgba(18, 18, 24, 0.9);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
    z-index: 999999;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f3f4f6;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  #waa-floating-panel.minimized {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    overflow: hidden;
    cursor: pointer;
  }

  .waa-header {
    background: linear-gradient(90deg, #6366f1, #a855f7);
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .waa-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #ffffff;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .waa-header-actions {
    display: flex;
    gap: 8px;
  }

  .waa-icon-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    font-size: 14px;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .waa-icon-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #ffffff;
  }

  .waa-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex-grow: 1;
    overflow-y: auto;
  }

  .waa-minimized-trigger {
    display: none;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    background: linear-gradient(135deg, #6366f1, #a855f7);
  }

  #waa-floating-panel.minimized .waa-minimized-trigger {
    display: flex;
  }

  #waa-floating-panel.minimized > *:not(.waa-minimized-trigger) {
    display: none;
  }

  .waa-progress-container {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .waa-progress-info {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #9ca3af;
    margin-bottom: 6px;
  }

  .waa-progress-bar-bg {
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .waa-progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4f46e5, #9333ea);
    transition: width 0.4s ease;
  }

  .waa-log-console {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 10px;
    font-family: monospace;
    font-size: 11px;
    height: 140px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .waa-log-entry {
    line-height: 1.4;
  }
  .waa-log-time { color: #6b7280; margin-right: 6px; }
  .waa-log-info { color: #9ca3af; }
  .waa-log-success { color: #34d399; }
  .waa-log-warn { color: #fbbf24; }
  .waa-log-error { color: #f87171; }

  .waa-drawer {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .waa-drawer-title {
    font-size: 12px;
    font-weight: 600;
    color: #818cf8;
  }

  .waa-drawer-desc {
    font-size: 11px;
    color: #d1d5db;
    line-height: 1.4;
  }

  .waa-drawer-input {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 8px;
    color: #ffffff;
    font-size: 12px;
    outline: none;
  }

  .waa-drawer-input:focus {
    border-color: #6366f1;
  }

  .waa-btn-group {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .waa-btn {
    flex-grow: 1;
    background: #6366f1;
    border: none;
    color: #ffffff;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .waa-btn:hover { background: #4f46e5; }
  .waa-btn-secondary { background: rgba(255, 255, 255, 0.1); color: #e5e7eb; }
  .waa-btn-secondary:hover { background: rgba(255, 255, 255, 0.15); }
  .waa-btn-danger { background: #ef4444; }
  .waa-btn-danger:hover { background: #dc2626; }
`;

export class FloatingPanel {
  private panel: HTMLElement | null = null;
  private logConsole: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressStep: HTMLElement | null = null;
  private progressPercent: HTMLElement | null = null;
  private drawerContainer: HTMLElement | null = null;
  private isMinimized = false;
  
  constructor() {
    this.injectStyles();
  }

  private injectStyles() {
    if (document.getElementById('waa-styles')) return;
    const style = document.createElement('style');
    style.id = 'waa-styles';
    style.textContent = CSS_STYLES;
    document.head.appendChild(style);
  }

  public render(onCancel: () => void, onPauseToggle: (isPaused: boolean) => void) {
    if (this.panel) return;

    this.panel = document.createElement('div');
    this.panel.id = 'waa-floating-panel';

    // Minimized HTML
    const minTrigger = document.createElement('div');
    minTrigger.className = 'waa-minimized-trigger';
    minTrigger.textContent = '⚡';
    minTrigger.onclick = () => this.toggleMinimize();
    this.panel.appendChild(minTrigger);

    // Header HTML
    const header = document.createElement('div');
    header.className = 'waa-header';
    header.innerHTML = `
      <h2>⚡ Workday AI Autofill</h2>
      <div class="waa-header-actions">
        <button class="waa-icon-btn" id="waa-pause-btn" title="Pause/Play">⏸️</button>
        <button class="waa-icon-btn" id="waa-min-btn" title="Minimize">➖</button>
        <button class="waa-icon-btn" id="waa-close-btn" title="Stop Automation">❌</button>
      </div>
    `;
    this.panel.appendChild(header);

    // Main content HTML
    const content = document.createElement('div');
    content.className = 'waa-content';
    content.innerHTML = `
      <div class="waa-progress-container">
        <div class="waa-progress-info">
          <span id="waa-progress-step">Initializing page...</span>
          <span id="waa-progress-percent">0%</span>
        </div>
        <div class="waa-progress-bar-bg">
          <div class="waa-progress-bar-fill" style="width: 0%"></div>
        </div>
      </div>

      <div class="waa-log-console" id="waa-logs"></div>
      <div id="waa-drawer-container"></div>
    `;
    this.panel.appendChild(content);

    document.body.appendChild(this.panel);

    // Bind events
    this.logConsole = this.panel.querySelector('#waa-logs');
    this.progressBar = this.panel.querySelector('.waa-progress-bar-fill');
    this.progressStep = this.panel.querySelector('#waa-progress-step');
    this.progressPercent = this.panel.querySelector('#waa-progress-percent');
    this.drawerContainer = this.panel.querySelector('#waa-drawer-container');

    const minBtn = this.panel.querySelector('#waa-min-btn') as HTMLElement;
    minBtn.onclick = () => this.toggleMinimize();

    const closeBtn = this.panel.querySelector('#waa-close-btn') as HTMLElement;
    closeBtn.onclick = onCancel;

    let isPaused = false;
    const pauseBtn = this.panel.querySelector('#waa-pause-btn') as HTMLElement;
    pauseBtn.onclick = () => {
      isPaused = !isPaused;
      pauseBtn.textContent = isPaused ? '▶️' : '⏸️';
      this.addLog(isPaused ? 'Automation paused by user' : 'Automation resumed', 'warn');
      onPauseToggle(isPaused);
    };
  }

  private toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    if (this.isMinimized) {
      this.panel?.classList.add('minimized');
    } else {
      this.panel?.classList.remove('minimized');
    }
  }

  public updateProgress(progress: number, stepName: string) {
    if (this.progressBar) this.progressBar.style.width = `${progress}%`;
    if (this.progressStep) this.progressStep.textContent = stepName;
    if (this.progressPercent) this.progressPercent.textContent = `${progress}%`;
  }

  public addLog(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    if (!this.logConsole) return;
    const entry = document.createElement('div');
    entry.className = 'waa-log-entry';
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span class="waa-log-time">${time}</span><span class="waa-log-${level}">${message}</span>`;
    this.logConsole.appendChild(entry);
    this.logConsole.scrollTop = this.logConsole.scrollHeight;
  }

  /**
   * Prompts the user to answer or verify a low-confidence/custom question.
   * Blocks execution until user submits.
   */
  public async promptUserQuestion(
    question: string,
    defaultValue: string,
    options?: string[]
  ): Promise<string> {
    return new Promise((resolve) => {
      if (!this.drawerContainer) {
        resolve(defaultValue);
        return;
      }

      this.drawerContainer.innerHTML = '';
      const drawer = document.createElement('div');
      drawer.className = 'waa-drawer';

      let inputHtml = '';
      if (options && options.length > 0) {
        inputHtml = `
          <select class="waa-drawer-input" id="waa-drawer-value" style="width: 100%;">
            ${options.map(opt => `<option value="${opt}" ${opt === defaultValue ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        `;
      } else {
        inputHtml = `
          <input type="text" class="waa-drawer-input" id="waa-drawer-value" value="${defaultValue}" style="width: 90%;" />
        `;
      }

      drawer.innerHTML = `
        <div class="waa-drawer-title">🙋 Verification Required</div>
        <div class="waa-drawer-desc">${question}</div>
        ${inputHtml}
        <div class="waa-btn-group">
          <button class="waa-btn" id="waa-drawer-submit">Confirm Value</button>
        </div>
      `;

      this.drawerContainer.appendChild(drawer);
      this.addLog(`Waiting for user to verify question: "${question.substring(0, 30)}..."`, 'warn');

      const submitBtn = drawer.querySelector('#waa-drawer-submit') as HTMLElement;
      submitBtn.onclick = () => {
        const inputEl = drawer.querySelector('#waa-drawer-value') as HTMLInputElement | HTMLSelectElement;
        const val = inputEl.value;
        this.drawerContainer!.innerHTML = '';
        this.addLog(`Answer confirmed: "${val}"`, 'success');
        resolve(val);
      };
    });
  }

  /**
   * Prompts the user to review filled fields before advancing page or submitting.
   */
  public async promptPageReview(
    fields: Array<{ label: string; value: string; confidence: number }>
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.drawerContainer) {
        resolve(true);
        return;
      }

      this.drawerContainer.innerHTML = '';
      const drawer = document.createElement('div');
      drawer.className = 'waa-drawer';
      
      const listHtml = fields.map(f => {
        const confColor = f.confidence > 85 ? '#34d399' : f.confidence > 50 ? '#fbbf24' : '#f87171';
        return `
          <div style="display:flex; justify-content:space-between; font-size:10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 4px 0;">
            <span style="color:#d1d5db; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${f.label}</span>
            <span style="color:#ffffff; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${f.value || 'N/A'}</span>
            <span style="color:${confColor}">${f.confidence}%</span>
          </div>
        `;
      }).join('');

      drawer.innerHTML = `
        <div class="waa-drawer-title">📋 Step Review</div>
        <div style="max-height: 120px; overflow-y: auto; margin: 4px 0;">
          ${listHtml}
        </div>
        <div class="waa-btn-group">
          <button class="waa-btn" id="waa-drawer-approve">Continue to Next Page</button>
        </div>
      `;

      this.drawerContainer.appendChild(drawer);
      this.addLog('Step completed. Please review values in the panel.', 'warn');

      const approveBtn = drawer.querySelector('#waa-drawer-approve') as HTMLElement;
      approveBtn.onclick = () => {
        this.drawerContainer!.innerHTML = '';
        resolve(true);
      };
    });
  }

  public destroy() {
    if (this.panel) {
      document.body.removeChild(this.panel);
      this.panel = null;
    }
  }
}
export default FloatingPanel;
