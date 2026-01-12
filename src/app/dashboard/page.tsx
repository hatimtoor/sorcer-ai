'use client'

import ClientSelector from '@/components/ClientSelector'

export default function DashboardPage() {
  const handleClientSelect = (client: any) => {
    console.log('Selected client:', client)
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Internal Portal Dashboard</h1>
      <ClientSelector onClientSelect={handleClientSelect} />
    </div>
  )
}
