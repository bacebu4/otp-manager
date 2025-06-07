// Background service worker for TOTP Chrome extension

// TOTP Generator (shared utility)
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
      
      return code.toString().padStart(digits, '0');
    } catch (error) {
      throw new Error('Invalid secret key');
    }
  }
}

// Storage utilities
class BackgroundStorage {
  static async getSecretsForDomain(domain) {
    const result = await chrome.storage.local.get([domain]);
    return result[domain] || [];
  }

  static async getCurrentDomain() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const url = new URL(tab.url);
        return url.hostname;
      }
    } catch (error) {
      console.error('Error getting current domain:', error);
    }
    return null;
  }
}

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'paste-totp') {
    await handleTOTPShortcut();
  }
});

async function handleTOTPShortcut() {
  try {
    // Get current domain
    const domain = await BackgroundStorage.getCurrentDomain();
    if (!domain) {
      console.log('No active domain found');
      return;
    }

    // Get secrets for current domain
    const secrets = await BackgroundStorage.getSecretsForDomain(domain);
    if (secrets.length === 0) {
      // Show notification that no secrets are configured
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'TOTP Generator',
        message: `No TOTP secrets configured for ${domain}`
      });
      return;
    }

    // Use the first secret if multiple exist
    // In a more advanced version, you could show a selection UI
    const secret = secrets[0];
    
    // Generate TOTP code
    const code = await TOTPGenerator.generateTOTP(
      secret.secret, null, secret.digits || 6, secret.period || 30
    );

    // Get current tab and inject content script to paste the code
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      // Send message to content script to paste the code
      await chrome.tabs.sendMessage(tab.id, {
        action: 'pasteTOTP',
        code: code,
        secretName: secret.name
      });
    }

  } catch (error) {
    console.error('Error handling TOTP shortcut:', error);
    
    // Show error notification
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'TOTP Generator Error',
      message: 'Failed to generate TOTP code'
    });
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateTOTP') {
    handleGenerateTOTP(request, sendResponse);
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'getCurrentDomain') {
    handleGetCurrentDomain(sendResponse);
    return true;
  }
});

async function handleGenerateTOTP(request, sendResponse) {
  try {
    const code = await TOTPGenerator.generateTOTP(
      request.secret,
      request.timestamp,
      request.digits,
      request.period
    );
    sendResponse({ success: true, code });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetCurrentDomain(sendResponse) {
  try {
    const domain = await BackgroundStorage.getCurrentDomain();
    sendResponse({ success: true, domain });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set up default settings or show welcome page
    console.log('TOTP Generator extension installed');
  } else if (details.reason === 'update') {
    // Handle extension updates
    console.log('TOTP Generator extension updated');
  }
});

// Handle tab updates to refresh domain-specific data
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Could be used to refresh popup if it's open
    // or update any cached domain-specific data
  }
});

// Cleanup notifications on click
chrome.notifications?.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

// Keep service worker alive for better performance
let keepAliveInterval;

function keepAlive() {
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // This does nothing but keeps the service worker active
    });
  }, 20000); // Every 20 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Start keepAlive when extension starts
keepAlive();

// Clean up on suspension (though this may not always fire in Manifest V3)
chrome.runtime.onSuspend.addListener(() => {
  stopKeepAlive();
});