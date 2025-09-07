const express = require("express");
const { z } = require("zod");
const auth = require("../middleware/auth");
const Asset = require("../models/Asset");
const { enrichAssetsWithPrices, getQuote } = require("../services/prices");
const axios = require("axios");
const yahooFinance = require("yahoo-finance2").default;

const router = express.Router();

// Add asset
const AddSchema = z.object({
  symbol: z.string().min(1),
  type: z.enum(["stock", "mutual_fund", "crypto", "commodity"]),
  quantity: z.number().positive(),
  buyPrice: z.number().nonnegative()
});

// === Search endpoint ===
router.get("/search", async (req, res) => {
  try {
    const keywords = req.query.q;
    const type = req.query.type || "stock"; // default to stock
    if (!keywords) return res.status(400).json({ error: "Missing query" });

    let results = [];

    if (type === "crypto") {
      // 🔹 CoinGecko search for crypto
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
      // 🔹 Yahoo Finance search for stocks / mutual funds / commodities
      const searchResults = await yahooFinance.search(keywords).catch(() => ({ quotes: [] }));
      const matches = searchResults.quotes || [];
      const seen = new Set();
      results = matches
        .filter((m) => {
          if (!m.symbol || seen.has(m.symbol)) return false;
          seen.add(m.symbol);
          return true;
        })
        .map((m) => ({
          symbol: m.symbol,
          name: m.shortname || m.longname || m.symbol,
          region: m.quoteType || m.exchange || "Unknown",
          currency: m.currency || (process.env.CURRENCY || "USD"),
        }));
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || "Search failed" });
  }
});

// === Add asset ===
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

// === Edit asset ===
const EditSchema = z.object({
  symbol: z.string().min(1).optional(),
  type: z.enum(["stock", "mutual_fund", "crypto", "commodity"]).optional(),
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

// === Delete asset ===
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

// === Get portfolio ===
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

// === History endpoint (robust) ===
router.get("/history/:symbol", auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    let range = (req.query.range || "6mo").toString();
    let interval = (req.query.interval || "1d").toString();

    // Allowed sets
    const VALID_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "5y", "max"]);
    const VALID_INTERVALS = new Set(["1d", "1wk", "1mo"]);

    // Normalize invalid values
    if (!VALID_RANGES.has(range)) range = "6mo";
    if (!VALID_INTERVALS.has(interval)) interval = "1d";

    // helper: compute period1/period2 dates for fallback
    function computePeriod(rangeKey) {
      const end = new Date();
      let start = new Date(end);
      switch (rangeKey) {
        case "1mo": start.setMonth(end.getMonth() - 1); break;
        case "3mo": start.setMonth(end.getMonth() - 3); break;
        case "6mo": start.setMonth(end.getMonth() - 6); break;
        case "1y":  start.setFullYear(end.getFullYear() - 1); break;
        case "5y":  start.setFullYear(end.getFullYear() - 5); break;
        case "max": start = new Date(2000, 0, 1); break;
        default:    start.setMonth(end.getMonth() - 6);
      }
      return { period1: start, period2: end };
    }

    // try chart(range, interval) first
    let result;
    let usedRange = range;
    let usedInterval = interval;
    let quotes = [];

    try {
      result = await yahooFinance.chart(symbol, { range, interval });
    } catch (errChart) {
      // fallback: compute period1/period2 and retry
      const { period1, period2 } = computePeriod(range);
      result = await yahooFinance.chart(symbol, { period1, period2, interval });
      // set usedRange to the computed actual dates for frontend clarity
      usedRange = undefined; // not using range shorthand now
      usedInterval = interval;
    }

    // Parse result into a consistent quotes array
    if (result && Array.isArray(result.quotes) && result.quotes.length) {
      quotes = result.quotes;
    } else if (result && result.chart && Array.isArray(result.chart.result) && result.chart.result[0]) {
      // low-level chart result shape -> build quotes
      const r0 = result.chart.result[0];
      const timestamps = r0.timestamp || [];
      const quoteIndicators = (r0.indicators && r0.indicators.quote && r0.indicators.quote[0]) || {};
      const opens = quoteIndicators.open || [];
      const closes = quoteIndicators.close || [];
      const highs = quoteIndicators.high || [];
      const lows = quoteIndicators.low || [];
      const volumes = quoteIndicators.volume || [];

      quotes = timestamps.map((ts, i) => ({
        date: new Date(ts * 1000),
        open: opens[i] ?? null,
        close: closes[i] ?? null,
        high: highs[i] ?? null,
        low: lows[i] ?? null,
        volume: volumes[i] ?? null
      }));
    } else {
      // no data
      return res.status(404).json({ error: "No historical data found", range: usedRange, interval: usedInterval, history: [] });
    }

    // Normalize quotes into history records
    const history = quotes
      .filter(q => q && (q.close !== undefined && q.close !== null || q.price !== undefined)) // ensure meaningful entries
      .map(q => ({
        date: q.date instanceof Date ? q.date : new Date(q.date),
        open: q.open ?? null,
        close: (q.close ?? q.price) ?? null,
        high: q.high ?? null,
        low: q.low ?? null,
        volume: q.volume ?? null
      }));

    res.json({
      range: usedRange,
      interval: usedInterval,
      history
    });
  } catch (err) {
    console.error("History fetch error:", err && err.stack ? err.stack : err);
    res.status(500).json({ error: err.message || "Failed to fetch history" });
  }
});

module.exports = router;