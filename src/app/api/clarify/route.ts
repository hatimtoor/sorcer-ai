import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-pro'
    })

    const systemPrompt = `
You are a senior automation consultant.

IMPORTANT: Distinguish between SIMPLE OPERATIONS and AUTOMATIONS:

SIMPLE OPERATIONS (no trigger needed):
- Creating tags, fields, lists, properties
- Updating contact information
- Simple one-time actions
- Direct API operations

For simple operations, collect only:
- What to create/update (name, type, details)
- Which system (GoHighLevel, HubSpot, ActiveCampaign)
- Success condition (what confirms it worked)

AUTOMATIONS (trigger needed):
- Workflows that run automatically
- Event-driven actions
- Multi-step processes
- Scheduled tasks

For automations, collect:
- Business goal
- Trigger event (what starts it)
- Systems involved
- Success condition
- Constraints

Your job:
- Ask clarifying questions until the task is fully understood.
- For SIMPLE OPERATIONS, do NOT ask about triggers - just get the details needed.
- Once clarity is reached, output EXACTLY this format and NOTHING ELSE:

CLARITY_READY {
  "business_goal": "...",
  "trigger": "Direct action" (for simple operations) OR specific trigger event (for automations),
  "systems": ["..."],
  "success_condition": "...",
  "constraints": "..."
}

IMPORTANT RULES:
- Do NOT explain the JSON
- Do NOT add commentary before or after
- Do NOT assume approval
- For simple tag/field/list creation, set trigger to "Direct action"
- The summary must be precise and implementation-ready
`

    const formattedMessages = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      ...messages.map((m: any) => ({
        role: m.sender === 'staff' ? 'user' : 'model',
        parts: [{ text: m.message }]
      }))
    ]

    const result = await model.generateContent({
      contents: formattedMessages
    })

    const aiText = result.response.text().trim()

    // ------------------------
    // Detect CLARITY_READY
    // ------------------------
    if (aiText.startsWith('CLARITY_READY')) {
      const jsonStart = aiText.indexOf('{')
      const jsonString = aiText.slice(jsonStart)

      let parsed
      try {
        parsed = JSON.parse(jsonString)
      } catch {
        return NextResponse.json({
          type: 'error',
          aiText,
          error: 'Failed to parse CLARITY_READY JSON'
        })
      }

      return NextResponse.json({
        type: 'clarity_ready',
        aiText,                  // <- ALWAYS RETURN TEXT
        requires_confirmation: true,
        clarity: parsed
      })
    }

    // ------------------------
    // Normal conversational reply
    // ------------------------
    return NextResponse.json({
      type: 'message',
      aiText
    })

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
