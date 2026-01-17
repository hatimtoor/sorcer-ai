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

  // ---------- TASK EXECUTION STATE ----------
  const [taskStatus, setTaskStatus] = useState<string>('')
  const [executionResult, setExecutionResult] = useState<string | null>(null)

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
  }, [messages, awaitingConfirmation, executionResult])

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


  // ---------- SEND MESSAGE ----------
  const handleSend = async () => {
    if (!input.trim() || awaitingConfirmation || taskStatus === 'executing') return

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
      
      // Don't save the JSON clarity to chat - only save the user-friendly message before CLARITY_READY
      const userFriendlyPart = aiText.split('CLARITY_READY')[0].trim()
      if (userFriendlyPart) {
        const { data: aiData, error: aiError } = await supabase
          .from('client_messages')
          .insert([{ client_id: clientId, message: userFriendlyPart, sender: 'ai' }])
          .select()
        
        if (!aiError && aiData) {
          setMessages(prev => [...prev, aiData[0]])
        }
      }
      setStatus('')
      return
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
    
    setAwaitingConfirmation(false)
    setStatus('Fetching client credentials...')
    
    // Get client credentials from Supabase
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .select('ghl_access_token, ghl_location_id')
      .eq('id', clientId)
      .single()
    
    if (clientError || !clientData) {
      setStatus('❌ Failed to load client credentials: ' + (clientError?.message || 'Client not found'))
      return
    }
    
    if (!clientData.ghl_access_token || !clientData.ghl_location_id) {
      setStatus('❌ Client credentials missing. Please add GHL access token and location ID.')
      return
    }
    
    // Log full token length to check if it's complete
    console.log('Full token from Supabase:', {
      token_length: clientData.ghl_access_token?.length || 0,
      token_type: typeof clientData.ghl_access_token,
      token_starts_with: clientData.ghl_access_token?.substring(0, 20) || 'empty',
      token_ends_with: clientData.ghl_access_token?.substring(clientData.ghl_access_token.length - 20) || 'empty',
      full_token: clientData.ghl_access_token // Log full token for debugging
    })
    
    // Determine platform from systems
    const systems: string[] = clarityJson.systems || []
    const supportedCRMs = ['GoHighLevel', 'ActiveCampaign', 'HubSpot']
    const isPureCRM = systems.length > 0 && systems.every(s => supportedCRMs.includes(s.trim()))
    
    if (!isPureCRM) {
      setStatus('🤖 External systems detected. Sending to n8n...')
      try {
        await fetch('https://sorcer.app.n8n.cloud/webhook/3eaf76d7-01e2-40f7-b004-07ff942b666a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clarityJson)
        })
        setStatus('✅ Sent to n8n factory')
        setTimeout(() => { router.push(`/clients/${clientId}/dashboard`) }, 1200)
      } catch (err) {
        setStatus('⚠️ Webhook error')
      }
      return
    }
    
    // Determine platform code
    let platform = 'ghl'
    if (systems.some(s => s.includes('HubSpot'))) platform = 'hubspot'
    if (systems.some(s => s.includes('ActiveCampaign'))) platform = 'ac'
    
    // Build natural language prompt from clarity
    const taskPrompt = `Create an automation with the following requirements:
Goal: ${clarityJson.business_goal || clarityJson.goal}
Trigger: ${clarityJson.trigger || clarityJson.event}
Systems: ${systems.join(', ')}
Success Condition: ${clarityJson.success_condition || clarityJson.success_event || clarityJson.success || clarityJson.goal_met || 'N/A'}
Constraints: ${clarityJson.constraints || clarityJson.limitations || 'None'}
${clarityJson.logic_steps ? `Steps: ${clarityJson.logic_steps.join('; ')}` : ''}`
    
    setStatus('🚀 Sending task to CRM...')
    
    // Validate and prepare credentials - preserve full token without truncation
    // Get raw values directly from Supabase response
    const rawAccessToken = clientData.ghl_access_token;
    const rawLocationId = clientData.ghl_location_id;
    
    // Convert to string only if needed, preserve full length
    const accessToken = (rawAccessToken != null ? String(rawAccessToken) : '').trim();
    const locationId = (rawLocationId != null ? String(rawLocationId) : '').trim();
    
    // Log full credentials for debugging - show complete token
    console.log('Full credentials from Supabase:', {
      raw_token: rawAccessToken,
      raw_token_type: typeof rawAccessToken,
      raw_token_length: rawAccessToken?.length || 0,
      processed_token: accessToken,
      processed_token_length: accessToken.length,
      location_id: locationId,
      // Log first 50 and last 50 chars to verify full token
      token_start: accessToken.substring(0, Math.min(50, accessToken.length)),
      token_end: accessToken.length > 50 ? accessToken.substring(accessToken.length - 50) : 'N/A'
    })
    
    // Log credentials being sent to CRM
    console.log('Sending credentials to CRM:', {
      has_access_token: !!accessToken,
      has_location_id: !!locationId,
      access_token_length: accessToken.length,
      location_id: locationId,
      access_token_preview: accessToken ? `${accessToken.substring(0, 20)}...${accessToken.substring(Math.max(0, accessToken.length - 10))}` : 'empty'
    })
    
    if (!accessToken || !locationId) {
      setStatus('❌ Invalid credentials: Access token or location ID is missing or empty')
      return
    }
    
    try {
      // Prepare payload with full credentials - no truncation
      const payload = {
        client_id: clientId,
        client_name: clientName,
        platform: platform,
        task_prompt: taskPrompt,
        clarity_json: clarityJson,
        credentials: {
          access_token: accessToken, // Full token preserved
          location_id: locationId
        }
      };
      
      // Log payload to verify full token is being sent
      console.log('Payload being sent (token length):', payload.credentials.access_token.length);
      console.log('Full access token being sent:', payload.credentials.access_token);
      
      // Send task to CRM - use environment variable or fallback to localhost
      const crmUrl = process.env.NEXT_PUBLIC_CRM_URL || 'http://localhost:3002'
      const response = await fetch(`${crmUrl}/api/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      if (!response.ok) {
        throw new Error(`CRM server error: ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (result.task_id) {
        setStatus('✅ Task sent to CRM. Waiting for execution...')
        setTaskStatus('executing')
        
        // Clear confirmation state since task is now executing
        setAwaitingConfirmation(false)
        setClarityText(null)
        
        // Poll for results
        pollTaskStatus(result.task_id)
      } else {
        setStatus('❌ Failed to create task: ' + (result.error || 'Unknown error'))
      }
    } catch (err: any) {
      setStatus('❌ Error connecting to CRM: ' + err.message)
      console.error('CRM connection error:', err)
    }
  }
  
  const pollTaskStatus = async (taskId: string) => {
    const maxAttempts = 120 // 10 minutes max (5 second intervals)
    let attempts = 0
    
    const poll = async () => {
      try {
        const crmUrl = process.env.NEXT_PUBLIC_CRM_URL || 'http://localhost:3002'
        const response = await fetch(`${crmUrl}/api/task/${taskId}/status`)
        if (!response.ok) {
          throw new Error('Failed to fetch task status')
        }
        
        const data = await response.json()
        
        if (data.status === 'completed') {
          setTaskStatus('completed')
          setExecutionResult(data.summary || 'Task completed successfully')
          setStatus('✅ Execution completed!')
          // Don't save summary to chat - it's shown on the right side
        } else if (data.status === 'failed') {
          setTaskStatus('failed')
          // Simplify error message for non-technical users
          const simplifiedError = simplifyErrorMessage(data.error || 'Task execution failed')
          setExecutionResult(simplifiedError)
          setStatus('❌ Execution failed')
          // Don't save error to chat - it's shown on the right side
        } else if (data.status === 'running') {
          setStatus(`⏳ Executing... (${data.progress || 0}%)`)
          attempts++
          if (attempts < maxAttempts) {
            setTimeout(poll, 5000) // Poll every 5 seconds
          } else {
            setStatus('⏱️ Execution taking longer than expected...')
          }
        }
      } catch (err: any) {
        console.error('Polling error:', err)
        attempts++
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000)
        } else {
          setStatus('❌ Failed to get task status')
        }
      }
    }
    
    poll()
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

        {/* Input area - always visible */}
        <div className="glass-panel" style={{ padding: 20, borderRadius: 16, background: 'rgba(2, 6, 23, 0.8)', position: 'relative' }}>
          <textarea placeholder={awaitingConfirmation ? "Selection active on right..." : "Type strategy or clarification..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={awaitingConfirmation || taskStatus === 'executing'} style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none', resize: 'none', height: 80, marginBottom: 10 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <span style={{ fontSize: 11, color: colors.accent, opacity: 0.6 }}>{status || 'System ready'}</span>
             <button onClick={handleSend} disabled={awaitingConfirmation || taskStatus === 'executing' || !input.trim()} className="btn-primary">Send Message</button>
          </div>
        </div>
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


        {/* EXECUTION STATUS - Show when task is executing */}
        {taskStatus === 'executing' && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
               <div className="thinking-orb" style={{ width: 40, height: 40 }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>Task Executing</h3>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.4)', padding: 20, borderRadius: 16, border: `1px solid ${colors.border}` }}>
              <p style={{ fontSize: 14, color: colors.accent, margin: 0 }}>{status || 'Processing in CRM...'}</p>
            </div>
          </div>
        )}

        {/* EXECUTION RESULT - Show when task completes or fails */}
        {executionResult && (
          <div className="glass-panel" style={{ padding: 30, borderRadius: 24, background: colors.glass, animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: taskStatus === 'failed' ? '#ef4444' : taskStatus === 'completed' ? '#22c55e' : '#fbbf24' }}></div>
               <h3 style={{ margin: 0, fontSize: 20 }}>Execution Result</h3>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.4)', padding: 25, borderRadius: 16, border: `1px solid ${colors.border}`, marginBottom: 20 }}>
              <div style={{ color: taskStatus === 'failed' ? '#ef4444' : taskStatus === 'completed' ? '#22c55e' : '#fbbf24', fontSize: 14, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                {executionResult}
              </div>
            </div>
            <button onClick={() => { setTaskStatus(''); setExecutionResult(null); setStatus(''); }} className="btn-primary" style={{ width: '100%' }}>
              Clear Result
            </button>
          </div>
        )}

        {/* LOADING ORB - Show when no active task and not awaiting confirmation */}
        {!awaitingConfirmation && !taskStatus && !executionResult && (
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