# Sorcer AI — Automation Agency Client Portal

> An internal portal that turns vague client requirements into validated, dispatched automation build briefs — automatically.

Sorcer AI is a full-stack web application built for automation agencies. It replaces the messy back-and-forth of client briefing with a structured AI conversation, then handles credential collection and build dispatch without any manual intervention.

It acts as the **screening layer** between client intake and the automation build pipeline (HatAssembly).

---

## The Problem It Solves

Running an automation agency means spending hours asking clients: "What exactly do you want? What tools do you use? What triggers the workflow?" — then manually collecting API keys, figuring out what you already have stored, and copying briefs into build tools.

Sorcer eliminates all of that.

---

## How It Works

```
Staff logs in
      │
      ▼
Select or create a client
      │
      ▼
┌─────────────────────────────┐
│  AI Clarifier (Gemini)      │  Asks clarifying questions until the
│                             │  automation is fully understood.
│  Outputs: CLARITY_READY {}  │  Structured JSON: goal, trigger,
│                             │  systems, success condition, constraints
└─────────────────────────────┘
      │
      ▼
Staff confirms the plan
      │
      ▼
┌─────────────────────────────┐
│  Credential Detection       │  Gemini infers what API keys / tokens
│  (Gemini + Supabase)        │  are needed. Cross-references against
│                             │  existing vault. Prompts only for missing.
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│  Smart Dispatch Engine      │  Routes to the right factory:
│                             │  - n8n webhook (general automation)
│                             │  - CRM factory (GHL / AC / HubSpot)
└─────────────────────────────┘
      │
      ▼
Build triggered. Redirect to client dashboard.
```

---

## Features

**AI Clarifier**
- Gemini-powered conversation that asks targeted questions
- Detects when enough information has been gathered and outputs `CLARITY_READY` signal
- Edit/refine mode for existing automations — loads previous plan as context

**Credential Intelligence**
- Detects required credentials based on the system stack (OAuth tokens, API keys, webhook secrets)
- Checks Supabase vault for what's already stored
- Only prompts for what's actually missing — never asks twice for the same key
- Secure show/hide toggle on all credential fields

**Smart Dispatch**
- Detects whether the job is CRM-only (GoHighLevel, ActiveCampaign, HubSpot) or general automation
- Routes to the appropriate factory automatically
- For general automations: fires n8n webhook with full clarity JSON
- For CRM jobs: dispatches to CRM factory with client credentials attached

**Client Dashboard**
- Full automation history with edit/refine capability
- Credential vault with inline edit and delete
- Paginated views (expand/collapse for large client lists)
- Role-based auth (staff / admin / manager) via Supabase

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| AI | Google Gemini 2.5 Pro (`@google/generative-ai`) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Styling | Inline styles, CSS animations (no framework) |
| Deployment | Vercel |
| Build dispatch | n8n webhook + CRM factory |

---

## Project Structure

```
sorcer-ai/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── clarify/route.ts          # Gemini clarification endpoint
│   │   │   └── gemini/credential-detection/route.ts  # Credential inference
│   │   ├── clients/
│   │   │   └── [clientId]/dashboard/     # Per-client dashboard
│   │   ├── dashboard/[clientId]/         # AI clarifier page
│   │   ├── login/                        # Staff login
│   │   └── signup/                       # Staff signup
│   ├── components/
│   │   ├── SeasonedClarifier.tsx         # Main AI conversation UI
│   │   ├── ClientSelector.tsx            # Client search + creation
│   │   └── StaffSignUp.tsx               # Auth UI
│   ├── hooks/
│   │   └── useAuthGuard.ts               # Route protection
│   └── lib/supabase/client.ts            # Supabase client
```

---

## Supabase Schema

```sql
-- Clients
create table clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email_address text not null,
  company_name text,
  ghl_access_token text,
  ghl_location_id text
);

-- Automation Clarity (build briefs)
create table automation_clarity (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  name text,
  clarity jsonb,
  confirmed boolean default false,
  factory_type text,  -- 'n8n' or 'crm'
  created_at timestamptz default now()
);

-- Credentials Vault
create table credentials (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  name text not null,   -- format: "System:FieldName"
  value text not null,
  created_at timestamptz default now()
);

-- Chat Messages
create table client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  message text not null,
  sender text not null,  -- 'staff' or 'ai'
  created_at timestamptz default now()
);
```

---

## Setup

### 1. Clone & install
```bash
git clone https://github.com/hatimtoor/sorcer-ai.git
cd sorcer-ai
npm install
```

### 2. Environment variables
Create `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Set up Supabase
- Create the tables above
- Enable Row Level Security
- Set up auth with email/password

### 4. Run locally
```bash
npm run dev
```

### 5. Deploy
Deploy to Vercel — connect your repo, add environment variables, done.

---

## Relation to HatAssembly

Sorcer AI and [HatAssembly](https://github.com/hatimtoor/HatAssembly) work together as a pipeline:

```
Sorcer AI                    HatAssembly
─────────────────            ──────────────────────────
Client intake          →     n8n workflow generation
Requirement clarity          RAG-powered node assembly
Credential collection        Deployable workflow JSON output
Build dispatch         →     Receives the clarity JSON via webhook
```

Sorcer handles the **human layer** — turning messy client conversations into structured briefs. HatAssembly handles the **build layer** — turning those briefs into deployable n8n workflows.

---

## Author

**Hatim Toor** — Automation Team Lead  
[Portfolio](https://hatimtoor.vercel.app/) · [LinkedIn](https://www.linkedin.com/in/hatim-toor/) · [HatAssembly](https://github.com/hatimtoor/HatAssembly)
