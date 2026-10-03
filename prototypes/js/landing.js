/**
 * VELARIS Landing Page - Interactive Components
 * Version: 1.0.0
 */

(function() {
  'use strict';
  
  // ROI Calculator Configuration
  const ROI_CONFIG = {
    DEFLECTION_RATE: 0.78,
    COST_PER_TICKET: 1.82,
    TIME_PER_TICKET_HOURS: 0.054
  };
  
  // Initialize Lucide icons with error handling
  function initIcons() {
    try {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    } catch (error) {
      console.error('Failed to initialize Lucide icons:', error);
    }
  }
  
  // Hero Demo Switcher
  function switchHeroDemo(type) {
    // Update button states
    document.querySelectorAll('.hero-chip').forEach(btn => {
      btn.className = 'hero-chip px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700';
      btn.setAttribute('aria-pressed', 'false');
    });
    
    const activeBtn = document.getElementById('btn-' + type);
    if (activeBtn) {
      activeBtn.className = 'hero-chip px-3 py-1.5 rounded-lg text-xs font-medium bg-brand/20 text-indigo-300 border border-brand/40';
      activeBtn.setAttribute('aria-pressed', 'true');
    }
    
    const thread = document.getElementById('hero-chat-thread');
    if (!thread) return;
    
    // Demo content templates
    const demos = {
      refund: 
        <div class=\"flex items-start gap-3\">
          <div class=\"w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300\" aria-hidden=\"true\">C</div>
          <div class=\"bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none p-3 max-w-[85%] text-xs text-slate-200\">
            Hi, my order #9182 was delivered late and damaged. Can I request a full refund?
          </div>
        </div>
        <div class=\"flex items-start gap-3 flex-row-reverse\">
          <div class=\"w-7 h-7 rounded-full bg-brand flex items-center justify-center text-xs font-bold text-white\" aria-hidden=\"true\">AI</div>
          <div class=\"bg-brand/10 border border-brand/30 rounded-2xl rounded-tr-none p-3 max-w-[85%] text-xs text-indigo-100 space-y-2\">
            <p>Hello Sarah! I've reviewed your order #9182. Based on our Shipping Guarantee (Section 4.2), late delivery over 48 hours qualifies for an immediate full refund of .50.</p>
            <div class=\"flex items-center gap-2 pt-1\">
              <span class=\"text-[10px] bg-brand/30 text-indigo-200 px-2 py-0.5 rounded border border-brand/40 flex items-center gap-1\">
                <i data-lucide=\"file-text\" class=\"w-3 h-3\" aria-hidden=\"true\"></i> Citation: Policy 4.2 (Match: 94%)
              </span>
            </div>
          </div>
        </div>,
      api: 
        <div class=\"flex items-start gap-3\">
          <div class=\"w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300\" aria-hidden=\"true\">C</div>
          <div class=\"bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none p-3 max-w-[85%] text-xs text-slate-200\">
            We compromised our API secret key key_live_9481. Can you revoke it immediately?
          </div>
        </div>
        <div class=\"flex items-start gap-3 flex-row-reverse\">
          <div class=\"w-7 h-7 rounded-full bg-brand flex items-center justify-center text-xs font-bold text-white\" aria-hidden=\"true\">AI</div>
          <div class=\"bg-brand/10 border border-brand/30 rounded-2xl rounded-tr-none p-3 max-w-[85%] text-xs text-indigo-100 space-y-2\">
            <p>I have triggered our automated key revocation protocol. Key <code class=\"font-mono bg-black/40 px-1 rounded\">key_live_9481</code> is now revoked and a new secret key has been emailed to the account owner.</p>
            <div class=\"flex items-center gap-2 pt-1\">
              <span class=\"text-[10px] bg-accent/30 text-cyan-200 px-2 py-0.5 rounded border border-accent/40 flex items-center gap-1\">
                <i data-lucide=\"key\" class=\"w-3 h-3\" aria-hidden=\"true\"></i> Action: revoke_api_key (Success)
              </span>
            </div>
          </div>
        </div>,
      escalate: 
        <div class=\"flex items-start gap-3\">
          <div class=\"w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300\" aria-hidden=\"true\">C</div>
          <div class=\"bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none p-3 max-w-[85%] text-xs text-slate-200\">
            There is a \,500 custom wire discrepancy on invoice #INV-2026-9. I need to speak to enterprise accounting.
          </div>
        </div>
        <div class=\"flex items-start gap-3 flex-row-reverse\">
          <div class=\"w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-white\" aria-hidden=\"true\">AI</div>
          <div class=\"bg-amber-500/10 border border-amber-500/30 rounded-2xl rounded-tr-none p-3 max-w-[85%] text-xs text-amber-200 space-y-2\">
            <p>Custom wire transfers over \,000 require senior accounting authorization. I am escalating your request directly to Senior Support Lead Jane Doe with full thread context.</p>
            <div class=\"flex items-center gap-2 pt-1\">
              <span class=\"text-[10px] bg-amber-500/30 text-amber-100 px-2 py-0.5 rounded border border-amber-500/40 flex items-center gap-1\">
                <i data-lucide=\"user-check\" class=\"w-3 h-3\" aria-hidden=\"true\"></i> Escalated: Policy Threshold (\,000 Limit)
              </span>
            </div>
          </div>
        </div>
    };
    
    thread.innerHTML = demos[type] || demos.refund;
    initIcons();
    
    // Announce change to screen readers
    const liveRegion = document.getElementById('hero-demo-live');
    if (liveRegion) {
      liveRegion.textContent = 'Demo switched to ' + type + ' scenario';
    }
  }
  
  // ROI Calculator with input validation
  function updateROICalculator(value) {
    const num = validateNumericInput(value, 1000, 100000);
    
    const volumeLabel = document.getElementById('calc-volume-label');
    const savingsEl = document.getElementById('calc-savings');
    const hoursEl = document.getElementById('calc-hours');
    const rateEl = document.getElementById('calc-rate');
    
    if (!volumeLabel || !savingsEl || !hoursEl || !rateEl) return;
    
    // Calculate metrics based on validated input
    const deflectionRate = ROI_CONFIG.DEFLECTION_RATE;
    const deflectedTickets = Math.round(num * deflectionRate);
    const savings = Math.round(deflectedTickets * ROI_CONFIG.COST_PER_TICKET);
    const hours = Math.round(deflectedTickets * ROI_CONFIG.TIME_PER_TICKET_HOURS);
    const ratePercent = Math.round(deflectionRate * 100);
    
    // Update display with formatted numbers
    volumeLabel.textContent = safeFormatNumber(num) + ' tickets/mo';
    savingsEl.textContent = '\$' + safeFormatNumber(savings) + '/mo';
    hoursEl.textContent = safeFormatNumber(hours) + ' hrs/mo';
    rateEl.textContent = ratePercent + '%';
  }
  
  // Mobile menu toggle
  function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const menuButton = document.querySelector('[aria-controls=\"mobile-menu\"]');
    
    if (!menu) return;
    
    const isHidden = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    
    if (menuButton) {
      menuButton.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    }
    
    // Announce to screen readers
    const liveRegion = document.getElementById('mobile-menu-live');
    if (liveRegion) {
      liveRegion.textContent = isHidden ? 'Menu opened' : 'Menu closed';
    }
  }
  
  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    initIcons();
    
    // Set up event listeners for hero demo buttons
    document.querySelectorAll('.hero-chip').forEach(btn => {
      const type = btn.id.replace('btn-', '');
      btn.addEventListener('click', () => switchHeroDemo(type));
    });
    
    // Set up ROI calculator input handler with debounce
    const calcRange = document.getElementById('calc-range');
    if (calcRange) {
      const debouncedCalc = debounce((val) => updateROICalculator(val), 50);
      calcRange.addEventListener('input', (e) => debouncedCalc(e.target.value));
    }
    
    // Expose functions globally for onclick handlers (legacy support)
    window.switchHeroDemo = switchHeroDemo;
    window.updateROICalculator = updateROICalculator;
    window.toggleMobileMenu = toggleMobileMenu;
  });
  
})();
