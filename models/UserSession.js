const mongoose = require("mongoose");

const userSessionSchema = new mongoose.Schema(
    {
        phone: { type: String, required: true, unique: true },
        mode: {
            type: String,
            enum: ["menu", "ask", "bill"],
            default: "menu"
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("UserSession", userSessionSchema);
