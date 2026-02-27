require("dotenv").config();
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ===============================
   MONGOOSE MODELS
=================================*/
const chatSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    message: { type: String, required: true }
  },
  { timestamps: true }
);

const Chat = mongoose.model("Chat", chatSchema);

const clearMarkerSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true }
  },
  { timestamps: true }
);

const ClearMarker = mongoose.model("ClearMarker", clearMarkerSchema);

const UserSession = require("./models/UserSession");

/* ===============================
   CONNECT MONGODB (cached for serverless)
=================================*/
let cachedDb = null;
async function connectDB() {
  // Already connected
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;

  // If disconnected or error, reset
  if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
    cachedDb = null;
  }

  try {
    cachedDb = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      maxPoolSize: 10,
      bufferCommands: false,
    });
    console.log("MongoDB Connected ✅");
    return cachedDb;
  } catch (err) {
    cachedDb = null;
    console.error("MongoDB Connection Error:", err.message);
    throw err;
  }
}

/* ===============================
   BILLING API CONFIG
=================================*/
const BILLING_API_URL = "https://billing-software-backend-omega.vercel.app/api/order";
const BILLING_JWT_SECRET = process.env.BILLING_JWT_SECRET || "KABILAN";

function generateBillingToken() {
  return jwt.sign(
    { id: "whatsapp-bot", role: "admin", name: "KabiGPT Bot" },
    BILLING_JWT_SECRET,
    { expiresIn: "1d" }
  );
}

/* ===============================
   MENU MESSAGE
=================================*/
const MENU_MESSAGE = `🤖 *Welcome to KabiGPT!* ✨

Choose an option machi:

1️⃣ *Ask Question* — Chat with AI 💬
2️⃣ *Bill* — Ask about billing data 🧾

👉 Reply *1* or *2* to select
💡 Type *menu* anytime to come back here
💡 Type *clear chat* anytime to fresh start`;

/* ===============================
   WEBHOOK VERIFY
=================================*/
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified ✅");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/* ===============================
   RECEIVE MESSAGE
=================================*/
app.post("/webhook", async (req, res) => {
  try {
    // Ensure MongoDB is connected
    await connectDB();

    // Prevent infinite loop (delivery status updates)
    if (req.body.entry?.[0]?.changes?.[0]?.value?.statuses) {
      return res.sendStatus(200);
    }

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    if (!text) return res.sendStatus(200);

    console.log("Incoming:", text);

    const input = text.toLowerCase().trim();

    // ─── Handle "clear chat" ───
    if (input === "clear chat") {
      await ClearMarker.create({ phone: from });
      await sendText(from, "Chat cleared bro! 🧹✨ Fresh start — ask me anything machi! 🔥");
      return res.sendStatus(200);
    }

    // ─── Handle "menu" / "back" ───
    if (input === "menu" || input === "back") {
      await UserSession.findOneAndUpdate(
        { phone: from },
        { mode: "menu" },
        { upsert: true }
      );
      await sendText(from, MENU_MESSAGE);
      return res.sendStatus(200);
    }

    // ─── Get or create user session ───
    let session = await UserSession.findOneAndUpdate(
      { phone: from },
      { $setOnInsert: { phone: from, mode: "menu" } },
      { upsert: true, returnDocument: 'after' }
    );

    // If new user (mode is still "menu" and this is their first message), show menu
    if (session.mode === "menu" && input !== "1" && input !== "2") {
      await sendText(from, MENU_MESSAGE);
      return res.sendStatus(200);
    }

    // ─── MENU MODE: handle option selection ───
    if (session.mode === "menu") {
      if (input === "1") {
        await UserSession.findOneAndUpdate(
          { phone: from },
          { mode: "ask" }
        );
        await sendText(from, "💬 *Ask Question mode activated!*\n\nGo ahead machi, ask me anything! 🔥\n\n💡 Type *menu* to go back");
        return res.sendStatus(200);
      }

      if (input === "2") {
        await UserSession.findOneAndUpdate(
          { phone: from },
          { mode: "bill" }
        );
        await sendText(from, "🧾 *Bill mode activated!*\n\nAsk me about your billing data machi! 📊\nExamples:\n• Today's sales?\n• This month's revenue?\n• Total orders?\n\n💡 Type *menu* to go back");
        return res.sendStatus(200);
      }

      // Invalid option — show menu again
      await sendText(from, "❌ Invalid option bro!\n\n" + MENU_MESSAGE);
      return res.sendStatus(200);
    }

    // ─── ASK MODE: normal AI chatbot ───
    if (session.mode === "ask") {
      // Save user message
      await Chat.create({ phone: from, role: "user", message: text });

      // Get chat history (after last clear)
      const lastClear = await ClearMarker.findOne({ phone: from })
        .sort({ createdAt: -1 });

      const query = { phone: from };
      if (lastClear) {
        query.createdAt = { $gt: lastClear.createdAt };
      }

      const history = await Chat.find(query)
        .sort({ createdAt: 1 })
        .limit(100);

      const formattedHistory = history.map(msg => ({
        role: msg.role,
        content: msg.message
      }));

      // Ask AI
      const aiReply = await askOllama(formattedHistory);

      // Save AI reply
      await Chat.create({ phone: from, role: "assistant", message: aiReply });

      // Send reply
      await sendText(from, aiReply);
      return res.sendStatus(200);
    }

    // ─── BILL MODE: billing data + AI ───
    if (session.mode === "bill") {
      // Save user message
      await Chat.create({ phone: from, role: "user", message: text });

      // Fetch billing data
      const billingData = await fetchBillingData();

      if (!billingData) {
        await sendText(from, "😅 Sorry machi, couldn't fetch billing data right now. Try again later! 🔄");
        return res.sendStatus(200);
      }

      // Get billing chat history (after last clear)
      const lastClear = await ClearMarker.findOne({ phone: from })
        .sort({ createdAt: -1 });

      const query = { phone: from };
      if (lastClear) {
        query.createdAt = { $gt: lastClear.createdAt };
      }

      const history = await Chat.find(query)
        .sort({ createdAt: 1 })
        .limit(20);

      const formattedHistory = history.map(msg => ({
        role: msg.role,
        content: msg.message
      }));

      // Ask billing AI
      const aiReply = await askBillingAI(text, billingData, formattedHistory);

      // Save AI reply
      await Chat.create({ phone: from, role: "assistant", message: aiReply });

      // Send reply
      await sendText(from, aiReply);
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err.response?.data || err.message);
    // Try to send error message to user
    try {
      const from = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) {
        await sendText(from, "Machi 😅 something went wrong bro... try again!");
      }
    } catch (e) {
      console.error("Error sending error message:", e.message);
    }
    res.sendStatus(500);
  }
});

