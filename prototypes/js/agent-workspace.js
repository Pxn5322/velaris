/**
 * VELARIS Agent Workspace - 3-Column Support Interface
 * Version: 1.0.0
 */

(function() {
  'use strict';
  
  // Suggested Reply Manager
  const SuggestedReply = {
    suggestedText: "Hi Sarah, I've confirmed your order #9182 arrived past our 48-hour delivery window. I have processed a full refund of \.50 to your original payment method.",
    
    insert() {
      const replyBox = document.getElementById('agent-reply-box');
      if (replyBox) {
        replyBox.value = this.suggestedText;
        replyBox.focus();
        
        // Announce to screen readers
        const liveRegion = document.getElementById('reply-live');
        if (liveRegion) {
          liveRegion.textContent = 'Suggested reply inserted into text area';
        }
      }
    },
    
    update(text) {
      if (text && typeof text === 'string') {
        this.suggestedText = text;
      }
    }
  };
  
  // Ticket Queue Manager
  const TicketQueue = {
    activeTicket: null,
    
    selectTicket(ticketId) {
      // Update active state visually
      document.querySelectorAll('.ticket-item-active').forEach(item => {
        item.classList.remove('ticket-item-active');
        item.setAttribute('aria-selected', 'false');
      });
      
      const selectedTicket = document.querySelector('[data-ticket-id="' + ticketId + '"]');
      if (selectedTicket) {
        selectedTicket.classList.add('ticket-item-active');
        selectedTicket.setAttribute('aria-selected', 'true');
        this.activeTicket = ticketId;
      }
      
      // Announce to screen readers
      const liveRegion = document.getElementById('ticket-live');
      if (liveRegion) {
        liveRegion.textContent = 'Selected ticket ' + ticketId;
      }
    }
  };
  
  // Keyboard Shortcuts for Agent Workspace
  const AgentShortcuts = {
    init() {
      document.addEventListener('keydown', (e) => {
        // Alt+R: Focus reply textarea
        if (e.altKey && e.key.toLowerCase() === 'r') {
          e.preventDefault();
          const replyBox = document.getElementById('agent-reply-box');
          if (replyBox) replyBox.focus();
        }
        
        // Alt+E: Trigger escalation
        if (e.altKey && e.key.toLowerCase() === 'e') {
          e.preventDefault();
          const escalateBtn = document.querySelector('[data-action="escalate"]');
          if (escalateBtn) escalateBtn.click();
        }
        
        // Cmd/Ctrl+K: Global search
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          const searchBtn = document.querySelector('[data-action="search"]');
          if (searchBtn) searchBtn.focus();
        }
      });
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
    
    AgentShortcuts.init();
    
    // Expose for legacy onclick handlers
    window.insertSuggestedReply = () => SuggestedReply.insert();
  });
  
})();
