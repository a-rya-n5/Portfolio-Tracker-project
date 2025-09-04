// services/prices.js
// Fetch live quotes: Yahoo Finance for stocks & mutual funds, CoinGecko for crypto

const NodeCache = require("node-cache");
const yahooFinance = require("yahoo-finance2").default;
const cache = new NodeCache(); // we'll set per-type TTLs

const FIAT = (process.env.CURRENCY || "USD").toUpperCase();

// Cache TTLs (seconds)
const STOCK_TTL = 900;   // 15 minutes
const CRYPTO_TTL = 60;   // 1 minute

const CRYPTO_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  ADA: "cardano",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  SOL: "solana",
  MATIC: "matic-network",
  LTC: "litecoin"
};

// ---- Fetchers ----

// Yahoo Finance for stocks/mutual funds
async function fetchYahooQuote(symbol) {
  try {
    const quote = await yahooFinance.quote(symbol);
    if (!quote || !quote.regularMarketPrice) {
      throw new Error("Price not found from Yahoo Finance");
    }

    return {
      symbol: symbol.toUpperCase(),
      price: Number(quote.regularMarketPrice),
      currency: quote.currency || FIAT,
      source: "Yahoo Finance"
    };
  } catch (err) {
    throw new Error(`Yahoo Finance error: ${err.message}`);
  }
}

// CoinGecko for crypto
async function fetchCoinGeckoPrice(symbol) {
  const id = CRYPTO_MAP[symbol.toUpperCase()];
  if (!id) throw new Error(`Unsupported crypto symbol: ${symbol}`);

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", id);
  url.searchParams.set("vs_currencies", FIAT.toLowerCase());

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko error ${res.status}`);
  const data = await res.json();

  const price = data?.[id]?.[FIAT.toLowerCase()];
  if (!price) throw new Error("Price not found from CoinGecko");

  return {
    symbol: symbol.toUpperCase(),
    price: Number(price),
    currency: FIAT,
    source: "CoinGecko"
  };
}

// ---- Main quote getter with per-type caching ----
async function getQuote({ symbol, type }) {
  const key = `${type}:${symbol}`.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let result;
  if (type === "crypto") {
    result = await fetchCoinGeckoPrice(symbol);
    cache.set(key, result, CRYPTO_TTL);
  } else {
    result = await fetchYahooQuote(symbol);
    cache.set(key, result, STOCK_TTL);
  }

  return result;
}

// ---- Enrich portfolio assets with prices ----
async function enrichAssetsWithPrices(assets) {
  const results = [];
  for (const a of assets) {
    try {
      const quote = await getQuote({ symbol: a.symbol, type: a.type });
      const currentValue = quote.price * a.quantity;
      const invested = a.buyPrice * a.quantity;
      const pnl = currentValue - invested;
      const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

      results.push({
        ...a.toObject(),
        currentPrice: quote.price,
        currency: quote.currency,
        currentValue,
        invested,
        pnl,
        pnlPct
      });
    } catch (err) {
      results.push({
        ...a.toObject(),
        currentPrice: null,
        error: err.message,
        currency: FIAT,
        currentValue: null,
        invested: a.buyPrice * a.quantity,
        pnl: null,
        pnlPct: null
      });
    }
  }
  return results;
}

module.exports = { getQuote, enrichAssetsWithPrices };
