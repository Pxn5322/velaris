/**
 * VELARIS Customer Portal - Self-Service Interface
 * Version: 1.0.0
 */

(function() {
  'use strict';
  
  // Portal Tab Management
  const PortalTabs = {
    currentTab: 'new',
    
    init() {
      document.querySelectorAll('[id^="portal-btn-"]').forEach(btn => {
        const tab = btn.id.replace('portal-btn-', '');
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
      document.querySelectorAll('[id^="portal-btn-"]').forEach(btn => {
        btn.className = 'hover:text-white text-slate-300';
        btn.setAttribute('aria-current', 'false');
      });
      
      const activeBtn = document.getElementById('portal-btn-' + tab);
      if (activeBtn) {
        activeBtn.className = 'text-white font-bold underline decoration-brand decoration-2 underline-offset-4';
        activeBtn.setAttribute('aria-current', 'page');
      }
      
      // Update views
      document.querySelectorAll('[id^="portal-view-"]').forEach(view => {
        view.classList.add('hidden');
        view.setAttribute('aria-hidden', 'true');
      });
      
      const activeView = document.getElementById('portal-view-' + tab);
      if (activeView) {
        activeView.classList.remove('hidden');
        activeView.setAttribute('aria-hidden', 'false');
      }
      
      this.currentTab = tab;
      
      // Announce to screen readers
      const liveRegion = document.getElementById('portal-live');
      if (liveRegion) {
        liveRegion.textContent = tab === 'new' ? 'Submit request form' : 'My tickets view';
      }
    }
  };
  
  // AI Deflection Widget
  const DeflectionWidget = {
    checkTimeout: null,
    delay: 300, // ms
    
    check(value) {
      // Clear previous timeout
      if (this.checkTimeout) {
        clearTimeout(this.checkTimeout);
      }
      
      // Debounce the check
      this.checkTimeout = setTimeout(() => {
        this.performCheck(value);
      }, this.delay);
    },
    
    performCheck(value) {
      const resultsEl = document.getElementById('deflection-results');
      if (!resultsEl) return;
      
      // Only show deflection if there's meaningful input
      if (value.length < 5) {
        resultsEl.innerHTML = '';
        return;
      }
      
      // Simulated deflection results based on keywords
      const hasRefund = value.toLowerCase().includes('refund');
      const hasOrder = value.toLowerCase().includes('order');
      const hasDelivery = value.toLowerCase().includes('delivery') || value.toLowerCase().includes('late');
      
      if (hasRefund || hasOrder || hasDelivery) {
        resultsEl.innerHTML = 
          <div class="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
            <div class="text-xs font-bold text-indigo-300">Shipping Guarantee & Refund Policy (Section 4.2)</div>
            <p class="text-[11px] text-slate-400 leading-relaxed">Deliveries exceeding 48 hours past SLA qualify for an immediate 100% refund. Click to execute automated refund.</p>
            <button type="button" class="text-xs text-accent font-semibold flex items-center gap-1 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded">
              Is this helpful? Resolve Request <i data-lucide="check" class="w-3.5 h-3.5" aria-hidden="true"></i>
            </button>
          </div>
        ;
        
        // Re-initialize Lucide icons
        try {
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        } catch (error) {
          console.error('Failed to initialize icons:', error);
        }
        
        // Announce to screen readers
        const liveRegion = document.getElementById('deflection-live');
        if (liveRegion) {
          liveRegion.textContent = 'Found 1 related help article';
        }
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
    
    PortalTabs.init();
    
    // Set up deflection input handler
    const subjectInput = document.getElementById('ticket-subject');
    if (subjectInput) {
      subjectInput.addEventListener('keyup', (e) => DeflectionWidget.check(e.target.value));
    }
    
    // Expose for legacy onclick handlers
    window.switchPortalTab = (tab) => PortalTabs.switchTab(tab);
    window.checkDeflection = (val) => DeflectionWidget.check(val);
  });
  
})();
