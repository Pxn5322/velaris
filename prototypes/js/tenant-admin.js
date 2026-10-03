/**
 * VELARIS Tenant Admin - AI Studio Components
 * Version: 1.0.0
 */

(function() {
  'use strict';
  
  // Studio Tab Management
  const StudioTabs = {
    currentTab: 'instructions',
    
    init() {
      // Set up event listeners for tab buttons
      document.querySelectorAll('[id^="tab-"]').forEach(btn => {
        const tab = btn.id.replace('tab-', '');
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
      // Update button states
      document.querySelectorAll('[id^="tab-"]').forEach(btn => {
        btn.className = 'py-3 flex items-center gap-2 hover:text-white text-slate-400';
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('tabindex', '-1');
      });
      
      const activeBtn = document.getElementById('tab-' + tab);
      if (activeBtn) {
        activeBtn.className = 'py-3 studio-tab-active flex items-center gap-2';
        activeBtn.setAttribute('aria-selected', 'true');
        activeBtn.setAttribute('tabindex', '0');
        activeBtn.focus();
      }
      
      // Hide all views
      document.querySelectorAll('[id^="studio-view-"]').forEach(view => {
        view.classList.add('hidden');
        view.setAttribute('aria-hidden', 'true');
      });
      
      // Show selected view
      const activeView = document.getElementById('studio-view-' + tab);
      if (activeView) {
        activeView.classList.remove('hidden');
        activeView.setAttribute('aria-hidden', 'false');
      }
      
      this.currentTab = tab;
      
      // Announce to screen readers
      const liveRegion = document.getElementById('studio-tab-live');
      if (liveRegion) {
        liveRegion.textContent = tab.charAt(0).toUpperCase() + tab.slice(1) + ' tab selected';
      }
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
    
    StudioTabs.init();
    
    // Expose for legacy onclick handlers
    window.switchStudioTab = (tab) => StudioTabs.switchTab(tab);
  });
  
})();
