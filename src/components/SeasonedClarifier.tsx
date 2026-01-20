'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Message {
  id: string
  message: string
  sender: string
  created_at: string
  workflow_id?: string | null
}

interface Props {
  clientId: string
  clientName: string
  workflow?: any  // Workflow data from Supabase
  workflowName?: string  // Workflow name from URL
}

export default function SeasonedClarifier({ clientId, clientName, workflow, workflowName }: Props) {
  // ---------- AUTH ----------
  const [session, setSession] = useState<any | null>(null)
  const [userRole, setUserRole] = useState<string>('staff')
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

  // ---------- TASK EXECUTION STATE ----------
  const [taskStatus, setTaskStatus] = useState<string>('')
  const [executionResult, setExecutionResult] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // ---------- AUTH CHECK ----------
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data?.session) {
        router.replace('/login')
        return
      }
      setSession(data.session)
      
      if (data.session.user?.email) {
        const { data: staffData, error: staffError } = await supabase
          .from('staff')
          .select('role')
          .eq('email', data.session.user.email)
          .maybeSingle()
        
        if (!staffError && staffData?.role) {
          setUserRole(staffData.role)
        } else {
          setUserRole('staff')
        }
      } else {
        setUserRole('staff')
      }
      
      setAuthLoading(false)
    }
    check()
  }, [router])

  // ---------- SCROLL ----------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, awaitingConfirmation, executionResult, showCredentialForm])

  // ---------- LOAD MESSAGES ----------
  useEffect(() => {
    if (!clientId) return
    const fetchMessages = async () => {
      // STRATEGY:
      // 1. If no workflow selected -> Empty chat (new automation)
      // 2. If workflow selected -> Only load messages with EXACT workflow_id match
      // 3. Always add workflow context message if editing a workflow
      
      if (!workflow?.workflow_id) {
        // New automation - start completely empty
        setMessages([])
        return
      }
      
      // Editing a workflow - ONLY load messages with this exact workflow_id
      // Do NOT include messages with null workflow_id (those are old/general messages)
      const { data, error } = await supabase
        .from('client_messages')
        .select('*')
        .eq('client_id', clientId)
        .eq('workflow_id', workflow.workflow_id)  // STRICT: Only exact matches
        .order('created_at', { ascending: true })
      
      if (error) {
        console.error('Error loading messages:', error)
        setStatus(`Supabase error: ${error.message}`)
        setMessages([])
        return
      }
      
      // Start with loaded messages (only messages for this workflow)
      let initialMessages: Message[] = data || []
      
      // Add workflow context message at the beginning if it doesn't exist
      if (workflowName && workflow) {
        const workflowContextMessage = `I want to edit the workflow "${workflowName}". 

Workflow Details:
- Name: ${workflow.name}
- Description: ${workflow.description || 'No description available'}
- Status: ${workflow.status || 'draft'}
- Version: ${workflow.version || 1}

This workflow is already created in GoHighLevel. What changes would you like to make?`
        
        // Check if context message already exists
        const contextExists = initialMessages.some(msg => 
          msg.workflow_id === workflow.workflow_id && 
          msg.sender !== 'ai' && 
          msg.message.includes(`edit the workflow "${workflowName}"`)
        )
        
        if (!contextExists) {
          const { data: contextData, error: contextError } = await supabase
            .from('client_messages')
            .insert([{
              client_id: clientId,
              message: workflowContextMessage,
              sender: userRole,
              workflow_id: workflow.workflow_id
            }])
            .select()
          
          if (contextError) {
            const workflowContext: Message = {
              id: `workflow-context-${Date.now()}`,
              message: workflowContextMessage,
              sender: userRole,
              created_at: new Date().toISOString(),
              workflow_id: workflow.workflow_id
            }
            initialMessages = [workflowContext, ...initialMessages]
          } else if (contextData && contextData[0]) {
            initialMessages = [contextData[0], ...initialMessages]
          }
        }
      }
      
      setMessages(initialMessages)
    }
    
    fetchMessages()
  }, [clientId, workflow?.workflow_id, workflowName, userRole])


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
    if (!input.trim() || awaitingConfirmation || taskStatus === 'executing' || showCredentialForm) return

    setStatus('Saving your message...')
    
    const workflowIdToSave = workflow?.workflow_id || null
    
    const { data: staffData, error: staffError } = await supabase
      .from('client_messages')
      .insert([{ 
        client_id: clientId, 
        message: input, 
        sender: userRole,
        workflow_id: workflowIdToSave
      }])
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
      body: JSON.stringify({ 
        messages: [...messages, newStaffMsg],
        workflow: workflow ? {
          workflow_id: workflow.workflow_id,
          name: workflow.name,
          description: workflow.description,
          status: workflow.status,
          version: workflow.version,
          payload: workflow.payload  // Include full workflow JSON payload
        } : null  // Pass complete workflow context including payload to API
      })
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
        const aiWorkflowId = workflow?.workflow_id || null
        const { data: aiData, error: aiError } = await supabase
          .from('client_messages')
          .insert([{ 
            client_id: clientId, 
            message: userFriendlyPart, 
            sender: 'ai',
            workflow_id: aiWorkflowId
          }])
          .select()
        
        if (!aiError && aiData && aiData[0]) {
          setMessages(prev => [...prev, aiData[0]])
        }
      }
      setStatus('')
      return
    }

    const finalWorkflowId = workflow?.workflow_id || null
    const { data: aiData, error: aiError } = await supabase
      .from('client_messages')
      .insert([{ 
        client_id: clientId, 
        message: aiText, 
        sender: 'ai',
        workflow_id: finalWorkflowId
      }])
      .select()

    if (aiError) {
      setStatus(`Error saving AI message: ${aiError.message}`)
      return
    }

    if (aiData && aiData[0]) {
      setMessages(prev => [...prev, aiData[0]])
    }
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

    const systems: string[] = clarityJson.systems || []
    const supportedCRMs = ['GoHighLevel', 'ActiveCampaign', 'HubSpot']
    const isPureCRM = systems.length > 0 && systems.every(s => supportedCRMs.includes(s.trim()))
    
    let platform = 'ghl'
    if (systems.some(s => s.includes('HubSpot'))) platform = 'hubspot'
    if (systems.some(s => s.includes('ActiveCampaign'))) platform = 'ac'

    const isGHL = platform === 'ghl' || systems.some(s => s.includes('GoHighLevel'))

    if (!isPureCRM) {
      setAwaitingConfirmation(false)
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

    if (!isGHL) {
      setAwaitingConfirmation(false)
      setStatus('Detecting required credentials...')
      const detected = await detectCredentialRequirementsFromGemini({
        systems: clarityJson.systems,
        business_goal: clarityJson.business_goal
      })
      
      const nonGHLRequirements = detected.filter((c: any) => 
        !c.system.toLowerCase().includes('gohighlevel') && 
        !c.system.toLowerCase().includes('ghl')
      )
      
      if (nonGHLRequirements.length > 0) {
        setCredentialRequirements(nonGHLRequirements)
        setShowCredentialForm(true)
        setStatus('Please enter credentials for the required systems.')
        return
      }
    }

    setAwaitingConfirmation(false)
    setStatus('Fetching client credentials...')
    
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
      // Get Supabase credentials to pass to CRM for workflow storage
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
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
        },
        supabase: {
          url: supabaseUrl,
          key: supabaseKey
        },
        // Include workflow_id if editing an existing workflow
        workflow_id: workflow?.workflow_id || null,
        workflow_name: workflow?.name || null
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
  
  // Helper function to simplify error messages for non-technical users
  const simplifyErrorMessage = (error: string): string => {
    if (!error) return 'Something went wrong. Please try again or contact support.'
    
    let errorStr = String(error)
    
    // Remove Python tracebacks
    if (errorStr.includes('Traceback') || errorStr.includes('File "') || errorStr.includes('line ')) {
      if (errorStr.includes('WebDriverException') || errorStr.includes('Browser window not found')) {
        return 'The automation tool encountered a browser issue. Please make sure the CRM application is running properly and try again.'
      }
      if (errorStr.includes('timeout') || errorStr.includes('Timeout')) {
        return 'The task took too long to complete. Please try again or contact support if the issue persists.'
      }
      if (errorStr.includes('selenium') || errorStr.includes('WebDriver')) {
        return 'An automation browser error occurred. Please try again or contact support.'
      }
      return 'An automation error occurred. Please try again or contact support.'
    }
    
    // Remove technical jargon
    let simplified = errorStr
      .replace(/API|api|endpoint|request|response|HTTP|status code/gi, '')
      .replace(/401|403|404|500|502|503/gi, '')
      .replace(/selenium|WebDriver|chrome|browser|driver/gi, '')
      .replace(/\.py|\.js|line \d+|File "/gi, '')
      .replace(/Traceback|Stacktrace|Exception|Error:/gi, '')
      .replace(/\{.*?\}|\[.*?\]/g, '') // Remove JSON objects/arrays
      .replace(/at .*?\(.*?\)/g, '') // Remove stack trace lines
      .trim()
    
    // Common error patterns
    if (errorStr.includes('Location mismatch') || (errorStr.includes('location_id') && errorStr.includes('redirected'))) {
      return 'The system tried to access a different location than expected. This usually happens when your browser has saved login information for a different location. Please clear your browser data or use a different browser profile.'
    }
    if (errorStr.includes('Chrome profile') && (errorStr.includes('redirected') || errorStr.includes('saved location'))) {
      return 'The browser opened to a different location than expected. This happens when your saved browser session is for a different location. Please clear your browser data or contact support.'
    }
    if (errorStr.includes('Invalid') && (errorStr.includes('token') || errorStr.includes('credential') || errorStr.includes('Private Integration token'))) {
      return 'Your access credentials are invalid. Please check your GoHighLevel access token and location ID in the client settings.'
    }
    if (simplified.includes('not found') || simplified.includes('does not exist')) {
      return 'The requested item was not found. Please check if it exists in your CRM system.'
    }
    if (simplified.includes('permission') || simplified.includes('unauthorized') || simplified.includes('forbidden')) {
      return 'You do not have permission to perform this action. Please check your account permissions.'
    }
    if (simplified.includes('connection') || simplified.includes('network') || simplified.includes('ECONNREFUSED')) {
      return 'Unable to connect to the CRM system. Please check your internet connection and try again.'
    }
    if (simplified.includes('timeout') || simplified.includes('ETIMEDOUT')) {
      return 'The request took too long. Please check your connection and try again.'
    }
    if (errorStr.includes('Browser window not found') || errorStr.includes('window is not accessible')) {
      return 'The automation tool could not access the browser window. Please make sure the CRM application is running and try again.'
    }
    if (errorStr.includes('Chrome driver') && errorStr.includes('initialization')) {
      return 'The automation tool could not start properly. Please restart the CRM application and try again.'
    }
    
    // If simplified is too short or empty, return a generic message
    if (simplified.length < 10) {
      return 'An unexpected error occurred. Please try again or contact support.'
    }
    
    // Return simplified version, but limit length
    return simplified.length > 200 ? simplified.substring(0, 200) + '...' : simplified
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
          
          if (!workflow?.workflow_id) {
            const createdWorkflowId = await updateMessagesWithWorkflowId()
            if (createdWorkflowId) {
              console.log('[Chat] Updated messages with workflow_id:', createdWorkflowId)
            }
          }
        } else if (data.status === 'failed') {
          setTaskStatus('failed')
          // Use summary if available (contains natural language error), otherwise simplify error message
          const errorMessage = data.summary || simplifyErrorMessage(data.error || 'Task execution failed')
          setExecutionResult(errorMessage)
          setStatus('❌ Execution failed')
          // Don't save error to chat - it's shown on the right side
        } else if (data.status === 'running') {
          setTaskStatus('executing')
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

  const updateMessagesWithWorkflowId = async (): Promise<string | null> => {
    try {
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select('workflow_id, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (error || !workflows || workflows.length === 0) {
        return null
      }
      
      const newWorkflowId = workflows[0].workflow_id
      const workflowCreatedAt = new Date(workflows[0].created_at)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
      
      if (workflowCreatedAt < tenMinutesAgo) {
        return null
      }
      
      const { data: messagesToUpdate, error: fetchError } = await supabase
        .from('client_messages')
        .select('id')
        .eq('client_id', clientId)
        .is('workflow_id', null)
        .gte('created_at', tenMinutesAgo.toISOString())
      
      if (fetchError || !messagesToUpdate || messagesToUpdate.length === 0) {
        return null
      }
      
      const messageIds = messagesToUpdate.map(msg => msg.id)
      
      const { error: updateError } = await supabase
        .from('client_messages')
        .update({ workflow_id: newWorkflowId })
        .in('id', messageIds)
      
      if (updateError) {
        return null
      }
      
      setMessages(prev => prev.map(msg => 
        messageIds.includes(msg.id) ? { ...msg, workflow_id: newWorkflowId } : msg
      ))
      
      return newWorkflowId
    } catch (err) {
      return null
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
    try { 
      if (clarityText) clarityJson = JSON.parse(clarityText) 
    } catch {
      setStatus('⚠️ JSON invalid')
      return
    }

    const systems: string[] = clarityJson.systems || []
    let platform = 'ghl'
    if (systems.some(s => s.includes('HubSpot'))) platform = 'hubspot'
    if (systems.some(s => s.includes('ActiveCampaign'))) platform = 'ac'

    setStatus('Fetching client credentials...')
    
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .select('ghl_access_token, ghl_location_id')
      .eq('id', clientId)
      .single()
    
    if (clientError || !clientData) {
      setStatus('❌ Failed to load client credentials: ' + (clientError?.message || 'Client not found'))
      return
    }

    const rawAccessToken = clientData.ghl_access_token || ''
    const rawLocationId = clientData.ghl_location_id || ''
    const accessToken = (rawAccessToken != null ? String(rawAccessToken) : '').trim()
    const locationId = (rawLocationId != null ? String(rawLocationId) : '').trim()

    const taskPrompt = `Create an automation with the following requirements:
Goal: ${clarityJson.business_goal || clarityJson.goal}
Trigger: ${clarityJson.trigger || clarityJson.event}
Systems: ${systems.join(', ')}
Success Condition: ${clarityJson.success_condition || clarityJson.success_event || clarityJson.success || clarityJson.goal_met || 'N/A'}
Constraints: ${clarityJson.constraints || clarityJson.limitations || 'None'}
${clarityJson.logic_steps ? `Steps: ${clarityJson.logic_steps.join('; ')}` : ''}`
    
    setStatus('🚀 Sending task to CRM...')
    
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      const payload = {
        client_id: clientId,
        client_name: clientName,
        platform: platform,
        task_prompt: taskPrompt,
        clarity_json: clarityJson,
        credentials: {
          access_token: accessToken,
          location_id: locationId,
          ...credentialValues
        },
        supabase: {
          url: supabaseUrl,
          key: supabaseKey
        },
        workflow_id: workflow?.workflow_id || null,
        workflow_name: workflow?.name || null
      }
      
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
        setClarityText(null)
        pollTaskStatus(result.task_id)
      } else {
        setStatus('❌ Failed to create task: ' + (result.error || 'Unknown error'))
      }
    } catch (err: any) {
      setStatus('❌ Error connecting to CRM: ' + err.message)
      console.error('CRM connection error:', err)
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
            <div key={msg.id} style={{ padding: '14px 18px', borderRadius: 16, maxWidth: '85%', fontSize: 14, lineHeight: '1.5', background: msg.sender === 'ai' ? colors.aiBubble : colors.userBubble, alignSelf: msg.sender === 'ai' ? 'flex-start' : 'flex-end', border: `1px solid ${msg.sender === 'ai' ? 'rgba(255,255,255,0.05)' : 'rgba(56, 189, 248, 0.3)'}`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>{msg.sender === 'ai' ? 'Sorcer AI' : msg.sender}</div>
              <div>{msg.message}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {!showCredentialForm && (
          <div className="glass-panel" style={{ padding: 20, borderRadius: 16, background: 'rgba(2, 6, 23, 0.8)', position: 'relative' }}>
            <textarea placeholder={awaitingConfirmation ? "Selection active on right..." : "Type strategy or clarification..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={awaitingConfirmation || taskStatus === 'executing'} style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none', resize: 'none', height: 80, marginBottom: 10 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ fontSize: 11, color: colors.accent, opacity: 0.6 }}>{status || 'System ready'}</span>
             <button onClick={handleSend} disabled={awaitingConfirmation || taskStatus === 'executing' || !input.trim()} className="btn-primary">Send Message</button>
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
                        <input type={showField[key] ? 'text' : 'password'} onChange={e => setCredentialValues(prev => ({ ...prev, [key]: e.target.value }))} value={credentialValues[key] || ''} style={{ width: '100%', padding: '12px', background: '#020617', border: `1px solid ${colors.border}`, borderRadius: 8, color: '#fff', outline: 'none' }} />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            <button onClick={saveCredentials} className="btn-primary" style={{ width: '100%' }}>Securely Save & Finish</button>
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
        {!awaitingConfirmation && !showCredentialForm && !taskStatus && !executionResult && (
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