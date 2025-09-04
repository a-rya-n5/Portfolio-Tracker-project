// routes/portfolio.js
const express = require("express");
const { z } = require("zod");
const auth = require("../middleware/auth");
const Asset = require("../models/Asset");
const { enrichAssetsWithPrices, getQuote } = require("../services/prices");
const axios = require("axios");

const AV_KEY = process.env.ALPHA_VANTAGE_KEY;
const router = express.Router();

// Add asset
const AddSchema = z.object({
  symbol: z.string().min(1),
  type: z.enum(["stock", "mutual_fund", "crypto"]),
  quantity: z.number().positive(),
  buyPrice: z.number().nonnegative()
});

// === Search Route (stocks via Alpha Vantage, crypto via CoinGecko) ===
router.get("/search", async (req, res) => {
  try {
    const keywords = req.query.q;
    const type = req.query.type || "stock"; // default = stock
    if (!keywords) return res.status(400).json({ error: "Missing query" });

    let results = [];

    if (type === "crypto") {
      // CoinGecko search
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(
        keywords
      )}`;
      const response = await axios.get(url);
      const coins = response.data.coins || [];
      results = coins.map((c) => ({
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        region: "Crypto",
        currency: (process.env.CURRENCY || "USD").toUpperCase(),
      }));
    } else {
      // Alpha Vantage SYMBOL_SEARCH
      if (!AV_KEY) return res.status(500).json({ error: "Missing Alpha Vantage API key" });
      const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${keywords}&apikey=${AV_KEY}`;
      const response = await axios.get(url);
      const matches = response.data.bestMatches || [];
      results = matches.map((m) => ({
        symbol: m["1. symbol"],
        name: m["2. name"],
        region: m["4. region"],
        currency: m["8. currency"],
      }));
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || "Search failed" });
  }
});

// === Add Asset ===
router.post("/add", auth, async (req, res) => {
  try {
    const parsed = AddSchema.parse(req.body);
    const asset = await Asset.create({ ...parsed, userId: req.user.id });
    res.status(201).json(asset);
  } catch (err) {
    if (err?.issues)
      return res
        .status(400)
        .json({ error: err.issues[0]?.message || "Invalid input" });
    res.status(500).json({ error: "Failed to add asset" });
  }
});

// === Edit Asset ===
const EditSchema = z.object({
  symbol: z.string().min(1).optional(),
  type: z.enum(["stock", "mutual_fund", "crypto"]).optional(),
  quantity: z.number().positive().optional(),
  buyPrice: z.number().nonnegative().optional()
});

router.put("/:id", auth, async (req, res) => {
  try {
    const updates = EditSchema.parse(req.body);
    const asset = await Asset.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: updates },
      { new: true }
    );
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    res.json(asset);
  } catch (err) {
    if (err?.issues)
      return res
        .status(400)
        .json({ error: err.issues[0]?.message || "Invalid input" });
    res.status(500).json({ error: "Failed to edit asset" });
  }
});

// === Delete Asset ===
router.delete("/:id", auth, async (req, res) => {
  try {
    const asset = await Asset.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });
    if (!asset) return res.status(404).json({ error: "Asset not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete asset" });
  }
});

// === Get Portfolio ===
router.get("/:userId", auth, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id)
      return res.status(403).json({ error: "Forbidden" });

    const assets = await Asset.find({ userId: req.user.id }).sort({
      createdAt: -1
    });
    const enriched = await enrichAssetsWithPrices(assets);

    const totals = enriched.reduce(
      (acc, a) => {
        acc.invested += a.invested || 0;
        acc.currentValue += a.currentValue || 0;
        return acc;
      },
      { invested: 0, currentValue: 0 }
    );

    const net = totals.currentValue - totals.invested;
    const netPct = totals.invested > 0 ? (net / totals.invested) * 100 : 0;

    res.json({
      currency: process.env.CURRENCY || "USD",
      assets: enriched,
      summary: {
        totalInvested: totals.invested,
        totalCurrentValue: totals.currentValue,
        netPnL: net,
        netPnLPct: netPct
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch portfolio" });
  }
});

// === Quote endpoint (for debugging) ===
router.get("/quote/:type/:symbol", auth, async (req, res) => {
  try {
    const { type, symbol } = req.params;
    const quote = await getQuote({ type, symbol });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch quote" });
  }
});

module.exports = router;