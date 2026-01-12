import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const clarity = body.clarity || body

    const systems = clarity.systems
    const business_goal = clarity.business_goal

    if (!systems || !business_goal) {
      throw new Error('Missing systems or business_goal in clarity JSON')
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY')
    }

    const prompt = `
You are an automation architect.

Infer the credentials REQUIRED to implement the automation described.

Return ONLY JSON in the format:
[
  { "system": "...", "type": "...", "fields": ["..."], "secure": true }
]

Instructions:
- Assume SaaS systems require authentication
- Never return [] if systems typically require credentials
- Include OAuth tokens, API keys, app tokens, webhook secrets
- Infer scopes from business goal
- Do not ask questions
- Do not include explanation text

Systems: ${JSON.stringify(systems)}
Business Goal: ${business_goal}
`

    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    )

    const json = await res.json()

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'

    let parsed = []

    try {
      const cleaned = text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim()

      parsed = JSON.parse(cleaned)
    } catch (_) {
      parsed = []
    }

    return NextResponse.json({ credentials: parsed })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Credential detection failed' },
      { status: 500 }
    )
  }
}
