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
  const [session, setSession] = useState<any | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const router = useRouter()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')

  const [clarityText, setClarityText] = useState<string | null>(null)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  const [credentialRequirements, setCredentialRequirements] = useState<any[]>([])
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})
  const [showCredentialForm, setShowCredentialForm] = useState(false)

  const [showField, setShowField] = useState<Record<string, boolean>>({})

  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const check = async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) console.error("Auth Session Error:", error)
      
      if (!data?.session) router.replace('/login')
      else setSession(data.session)
      setAuthLoading(false)
    }
    check()
  }, [router])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, awaitingConfirmation, showCredentialForm])

  useEffect(() => {
    if (!clientId) return
    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('client_messages')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true })
      
      if (error) {
        console.error("Fetch Messages Error:", error) // <-- REAL ERROR SHOWN IN CONSOLE
        setStatus(`Supabase error: ${error.message || 'Check Browser Console'}`)
      } else {
        setMessages(data || [])
      }
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

  const handleSend = async () => {
    if (!input.trim() || awaitingConfirmation || showCredentialForm) return

    setStatus('Saving your message...')
    const { data: staffData, error: staffError } = await supabase
      .from('client_messages')
      .insert([{ client_id: clientId, message: input, sender: 'staff' }])
      .select()

    if (staffError) {
      console.error("Send Message Error:", staffError)
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

    const systems: string[] = clarityJson.systems || []
    const crmSystems = ['HubSpot', 'GoHighLevel', 'ActiveCampaign']
    let factory: 'crm' | 'n8n' = 'n8n'
    if (Array.isArray(systems) && systems.length > 0 && systems.every(s => crmSystems.includes(s.trim()))) {
      factory = 'crm'
    }

    if (factory === 'crm') {
      setStatus('🏭 CRM factory selected')
    } else {
      setStatus('🤖 n8n factory selected...')
      try {
        await fetch('https://sorcer.app.n8n.cloud/webhook/3eaf76d7-01e2-40f7-b004-07ff942b666a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: clarityText ?? '{}'
        })
        setStatus('✅ Credentials saved & sent to webhook')
        setTimeout(() => { router.push(`/clients/${clientId}/dashboard`) }, 1200)
      } catch (err) {
        setStatus('⚠️ Webhook error')
      }
    }
  }

  const toggleField = (key: string) => setShowField(prev => ({ ...prev, [key]: !prev[key] }))
  const handleContinueClarifying = () => { setAwaitingConfirmation(false); setClarityText(null); }

  if (authLoading) return <div style={{ color: '#38bdf8', padding: 40, background: '#020617', minHeight: '100vh' }}>Verifying Authentication...</div>
  if (!session) return <div style={{ color: '#38bdf8', padding: 40, background: '#020617', minHeight: '100vh' }}>Access Denied. Redirecting...</div>

  const colors = {
    bg: '#020617',
    glass: 'rgba(15, 23, 42, 0.7)',
    border: 'rgba(56, 189, 248, 0.2)',
    accent: '#38bdf8',
    text: '#f8fafc',
    aiBubble: 'rgba(30, 41, 59, 0.8)',
    userBubble: 'rgba(14, 165, 233, 0.2)'
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text, fontFamily: 'Inter, sans-serif', overflow: 'hidden' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes orbPulse { 
          0% { transform: scale(1); box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); } 
          50% { transform: scale(1.1); box-shadow: 0 0 50px rgba(56, 189, 248, 0.7); } 
          100% { transform: scale(1); box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); } 
        }
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
          <span style={{ color: colors.accent, fontSize: 12, fontWeight: 800, letterSpacing: '2px' }}>SORCER AI STRATEGIST</span>
          <h2 style={{ margin: '5px 0', fontSize: 24 }}>Session: {clientName}</h2>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 20, paddingRight: 10, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ padding: '14px 18px', borderRadius: 16, maxWidth: '85%', fontSize: 14, lineHeight: '1.5', background: msg.sender === 'staff' ? colors.userBubble : colors.aiBubble, alignSelf: msg.sender === 'staff' ? 'flex-end' : 'flex-start', border: `1px solid ${msg.sender === 'staff' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255,255,255,0.05)'}`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>{msg.sender === 'staff' ? 'Engineer' : 'Sorcer AI'}</div>
              <div>{msg.message}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {!showCredentialForm && (
          <div className="glass-panel" style={{ padding: 20, borderRadius: 16, background: 'rgba(2, 6, 23, 0.8)' }}>
            <textarea placeholder={awaitingConfirmation ? "Selection active on right..." : "Type strategy or clarification..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={awaitingConfirmation} style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none', resize: 'none', height: 80, marginBottom: 10 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ fontSize: 11, color: colors.accent, opacity: 0.6 }}>{status || 'Link established'}</span>
               <button onClick={handleSend} disabled={awaitingConfirmation || !input.trim()} className="btn-primary">Execute Message</button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: ACTIONS */}
      <div style={{ width: '50%', padding: 40, overflowY: 'auto', background: 'radial-gradient(circle at top right, rgba(56,189,248,0.05), transparent 40%)', display: 'flex', flexDirection: 'column' }}>
        {awaitingConfirmation && clarityText && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e' }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>Validation Required</h3>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.3)', color: colors.accent, padding: 20, borderRadius: 12, border: `1px solid ${colors.border}`, maxHeight: 400, overflowY: 'auto', fontSize: 13, fontFamily: 'monospace', marginBottom: 25 }}>{clarityText}</pre>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleConfirm} className="btn-primary" style={{ flex: 1 }}>Confirm Logic</button>
              <button onClick={handleContinueClarifying} className="btn-secondary" style={{ flex: 1 }}>Modify Input</button>
            </div>
          </div>
        )}

        {showCredentialForm && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 25 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: colors.accent }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>Credential Vault</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 30 }}>
              {credentialRequirements.map((c, idx) => (
                <div key={idx} style={{ padding: 20, borderRadius: 16, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <label style={{ color: colors.accent, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', display: 'block', marginBottom: 15 }}>{c.system} API Access</label>
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
            <button onClick={saveCredentials} className="btn-primary" style={{ width: '100%' }}>Finalize Configuration</button>
          </div>
        )}

        {!awaitingConfirmation && !showCredentialForm && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {status === 'Thinking...' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <div className="thinking-orb"></div>
                <span style={{ fontSize: 12, letterSpacing: '3px', color: colors.accent, fontWeight: 700 }}>AI ANALYSIS IN PROGRESS</span>
              </div>
            ) : (
              <div style={{ opacity: 0.3, textAlign: 'center' }}>
                <p style={{ fontSize: 12, letterSpacing: '2px', fontWeight: 800 }}>AWAITING COMMANDS</p>
                <div style={{ marginTop: 20, fontSize: 14 }}>{status}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}