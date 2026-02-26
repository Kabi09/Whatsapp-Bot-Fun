const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", chatSchema);