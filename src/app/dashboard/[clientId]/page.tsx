'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import SeasonedClarifier from '@/components/SeasonedClarifier'

interface Client {
  id: string
  full_name: string
  company_name?: string
}

export default function ClientClarifierPage() {
  const params = useParams()
  const clientId = params?.clientId as string | undefined

  const [client, setClient] = useState<Client | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // UUID format check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  useEffect(() => {
    if (!clientId) return
    
    const fetchClient = async () => {
      setLoading(true)

      // FIX: Changed .single() to .maybeSingle()
      // This prevents the app from crashing if 0 rows are returned (e.g. due to RLS or invalid ID)
      const { data, error } = await supabase
        .from('clients')
        .select('id, full_name, company_name')
        .eq('id', clientId)
        .maybeSingle()

      if (error) {
        // Log the actual message so you don't see {}
        console.error('Supabase Client Fetch Error:', error.message) 
        setError(error.message)
      } else if (!data) {
        // Handle the case where ID is valid format but doesn't exist in DB
        console.error('Client not found. This might be an RLS permission issue.')
        setError('Client not found in database.')
      } else {
        setClient(data)
      }
      setLoading(false)
    }

    if (uuidRegex.test(clientId)) {
      fetchClient()
    } else {
      setError('Invalid Client ID format')
      setLoading(false)
    }
  }, [clientId])

  // --- RENDER STATES ---

  if (!clientId || error === 'Invalid Client ID format') {
    return (
      <div style={{ padding: 40, color: '#ef4444', background: '#020617', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h2>Error: Invalid URL or Client ID</h2>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 40, color: '#38bdf8', background: '#020617', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div className="thinking-orb" style={{ width: 40, height: 40, borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1s infinite' }}></div>
        <p style={{ letterSpacing: 2, fontSize: 12, textTransform: 'uppercase' }}>Loading Profile...</p>
        <style>{`@keyframes pulse { 0% { opacity: 0.5; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } 100% { opacity: 0.5; transform: scale(0.9); } }`}</style>
      </div>
    )
  }

  if (error || !client) {
    return (
      <div style={{ padding: 40, color: '#f8fafc', background: '#020617', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <h2 style={{ color: '#ef4444' }}>Connection Failed</h2>
        <p style={{ maxWidth: 400, textAlign: 'center', color: '#94a3b8' }}>
          {error === 'Client not found in database.' 
            ? "We couldn't find this client. This is likely a permission issue." 
            : "We couldn't load the client data."}
        </p>
        <div style={{ background: '#000', padding: 16, borderRadius: 8, border: '1px solid #333', fontFamily: 'monospace', fontSize: 12, color: '#ef4444' }}>
          Error: {error}
        </div>
        <button 
          onClick={() => window.location.reload()}
          style={{ padding: '10px 20px', background: '#38bdf8', border: 'none', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}
        >
          Retry Connection
        </button>
      </div>
    )
  }

  // --- SUCCESS RENDER ---
  return (
    <SeasonedClarifier
      clientId={client.id}
      clientName={client.full_name}
    />
  )
}