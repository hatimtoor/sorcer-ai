'use client'

import ClientSelector from '@/components/ClientSelector'
import { useAuthGuard } from '@/hooks/useAuthGuard'

export default function ClientsPage() {
  const { loading } = useAuthGuard()

  if (loading) return <div style={{ padding: 20 }}>Checking authentication…</div>

  return <ClientSelector />
}
