'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

interface Message {
  id: string
  message: string
  sender: 'staff' | 'ai'
  created_at: string
  // This optional field holds the raw automation plan so we can render it prettily
  clarityData?: any 
}

interface Props {
  clientId: string
  clientName: string
}

export default function SeasonedClarifier({ clientId, clientName }: Props) {
  // ---------------------------------------------------------------------------
  // 1. AUTH & ROUTING
  // ---------------------------------------------------------------------------
  const [session, setSession] = useState<any | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('editId') // Captures the ID if we are refining an existing build

  // ---------------------------------------------------------------------------
  // 2. CHAT STATE
  // ---------------------------------------------------------------------------
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')

  // ---------------------------------------------------------------------------
  // 3. CLARITY & EDIT STATE
  // ---------------------------------------------------------------------------
  const [clarityText, setClarityText] = useState<string | null>(null)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  
  // LOCK: Prevents double-submission causing duplicate DB entries
  const [isSaving, setIsSaving] = useState(false)

  // ---------------------------------------------------------------------------
  // 4. CREDENTIAL STATE
  // ---------------------------------------------------------------------------
  const [credentialRequirements, setCredentialRequirements] = useState<any[]>([])
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})
  const [showCredentialForm, setShowCredentialForm] = useState(false)
  const [credentialsVerified, setCredentialsVerified] = useState(false)
  const [showField, setShowField] = useState<Record<string, boolean>>({})

  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // ---------------------------------------------------------------------------
  // 5. EFFECT: CHECK AUTH
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data?.session) router.replace('/login')
      else setSession(data.session)
      setAuthLoading(false)
    }
    check()
  }, [router])

  // ---------------------------------------------------------------------------
  // 6. EFFECT: AUTO SCROLL
  // ---------------------------------------------------------------------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, awaitingConfirmation, showCredentialForm, credentialsVerified])

  // ---------------------------------------------------------------------------
  // 7. EFFECT: LOAD MESSAGES & INJECT "EDIT CONTEXT"
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!clientId) return
    const fetchContext = async () => {
      // A. Load regular chat history from Supabase
      const { data: msgData, error: msgError } = await supabase
        .from('client_messages')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true })
      
      if (msgError) console.error("History Error:", msgError.message)
      let initialMessages: Message[] = msgData || []

      // B. If in Edit Mode, pull the old clarity and inject a "System Memory" message
      if (editId) {
        const { data: oldClarity } = await supabase
          .from('automation_clarity')
          .select('clarity, name')
          .eq('id', editId)
          .single()

        if (oldClarity) {
          const editPrompt: Message = {
            id: 'edit-context-sys',
            sender: 'ai',
            // The text message (for AI to read)
            message: `[SYSTEM CONTEXT]: I am now helping you refine the existing automation "${oldClarity.name}". The previous plan was: ${JSON.stringify(oldClarity.clarity)}. What specific adjustments or additions would you like to make to this build?`,
            created_at: new Date().toISOString(),
            // The raw data object (for UI to render)
            clarityData: oldClarity.clarity 
          }
          initialMessages = [...initialMessages, editPrompt]
        }
      }
      
      setMessages(initialMessages)
    }
    fetchContext()
  }, [clientId, editId])

  // ---------------------------------------------------------------------------
  // 8. HELPER: DETECT CREDENTIALS (VIA GEMINI API)
  // ---------------------------------------------------------------------------
  async function detectCredentialRequirementsFromGemini(clarityJson: any) {
    const res = await fetch('/api/gemini/credential-detection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systems: clarityJson.systems,
        business_goal: clarityJson.business_goal
      })
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.credentials || []
  }

  // ---------------------------------------------------------------------------
  // 9. ACTION: SEND MESSAGE
  // ---------------------------------------------------------------------------
  const handleSend = async () => {
    if (!input.trim() || awaitingConfirmation || showCredentialForm || credentialsVerified) return

    setStatus('Saving your message...')
    const { data: staffData, error: staffError } = await supabase
      .from('client_messages')
      .insert([{ client_id: clientId, message: input, sender: 'staff' }])
      .select()

    if (staffError) {
      setStatus(`Error: ${staffError.message}`)
      return
    }

    const newStaffMsg = staffData![0]
    setMessages(prev => [...prev, newStaffMsg])
    setInput('')
    setStatus('Thinking...')

    const response = await fetch('/api/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [...messages, newStaffMsg] })
    })

    const result = await response.json()
    if (result.error || !result.aiText) {
      setStatus(`AI error: ${result.error || 'Unknown error'}`)
      return
    }

    const aiText: string = result.aiText
    
    // Check for the "Signal" from AI that the plan is ready
    if (aiText.includes('CLARITY_READY')) {
      const textPart = aiText.split('CLARITY_READY')[1].trim()
      setClarityText(textPart)
      setAwaitingConfirmation(true)
    }

    const { data: aiData, error: aiError } = await supabase
      .from('client_messages')
      .insert([{ client_id: clientId, message: aiText, sender: 'ai' }])
      .select()

    if (aiError) {
      setStatus(`Error: ${aiError.message}`)
      return
    }

    setMessages(prev => [...prev, aiData![0]])
    setStatus('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ---------------------------------------------------------------------------
  // 10. ACTION: CONFIRM CLARITY (WITH SAVING LOCK)
  // ---------------------------------------------------------------------------
  const handleConfirm = async () => {
    // Safety check to prevent duplicate clicks
    if (!clarityText || isSaving) return
    setIsSaving(true)

    setStatus('Syncing clarity...')
    
    // Parse the JSON safely (handles both string and object inputs)
    let clarityJson: any = {}
    try { 
      clarityJson = typeof clarityText === 'string' ? JSON.parse(clarityText) : clarityText 
    } catch {}

    // Determine Factory Type (CRM vs n8n)
    const systems = clarityJson.systems || []
    const supportedCRMs = ['GoHighLevel', 'ActiveCampaign', 'HubSpot']
    const isPureCRM = systems.length > 0 && systems.every((s: string) => supportedCRMs.includes(s.trim()))
    const factoryType = isPureCRM ? 'crm' : 'n8n'

    // Save to Database (Update if editing, Insert if new)
    if (editId) {
      await supabase.from('automation_clarity')
        .update({ clarity: clarityText, factory_type: factoryType })
        .eq('id', editId)
    } else {
      await supabase.from('automation_clarity').insert([
        { client_id: clientId, clarity: clarityText, confirmed: true, factory_type: factoryType }
      ])
    }

    setStatus('Checking credentials...')
    
    // --- SMART CREDENTIAL CHECK ---
    // 1. Ask Gemini what is needed
    const detected = await detectCredentialRequirementsFromGemini(clarityJson)
    
    // 2. Ask Supabase what we already have
    const { data: existingCreds } = await supabase
      .from('credentials')
      .select('name')
      .eq('client_id', clientId)
    
    const existingSet = new Set(existingCreds?.map(c => c.name) || [])

    // 3. Compare and filter out what we have
    const missingRequirements = detected.map((req: any) => {
      const missingFields = req.fields.filter((f: string) => !existingSet.has(`${req.system}:${f}`))
      return { ...req, fields: missingFields }
    }).filter((req: any) => req.fields.length > 0)

    setAwaitingConfirmation(false)

    // 4. Determine UI State
    if (detected.length > 0 && missingRequirements.length === 0) {
      // Scenario A: Credentials needed, but we have them all
      setCredentialsVerified(true)
      setStatus('All required credentials found.')
    } else if (missingRequirements.length > 0) {
      // Scenario B: We are missing some credentials
      setCredentialRequirements(missingRequirements)
      setShowCredentialForm(true)
      setStatus('Please provide missing credentials.')
    } else {
      // Scenario C: No credentials needed (rare)
      setCredentialsVerified(true)
      setStatus('No credentials required.')
    }
    
    setIsSaving(false) // Unlock to allow next user interaction
  }

  // ---------------------------------------------------------------------------
  // 11. ACTION: DISPATCH TO FACTORY
  // ---------------------------------------------------------------------------
  const saveCredentials = async () => {
    setStatus('Finalizing build...')
    
    // Only save if the user actually typed new values
    if (Object.keys(credentialValues).length > 0) {
      const inserts = Object.entries(credentialValues).map(([key, value]) => {
        const [system, field] = key.split(':')
        return { client_id: clientId, name: `${system}:${field}`, value }
      })
      const { error } = await supabase.from('credentials').insert(inserts)
      if (error) { setStatus('❌ Credential Error: ' + error.message); return; }
    }

    setShowCredentialForm(false)
    setCredentialsVerified(false)
    
    let clarityJson: any = {}
    try { clarityJson = typeof clarityText === 'string' ? JSON.parse(clarityText!) : clarityText } catch {}

    const systems: string[] = clarityJson.systems || []
    const supportedCRMs = ['GoHighLevel', 'ActiveCampaign', 'HubSpot']
    const isPureCRM = systems.length > 0 && systems.every((s: any) => supportedCRMs.includes(s.trim()))

    if (isPureCRM) {
      setStatus('🏭 Updating CRM Factory...')
      const crmPayload = {
        client_id: clientId,
        client_name: clientName,
        automation_plan: clarityJson,
        credentials_provided: credentialValues,
        is_edit: !!editId,
        original_workflow_id: editId
      }
      console.log('CRM DISPATCH:', crmPayload)
      setStatus('✅ Success: CRM Factory Synced')
    } else {
      setStatus('🤖 Triggering n8n workflow...')
      try {
        await fetch('https://sorcer.app.n8n.cloud/webhook/3eaf76d7-01e2-40f7-b004-07ff942b666a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clarityJson)
        })
        setStatus('✅ Success: Sent to n8n')
      } catch (err) {
        setStatus('⚠️ Webhook failed')
      }
    }

    setTimeout(() => { router.push(`/clients/${clientId}/dashboard`) }, 1500)
  }

  // ---------------------------------------------------------------------------
  // 12. HELPER: RENDER PLAIN ENGLISH (ROBUST)
  // ---------------------------------------------------------------------------
  const renderEnglishClarity = (raw: any) => {
    let data: any = {}
    
    // Robustly handle string OR object input
    try {
      if (typeof raw === 'string') {
        data = JSON.parse(raw)
      } else if (typeof raw === 'object' && raw !== null) {
        data = raw
      }
    } catch {
      return <span style={{ color: '#ef4444' }}>Error: Invalid Plan Data</span>
    }

    return (
      <div style={{ lineHeight: '1.6', fontSize: '14px' }}>
        <div style={{ marginBottom: '12px' }}>
          <strong style={{ color: colors.accent }}>Goal:</strong> {data.business_goal || data.goal}
        </div>
        <div style={{ marginBottom: '12px' }}>
          <strong style={{ color: colors.accent }}>Trigger:</strong> {data.trigger || data.event}
        </div>
        <div style={{ marginBottom: '12px' }}>
          <strong style={{ color: colors.accent }}>Systems:</strong> {Array.isArray(data.systems) ? data.systems.join(', ') : data.systems}
        </div>
        
        {(data.success_condition || data.success_event || data.success) && (
          <div style={{ marginBottom: '12px' }}>
            <strong style={{ color: colors.accent }}>Success Condition:</strong> {data.success_condition || data.success_event || data.success}
          </div>
        )}
        
        {(data.constraints || data.limitations) && (
          <div style={{ marginBottom: '12px' }}>
            <strong style={{ color: colors.accent }}>Constraints:</strong> {data.constraints || data.limitations}
          </div>
        )}

        {data.logic_steps && (
            <div>
              <strong style={{ color: colors.accent }}>Automation Steps:</strong>
              <ul style={{ marginTop: '8px', paddingLeft: '20px', color: colors.textMuted }}>
                {data.logic_steps.map((step: string, i: number) => <li key={i} style={{ marginBottom: '4px' }}>{step}</li>)}
              </ul>
            </div>
        )}
      </div>
    )
  }

  const toggleField = (key: string) => setShowField(prev => ({ ...prev, [key]: !prev[key] }))
  const handleContinueClarifying = () => { setAwaitingConfirmation(false); setClarityText(null); setIsSaving(false); }

  if (authLoading) return <div style={{ color: '#38bdf8', padding: 40, background: '#020617', minHeight: '100vh' }}>Verifying Identity...</div>
  if (!session) return <div style={{ color: '#38bdf8', padding: 40, background: '#020617', minHeight: '100vh' }}>Redirecting...</div>

  const colors = {
    bg: '#020617',
    glass: 'rgba(15, 23, 42, 0.7)',
    border: 'rgba(56, 189, 248, 0.2)',
    accent: '#38bdf8',
    text: '#f8fafc',
    textMuted: '#94a3b8',
    aiBubble: 'rgba(30, 41, 59, 0.8)',
    userBubble: 'rgba(14, 165, 233, 0.2)'
  }

  // ---------------------------------------------------------------------------
  // 13. RENDER JSX
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text, fontFamily: 'Inter, sans-serif', overflow: 'hidden' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes orbPulse { 0% { transform: scale(1); box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); } 50% { transform: scale(1.1); box-shadow: 0 0 50px rgba(56, 189, 248, 0.7); } 100% { transform: scale(1); box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.3); border-radius: 10px; }
        .glass-panel { backdrop-filter: blur(12px); border: 1px solid ${colors.border}; }
        .btn-primary { background: ${colors.accent}; color: #000; font-weight: 700; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; transition: 0.2s; }
        .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .btn-secondary { background: rgba(255,255,255,0.05); color: #fff; border: 1px solid ${colors.border}; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
        .thinking-orb { width: 80px; height: 80px; background: radial-gradient(circle, #38bdf8, #1e40af); border-radius: 50%; animation: orbPulse 2s infinite ease-in-out; }
      `}</style>

      {/* LEFT COLUMN: CHAT */}
      <div style={{ width: '50%', borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', padding: 30, position: 'relative' }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ color: colors.accent, fontSize: 12, fontWeight: 800, letterSpacing: '2px' }}>{editId ? 'BUILD REFINEMENT' : 'AI CLARIFIER'}</span>
          <h2 style={{ margin: '5px 0', fontSize: 24 }}>Conversation with {clientName}</h2>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 20, paddingRight: 10, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ padding: '14px 18px', borderRadius: 16, maxWidth: '85%', fontSize: 14, lineHeight: '1.5', background: msg.sender === 'staff' ? colors.userBubble : colors.aiBubble, alignSelf: msg.sender === 'staff' ? 'flex-end' : 'flex-start', border: `1px solid ${msg.sender === 'staff' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255,255,255,0.05)'}`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>{msg.sender === 'staff' ? 'Project Manager' : 'Sorcer AI'}</div>
              
              {msg.clarityData ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ marginBottom: 12, color: colors.accent, fontWeight: 'bold', fontSize: 12, borderBottom: `1px solid ${colors.border}`, paddingBottom: 8 }}>
                    PREVIOUS PLAN
                  </div>
                  {/* FIX: Renders the raw data object directly, no stringify here */}
                  {renderEnglishClarity(msg.clarityData)}
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${colors.border}`, fontSize: 12, fontStyle: 'italic', opacity: 0.8 }}>
                    What specific adjustments or additions would you like to make to this build?
                  </div>
                </div>
              ) : (
                <div>{msg.message}</div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT BOX - Only show if not waiting for user action on right side */}
        {!showCredentialForm && !credentialsVerified && (
          <div className="glass-panel" style={{ padding: 20, borderRadius: 16, background: 'rgba(2, 6, 23, 0.8)', position: 'relative' }}>
            <textarea placeholder={awaitingConfirmation ? "Check refinement on right..." : "Type instructions..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={awaitingConfirmation} style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none', resize: 'none', height: 80, marginBottom: 10 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ fontSize: 11, color: colors.accent, opacity: 0.6 }}>{status || 'System ready'}</span>
               <button onClick={handleSend} disabled={awaitingConfirmation || !input.trim()} className="btn-primary">Send Message</button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: ACTIONS & CARDS */}
      <div style={{ width: '50%', padding: 40, overflowY: 'auto', background: 'radial-gradient(circle at top right, rgba(56,189,248,0.05), transparent 40%)' }}>
        
        {/* CARD 1: CONFIRM STRATEGY */}
        {awaitingConfirmation && clarityText && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e' }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>{editId ? 'Confirm Refinements' : 'Confirm Strategy'}</h3>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.4)', padding: 25, borderRadius: 16, border: `1px solid ${colors.border}`, marginBottom: 25 }}>
               {renderEnglishClarity(clarityText)}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button 
                onClick={handleConfirm} 
                disabled={isSaving} 
                className="btn-primary" 
                style={{ flex: 1, opacity: isSaving ? 0.5 : 1, cursor: isSaving ? 'not-allowed' : 'pointer' }}
              >
                {isSaving ? 'Checking Systems...' : (editId ? 'Save Updates' : 'Confirm Correct')}
              </button>
              <button onClick={handleContinueClarifying} className="btn-secondary" style={{ flex: 1 }} disabled={isSaving}>Needs Changes</button>
            </div>
          </div>
        )}

        {/* CARD 2: VERIFIED CREDENTIALS (NEW FEATURE) */}
        {credentialsVerified && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e' }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>System Access Verified</h3>
            </div>
            <div style={{ marginBottom: 25, color: colors.textMuted, fontSize: 14, lineHeight: '1.5' }}>
              We have detected that all required credentials are already securely stored for this client. You are ready to build.
            </div>
            <button onClick={saveCredentials} className="btn-primary" style={{ width: '100%' }}>
              Initialize Build & Dispatch
            </button>
          </div>
        )}

        {/* CARD 3: MISSING CREDENTIALS FORM */}
        {showCredentialForm && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 25 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: colors.accent }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>Missing Credentials</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 30 }}>
              {credentialRequirements.map((c, idx) => (
                <div key={idx} style={{ padding: 20, borderRadius: 16, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <label style={{ color: colors.accent, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', display: 'block', marginBottom: 15 }}>{c.system} Access</label>
                  {c.fields?.map((f: string) => {
                    const key = `${c.system}:${f}`
                    return (
                      <div key={f} style={{ marginBottom: 15 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <small style={{ color: colors.textMuted }}>{f}</small>
                          <button onClick={() => toggleField(key)} style={{ background: 'none', border: 'none', color: colors.accent, fontSize: 10, cursor: 'pointer' }}>{showField[key] ? 'HIDE' : 'SHOW'}</button>
                        </div>
                        <input type={showField[key] ? 'text' : 'password'} onChange={e => setCredentialValues(prev => ({ ...prev, [key]: e.target.value }))} style={{ width: '100%', padding: '12px', background: '#020617', border: `1px solid ${colors.border}`, borderRadius: 8, color: '#fff', outline: 'none' }} />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <button onClick={saveCredentials} className="btn-primary" style={{ width: '100%' }}>Securely Save & Finish</button>
          </div>
        )}

        {/* LOADING STATE */}
        {!awaitingConfirmation && !showCredentialForm && !credentialsVerified && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {status === 'Thinking...' ? (
              <div style={{ textAlign: 'center' }}>
                <div className="thinking-orb"></div>
                <div style={{ marginTop: 20, fontSize: 12, letterSpacing: '3px', color: colors.accent, fontWeight: 700 }}>AI ANALYZING</div>
              </div>
            ) : (
              <div style={{ opacity: 0.3, textAlign: 'center' }}>
                <p style={{ fontSize: 13, letterSpacing: '2px' }}>AWAITING CLARITY_READY SIGNAL</p>
                <div style={{ marginTop: 10, color: colors.accent }}>{status}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}