// Content script for TOTP Chrome extension
// Handles auto-filling TOTP codes into input fields

class TOTPContentScript {
  constructor() {
    this.setupMessageListener();
  }

  setupMessageListener() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'pasteTOTP') {
        this.handlePasteTOTP(request.code, request.secretName);
        sendResponse({ success: true });
      }
      return false;
    });
  }

  handlePasteTOTP(code, secretName) {
    try {
      // Find the currently focused element
      const activeElement = document.activeElement;
      
      // Check if the active element is a valid input field
      if (this.isValidInputField(activeElement)) {
        // Paste the TOTP code
        this.pasteCodeToInput(activeElement, code);
        
        // Show a brief confirmation
        this.showConfirmation(secretName, code);
      } else {
        // Try to find a suitable input field if none is focused
        const inputField = this.findBestInputField();
        if (inputField) {
          this.pasteCodeToInput(inputField, code);
          inputField.focus();
          this.showConfirmation(secretName, code);
        } else {
          // Copy to clipboard as fallback
          this.copyToClipboard(code);
          this.showNotification(`TOTP code copied to clipboard: ${code}`);
        }
      }
    } catch (error) {
      console.error('Error pasting TOTP code:', error);
      // Fallback to clipboard
      this.copyToClipboard(code);
      this.showNotification('TOTP code copied to clipboard');
    }
  }

  isValidInputField(element) {
    if (!element) return false;
    
    const tagName = element.tagName.toLowerCase();
    const type = element.type ? element.type.toLowerCase() : '';
    
    // Check for standard input fields
    if (tagName === 'input') {
      const validTypes = ['text', 'password', 'number', 'tel', 'email'];
      return validTypes.includes(type) || type === '';
    }
    
    // Check for textarea
    if (tagName === 'textarea') {
      return true;
    }
    
    // Check for contenteditable elements
    if (element.contentEditable === 'true') {
      return true;
    }
    
    return false;
  }

  findBestInputField() {
    // Look for common TOTP input field patterns
    const selectors = [
      // Common TOTP field patterns
      'input[name*="code"]',
      'input[name*="totp"]',
      'input[name*="otp"]',
      'input[name*="token"]',
      'input[name*="verify"]',
      'input[name*="auth"]',
      'input[placeholder*="code" i]',
      'input[placeholder*="verification" i]',
      'input[placeholder*="authenticator" i]',
      'input[id*="code"]',
      'input[id*="totp"]',
      'input[id*="otp"]',
      'input[id*="token"]',
      'input[class*="code"]',
      'input[class*="otp"]',
      'input[class*="totp"]',
      
      // General input fields (as fallback)
      'input[type="text"]',
      'input[type="number"]',
      'input[type="tel"]',
      'input[type="password"]',
      'input:not([type])'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isValidInputField(element) && this.isVisible(element)) {
          return element;
        }
      }
    }

    return null;
  }

  isVisible(element) {
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.offsetWidth > 0 &&
      element.offsetHeight > 0
    );
  }

  pasteCodeToInput(inputElement, code) {
    // Clear existing value
    inputElement.value = '';
    
    // Set new value
    inputElement.value = code;
    
    // Trigger input events to ensure the website recognizes the change
    const events = ['input', 'change', 'keyup', 'paste'];
    events.forEach(eventType => {
      const event = new Event(eventType, { bubbles: true, cancelable: true });
      inputElement.dispatchEvent(event);
    });

    // For contenteditable elements
    if (inputElement.contentEditable === 'true') {
      inputElement.textContent = code;
      inputElement.innerHTML = code;
      
      // Trigger events for contenteditable
      const editableEvents = ['input', 'textInput', 'keyup'];
      editableEvents.forEach(eventType => {
        const event = new Event(eventType, { bubbles: true, cancelable: true });
        inputElement.dispatchEvent(event);
      });
    }

    // Focus the element to show the user where the code was pasted
    inputElement.focus();
    
    // Select the text for easy replacement if needed
    if (inputElement.select) {
      inputElement.select();
    }
  }

  async copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }

  showConfirmation(secretName, code) {
    // Create and show a temporary notification
    const notification = this.createNotificationElement(
      `TOTP code pasted: ${code}`,
      `From: ${secretName}`,
      'success'
    );
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.classList.add('totp-notification-show');
    }, 10);
    
    // Remove after delay
    setTimeout(() => {
      notification.classList.remove('totp-notification-show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  showNotification(message, type = 'info') {
    const notification = this.createNotificationElement(message, '', type);
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('totp-notification-show');
    }, 10);
    
    setTimeout(() => {
      notification.classList.remove('totp-notification-show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  createNotificationElement(title, subtitle, type) {
    const notification = document.createElement('div');
    notification.className = `totp-notification totp-notification-${type}`;
    
    // Inject styles if not already present
    this.injectStyles();
    
    notification.innerHTML = `
      <div class="totp-notification-content">
        <div class="totp-notification-title">${title}</div>
        ${subtitle ? `<div class="totp-notification-subtitle">${subtitle}</div>` : ''}
      </div>
      <div class="totp-notification-close">×</div>
    `;
    
    // Add close button functionality
    const closeBtn = notification.querySelector('.totp-notification-close');
    closeBtn.addEventListener('click', () => {
      notification.classList.remove('totp-notification-show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    });
    
    return notification;
  }

  injectStyles() {
    // Only inject styles once
    if (document.getElementById('totp-extension-styles')) {
      return;
    }
    
    const styles = document.createElement('style');
    styles.id = 'totp-extension-styles';
    styles.textContent = `
      .totp-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        padding: 16px;
        max-width: 320px;
        z-index: 10001;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        transform: translateX(400px);
        opacity: 0;
        transition: all 0.3s ease;
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      
      .totp-notification-show {
        transform: translateX(0);
        opacity: 1;
      }
      
      .totp-notification-success {
        border-left: 4px solid #10b981;
      }
      
      .totp-notification-info {
        border-left: 4px solid #3b82f6;
      }
      
      .totp-notification-content {
        flex: 1;
      }
      
      .totp-notification-title {
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 4px;
      }
      
      .totp-notification-subtitle {
        color: #6b7280;
        font-size: 12px;
      }
      
      .totp-notification-close {
        cursor: pointer;
        color: #9ca3af;
        font-size: 18px;
        line-height: 1;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      }
      
      .totp-notification-close:hover {
        background: #f3f4f6;
        color: #374151;
      }
    `;
    
    document.head.appendChild(styles);
  }
}

// Initialize the content script
const totpContentScript = new TOTPContentScript();