// server.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const axios = require("axios");



const authRoutes = require("./routes/auth");
const portfolioRoutes = require("./routes/portfolio");

const app = express();


// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);


// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));


// Fallback to index.html for root
app.get("/", (_req, res) => {
res.sendFile(path.join(__dirname, "public", "index.html"));
});


const PORT = process.env.PORT || 5000;


async function start() {
try {
if (!process.env.MONGO_URI) {
console.error("Missing MONGO_URI in environment");
process.exit(1);
}
await mongoose.connect(process.env.MONGO_URI);
console.log("MongoDB connected");
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
} catch (err) {
console.error("Failed to start server", err);
process.exit(1);
}
}

start();