/**
 * VELARIS Admin Console - Enterprise Management
 * Version: 1.0.0
 */

(function() {
  'use strict';
  
  // Admin Tab Management
  const AdminTabs = {
    currentTab: 'tenants',
    
    init() {
      document.querySelectorAll('.admin-nav-item').forEach(btn => {
        const tab = btn.id.replace('tab-btn-', '');
        btn.addEventListener('click', () => this.switchTab(tab));
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.switchTab(tab);
          }
        });
      });
    },
    
    switchTab(tab) {
      // Update navigation
      document.querySelectorAll('.admin-nav-item').forEach(el => {
        el.className = 'admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800/60';
        el.setAttribute('aria-current', 'false');
      });
      
      const activeBtn = document.getElementById('tab-btn-' + tab);
      if (activeBtn) {
        activeBtn.className = 'admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold bg-brand text-white';
        activeBtn.setAttribute('aria-current', 'page');
      }
      
      // Update views
      document.querySelectorAll('[id^="view-"]').forEach(view => {
        if (view.id.startsWith('view-')) {
          view.classList.add('hidden');
          view.setAttribute('aria-hidden', 'true');
        }
      });
      
      const activeView = document.getElementById('view-' + tab);
      if (activeView) {
        activeView.classList.remove('hidden');
        activeView.setAttribute('aria-hidden', 'false');
      }
      
      // Update title
      const titleEl = document.getElementById('admin-view-title');
      if (titleEl) {
        titleEl.textContent = tab === 'tenants' ? 'Tenants Management' : 
                              tab === 'audit' ? 'Global Audit Stream' : 
                              tab.charAt(0).toUpperCase() + tab.slice(1);
      }
      
      this.currentTab = tab;
    }
  };
  
  // Modal Management with Focus Trap
  const SuspendModal = {
    modal: null,
    focusTrap: null,
    previousFocus: null,
    
    init() {
      this.modal = document.getElementById('suspend-modal');
      if (!this.modal) return;
      
      // Close on backdrop click
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.close();
        }
      });
      
      // Close on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
          this.close();
        }
      });
    },
    
    open(tenantName) {
      if (!this.modal) return;
      
      this.previousFocus = document.activeElement;
      
      const nameEl = document.getElementById('suspend-tenant-name');
      if (nameEl) nameEl.textContent = tenantName;
      
      this.modal.classList.remove('hidden');
      this.modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      
      // Set focus to first focusable element
      const firstFocusable = this.modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (firstFocusable) firstFocusable.focus();
      
      // Trap focus
      this.trapFocus();
    },
    
    close() {
      if (!this.modal) return;
      
      this.modal.classList.add('hidden');
      this.modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      
      // Restore focus
      if (this.previousFocus) {
        this.previousFocus.focus();
      }
      
      this.releaseFocusTrap();
    },
    
    confirm() {
      const tenantName = document.getElementById('suspend-tenant-name')?.textContent || 'Unknown';
      alert('Tenant ' + tenantName + ' has been suspended. Audit log updated.');
      this.close();
    },
    
    trapFocus() {
      const focusableElements = this.modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      
      this.focusHandler = (e) => {
        if (e.key === 'Tab') {
          if (e.shiftKey && document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          } else if (!e.shiftKey && document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      };
      
      this.modal.addEventListener('keydown', this.focusHandler);
    },
    
    releaseFocusTrap() {
      if (this.focusHandler && this.modal) {
        this.modal.removeEventListener('keydown', this.focusHandler);
      }
    }
  };
  
  // Sidebar Management
  const Sidebar = {
    sidebar: null,
    overlay: null,
    
    init() {
      this.sidebar = document.getElementById('admin-sidebar');
      this.overlay = document.getElementById('sidebar-overlay');
      
      if (this.overlay) {
        this.overlay.addEventListener('click', () => this.toggle());
      }
    },
    
    toggle() {
      if (!this.sidebar) return;
      
      const isHidden = this.sidebar.classList.contains('-translate-x-full');
      this.sidebar.classList.toggle('-translate-x-full');
      
      if (this.overlay) {
        this.overlay.classList.toggle('hidden');
      }
      
      // Update ARIA
      this.sidebar.setAttribute('aria-hidden', isHidden ? 'false' : 'true');
    }
  };
  
  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    try {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    } catch (error) {
      console.error('Failed to initialize Lucide icons:', error);
    }
    
    AdminTabs.init();
    SuspendModal.init();
    Sidebar.init();
    
    // Expose for legacy onclick handlers
    window.switchAdminTab = (tab) => AdminTabs.switchTab(tab);
    window.openSuspendModal = (name) => SuspendModal.open(name);
    window.closeSuspendModal = () => SuspendModal.close();
    window.confirmSuspend = () => SuspendModal.confirm();
    window.toggleSidebar = () => Sidebar.toggle();
  });
  
})();
