// services/prices.js
// Fetch live quotes from free APIs: Alpha Vantage for stocks & mutual funds, CoinGecko for crypto
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 60 }); // 1 minute cache to avoid rate limits


const AV_KEY = process.env.ALPHA_VANTAGE_KEY;
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

async function fetchAlphaVantageQuote(symbol) {
if (!AV_KEY) throw new Error("Missing ALPHA_VANTAGE_KEY");
const url = new URL("https://www.alphavantage.co/query");
url.searchParams.set("function", "GLOBAL_QUOTE");
url.searchParams.set("symbol", symbol);
url.searchParams.set("apikey", AV_KEY);
const res = await fetch(url);
if (!res.ok) throw new Error(`Alpha Vantage error ${res.status}`);
const data = await res.json();
const q = data["Global Quote"] || {};
const price = parseFloat(q["05. price"] || q["05. Price"] || q["05. Price"]) || null;
if (!price) throw new Error("Price not found from Alpha Vantage");
return { symbol, price, currency: FIAT, source: "Alpha Vantage" };
}

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

async function getQuote({ symbol, type }) {
const key = `${type}:${symbol}`.toUpperCase();
const cached = cache.get(key);
if (cached) return cached;


let result;
if (type === "crypto") {
result = await fetchCoinGeckoPrice(symbol);
} else {
// stock or mutual_fund
result = await fetchAlphaVantageQuote(symbol);
}
cache.set(key, result);
return result;
}

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