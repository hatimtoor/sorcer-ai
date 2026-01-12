'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export default function Home() {
  const router = useRouter()
  const starsRef = useRef<HTMLCanvasElement | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Fade-in cinematic
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 400)
    return () => clearTimeout(t)
  }, [])

  // Parallax starfield
  useEffect(() => {
    const canvas = starsRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const stars: any[] = []
    const STAR_COUNT = 140

    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 2 + 0.3
      })
    }

    let mouseX = 0
    let mouseY = 0

    const onMove = (e: MouseEvent) => {
      mouseX = (e.clientX - canvas.width / 2) / 150
      mouseY = (e.clientY - canvas.height / 2) / 150
    }

    window.addEventListener('mousemove', onMove)

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      stars.forEach(star => {
        star.x += mouseX * star.z
        star.y += mouseY * star.z

        if (star.x < 0) star.x = canvas.width
        if (star.x > canvas.width) star.x = 0
        if (star.y < 0) star.y = canvas.height
        if (star.y > canvas.height) star.y = 0

        ctx.beginPath()
        ctx.fillStyle = `rgba(120,220,255,${0.7 * star.z})`
        ctx.shadowBlur = 12
        ctx.shadowColor = '#48b4ff'
        ctx.arc(star.x, star.y, star.z * 1.2, 0, Math.PI * 2)
        ctx.fill()
      })

      requestAnimationFrame(animate)
    }

    animate()

    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'black',
        fontFamily:
          "-apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* cinematic blackout intro */}
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

      {/* parallax star canvas */}
      <canvas
        ref={starsRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0
        }}
      />

      {/* rotating nebula smoke */}
      <div
        style={{
          position: 'absolute',
          width: '200%',
          height: '200%',
          background:
            'radial-gradient(circle at 30% 30%, rgba(0,140,255,0.18), transparent 60%), radial-gradient(circle at 70% 70%, rgba(0,60,180,0.18), transparent 60%)',
          filter: 'blur(110px)',
          animation: 'slowspin 40s linear infinite',
          opacity: 0.6,
          zIndex: 0
        } as any}
      />

      {/* 🚫 REMOVED THE GRID LAYER */}

      {/* center card — unchanged */}
      <div
        style={{
          background: 'rgba(0,0,0,0.65)',
          padding: 28,
          borderRadius: 20,
          border: '1px solid rgba(0,153,255,0.25)',
          boxShadow:
            '0 0 25px rgba(0,153,255,0.35), inset 0 0 20px rgba(0,0,0,0.6)',
          width: 360,
          textAlign: 'center',
          backdropFilter: 'blur(10px)',
          zIndex: 2
        }}
      >
        <h1
          style={{
            color: '#38bdf8',
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 6,
            textShadow: '0 0 10px rgba(56,189,248,0.6)'
          }}
        >
          Sorcer.ai
        </h1>

        <h2
          style={{ marginBottom: 10, color: '#60a5fa', fontSize: 20, fontWeight: 600 }}
        >
          Welcome
        </h2>

        <p style={{ marginBottom: 26, color: '#a5b4fc' }}>
          Choose an option to continue
        </p>

        <button
          onClick={() => router.push('/signup')}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 14,
            border: 'none',
            background:
              'linear-gradient(135deg, #0ea5e9 0%, #3b82f6 60%, #60a5fa 100%)',
            color: 'white',
            cursor: 'pointer',
            marginBottom: 12,
            fontWeight: 600,
            boxShadow: '0 0 12px rgba(59,130,246,0.8)'
          }}
        >
          Create Account
        </button>

        <button
          onClick={() => router.push('/login')}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 14,
            border: '1px solid rgba(96,165,250,0.5)',
            background: 'black',
            color: '#93c5fd',
            cursor: 'pointer',
            fontWeight: 600,
            boxShadow: '0 0 12px rgba(37,99,235,0.25)'
          }}
        >
          Log In
        </button>
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
