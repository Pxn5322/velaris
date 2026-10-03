/**
 * VELARIS Shared JavaScript Utilities
 * Version: 1.0.0
 */

(function(global) {
  'use strict';

  // Configuration Constants
  const ROI_CONFIG = Object.freeze({
    DEFLECTION_RATE: 0.78,
    COST_PER_TICKET: 1.82,
    TIME_PER_TICKET_HOURS: 0.054,
    MIN_VOLUME: 1000,
    MAX_VOLUME: 100000
  });

  const VALIDATION_LIMITS = Object.freeze({
    TICKET_SUBJECT_MAX: 200,
    TICKET_DESCRIPTION_MAX: 5000,
    TENANT_NAME_MAX: 100,
    EMAIL_MAX: 255
  });

  // Debounce function
  function debounce(func, wait, immediate) {
    if (typeof func !== 'function') {
      throw new TypeError('Expected a function');
    }
    
    let timeout;
    
    return function debounced() {
      const context = this;
      const args = arguments;
      
      const later = function() {
        timeout = null;
        if (!immediate) {
          func.apply(context, args);
        }
      };
      
      const callNow = immediate && !timeout;
      
      if (timeout) {
        clearTimeout(timeout);
      }
      
      timeout = setTimeout(later, wait);
      
      if (callNow) {
        func.apply(context, args);
      }
    };
  }

  // Throttle function
  function throttle(func, limit) {
    if (typeof func !== 'function') {
      throw new TypeError('Expected a function');
    }
    
    let inThrottle;
    
    return function throttled() {
      const context = this;
      const args = arguments;
      
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(function() {
          inThrottle = false;
        }, limit);
      }
    };
  }

  // Validate numeric input within bounds
  function validateNumericInput(value, min, max, defaultVal) {
    const num = parseFloat(value);
    const defaultValue = typeof defaultVal === 'number' ? defaultVal : min;
    
    if (isNaN(num) || !isFinite(num)) {
      return defaultValue;
    }
    
    return Math.max(min, Math.min(max, num));
  }

  // Validate string input length
  function validateStringInput(value, minLength, maxLength) {
    if (typeof value !== 'string') {
      return { isValid: false, value: '', error: 'Invalid input type' };
    }
    
    const trimmed = value.trim();
    
    if (trimmed.length < minLength) {
      return { isValid: false, value: trimmed, error: 'Minimum ' + minLength + ' characters required' };
    }
    
    if (trimmed.length > maxLength) {
      return { isValid: false, value: trimmed.substring(0, maxLength), error: 'Maximum ' + maxLength + ' characters allowed' };
    }
    
    return { isValid: true, value: trimmed, error: null };
  }

  // Validate email format
  function validateEmail(email) {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  // Safe number formatting
  function safeFormatNumber(value, locale, options) {
    try {
      const num = parseFloat(value);
      
      if (isNaN(num) || !isFinite(num)) {
        return '0';
      }
      
      return num.toLocaleString(locale || 'en-US', options || {});
    } catch (error) {
      console.error('Number formatting error:', error);
      return String(value);
    }
  }

  // Format currency
  function formatCurrency(value, currency, locale) {
    return safeFormatNumber(value, locale || 'en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  // Format percentage
  function formatPercentage(value, decimals) {
    const num = parseFloat(value);
    
    if (isNaN(num)) return '0%';
    
    const percentage = num * 100;
    const places = typeof decimals === 'number' ? decimals : 0;
    
    return safeFormatNumber(percentage, 'en-US', {
      minimumFractionDigits: places,
      maximumFractionDigits: places
    }) + '%';
  }

  // Error handler wrapper
  function withErrorHandling(fn, fallback, context) {
    if (typeof fn !== 'function') {
      console.error('withErrorHandling: Expected a function');
      return fallback;
    }
    
    return function safeExecutor() {
      try {
        return fn.apply(this, arguments);
      } catch (error) {
        const errorMsg = context ? '[' + context + '] ' : '';
        console.error(errorMsg + 'Function error:', error);
        return fallback;
      }
    };
  }

  // Create accessible alert element
  function createAlert(message, type) {
    const alertEl = document.createElement('div');
    alertEl.setAttribute('role', 'alert');
    alertEl.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    alertEl.className = 'sr-only alert alert-' + (type || 'info');
    alertEl.textContent = message;
    return alertEl;
  }

  // Announce to screen readers
  function announceToScreenReader(message, priority) {
    const liveRegion = document.createElement('div');
    liveRegion.setAttribute('aria-live', priority || 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.className = 'sr-only';
    liveRegion.textContent = message;
    
    document.body.appendChild(liveRegion);
    
    setTimeout(function() {
      if (liveRegion.parentNode) {
        liveRegion.parentNode.removeChild(liveRegion);
      }
    }, 1000);
  }

  // Keyboard Shortcuts Manager
  const KeyboardShortcuts = {
    shortcuts: {},
    enabled: true,
    
    register: function(key, modifiers, callback, description) {
      if (typeof callback !== 'function') {
        throw new TypeError('Callback must be a function');
      }
      
      const keyCombo = [
        modifiers.ctrl ? 'ctrl+' : '',
        modifiers.alt ? 'alt+' : '',
        modifiers.shift ? 'shift+' : '',
        modifiers.meta ? 'meta+' : '',
        key.toLowerCase()
      ].join('');
      
      this.shortcuts[keyCombo] = {
        callback: callback,
        description: description || 'Shortcut: ' + keyCombo,
        key: key,
        modifiers: modifiers
      };
    },
    
    unregister: function(key, modifiers) {
      const keyCombo = [
        modifiers.ctrl ? 'ctrl+' : '',
        modifiers.alt ? 'alt+' : '',
        modifiers.shift ? 'shift+' : '',
        modifiers.meta ? 'meta+' : '',
        key.toLowerCase()
      ].join('');
      
      delete this.shortcuts[keyCombo];
    },
    
    enable: function() {
      this.enabled = true;
    },
    
    disable: function() {
      this.enabled = false;
    },
    
    init: function() {
      const self = this;
      
      document.addEventListener('keydown', function(e) {
        if (!self.enabled) return;
        
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
          if (e.key !== 'Escape' && !(e.key === 'k' && (e.metaKey || e.ctrlKey))) {
            return;
          }
        }
        
        const keyCombo = [
          e.ctrlKey ? 'ctrl+' : '',
          e.altKey ? 'alt+' : '',
          e.shiftKey ? 'shift+' : '',
          e.metaKey ? 'meta+' : '',
          e.key.toLowerCase()
        ].join('');
        
        if (self.shortcuts[keyCombo]) {
          e.preventDefault();
          self.shortcuts[keyCombo].callback(e);
        }
      });
    },
    
    getShortcuts: function() {
      const result = [];
      for (const keyCombo in this.shortcuts) {
        const data = this.shortcuts[keyCombo];
        result.push({
          key: data.key,
          modifiers: data.modifiers,
          combo: keyCombo,
          description: data.description
        });
      }
      return result;
    }
  };

  // Focus Trap Class
  class FocusTrap {
    constructor(element) {
      if (!element || !(element instanceof HTMLElement)) {
        throw new TypeError('FocusTrap requires a valid HTMLElement');
      }
      
      this.element = element;
      this.focusableElements = null;
      this.firstFocusable = null;
      this.lastFocusable = null;
      this.previousFocus = null;
      this.active = false;
      
      this.handleKeyDown = this.handleKeyDown.bind(this);
    }
    
    updateFocusableElements() {
      const focusableSelectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      
      this.focusableElements = this.element.querySelectorAll(focusableSelectors);
      this.firstFocusable = this.focusableElements[0];
      this.lastFocusable = this.focusableElements[this.focusableElements.length - 1];
    }
    
    activate() {
      if (this.active) return;
      
      this.previousFocus = document.activeElement;
      this.updateFocusableElements();
      
      this.element.addEventListener('keydown', this.handleKeyDown);
      this.active = true;
      
      if (this.firstFocusable) {
        this.firstFocusable.focus();
      }
    }
    
    deactivate() {
      if (!this.active) return;
      
      this.element.removeEventListener('keydown', this.handleKeyDown);
      this.active = false;
      
      if (this.previousFocus && typeof this.previousFocus.focus === 'function') {
        this.previousFocus.focus();
      }
    }
    
    handleKeyDown(e) {
      if (e.key !== 'Tab') return;
      
      this.updateFocusableElements();
      
      if (e.shiftKey) {
        if (document.activeElement === this.firstFocusable) {
          e.preventDefault();
          this.lastFocusable.focus();
        }
      } else {
        if (document.activeElement === this.lastFocusable) {
          e.preventDefault();
          this.firstFocusable.focus();
        }
      }
    }
  }

  // DOM Utilities
  function querySelectorSafe(selector, context) {
    try {
      const ctx = context || document;
      return ctx.querySelector(selector);
    } catch (error) {
      console.error('Query selector error:', error);
      return null;
    }
  }

  function querySelectorAllSafe(selector, context) {
    try {
      const ctx = context || document;
      return ctx.querySelectorAll(selector);
    } catch (error) {
      console.error('Query selector all error:', error);
      return [];
    }
  }

  // Storage Utilities
  const storage = {
    get: function(key, defaultValue) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (error) {
        console.error('Storage get error:', error);
        return defaultValue;
      }
    },
    
    set: function(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error('Storage set error:', error);
        return false;
      }
    },
    
    remove: function(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (error) {
        console.error('Storage remove error:', error);
        return false;
      }
    }
  };

  // Export to Global
  global.VELARIS = {
    ROI_CONFIG: ROI_CONFIG,
    VALIDATION_LIMITS: VALIDATION_LIMITS,
    debounce: debounce,
    throttle: throttle,
    validateNumericInput: validateNumericInput,
    validateStringInput: validateStringInput,
    validateEmail: validateEmail,
    safeFormatNumber: safeFormatNumber,
    formatCurrency: formatCurrency,
    formatPercentage: formatPercentage,
    withErrorHandling: withErrorHandling,
    createAlert: createAlert,
    announceToScreenReader: announceToScreenReader,
    KeyboardShortcuts: KeyboardShortcuts,
    FocusTrap: FocusTrap,
    querySelectorSafe: querySelectorSafe,
    querySelectorAllSafe: querySelectorAllSafe,
    storage: storage
  };

  // Backward compatibility
  global.debounce = debounce;
  global.validateNumericInput = validateNumericInput;
  global.safeFormatNumber = safeFormatNumber;
  global.withErrorHandling = withErrorHandling;
  global.createAlert = createAlert;
  global.KeyboardShortcuts = KeyboardShortcuts;
  global.FocusTrap = FocusTrap;

})(typeof window !== 'undefined' ? window : this);
