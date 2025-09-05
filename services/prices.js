// services/prices.js
// Fetch live quotes from free APIs: Yahoo Finance for stocks/mutual funds/commodities, CoinGecko for crypto
const NodeCache = require("node-cache");
const yahooFinance = require("yahoo-finance2").default; // install: npm install yahoo-finance2
const cache = new NodeCache({ stdTTL: 60 }); // 1 minute cache to avoid rate limits

const FIAT = (process.env.CURRENCY || "USD").toUpperCase();

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

// ✅ Yahoo Finance fetcher (works for stocks, mutual funds, commodities like GC=F for gold)
async function fetchYahooQuote(symbol) {
  try {
    const q = await yahooFinance.quote(symbol);
    if (!q || !q.regularMarketPrice) throw new Error("Price not found from Yahoo Finance");
    return {
      symbol,
      price: Number(q.regularMarketPrice),
      currency: q.currency || FIAT,
      source: "Yahoo Finance"
    };
  } catch (err) {
    throw new Error(`Yahoo Finance error: ${err.message}`);
  }
}

// ✅ CoinGecko fetcher for crypto
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
  return { symbol: symbol.toUpperCase(), price: Number(price), currency: FIAT, source: "CoinGecko" };
}

// ✅ Main getQuote
async function getQuote({ symbol, type }) {
  const key = `${type}:${symbol}`.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let result;
  if (type === "crypto") {
    result = await fetchCoinGeckoPrice(symbol);
  } else if (["stock", "mutual_fund", "commodity"].includes(type)) {
    result = await fetchYahooQuote(symbol);
  } else {
    throw new Error(`Unsupported asset type: ${type}`);
  }

  cache.set(key, result);
  return result;
}

// ✅ Enrich assets with prices, PnL, etc.
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
