'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)

  const starsRef = useRef<HTMLCanvasElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const router = useRouter()

  // cinematic fade-in
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 400)
    return () => clearTimeout(t)
  }, [])

  // ⭐ floating stars like signup page
  useEffect(() => {
    const canvas = starsRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const STAR_COUNT = 150
    const stars: any[] = []

    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 2 + 0.5
      })
    }

    let mx = 0
    let my = 0

    const move = (e: MouseEvent) => {
      mx = (e.clientX - canvas.width / 2) / 95
      my = (e.clientY - canvas.height / 2) / 95
    }

    window.addEventListener('mousemove', move)

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      stars.forEach(star => {
        star.x += mx * star.z
        star.y += my * star.z

        if (star.x < 0) star.x = canvas.width
        if (star.x > canvas.width) star.x = 0
        if (star.y < 0) star.y = canvas.height
        if (star.y > canvas.height) star.y = 0

        ctx.beginPath()
        ctx.fillStyle = `rgba(140,220,255,${0.7 * star.z})`
        ctx.shadowBlur = 16
        ctx.shadowColor = '#38bdf8'
        ctx.arc(star.x, star.y, star.z * 1.4, 0, Math.PI * 2)
        ctx.fill()
      })

      requestAnimationFrame(animate)
    }

    animate()

    return () => window.removeEventListener('mousemove', move)
  }, [])

  const handleLogin = async () => {
    setStatus('Logging in...')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }

    setStatus('Login successful! Redirecting...')

    router.push('/clients')
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'black',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* cinematic fade screen */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'black',
          opacity: loaded ? 0 : 1,
          transition: 'opacity 1.2s ease-out',
          pointerEvents: 'none',
          zIndex: 999
        }}
      />

      {/* floating stars */}
      <canvas
        ref={starsRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0
        }}
      />

      {/* nebula glow */}
      <div
        style={{
          position: 'absolute',
          width: '200%',
          height: '200%',
          background:
            'radial-gradient(circle at 30% 30%, rgba(0,120,255,0.18), transparent 60%), radial-gradient(circle at 70% 70%, rgba(0,40,160,0.18), transparent 60%)',
          filter: 'blur(110px)',
          animation: 'slowspin 40s linear infinite',
          opacity: 0.6,
          zIndex: 0
        } as any}
      />

      {/* LOGIN CARD */}
      <div
        style={{
          background: 'rgba(0,0,0,0.65)',
          padding: 28,
          borderRadius: 20,
          border: '1px solid rgba(0,153,255,0.25)',
          boxShadow:
            '0 0 25px rgba(0,153,255,0.35), inset 0 0 20px rgba(0,0,0,0.6)',
          width: 380,
          textAlign: 'center',
          color: 'white',
          backdropFilter: 'blur(10px)',
          zIndex: 2
        }}
      >
        <h2 style={{ marginBottom: 14, color: '#60a5fa' }}>Staff Login</h2>

        <input
          type="email"
          placeholder="Email Address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setStatus('')
          }}
          style={{
            display: 'block',
            width: '100%',
            margin: '10px 0',
            padding: 10,
            borderRadius: 12,
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(96,165,250,0.4)',
            color: 'white'
          }}
        />

        {/* password with eye toggle */}
        <div style={{ position: 'relative', width: '100%', margin: '10px 0' }}>
          <input
            type={passwordVisible ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setStatus('')
            }}
            style={{
              width: '100%',
              padding: '10px 38px 10px 10px',
              borderRadius: 12,
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(96,165,250,0.4)',
              color: 'white'
            }}
          />

          <span
            onClick={() => setPasswordVisible(!passwordVisible)}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              cursor: 'pointer',
              fontSize: 18,
              userSelect: 'none'
            }}
          >
            {passwordVisible ? '👁️' : '👁️‍🗨️'}
          </span>
        </div>

        <button
          onClick={handleLogin}
          style={{
            marginTop: 12,
            width: '100%',
            padding: '12px 16px',
            borderRadius: 14,
            border: 'none',
            background:
              'linear-gradient(135deg, #0ea5e9 0%, #3b82f6 60%, #60a5fa 100%)',
            color: 'white',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 0 14px rgba(59,130,246,0.8)'
          }}
        >
          Log In
        </button>

        <p style={{ marginTop: 10 }}>{status}</p>
      </div>

      <style>
        {`
          @keyframes slowspin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  )
}
