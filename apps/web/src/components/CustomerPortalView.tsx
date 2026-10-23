'use client';

import React, { useState } from 'react';
import { LifeBuoy, Search, PlusCircle, FileText, Send, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { useRole } from '@/context/RoleContext';

interface CustomerTicket {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  createdAt: string;
}

export function CustomerPortalView() {
  const [deflectionQuery, setDeflectionQuery] = useState('');
  const [deflectionResult, setDeflectionResult] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const { theme } = useRole();
  const isLight = theme === 'light';
  const [tickets, setTickets] = useState<CustomerTicket[]>([
    {
      id: 'TK-9012',
      title: 'Unable to configure SAML 2.0 single sign-on',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      category: 'Authentication',
      createdAt: '2 hours ago',
    },
    {
      id: 'TK-8941',
      title: 'Billing statement missing VAT tax ID',
      status: 'RESOLVED',
      priority: 'MEDIUM',
      category: 'Billing',
      createdAt: 'Yesterday',
    },
  ]);

  const handleSearchChange = (q: string) => {
    setDeflectionQuery(q);
    if (q.toLowerCase().includes('sso') || q.toLowerCase().includes('saml') || q.toLowerCase().includes('login')) {
      setDeflectionResult('SAML SSO setup guide: Go to Admin Settings > Security > Identity Provider and upload your SAML metadata XML file.');
    } else if (q.toLowerCase().includes('bill') || q.toLowerCase().includes('invoice') || q.toLowerCase().includes('tax')) {
      setDeflectionResult('Invoices and tax receipts can be downloaded directly under Organization > Billing History.');
    } else if (q.length > 4) {
      setDeflectionResult('Our AI Knowledge Base recommends reviewing our troubleshooting docs or creating a support request below.');
    } else {
      setDeflectionResult(null);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const created = await apiFetch<{ id?: string }>('/tickets', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          customerEmail: 'customer@acme.corp',
          category: newCategory,
          tenantId: 'tenant_acme_corp',
        }),
      });

      const newTicketItem: CustomerTicket = {
        id: created.id || `TK-${Math.floor(1000 + Math.random() * 9000)}`,
        title: newTitle,
        status: 'OPEN',
        priority: 'MEDIUM',
        category: newCategory,
        createdAt: 'Just now',
      };
      setTickets([newTicketItem, ...tickets]);
    } catch {
      const fallbackItem: CustomerTicket = {
        id: `TK-${Math.floor(1000 + Math.random() * 9000)}`,
        title: newTitle,
        status: 'OPEN',
        priority: 'MEDIUM',
        category: newCategory,
        createdAt: 'Just now',
      };
      setTickets([fallbackItem, ...tickets]);
    }

    setNewTitle('');
    setNewDesc('');
    setIsModalOpen(false);
  };

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Header Hero */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border" style={{ borderColor: 'var(--card-border)' }}>
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider font-mono"
              style={{ background: isLight ? 'rgba(37,99,235,0.1)' : 'rgba(59,130,246,0.1)', color: 'var(--accent-cyan)' }}>
              Customer Self-Service Hub
            </span>
            <h1 className="text-2xl md:text-3xl font-bold font-display text-heading mt-2">Welcome to Acme Support</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Search our AI knowledge base or submit a support request directly.</p>
          </div>
          <button onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition">
            <PlusCircle className="w-4 h-4" /> Submit New Ticket
          </button>
        </div>

        {/* AI Deflection Widget */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5" style={{ color: 'var(--accent-cyan)' }} />
            <h2 className="text-sm font-bold text-heading uppercase tracking-wider">AI Instant Solution Search</h2>
          </div>
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <input type="text" value={deflectionQuery} onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search issues (e.g. SSO login error, billing invoice)..."
              className={`w-full border rounded-xl pl-10 pr-4 py-2.5 text-xs text-heading focus:outline-none ${isLight ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-700/60'}`} />
          </div>

          {deflectionResult && (
            <div className="border rounded-xl p-4 space-y-2 animate-fadeIn"
              style={{ background: isLight ? 'rgba(14,116,144,0.06)' : 'rgba(30,58,138,0.2)', borderColor: 'var(--accent-cyan)' }}>
              <span className="text-[10px] font-bold uppercase tracking-widest block font-mono" style={{ color: 'var(--accent-cyan)' }}>AI Knowledge Response</span>
              <p className="text-xs leading-relaxed font-mono text-heading">{deflectionResult}</p>
              <div className="pt-2 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <span>Did this resolve your inquiry?</span>
                <div className="flex gap-2">
                  <button className="px-2.5 py-1 rounded font-bold transition border"
                    style={{ background: isLight ? 'rgba(5,150,105,0.1)' : 'rgba(52,211,153,0.1)', color: 'var(--accent-emerald)', borderColor: 'var(--accent-emerald)' }}>
                    ✓ Yes, thanks
                  </button>
                  <button onClick={() => setIsModalOpen(true)} className="px-2.5 py-1 rounded font-bold transition border"
                    style={{ background: isLight ? '#FFFFFF' : 'rgba(30,41,59,0.5)', color: 'var(--text-main)', borderColor: 'var(--card-border)' }}>
                    No, contact support
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* My Active Tickets Table */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <h2 className="text-sm font-bold text-heading uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4" style={{ color: 'var(--accent-cyan)' }} /> My Active Support Requests ({tickets.length})
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" style={{ color: 'var(--text-main)' }}>
              <thead className="font-mono uppercase border-b" style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}>
                <tr>
                  <th className="p-3">Ticket ID</th>
                  <th className="p-3">Subject</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-500/10 transition">
                    <td className="p-3 font-mono font-bold" style={{ color: 'var(--accent-cyan)' }}>{t.id}</td>
                    <td className="p-3 font-semibold text-heading">{t.title}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded font-mono text-[10px]" style={{ background: isLight ? '#E2E8F0' : 'rgba(30,41,59,0.8)', color: 'var(--text-main)' }}>
                        {t.category}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded font-bold text-[10px]"
                        style={{
                          background: t.status === 'RESOLVED' ? (isLight ? 'rgba(5,150,105,0.1)' : 'rgba(52,211,153,0.15)') : (isLight ? 'rgba(217,119,6,0.1)' : 'rgba(245,158,11,0.15)'),
                          color: t.status === 'RESOLVED' ? 'var(--accent-emerald)' : '#D97706'
                        }}>
                        ● {t.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Ticket Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-panel w-full max-w-lg rounded-2xl p-6 relative shadow-2xl animate-fadeIn border" style={{ borderColor: 'var(--card-border)', background: isLight ? '#FFFFFF' : 'var(--card-bg)' }}>
            <button onClick={() => setIsModalOpen(false)} className="absolute right-4 top-4 hover:opacity-75" style={{ color: 'var(--text-muted)' }}>
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold font-display text-heading mb-4">Submit New Support Ticket</h2>
            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase mb-1 font-bold" style={{ color: 'var(--text-muted)' }}>Subject</label>
                <input type="text" required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Brief summary of your issue..."
                  className={`w-full border rounded-lg p-2.5 text-xs text-heading focus:outline-none ${isLight ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-700'}`} />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase mb-1 font-bold" style={{ color: 'var(--text-muted)' }}>Category</label>
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                  className={`w-full border rounded-lg p-2.5 text-xs text-heading focus:outline-none ${isLight ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-700'}`}>
                  <option value="Authentication">Authentication & SSO</option>
                  <option value="Billing">Billing & Subscriptions</option>
                  <option value="API Integration">API Integration</option>
                  <option value="General">General Inquiries</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase mb-1 font-bold" style={{ color: 'var(--text-muted)' }}>Detailed Description</label>
                <textarea rows={4} required value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Provide steps to reproduce or details..."
                  className={`w-full border rounded-lg p-2.5 text-xs text-heading focus:outline-none resize-none ${isLight ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-700'}`} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 border text-xs font-bold rounded-lg"
                  style={{ background: isLight ? '#F1F5F9' : 'rgba(30,41,59,0.8)', borderColor: 'var(--card-border)', color: 'var(--text-main)' }}>
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow">
                  <Send className="w-3.5 h-3.5" /> Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}