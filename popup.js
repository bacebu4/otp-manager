// TOTP Generator utility functions
class TOTPGenerator {
  static base32Decode(encoded) {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    encoded = encoded.replace(/=+$/, '');
    let bits = '';
    
    for (let i = 0; i < encoded.length; i++) {
      const val = base32Chars.indexOf(encoded.charAt(i).toUpperCase());
      if (val === -1) throw new Error('Invalid base32 character');
      bits += val.toString(2).padStart(5, '0');
    }
    
    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
    }
    
    return bytes;
  }

  static async hmacSha1(key, data) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
    return new Uint8Array(signature);
  }

  static async generateTOTP(secret, timestamp = null, digits = 6, period = 30) {
    try {
      const key = this.base32Decode(secret);
      const time = timestamp || Math.floor(Date.now() / 1000);
      const counter = Math.floor(time / period);
      
      const counterBytes = new ArrayBuffer(8);
      const counterView = new DataView(counterBytes);
      counterView.setUint32(4, counter, false);
      
      const hmac = await this.hmacSha1(key, counterBytes);
      const offset = hmac[hmac.length - 1] & 0xf;
      
      const code = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
      ) % Math.pow(10, digits);
      
      const timeRemaining = period - (time % period);
      const progress = ((period - timeRemaining) / period) * 100;
      
      return {
        code: code.toString().padStart(digits, '0'),
        timeRemaining,
        progress
      };
    } catch (error) {
      throw new Error('Invalid secret key');
    }
  }

  static validateSecret(secret) {
    try {
      this.base32Decode(secret);
      return true;
    } catch {
      return false;
    }
  }
}

// Storage Manager
class StorageManager {
  static async getSecretsForDomain(domain) {
    const result = await chrome.storage.local.get([domain]);
    return result[domain] || [];
  }

  static async getAllSecrets() {
    const result = await chrome.storage.local.get();
    const allSecrets = [];
    
    Object.keys(result).forEach(domain => {
      if (Array.isArray(result[domain])) {
        allSecrets.push(...result[domain]);
      }
    });
    
    return allSecrets;
  }

  static async saveSecret(secret) {
    const secrets = await this.getSecretsForDomain(secret.website);
    const existingIndex = secrets.findIndex(s => s.id === secret.id);
    
    if (existingIndex >= 0) {
      secrets[existingIndex] = { ...secret, updatedAt: new Date().toISOString() };
    } else {
      secret.id = this.generateId();
      secret.createdAt = new Date().toISOString();
      secret.updatedAt = new Date().toISOString();
      secrets.push(secret);
    }
    
    await chrome.storage.local.set({ [secret.website]: secrets });
  }

  static async deleteSecret(secretId, domain) {
    const secrets = await this.getSecretsForDomain(domain);
    const filteredSecrets = secrets.filter(s => s.id !== secretId);
    await chrome.storage.local.set({ [domain]: filteredSecrets });
  }

  static async exportSecrets() {
    const secrets = await this.getAllSecrets();
    return JSON.stringify({
      version: '1.0',
      exportDate: new Date().toISOString(),
      secrets: secrets.map(s => ({
        website: s.website,
        name: s.name,
        secret: s.secret,
        issuer: s.issuer || '',
        digits: s.digits || 6,
        period: s.period || 30
      }))
    }, null, 2);
  }

  static async importSecrets(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      if (!data.secrets || !Array.isArray(data.secrets)) {
        throw new Error('Invalid import format');
      }

      for (const secret of data.secrets) {
        if (!secret.website || !secret.name || !secret.secret) {
          continue; // Skip invalid entries
        }

        await this.saveSecret({
          website: secret.website,
          name: secret.name,
          secret: secret.secret,
          issuer: secret.issuer || '',
          digits: secret.digits || 6,
          period: secret.period || 30,
          algorithm: 'SHA1'
        });
      }
    } catch (error) {
      throw new Error('Failed to import secrets: ' + error.message);
    }
  }

  static generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

// UI Controller
class UIController {
  constructor() {
    this.currentDomain = '';
    this.currentSecrets = [];
    this.updateInterval = null;
    this.editingSecret = null;
    
    this.initializeElements();
    this.bindEvents();
    this.initialize();
  }

