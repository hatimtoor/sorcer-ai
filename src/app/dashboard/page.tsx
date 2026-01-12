'use client'

import ClientSelector from '@/components/ClientSelector'

export default function DashboardPage() {
  // We use 'any' here to keep it flexible for your existing data structure
  const handleClientSelect = (client: any) => {
    console.log('Selected client:', client)
    
    // Optional: You can add logic here if you want the dashboard 
    // to do something specific when a client is clicked 
    // before the redirect happens.
  }

  return (
    <div style={{ 
      padding: 0, 
      minHeight: '100vh', 
      background: '#020617', 
      display: 'flex', 
      flexDirection: 'column' 
    }}>
      {/* Header Section */}
      <div style={{ 
        padding: '40px 20px 20px 40px', 
        borderBottom: '1px solid rgba(56, 189, 248, 0.2)' 
      }}>
        <h1 style={{ 
          fontSize: '32px', 
          fontWeight: 800, 
          color: '#f8fafc', 
          margin: 0,
          letterSpacing: '-0.02em'
        }}>
          Internal Portal Dashboard
        </h1>
        <p style={{ color: '#94a3b8', marginTop: '8px' }}>
          Select a client to manage their automations and credentials.
        </p>
      </div>
      
      {/* Main Content Area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <ClientSelector onClientSelect={handleClientSelect} />
      </div>
    </div>
  )
}