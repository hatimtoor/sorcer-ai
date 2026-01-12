'use client'

import { use, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useAuthGuard } from '@/hooks/useAuthGuard'

interface Automation {
  id: string
  name: string | null
  clarity: any
  confirmed: boolean
  created_at: string
}

interface Client {
  id: string
  full_name: string
  email_address: string
  company_name: string | null
}

interface Credential {
  id: string
  client_id: string
  name: string
  value: string 
  created_at: string
}

function generateAutomationName(clarity: any): string {
  if (!clarity) return 'New Automation'
  const goal = clarity.business_goal || clarity.goal || ''
  const trigger = clarity.trigger || clarity.event || ''
  const systems = clarity.systems?.join(', ') || ''
  if (goal) return goal
  if (trigger) return `Triggered by ${trigger}`
  if (systems) return `Automation for ${systems}`
  return 'New Automation'
}

export default function ClientDashboard({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  const router = useRouter()
  const { loading: authLoading } = useAuthGuard()

  const [client, setClient] = useState<Client | null>(null)
  const [automations, setAutomations] = useState<Automation[]>([])
  const [selected, setSelected] = useState<Automation | null>(null)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [visibleCreds, setVisibleCreds] = useState<Record<string, boolean>>({})
  
  // States for Credential Editing
  const [editingCredId, setEditingCredId] = useState<string | null>(null)
  const [editCredName, setEditCredName] = useState('')
  const [editCredValue, setEditCredValue] = useState('')

  // Expansion States
  const [autosExpanded, setAutosExpanded] = useState(false)
  const [credsExpanded, setCredsExpanded] = useState(false)

  const loadClient = async () => {
    const { data } = await supabase.from('clients').select('*').eq('id', clientId).single()
    if (data) setClient(data)
  }

  const loadAutomations = async () => {
    const { data } = await supabase
      .from('automation_clarity')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    if (!data) return
    for (const a of data) {
      if (!a.name) {
        const auto = generateAutomationName(a.clarity)
        await supabase.from('automation_clarity').update({ name: auto }).eq('id', a.id)
        a.name = auto
      }
    }
    setAutomations(data)
    if (!selected && data.length > 0) setSelected(data[0])
  }

  const loadCredentials = async () => {
    const { data } = await supabase.from('credentials').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
    if (data) setCredentials(data)
  }

  useEffect(() => {
    if (!authLoading) {
      loadClient()
      loadAutomations()
      loadCredentials()
    }
  }, [clientId, authLoading])

  const displayedAutos = autosExpanded ? automations : automations.slice(0, 5);
  const displayedCreds = credsExpanded ? credentials : credentials.slice(0, 3);

  const toggleCredVisibility = (id: string) => setVisibleCreds(prev => ({ ...prev, [id]: !prev[id] }))

  // --- ACTIONS ---
  const deleteCredential = async (id: string) => {
    if (!confirm('Delete this credential permanently?')) return
    await supabase.from('credentials').delete().eq('id', id)
    setCredentials(prev => prev.filter(c => c.id !== id))
  }

  const startEditingCred = (cred: Credential) => {
    setEditingCredId(cred.id); setEditCredName(cred.name); setEditCredValue(cred.value);
  }

  const saveCredentialUpdate = async (id: string) => {
    await supabase.from('credentials').update({ name: editCredName, value: editCredValue }).eq('id', id)
    setCredentials(prev => prev.map(c => c.id === id ? { ...c, name: editCredName, value: editCredValue } : c))
    setEditingCredId(null)
  }

  const deleteAutomation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    if (!confirm('Delete this automation permanently?')) return
    await supabase.from('automation_clarity').delete().eq('id', id)
    setAutomations(prev => prev.filter(a => a.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const colors = {
    bg: '#020617',
    card: 'rgba(15, 23, 42, 0.6)',
    border: 'rgba(56, 189, 248, 0.25)',
    accent: '#38bdf8',
    textMain: '#f8fafc',
    textMuted: '#94a3b8',
    danger: '#ef4444'
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .dashboard-container { animation: fadeIn 0.5s ease-out; width: 100%; max-width: 100vw; overflow-x: hidden; }
        
        .expand-action-bar { 
          width: 100%; 
          margin-top: 16px; 
          padding: 12px; 
          background: rgba(15, 23, 42, 0.8); 
          border: 1px solid ${colors.border}; 
          border-radius: 8px; 
          color: #38bdf8 !important; 
          font-weight: 700; 
          font-size: 11px; 
          text-transform: uppercase; 
          letter-spacing: 0.1em; 
          cursor: pointer; 
          transition: 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .expand-action-bar:hover { background: rgba(56, 189, 248, 0.1); color: #fff !important; }
        .icon-btn { opacity: 0.5; transition: 0.2s; cursor: pointer; background: none; border: none; color: #fff; padding: 4px; }
        .icon-btn:hover { opacity: 1; transform: scale(1.1); }
      `}</style>

      {authLoading ? (
        <div style={{ padding: 40, color: colors.accent, textAlign: 'center', background: colors.bg, minHeight: '100vh' }}>Loading...</div>
      ) : (
        <div className="dashboard-container" style={{ minHeight: '100vh', backgroundColor: colors.bg, color: colors.textMain, padding: '24px 20px', fontFamily: 'Inter, sans-serif' }}>
          
          {/* UPDATED HEADER: Full Client Info */}
          <header style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: 24, marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 8px 0' }}>
                   {client?.company_name || 'Dashboard'}
                </h1>
                <div style={{ display: 'flex', gap: 24, color: colors.textMuted, fontSize: 13 }}>
                  <span><strong style={{ color: '#fff' }}>Contact:</strong> {client?.full_name}</span>
                  <span><strong style={{ color: '#fff' }}>Email:</strong> {client?.email_address}</span>
                </div>
              </div>
              <button onClick={() => router.push(`/dashboard/${clientId}`)} style={{ height: 40, padding: '0 20px', borderRadius: 8, backgroundColor: colors.accent, color: 'black', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                + New Automation
              </button>
            </div>
          </header>

          <main style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) 1fr', gap: 24, alignItems: 'start' }}>
            
            {/* SIDEBAR */}
            <aside style={{ background: 'rgba(15, 23, 42, 0.4)', border: `1px solid ${colors.border}`, borderRadius: 16, padding: 16 }}>
              <h3 style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 16, letterSpacing: '0.1em' }}>Workflows</h3>
              {displayedAutos.map(a => (
                <div key={a.id} onClick={() => setSelected(a)} style={{ padding: '12px', marginBottom: 8, borderRadius: 10, cursor: 'pointer', background: selected?.id === a.id ? 'rgba(56, 189, 248, 0.1)' : 'transparent', border: `1px solid ${selected?.id === a.id ? colors.accent : 'transparent'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Untitled'}</div>
                    </div>
                    <button onClick={(e) => deleteAutomation(e, a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>🗑️</button>
                  </div>
                </div>
              ))}
              {automations.length > 5 && (
                <div className="expand-action-bar" onClick={() => setAutosExpanded(!autosExpanded)}>
                   {autosExpanded ? '↑ SHOW LESS' : `↓ SEE ALL (${automations.length})`}
                </div>
              )}
            </aside>

            {/* CONTENT AREA */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
              
              <div style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 24, width: '100%' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Workflow Details</h3>
                {selected ? (
                  <pre style={{ background: 'rgba(2, 6, 23, 0.6)', padding: 16, borderRadius: 12, fontSize: 12, color: colors.textMuted, maxHeight: '400px', overflow: 'auto', border: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {JSON.stringify(selected.clarity, null, 2)}
                  </pre>
                ) : <p style={{ color: colors.textMuted }}>Select a workflow.</p>}
              </div>

              {/* CREDENTIALS SECTION with Edit/Delete */}
              <div style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 24, width: '100%' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>System Credentials</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {displayedCreds.map(c => {
                    const isVisible = visibleCreds[c.id] || false;
                    const isEditing = editingCredId === c.id;
                    return (
                      <div key={c.id} style={{ padding: '16px', borderRadius: 12, background: 'rgba(2, 6, 23, 0.4)', border: `1px solid ${isEditing ? colors.accent : 'rgba(56, 189, 248, 0.1)'}` }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <input style={{ background: '#000', color: '#fff', border: `1px solid ${colors.border}`, padding: '8px', borderRadius: 4, fontSize: 12 }} value={editCredName} onChange={e => setEditCredName(e.target.value)} />
                            <input style={{ background: '#000', color: '#fff', border: `1px solid ${colors.border}`, padding: '8px', borderRadius: 4, fontSize: 12 }} value={editCredValue} onChange={e => setEditCredValue(e.target.value)} />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button onClick={() => saveCredentialUpdate(c.id)} style={{ flex: 1, background: colors.accent, padding: '6px', border: 'none', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}>SAVE</button>
                              <button onClick={() => setEditingCredId(null)} style={{ flex: 1, background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', padding: '6px', borderRadius: 4, cursor: 'pointer' }}>CANCEL</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                              <div style={{ color: colors.accent, fontWeight: 'bold', fontSize: 11 }}>🛡️ {c.name}</div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="icon-btn" onClick={() => startEditingCred(c)}>✏️</button>
                                <button className="icon-btn" onClick={() => deleteCredential(c.id)} style={{ color: colors.danger }}>🗑️</button>
                              </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                              <span style={{ fontFamily: isVisible ? 'monospace' : 'serif', letterSpacing: isVisible ? '0' : '3px', fontSize: 13, overflow: 'hidden' }}>{isVisible ? c.value : '••••••••'}</span>
                              <button onClick={() => toggleCredVisibility(c.id)} style={{ background: 'none', border: 'none', color: colors.accent, fontSize: 10, fontWeight: 'bold', cursor: 'pointer' }}>{isVisible ? 'HIDE' : 'SHOW'}</button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>

                {credentials.length > 3 && (
                  <div className="expand-action-bar" onClick={() => setCredsExpanded(!credsExpanded)}>
                    {credsExpanded ? '↑ SHOW FEWER CREDENTIALS' : `↓ SEE ALL CREDENTIALS (${credentials.length})`}
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      )}
    </>
  )
}