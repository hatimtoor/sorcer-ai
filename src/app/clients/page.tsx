'use client'

import ClientSelector from '@/components/ClientSelector'
import { useAuthGuard } from '@/hooks/useAuthGuard'

export default function ClientsPage() {
  const { loading } = useAuthGuard()

  // We add this function to satisfy the required prop in ClientSelector
  const handleClientSelect = (client: any) => {
    console.log('Client selected from the main clients list:', client)
    // The ClientSelector already handles the redirect logic internally
  }

  if (loading) return <div style={{ padding: 20 }}>Checking authentication…</div>

  return (
    <div style={{ background: '#020617', minHeight: '100vh' }}>
      {/* We pass the function here to fix the "Property missing" error */}
      <ClientSelector onClientSelect={handleClientSelect} />
    </div>
  )
}