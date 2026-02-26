# KabiGPT 🤖✨ — WhatsApp AI Chat Bot

A WhatsApp chatbot powered by Ollama AI that speaks in **Tanglish** (Tamil + English). Built with Node.js, Express, and MongoDB.

## Features

- 🗣️ **Tanglish Conversations** — Responds like a close Tamil friend
- 🧠 **Chat Memory** — Remembers last 10 messages per user for context
- 📲 **WhatsApp Integration** — Uses Meta's WhatsApp Cloud API
- 🤖 **AI Powered** — Uses Ollama API for intelligent responses
- 🗄️ **MongoDB Storage** — Persists all conversations
- 🚀 **Vercel Ready** — Configured for serverless deployment

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Node.js + Express | Server & webhook handling |
| Ollama API | AI chat responses |
| MongoDB + Mongoose | Chat history storage |
| WhatsApp Cloud API | Messaging |
| Vercel | Deployment |

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Kabi09/Whatsapp-Bot-Fun.git
cd Whatsapp-Bot-Fun
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
VERIFY_TOKEN=your_webhook_verify_token
OLLAMA_API_KEY=your_ollama_api_key
PHONE_NUMBER_ID=your_whatsapp_phone_number_id
WHATSAPP_TOKEN=your_whatsapp_access_token
```

### 4. Run locally

```bash
node server.js
```

## Deploy to Vercel

1. Push the repo to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Add all environment variables in Vercel's dashboard
4. Deploy 🚀

## Webhook Setup

Set your WhatsApp webhook URL to:

```
https://your-app.vercel.app/webhook
```

Use your `VERIFY_TOKEN` during webhook verification.

## Author

**Kabilan** 🔥
