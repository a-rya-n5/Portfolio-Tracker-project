// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const User = require("../models/User");


const router = express.Router();


const RegisterSchema = z.object({
email: z.string().email(),
password: z.string().min(6)
});


router.post("/register", async (req, res) => {
try {
const { email, password } = RegisterSchema.parse(req.body);
const existing = await User.findOne({ email });
if (existing) return res.status(409).json({ error: "Email already registered" });
const hash = await bcrypt.hash(password, 10);
const user = await User.create({ email, password: hash });
const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
res.status(201).json({ token, user: { id: user._id, email: user.email } });
} catch (err) {
if (err?.issues) return res.status(400).json({ error: err.issues[0]?.message || "Invalid input" });
res.status(500).json({ error: "Registration failed" });
}
});


const LoginSchema = z.object({
email: z.string().email(),
password: z.string().min(6)
});


router.post("/login", async (req, res) => {
try {
const { email, password } = LoginSchema.parse(req.body);
const user = await User.findOne({ email });
if (!user) return res.status(401).json({ error: "Invalid credentials" });
const ok = await bcrypt.compare(password, user.password);
if (!ok) return res.status(401).json({ error: "Invalid credentials" });
const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
res.json({ token, user: { id: user._id, email: user.email } });
} catch (err) {
if (err?.issues) return res.status(400).json({ error: err.issues[0]?.message || "Invalid input" });
res.status(500).json({ error: "Login failed" });
}
});


module.exports = router;