  initializeElements() {
    // Main view elements
    this.mainView = document.getElementById('mainView');
    this.editView = document.getElementById('editView');
    this.currentDomainEl = document.getElementById('currentDomain');
    this.totpList = document.getElementById('totpList');
    this.emptyState = document.getElementById('emptyState');
    this.totalSecretsEl = document.getElementById('totalSecrets');
    
    // Buttons
    this.addNewBtn = document.getElementById('addNewBtn');
    this.addFirstBtn = document.getElementById('addFirstBtn');
    this.backBtn = document.getElementById('backBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.importBtn = document.getElementById('importBtn');
    this.showAllBtn = document.getElementById('showAllBtn');
    this.importFile = document.getElementById('importFile');
    
    // Form elements
    this.secretForm = document.getElementById('secretForm');
    this.editTitle = document.getElementById('editTitle');
    this.secretName = document.getElementById('secretName');
    this.secretWebsite = document.getElementById('secretWebsite');
    this.secretKey = document.getElementById('secretKey');
    this.secretIssuer = document.getElementById('secretIssuer');
    this.secretDigits = document.getElementById('secretDigits');
    this.secretPeriod = document.getElementById('secretPeriod');
    this.errorMessage = document.getElementById('errorMessage');
    this.deleteBtn = document.getElementById('deleteBtn');
    this.advancedToggle = document.getElementById('advancedToggle');
    this.advancedOptions = document.getElementById('advancedOptions');
    this.advancedArrow = document.getElementById('advancedArrow');
  }

  bindEvents() {
    // Navigation
    this.addNewBtn.addEventListener('click', () => this.showEditView());
    this.addFirstBtn.addEventListener('click', () => this.showEditView());
    this.backBtn.addEventListener('click', () => this.showMainView());
    
    // Form
    this.secretForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
    this.deleteBtn.addEventListener('click', () => this.handleDelete());
    
    // Advanced options toggle
    this.advancedToggle.addEventListener('click', () => this.toggleAdvancedOptions());
    
    // Import/Export
    this.exportBtn.addEventListener('click', () => this.handleExport());
    this.importBtn.addEventListener('click', () => this.importFile.click());
    this.importFile.addEventListener('change', (e) => this.handleImport(e));
    this.showAllBtn.addEventListener('click', (e) => this.handleShowAll(e));
  }

  async initialize() {
    await this.getCurrentDomain();
    await this.loadSecrets();
    this.startCountdownTimer();
  }

  async getCurrentDomain() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const url = new URL(tab.url);
        this.currentDomain = url.hostname;
        this.currentDomainEl.textContent = this.currentDomain;
        this.secretWebsite.value = this.currentDomain;
      }
    } catch (error) {
      console.error('Error getting current domain:', error);
      this.currentDomain = '';
    }
  }

  async loadSecrets() {
    try {
      this.currentSecrets = await StorageManager.getSecretsForDomain(this.currentDomain);
      const allSecrets = await StorageManager.getAllSecrets();      
      this.totalSecretsEl.textContent = `${allSecrets.length} secret${allSecrets.length !== 1 ? 's' : ''}`;
      this.renderSecrets();
    } catch (error) {
      console.error('Error loading secrets:', error);
      this.showError('Failed to load secrets');
    }
  }

  async renderSecrets() {
    if (this.currentSecrets.length === 0) {
      this.totpList.style.display = 'none';
      this.emptyState.style.display = 'block';
      return;
    }
    
    this.totpList.style.display = 'block';
    this.emptyState.style.display = 'none';
    
    const secretsHtml = await Promise.all(
      this.currentSecrets.map(secret => this.renderSecretCard(secret))
    );
    
    this.totpList.innerHTML = secretsHtml.join('');
    this.bindSecretCardEvents();
  }

  async renderSecretCard(secret) {
    try {
      const totp = await TOTPGenerator.generateTOTP(
        secret.secret, null, secret.digits || 6, secret.period || 30
      );
      
      return `
        <div class="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div class="flex items-center justify-between mb-2">
            <div class="flex-1">
              <h3 class="font-medium text-gray-800">${this.escapeHtml(secret.name)}</h3>
              ${secret.issuer ? `<p class="text-sm text-gray-500">${this.escapeHtml(secret.issuer)}</p>` : ''}
            </div>
            <button class="text-gray-400 hover:text-gray-600 edit-secret" data-id="${secret.id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
          
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="font-mono text-2xl font-bold text-blue-600">${totp.code}</span>
              <button class="copy-btn bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm transition-colors" data-code="${totp.code}">
                Copy
              </button>
            </div>
            <div class="text-right">
              <div class="text-sm text-gray-500">${totp.timeRemaining}s</div>
              <div class="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div class="countdown-bar h-full bg-blue-500" style="width: ${totp.progress}%"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      return `
        <div class="bg-red-50 rounded-lg border border-red-200 p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-medium text-red-800">${this.escapeHtml(secret.name)}</h3>
              <p class="text-sm text-red-600">Invalid secret key</p>
            </div>
            <button class="text-red-400 hover:text-red-600 edit-secret" data-id="${secret.id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        </div>
      `;
    }
  }

  bindSecretCardEvents() {
    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const code = e.target.dataset.code;
        try {
          await navigator.clipboard.writeText(code);
          const originalText = e.target.textContent;
          e.target.textContent = 'Copied!';
          e.target.classList.add('bg-green-100', 'text-green-700');
          setTimeout(() => {
            e.target.textContent = originalText;
            e.target.classList.remove('bg-green-100', 'text-green-700');
          }, 1000);
        } catch (error) {
          console.error('Failed to copy:', error);
        }
      });
    });

    // Edit buttons
    document.querySelectorAll('.edit-secret').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const secretId = e.currentTarget.dataset.id;
        this.editSecret(secretId);
      });
    });
  }

  startCountdownTimer() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.updateInterval = setInterval(() => {
      this.renderSecrets();
    }, 1000);
  }

  showMainView() {
    this.editView.classList.add('hidden');
    this.mainView.classList.remove('hidden');
    this.editingSecret = null;
    this.resetForm();
    this.loadSecrets();
  }

  showEditView(secret = null) {
    this.mainView.classList.add('hidden');
    this.editView.classList.remove('hidden');
    
    if (secret) {
      this.editingSecret = secret;
      this.editTitle.textContent = 'Edit Secret';
      this.deleteBtn.classList.remove('hidden');
      this.populateForm(secret);
    } else {
      this.editingSecret = null;
      this.editTitle.textContent = 'Add New Secret';
      this.deleteBtn.classList.add('hidden');
      this.resetForm();
    }
  }

  populateForm(secret) {
    this.secretName.value = secret.name;
    this.secretWebsite.value = secret.website;
    this.secretKey.value = secret.secret;
    this.secretIssuer.value = secret.issuer || '';
    this.secretDigits.value = secret.digits || 6;
    this.secretPeriod.value = secret.period || 30;
  }

  resetForm() {
    this.secretForm.reset();
    this.secretWebsite.value = this.currentDomain;
    this.hideError();
  }

  async handleFormSubmit(e) {
    e.preventDefault();

    const website = this.secretWebsite.value.trim();
    
    const secret = {
      name: this.secretName.value.trim() || website,
      website,
      secret: this.secretKey.value.trim().replace(/\s/g, ''),
      issuer: this.secretIssuer.value.trim(),
      digits: parseInt(this.secretDigits.value),
      period: parseInt(this.secretPeriod.value),
      algorithm: 'SHA1'
    };

    // Validation
    if (!secret.website || !secret.secret) {
      this.showError('Please fill in all required fields');
      return;
    }

    if (!TOTPGenerator.validateSecret(secret.secret)) {
      this.showError('Invalid secret key. Please check the Base32 format.');
      return;
    }

    try {
      if (this.editingSecret) {
        secret.id = this.editingSecret.id;
      }
      
      await StorageManager.saveSecret(secret);
      this.showMainView();
    } catch (error) {
      console.error('Error saving secret:', error);
      this.showError('Failed to save secret');
    }
  }

  async handleDelete() {
    if (!this.editingSecret) return;
    
    if (confirm('Are you sure you want to delete this secret?')) {
      try {
        await StorageManager.deleteSecret(this.editingSecret.id, this.editingSecret.website);
        this.showMainView();
      } catch (error) {
        console.error('Error deleting secret:', error);
        this.showError('Failed to delete secret');
      }
    }
  }

  editSecret(secretId) {
    const secret = this.currentSecrets.find(s => s.id === secretId);
    if (secret) {
      this.showEditView(secret);
    }
  }

  toggleAdvancedOptions() {
    const isHidden = this.advancedOptions.classList.contains('hidden');
    
    if (isHidden) {
      this.advancedOptions.classList.remove('hidden');
      this.advancedArrow.style.transform = 'rotate(180deg)';
    } else {
      this.advancedOptions.classList.add('hidden');
      this.advancedArrow.style.transform = 'rotate(0deg)';
    }
  }

  async handleExport() {
    try {
      const jsonData = await StorageManager.exportSecrets();
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `totp-secrets-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting secrets:', error);
      this.showError('Failed to export secrets');
    }
  }

  async handleShowAll() {
    try {
      this.currentSecrets =  await StorageManager.getAllSecrets();
      this.renderSecrets();
    } catch (error) {
      console.error('Error showing all secrets:', error);
      this.showError('Failed to show all secrets');
    }
  }

  async handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      await StorageManager.importSecrets(text);
      await this.loadSecrets();
      
      // Reset file input
      this.importFile.value = '';
      
      // Show success message
      const originalText = this.importBtn.textContent;
      this.importBtn.textContent = 'Imported!';
      this.importBtn.style.color = '#10b981';
      setTimeout(() => {
        this.importBtn.textContent = originalText;
        this.importBtn.style.color = '';
      }, 2000);
    } catch (error) {
      console.error('Error importing secrets:', error);
      this.showError('Failed to import secrets: ' + error.message);
      this.importFile.value = '';
    }
  }

  showError(message) {
    this.errorMessage.textContent = message;
    this.errorMessage.classList.remove('hidden');
    setTimeout(() => this.hideError(), 5000);
  }

  hideError() {
    this.errorMessage.classList.add('hidden');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  new UIController();
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (window.uiController) {
    window.uiController.destroy();
  }
});