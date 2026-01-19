'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import SeasonedClarifier from '@/components/SeasonedClarifier'

interface Client {
  id: string
  full_name: string
}

export default function ClientClarifierPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const clientId = params?.clientId as string | undefined
  const workflowId = searchParams?.get('workflow_id')
  const workflowName = searchParams?.get('workflow_name')

  const [client, setClient] = useState<Client | null>(null)
  const [workflow, setWorkflow] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Basic validation
  if (!clientId) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Seasoned Clarifier</h2>
        <p style={{ color: 'red' }}>
          Error: No client selected. Please go back and select or create a client.
        </p>
      </div>
    )
  }

  // UUID format check
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  if (!uuidRegex.test(clientId)) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Seasoned Clarifier</h2>
        <p style={{ color: 'red' }}>
          Error: Invalid client ID. Please select a valid client.
        </p>
      </div>
    )
  }

  // Fetch client info and workflow if workflow_id is provided
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)

      // Fetch client
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('id, full_name')
        .eq('id', clientId)
        .single()

      if (clientError) {
        console.error('Supabase error:', clientError)
        setError('Failed to load client information.')
        setLoading(false)
        return
      }
      
      setClient(clientData)

      // Fetch workflow if workflow_id is provided
      if (workflowId && clientId) {
        const { data: workflowData, error: workflowError } = await supabase
          .from('workflows')
          .select('*')
          .eq('workflow_id', workflowId)
          .eq('client_id', clientId)
          .single()

        if (!workflowError && workflowData) {
          setWorkflow(workflowData)
        } else {
          console.warn('Workflow not found:', workflowError)
        }
      }

      setLoading(false)
    }

    fetchData()
  }, [clientId, workflowId])

  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Seasoned Clarifier</h2>
        <p>Loading client info...</p>
      </div>
    )
  }

  if (error || !client) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Seasoned Clarifier</h2>
        <p style={{ color: 'red' }}>{error || 'Client not found.'}</p>
      </div>
    )
  }

  return (
    <SeasonedClarifier
      clientId={client.id}
      clientName={client.full_name}
      workflow={workflow}
      workflowName={workflowName || undefined}
    />
  )
}
