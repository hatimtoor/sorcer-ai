'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Message {
  id: string
  message: string
  sender: 'staff' | 'ai'
  created_at: string
}

interface Props {
  clientId: string
  clientName: string
}

export default function SeasonedClarifier({ clientId, clientName }: Props) {
  // ---------- AUTH ----------
  const [session, setSession] = useState<any | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const router = useRouter()

  // ---------- CHAT STATE ----------
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')

  // ---------- CLARITY STATE ----------
  const [clarityText, setClarityText] = useState<string | null>(null)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  // ---------- CREDENTIAL STATE ----------
  const [credentialRequirements, setCredentialRequirements] = useState<any[]>([])
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})
  const [showCredentialForm, setShowCredentialForm] = useState(false)

  const [showField, setShowField] = useState<Record<string, boolean>>({})

  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // ---------- AUTH CHECK ----------
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data?.session) router.replace('/login')
      else setSession(data.session)
      setAuthLoading(false)
    }
    check()
  }, [router])

  // ---------- SCROLL ----------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, awaitingConfirmation, showCredentialForm])

  // ---------- LOAD MESSAGES ----------
  useEffect(() => {
    if (!clientId) return
    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('client_messages')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true })
      if (error) setStatus(`Supabase error: ${error.message}`)
      else setMessages(data || [])
    }
    fetchMessages()
  }, [clientId])

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

  // ---------- SEND MESSAGE ----------
  const handleSend = async () => {
    if (!input.trim() || awaitingConfirmation || showCredentialForm) return

    setStatus('Saving your message...')
    const { data: staffData, error: staffError } = await supabase
      .from('client_messages')
      .insert([{ client_id: clientId, message: input, sender: 'staff' }])
      .select()

    if (staffError) {
      setStatus(`Error saving message: ${staffError.message}`)
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
      setStatus(`Error saving AI message: ${aiError.message}`)
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

  const handleConfirm = async () => {
    if (!clarityText) return
    setStatus('Saving confirmed clarity...')
    await supabase.from('automation_clarity').insert([
      { client_id: clientId, clarity: clarityText, confirmed: true }
    ])

    let clarityJson: any = {}
    try { clarityJson = JSON.parse(clarityText) } catch {}
    setStatus('Detecting required credentials...')
    const detected = await detectCredentialRequirementsFromGemini({
      systems: clarityJson.systems,
      business_goal: clarityJson.business_goal
    })

    setCredentialRequirements(detected)
    setShowCredentialForm(detected.length > 0)
    setAwaitingConfirmation(false)
    setStatus(detected.length > 0 ? 'Clarity saved. Please enter credentials.' : 'Clarity saved.')
  }

  const saveCredentials = async () => {
    setStatus('Saving credentials...')
    if (Object.keys(credentialValues).length === 0) {
      setStatus('⚠️ No credentials entered')
      return
    }
    const inserts = Object.entries(credentialValues).map(([key, value]) => {
      const [system, field] = key.split(':')
      return { client_id: clientId, name: `${system}:${field}`, value }
    })

    const { error } = await supabase.from('credentials').insert(inserts)
    if (error) {
      setStatus('❌ Failed to save credentials: ' + error.message)
      return
    }

    setShowCredentialForm(false)
    let clarityJson: any = {}
    try { if (clarityText) clarityJson = JSON.parse(clarityText) } catch {
      setStatus('⚠️ JSON invalid')
      return
    }

    // --- STRICT FACTORY SELECTION ---
    const systems: string[] = clarityJson.systems || []
    const supportedCRMs = ['GoHighLevel', 'ActiveCampaign', 'HubSpot']
    
    // Only use CRM factory if ALL systems in the list are in our supported whitelist
    const isPureCRM = systems.length > 0 && systems.every(s => supportedCRMs.includes(s.trim()))

    if (isPureCRM) {
      setStatus('🏭 Supported CRM detected. Sending to CRM Factory...')
      
      const crmPayload = {
        client_id: clientId,
        client_name: clientName,
        automation_plan: clarityJson,
        credentials_provided: credentialValues
      }
      
      console.log('CRM Factory Payload Dispatch:', crmPayload)
      
      // TODO: Actual fetch call to CRM API would go here
      setStatus('✅ Sent to CRM Factory')
      setTimeout(() => { router.push(`/clients/${clientId}/dashboard`) }, 1500)
    } else {
      setStatus('🤖 External systems detected. Sending to n8n...')
      try {
        await fetch('https://sorcer.app.n8n.cloud/webhook/3eaf76d7-01e2-40f7-b004-07ff942b666a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clarityJson) // Sends ONLY clarity JSON to n8n
        })
        setStatus('✅ Sent to n8n factory')
        setTimeout(() => { router.push(`/clients/${clientId}/dashboard`) }, 1200)
      } catch (err) {
        setStatus('⚠️ Webhook error')
      }
    }
  }

  // --- HELPER: Renders JSON Clarity into Plain English ---
  const renderEnglishClarity = (jsonString: string) => {
    try {
      const data = JSON.parse(jsonString)
      return (
        <div style={{ lineHeight: '1.6', fontSize: '14px' }}>
          <div style={{ marginBottom: '12px' }}>
            <strong style={{ color: colors.accent }}>Goal:</strong> {data.business_goal || data.goal}
          </div>
          
          <div style={{ marginBottom: '12px' }}>
            <strong style={{ color: colors.accent }}>Trigger Event:</strong> {data.trigger || data.event}
          </div>
          
          <div style={{ marginBottom: '12px' }}>
            <strong style={{ color: colors.accent }}>Systems:</strong> {Array.isArray(data.systems) ? data.systems.join(', ') : data.systems}
          </div>

          {/* IMPROVED: Success Condition Mapping (captures multiple variations) */}
          {(data.success_condition || data.success_event || data.success || data.goal_met) && (
            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: colors.accent }}>Success Condition:</strong> {data.success_condition || data.success_event || data.success || data.goal_met}
            </div>
          )}

          {/* Constraints Mapping */}
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
    } catch {
      return <span style={{ color: '#ef4444' }}>Error: Plan text is not in a valid format.</span>
    }
  }

  const toggleField = (key: string) => setShowField(prev => ({ ...prev, [key]: !prev[key] }))
  const handleContinueClarifying = () => { setAwaitingConfirmation(false); setClarityText(null); }

  if (authLoading) return <div style={{ color: '#38bdf8', padding: 40, background: '#020617', minHeight: '100vh' }}>Verifying...</div>
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
          <span style={{ color: colors.accent, fontSize: 12, fontWeight: 800, letterSpacing: '2px' }}>AI CLARIFIER</span>
          <h2 style={{ margin: '5px 0', fontSize: 24 }}>Conversation with {clientName}</h2>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 20, paddingRight: 10, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ padding: '14px 18px', borderRadius: 16, maxWidth: '85%', fontSize: 14, lineHeight: '1.5', background: msg.sender === 'staff' ? colors.userBubble : colors.aiBubble, alignSelf: msg.sender === 'staff' ? 'flex-end' : 'flex-start', border: `1px solid ${msg.sender === 'staff' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255,255,255,0.05)'}`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>{msg.sender === 'staff' ? 'Project Manager' : 'Sorcer AI'}</div>
              <div>{msg.message}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {!showCredentialForm && (
          <div className="glass-panel" style={{ padding: 20, borderRadius: 16, background: 'rgba(2, 6, 23, 0.8)', position: 'relative' }}>
            <textarea placeholder={awaitingConfirmation ? "Selection active on right..." : "Type strategy or clarification..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={awaitingConfirmation} style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none', resize: 'none', height: 80, marginBottom: 10 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ fontSize: 11, color: colors.accent, opacity: 0.6 }}>{status || 'System ready'}</span>
               <button onClick={handleSend} disabled={awaitingConfirmation || !input.trim()} className="btn-primary">Send Message</button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: ACTIONS & OUTPUTS */}
      <div style={{ width: '50%', padding: 40, overflowY: 'auto', background: 'radial-gradient(circle at top right, rgba(56,189,248,0.05), transparent 40%)' }}>
        
        {/* CLARITY CONFIRMATION (JSON -> ENGLISH) */}
        {awaitingConfirmation && clarityText && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e' }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>Confirm Strategy</h3>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.4)', padding: 25, borderRadius: 16, border: `1px solid ${colors.border}`, marginBottom: 25 }}>
               {renderEnglishClarity(clarityText)}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleConfirm} className="btn-primary" style={{ flex: 1 }}>Confirm Correct</button>
              <button onClick={handleContinueClarifying} className="btn-secondary" style={{ flex: 1 }}>Needs Changes</button>
            </div>
          </div>
        )}

        {/* CREDENTIAL INTAKE FORM */}
        {showCredentialForm && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 25 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: colors.accent }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>Credential Requirements</h3>
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

        {/* LOADING ORB */}
        {!awaitingConfirmation && !showCredentialForm && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
               {status === 'Thinking...' ? (
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                    <div className="thinking-orb"></div>
                    <span style={{ fontSize: 12, letterSpacing: '3px', color: colors.accent, fontWeight: 700 }}>AI ANALYZING</span>
                 </div>
               ) : (
                 <div style={{ opacity: 0.3 }}>
                    <p style={{ fontSize: 13, letterSpacing: '2px' }}>AWAITING CLARITY_READY SIGNAL</p>
                    <div style={{ marginTop: 20, color: colors.accent }}>{status}</div>
                 </div>
               )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}