'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Client {
  id: string
  full_name: string
  email_address: string
  company_name: string
  ghl_access_token?: string
  ghl_location_id?: string
}

interface ClientSelectorProps {
  onClientSelect: (client: Client) => void
}

export default function ClientSelector({ onClientSelect }: ClientSelectorProps) {
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [filteredClients, setFilteredClients] = useState<Client[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [newClient, setNewClient] = useState({
    full_name: '',
    email_address: '',
    company_name: '',
    ghl_access_token: '',
    ghl_location_id: ''
  })
  const [status, setStatus] = useState('')

  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const fetchClients = async () => {
      const { data, error } = await supabase.from('clients').select('*')
      if (error) setStatus(`Error fetching clients: ${error.message}`)
      else if (data) setClients(data)
    }
    fetchClients()
  }, [])

  useEffect(() => {
    setFilteredClients(
      clients.filter(c =>
        c.full_name.toLowerCase().includes(search.toLowerCase())
      )
    )
  }, [search, clients])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (client: Client) => {
    onClientSelect(client)
    router.push(`/clients/${client.id}/dashboard`)
  }

  const handleCreate = async () => {
    if (!newClient.full_name || !newClient.email_address) {
      setStatus('Full name and email are required')
      return
    }

    setStatus('Creating client...')

    const { data, error } = await supabase
      .from('clients')
      .insert([newClient])
      .select()

    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }

    if (!data || data.length === 0) {
      setStatus('Error: No client data returned')
      return
    }

    onClientSelect(data[0])
    router.push(`/clients/${data[0].id}/dashboard`)
  }

  /* ---------- Floating mouse-reactive stars ---------- */
  const [stars] = useState(() => 
    typeof window !== 'undefined' 
      ? Array.from({ length: 60 }, () => ({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight
        }))
      : []
  )

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const elements = document.getElementsByClassName('star')
    for (let i = 0; i < elements.length; i++) {
      const star = elements[i] as HTMLElement
      const speed = 0.08
      const dx = (e.clientX - star.offsetLeft) * speed
      const dy = (e.clientY - star.offsetTop) * speed
      star.style.transform = `translate(${dx}px, ${dy}px)`
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    marginTop: 8,
    padding: '10px 14px',
    borderRadius: 14,
    border: '1px solid rgba(147,197,253,0.5)',
    background: 'rgba(15, 23, 42, 0.65)',
    color: 'white',
    boxShadow: 'inset 0 0 10px rgba(30,58,138,0.6)',
    outline: 'none'
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at bottom, #020617, #000000)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 40
      }}
      onMouseMove={handleMouseMove}
    >
      {stars.map((s, i) => (
        <div
          key={i}
          className="star"
          style={{
            position: 'absolute',
            top: s.y,
            left: s.x,
            width: 2,
            height: 2,
            borderRadius: '50%',
            background: '#a5f3fc',
            opacity: 0.9,
            transition: 'transform 0.12s linear'
          }}
        />
      ))}

      {/* -------- SELECT CLIENT CARD -------- */}
      <div
        style={{
          width: 360,
          padding: 22,
          borderRadius: 20,
          background: 'rgba(12, 24, 60, 0.65)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(96, 165, 250, 0.35)',
          position: 'relative',
          color: 'white',
          boxShadow: '0 0 28px rgba(59, 130, 246, 0.35)'
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: 20,
            background: 'linear-gradient(160deg, rgba(14,165,233,0.7), rgba(59,130,246,0.6), transparent)',
            filter: 'blur(10px)',
            zIndex: -1,
            animation: 'sweep 7s linear infinite'
          }}
        />
        <h2 style={{ textAlign: 'center', marginBottom: 6, color: '#93c5fd' }}>
          Select Existing Client
        </h2>
        <div ref={dropdownRef}>
          <input
            type="text"
            placeholder="Search client..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setDropdownOpen(true)
            }}
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={inputStyle}
          />
          {dropdownOpen && filteredClients.length > 0 && (
            <ul
              style={{
                marginTop: 8,
                borderRadius: 14,
                background: 'rgba(3,7,18,0.9)',
                border: '1px solid rgba(148,163,184,0.3)',
                listStyle: 'none',
                padding: 0,
                maxHeight: 150,
                overflowY: 'auto'
              }}
            >
              {filteredClients.map(c => (
                <li
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: 10 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(59,130,246,0.25)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {c.full_name} ({c.email_address})
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* -------- CREATE NEW CLIENT CARD -------- */}
      <div
        style={{
          width: 380,
          padding: 22,
          borderRadius: 20,
          background: 'rgba(12, 24, 60, 0.65)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(96, 165, 250, 0.35)',
          color: 'white',
          position: 'relative',
          boxShadow: '0 0 28px rgba(59, 130, 246, 0.35)'
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: 20,
            background: 'linear-gradient(200deg, rgba(96,165,250,0.7), rgba(2,132,199,0.6), transparent)',
            filter: 'blur(10px)',
            zIndex: -1,
            animation: 'sweep 7s linear infinite'
          }}
        />
        <h2 style={{ textAlign: 'center', marginBottom: 6, color: '#bae6fd' }}>
          Create New Client
        </h2>

        <input
          type="text"
          placeholder="Full Name"
          value={newClient.full_name}
          onChange={(e) => setNewClient({ ...newClient, full_name: e.target.value })}
          style={inputStyle}
        />
        <input
          type="email"
          placeholder="Email Address"
          value={newClient.email_address}
          onChange={(e) => setNewClient({ ...newClient, email_address: e.target.value })}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Company Name"
          value={newClient.company_name}
          onChange={(e) => setNewClient({ ...newClient, company_name: e.target.value })}
          style={inputStyle}
        />

        <p style={{ 
          fontSize: '0.85rem', 
          marginTop: 18, 
          marginBottom: 4, 
          color: '#93c5fd', 
          textAlign: 'center',
          lineHeight: '1.4' 
        }}>
          If you think this client is going to need CRM work done please also fill out these 2 fields.
        </p>

        <input
          type="text" // Changed from password to text as requested
          placeholder="GHL Access Token"
          value={newClient.ghl_access_token}
          onChange={(e) => setNewClient({ ...newClient, ghl_access_token: e.target.value })}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="GHL Location ID"
          value={newClient.ghl_location_id}
          onChange={(e) => setNewClient({ ...newClient, ghl_location_id: e.target.value })}
          style={inputStyle}
        />

        <button
          onClick={handleCreate}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '12px 14px',
            borderRadius: 14,
            background: 'linear-gradient(135deg, #0ea5e9, #3b82f6, #60a5fa)',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            boxShadow: '0 0 16px rgba(59,130,246,0.8)'
          }}
        >
          Create Client
        </button>
      </div>

      <style jsx>{`
        @keyframes sweep {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <p style={{ position: 'absolute', bottom: 20, color: '#e0f2fe' }}>{status}</p>
    </div>
  )
}