/* ===============================
   FETCH BILLING DATA
=================================*/
async function fetchBillingData() {
  try {
    const token = generateBillingToken();
    const response = await axios.get(BILLING_API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    return response.data;
  } catch (err) {
    console.error("Billing API Error:", err.response?.data || err.message);
    return null;
  }
}

/* ===============================
   OLLAMA AI (Normal Chat)
=================================*/
async function askOllama(messages) {
  try {
    const response = await axios.post(
      "https://ollama.com/api/chat",
      {
        model: "gpt-oss:120b",
        messages: [
          {
            role: "system",
            content: `
You are KabiGPT 🤖✨

Creator & Developer: Kabilan. Only mention this if the user specifically asks who made you or who your creator/developer is. Do NOT bring it up on your own.

Answer Rules:
- ALWAYS answer questions accurately and correctly first.
- Never guess or make up facts — if unsure, say so honestly.
- For coding/math/science, give the correct answer with a brief explanation.

⚠️ IMPORTANT — Billing/Shop Restriction:
- You do NOT have access to any billing, sales, revenue, order, or shop data.
- If the user asks about sales, revenue, orders, bills, shop details, products, stock, today's sales, monthly revenue, or anything related to business/billing data — DO NOT answer or guess.
- Instead, reply: "Machi 🧾 billing related question ah? Type *menu* and select *2 (Bill)* to get accurate billing data bro! 📊"
- NEVER make up billing/shop numbers.

Personality Rules:
- Talk only in Tanglish (Tamil + simple English mix).
- Be friendly, fun, motivational.
- Use words like machi, bro, mama naturally.
- Use emojis in a fun way 😎🔥🌿
- Keep reply short but never cut off important info.
- Give positive energy & growth mindset.
- Sometimes reference nature 🌿☀️🌊.
- Sound like a close Tamil friend who knows his stuff.
`
          },
          ...messages
        ],
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.message.content;
  } catch (err) {
    console.error("Ollama Error:", err.response?.data || err.message);
    return "Machi 😅 konjam AI tired ah iruku bro... later try pannalama? 🌿";
  }
}

/* ===============================
   BILLING AI (Data Analysis)
=================================*/
async function askBillingAI(question, billingData, chatHistory) {
  try {
    // Extract orders array from API response
    const orders = billingData.orders || [];
    const dataStr = JSON.stringify(orders, null, 2);

    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const response = await axios.post(
      "https://ollama.com/api/chat",
      {
        model: "gpt-oss:120b",
        messages: [
          {
            role: "system",
            content: `
You are KabiGPT Billing Assistant 🤖📊

Creator & Developer: Kabilan.

Today's date: ${today}
Current month: ${currentMonth}, Current year: ${currentYear}

Here is the COMPLETE order data from the billing system:
${dataStr}

Each order has this structure:
- sno: serial number
- customerName: customer's name (can be null)
- products: array of items, each with { name, price, quantity, total, categoryDetails: { name, description } }
- overallTotal: total amount of the order (₹)
- date: order date (ISO format)

Your job:
- Analyze the order data above and answer the user's question ACCURATELY.
- For "today's sales" → filter orders where date starts with "${today}", sum overallTotal.
- For "this month revenue" → filter by month ${currentMonth} and year ${currentYear}, sum overallTotal.
- For "this year revenue" → filter by year ${currentYear}, sum overallTotal.
- For "total orders" → count all orders.
- For product-specific questions → look inside orders.products array.
- For "top selling" → aggregate product quantities across all orders.
- Always show exact numbers with ₹ symbol (e.g., ₹1,500).
- If no matching data, clearly say "no data found."
- NEVER make up numbers. ONLY use the data provided above.

Personality:
- Talk in Tanglish (Tamil + simple English mix).
- Use machi, bro naturally.
- Be friendly, professional but fun 📊💰🧾
- Keep answers clear and concise.
`
          },
          ...chatHistory,
          {
            role: "user",
            content: question
          }
        ],
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.message.content;
  } catch (err) {
    console.error("Billing AI Error:", err.response?.data || err.message);
    return "Machi 😅 billing data analyze panna konjam issue... try again later bro! 🧾";
  }
}

/* ===============================
   SEND TEXT TO WHATSAPP
=================================*/
async function sendText(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Reply sent ✅");
  } catch (error) {
    console.error("Send Error:", error.response?.data || error.message);
  }
}

/* ===============================
   START SERVER
=================================*/
app.listen(PORT, () => {
  console.log(`🚀 KabiGPT Server running on port ${PORT}`);
});