# CRM Connection Setup

## Problem
When the website is deployed, it cannot connect to a locally running CRM because `localhost` refers to the server, not your machine.

## Solution
Use environment variables to configure the CRM URL.

## Setup Instructions

### For Local Development
1. Create a `.env.local` file in the `sorcer ai` directory:
```bash
NEXT_PUBLIC_CRM_URL=http://localhost:3002
```

### For Production (Deployed Website + Local CRM)

You have two options:

#### Option 1: Use a Tunneling Service (Recommended)
1. Install and run a tunneling service like **ngrok**:
   ```bash
   # Install ngrok
   npm install -g ngrok
   # or download from https://ngrok.com/
   
   # Start tunnel to your local CRM
   ngrok http 3002
   ```

2. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

3. Set the environment variable in your deployment platform:
   - **Vercel**: Go to Project Settings → Environment Variables
   - **Netlify**: Go to Site Settings → Environment Variables
   - **Other platforms**: Check their documentation for environment variables

4. Add:
   ```
   NEXT_PUBLIC_CRM_URL=https://abc123.ngrok.io
   ```

5. **Important**: Update this URL whenever ngrok restarts (free tier gives new URLs)

#### Option 2: Use a Static Tunnel Service
Services like **localtunnel** or **serveo** provide more stable URLs:
```bash
# Using localtunnel
npx localtunnel --port 3002

# Using serveo (SSH-based, more stable)
ssh -R 80:localhost:3002 serveo.net
```

### Security Note
⚠️ **Important**: Exposing your local CRM to the internet has security implications. Consider:
- Using authentication/API keys
- Limiting access to specific IPs
- Using HTTPS only
- Regularly rotating tunnel URLs

## Testing
After setting up, test the connection:
1. Make sure your CRM is running locally on port 3002
2. If using a tunnel, make sure it's active
3. Try sending a task from the deployed website
4. Check the browser console for connection errors

