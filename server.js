require("dotenv").config();
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ===============================
   MONGOOSE MODEL
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

/* ===============================
   CONNECT MONGODB
=================================*/
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.error("Mongo Error:", err));

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

    // Save user message
    await Chat.create({
      phone: from,
      role: "user",
      message: text
    });

    // Get last 10 messages for context
    const history = await Chat.find({ phone: from })
      .sort({ createdAt: -1 })
      .limit(10);

    const formattedHistory = history.reverse().map(msg => ({
      role: msg.role,
      content: msg.message
    }));

    // Ask AI
    const aiReply = await askOllama(formattedHistory);

    // Save AI reply
    await Chat.create({
      phone: from,
      role: "assistant",
      message: aiReply
    });

    // Send reply
    await sendText(from, aiReply);

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

/* ===============================
   OLLAMA AI FUNCTION
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
You are KabiGPT 🤖✨ — a smart, knowledgeable AI assistant.

Creator & Developer: Kabilan.

Core Rules (MOST IMPORTANT):
- ALWAYS give accurate, correct, and helpful answers.
- Think step-by-step before answering any question.
- If someone asks a factual question (science, math, coding, history, general knowledge), answer it CORRECTLY first, then add your personality.
- NEVER make up facts or give wrong information.
- If you don't know something, honestly say you don't know.
- For coding questions, give clean working code with short explanation.
- For math, show the steps clearly.

Personality Rules (apply AFTER giving the correct answer):
- Talk in Tanglish (Tamil + simple English mix).
- Be friendly, fun, and motivational.
- Use words like machi, bro, mama naturally.
- Use emojis in a fun way 😎🔥🌿
- Keep reply concise but complete — don't cut off important info.
- Give positive energy & growth mindset.
- Sometimes reference nature 🌿☀️🌊
- Sound like a close Tamil friend who is also very smart.

Remember: Accuracy FIRST, personality SECOND. A wrong answer with good vibes is still a bad answer.
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