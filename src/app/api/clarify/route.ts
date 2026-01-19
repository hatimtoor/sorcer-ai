import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(req: Request) {
  try {
    const { messages, workflow } = await req.json()

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-pro'
    })

    // Build workflow context if provided
    let workflowContext = ''
    if (workflow) {
      const workflowPayload = workflow.payload ? JSON.stringify(workflow.payload, null, 2) : 'No workflow structure available'
      workflowContext = `
      
WORKFLOW CONTEXT:
You are editing an existing workflow named "${workflow.name || 'Unnamed Workflow'}".
Workflow ID: ${workflow.workflow_id}
Description: ${workflow.description || 'No description available'}
Status: ${workflow.status || 'draft'}
Version: ${workflow.version || 1}

CURRENT WORKFLOW STRUCTURE (JSON):
${workflowPayload}

IMPORTANT INSTRUCTIONS:
1. You have access to the complete workflow JSON structure above
2. When the user wants to edit this workflow, acknowledge that you understand they want to edit "${workflow.name}"
3. Reference the current workflow structure when discussing changes
4. Ask what specific changes they want to make
5. Once you have the edit requirements, the system will automatically:
   - Load the workflow from storage
   - Apply the changes using AI
   - Save the updated workflow

The workflow editing will be handled automatically - you just need to collect the edit requirements from the user and reference the current workflow structure when needed.
`
    }

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
- The summary must be precise and implementation-ready${workflowContext}
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
