'use client';

import React, { useState } from 'react';
import { Shield, Users, Lock, Cpu, Settings, Activity } from 'lucide-react';
import { useRole } from '@/context/RoleContext';

export function AdminView() {
  const [activeTab, setActiveTab] = useState<'analytics' | 'users' | 'roles' | 'ai-gov' | 'settings'>('analytics');
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { theme } = useRole();
  const isLight = theme === 'light';

  const usersData = [
    { name: 'Alex Vance', email: 'alex@velaris.ai', role: 'ENTERPRISE', status: 'Active', lastLogin: '2 mins ago' },
    { name: 'Sarah Lin', email: 'sarah@acme.com', role: 'AGENT', status: 'Active', lastLogin: '10 mins ago' },
    { name: 'Marcus Brody', email: 'marcus@globex.io', role: 'USER', status: 'Inactive', lastLogin: '3 days ago' },
    { name: 'Elena Rostova', email: 'elena@initech.com', role: 'AGENT', status: 'Active', lastLogin: '1 hour ago' },
    { name: 'David Kim', email: 'david@velaris.ai', role: 'ADMIN', status: 'Active', lastLogin: 'Just now' },
  ];

  const filteredUsers = usersData.filter((u) => {
    const matchesSearch = u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    const matchesStatus = statusFilter === 'ALL' || u.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest font-bold" style={{ color: 'var(--accent-cyan)' }}>
            Enterprise Platform Administration
          </span>
          <h1 className="text-2xl font-bold font-display text-heading">Global Control Center</h1>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-bold w-fit"
          style={{ background: isLight ? 'rgba(37,99,235,0.1)' : 'rgba(59,130,246,0.1)', color: 'var(--accent-cyan)', border: '1px solid var(--card-border)' }}>
          Role: Platform Admin
        </span>
      </div>

      <div className="glass-panel p-1.5 rounded-xl flex overflow-x-auto no-scrollbar gap-1 border border-slate-700/50">
        {([
          { id: 'analytics', label: 'Platform Analytics', icon: Activity },
          { id: 'users', label: 'User Directory', icon: Users },
          { id: 'roles', label: 'Roles & RBAC', icon: Lock },
          { id: 'ai-gov', label: 'AI Governance', icon: Cpu },
          { id: 'settings', label: 'System Settings', icon: Settings },
        ] as const).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const acls = isActive
            ? `${isLight ? 'bg-blue-600/10 text-blue-700 border-blue-600' : 'bg-blue-600/40 text-cyan-300 border-cyan-500/40'} shadow-sm`
            : `${isLight ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200' : 'text-muted-custom hover:text-heading hover:bg-slate-800/40'}`;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={"px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 whitespace-nowrap transition-all border " + acls}>
              <Icon className="w-3.5 h-3.5" style={{ color: isActive ? 'inherit' : 'var(--accent-cyan)' }} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-panel p-5 rounded-2xl border border-slate-700/50">
            <span className="text-xs uppercase font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Total Active Tenants</span>
            <div className="text-3xl font-bold font-display text-heading mt-2">42</div>
            <span className="text-xs mt-1 block font-bold" style={{ color: 'var(--accent-emerald)' }}>↑ +4 this month</span>
          </div>
          <div className="glass-panel p-5 rounded-2xl border border-slate-700/50">
            <span className="text-xs uppercase font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Total AI Operations</span>
            <div className="text-3xl font-bold font-display text-heading mt-2">1,420,890</div>
            <span className="text-xs mt-1 block font-bold" style={{ color: 'var(--accent-emerald)' }}>99.98% SLA target</span>
          </div>
          <div className="glass-panel p-5 rounded-2xl border border-slate-700/50">
            <span className="text-xs uppercase font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Average Deflection Rate</span>
            <div className="text-3xl font-bold font-display mt-2" style={{ color: 'var(--accent-cyan)' }}>64.2%</div>
            <span className="text-xs mt-1 block" style={{ color: 'var(--text-muted)' }}>Across all tenants</span>
          </div>
          <div className="glass-panel p-5 rounded-2xl border border-slate-700/50">
            <span className="text-xs uppercase font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Security Violations</span>
            <div className="text-3xl font-bold font-display mt-2" style={{ color: 'var(--accent-rose)' }}>0</div>
            <span className="text-xs mt-1 block font-bold" style={{ color: 'var(--accent-emerald)' }}>100% Isolated</span>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-700/50">
          <div className="flex flex-col sm:flex-row justify-between gap-3">
            <input type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search users..."
              className={`border rounded-xl px-3 py-1.5 text-xs text-heading focus:outline-none ${isLight ? 'bg-white border-slate-300' : 'bg-slate-900/80 border-slate-700/60'}`} />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              className={`border rounded-xl px-3 py-1.5 text-xs text-heading font-semibold focus:outline-none ${isLight ? 'bg-white border-slate-300' : 'bg-slate-900/80 border-slate-700/60'}`}>
              <option value="ALL">All Roles</option>
              <option value="ENTERPRISE">ENTERPRISE</option>
              <option value="ADMIN">ADMIN</option>
              <option value="AGENT">AGENT</option>
              <option value="USER">USER</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" style={{ color: 'var(--text-main)' }}>
              <thead className="font-mono uppercase border-b" style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}>
                <tr>
                  <th className="p-3">User</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last Login</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center font-mono" style={{ color: 'var(--text-muted)' }}>No matching users found</td>
                  </tr>
                ) : (
                  filteredUsers.map((u, i) => (
                    <tr key={i} className="hover:bg-slate-500/10 transition">
                      <td className="p-3 font-semibold text-heading">
                        {u.name}<br />
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{u.email}</span>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px]"
                          style={{ background: isLight ? 'rgba(37,99,235,0.1)' : 'rgba(59,130,246,0.2)', color: 'var(--accent-cyan)' }}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="font-bold" style={{ color: u.status === 'Active' ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                          ● {u.status}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{u.lastLogin}</td>
                      <td className="p-3 text-right">
                        <button className="px-2.5 py-1 rounded glass-panel text-[10px] font-bold" style={{ color: 'var(--accent-cyan)' }}>Edit</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab !== 'analytics' && activeTab !== 'users' && (
        <div className="glass-panel p-8 rounded-2xl text-center space-y-3 border border-slate-700/50">
          <Shield className="w-10 h-10 mx-auto" style={{ color: 'var(--accent-cyan)' }} />
          <h3 className="text-base font-bold text-heading uppercase tracking-wider">{activeTab} Module</h3>
          <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            Configuration and policy definitions active under enterprise isolation rules.
          </p>
        </div>
      )}
    </div>
  );
}