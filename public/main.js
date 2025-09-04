// public/main.js
const API = "/api";

function fmt(n, currency = "USD") {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}

function pct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function getToken() { return localStorage.getItem("token"); }
function getUser() { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } }

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { localStorage.clear(); window.location.href = "/"; return; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadPortfolio() {
  const user = getUser();
  document.getElementById("user-email").textContent = user?.email || "";
  const data = await api(`/portfolio/${user.id}`);
  renderSummary(data.summary, data.currency);
  renderTable(data.assets, data.currency);
  renderAllocation(data.assets, data.currency);
}

function renderSummary(summary, currency) {
  document.getElementById("total-invested").textContent = fmt(summary.totalInvested, currency);
  document.getElementById("current-value").textContent = fmt(summary.totalCurrentValue, currency);
  const sign = summary.netPnL >= 0 ? "+" : "";
  document.getElementById("net-pnl").innerHTML = `
    <span class="${summary.netPnL >= 0 ? 'text-green-600' : 'text-red-600'} font-semibold">${sign}${fmt(summary.netPnL, currency)}</span>
    <span class="text-gray-500">(${pct(summary.netPnLPct)})</span>`;
}

function tr(a, currency) {
  const row = document.createElement("tr");
  row.className = "border-b hover:bg-gray-50";
  row.innerHTML = `
    <td class="py-2 pr-4 font-semibold">${a.symbol}</td>
    <td class="py-2 pr-4">${a.type.replace('_',' ')}</td>
    <td class="py-2 pr-4">${a.quantity}</td>
    <td class="py-2 pr-4">${fmt(a.buyPrice, currency)}</td>
    <td class="py-2 pr-4">${a.currentPrice ? fmt(a.currentPrice, currency) : '<span class="text-gray-400">n/a</span>'}</td>
    <td class="py-2 pr-4">${fmt(a.invested, currency)}</td>
    <td class="py-2 pr-4">${a.currentValue ? fmt(a.currentValue, currency) : '—'}</td>
    <td class="py-2 pr-4 ${a.pnl >= 0 ? 'text-green-600' : 'text-red-600'}">${a.pnl !== null ? fmt(a.pnl, currency) + ` (${pct(a.pnlPct)})` : '—'}</td>
    <td class="py-2 pr-4 flex gap-2">
      <button data-id="${a._id}" class="btn-sm edit">Edit</button>
      <button data-id="${a._id}" class="btn-sm danger delete">Delete</button>
    </td>`;
  return row;
}

function renderTable(assets, currency) {
  const tbody = document.getElementById("asset-rows");
  tbody.innerHTML = "";
  assets.forEach(a => tbody.appendChild(tr(a, currency)));
  tbody.querySelectorAll(".delete").forEach(btn => btn.addEventListener("click", onDelete));
  tbody.querySelectorAll(".edit").forEach(btn => btn.addEventListener("click", () => onEdit(assets.find(x => x._id === btn.dataset.id))));
}

async function onDelete(e) {
  const id = e.currentTarget.dataset.id;
  if (!confirm("Delete this asset?")) return;
  await api(`/portfolio/${id}`, { method: "DELETE" });
  await loadPortfolio();
}

function onEdit(a) {
  document.getElementById("asset-id").value = a._id;
  document.getElementById("symbol").value = a.symbol;
  document.getElementById("type").value = a.type;
  document.getElementById("quantity").value = a.quantity;
  document.getElementById("buyPrice").value = a.buyPrice;
}

// Form submit (add or edit)
const form = document.getElementById("asset-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("form-error").textContent = "";
  const payload = {
    symbol: document.getElementById("symbol").value.trim().toUpperCase(),
    type: document.getElementById("type").value,
    quantity: Number(document.getElementById("quantity").value),
    buyPrice: Number(document.getElementById("buyPrice").value)
  };
  const id = document.getElementById("asset-id").value;
  try {
    if (id) {
      await api(`/portfolio/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/portfolio/add", { method: "POST", body: JSON.stringify(payload) });
    }
    form.reset();
    document.getElementById("asset-id").value = "";
    await loadPortfolio();
  } catch (err) {
    document.getElementById("form-error").textContent = err.message;
  }
});

// Reset form
document.getElementById("reset-form").addEventListener("click", () => { form.reset(); document.getElementById("asset-id").value = ""; });

// Refresh prices
document.getElementById("refresh").addEventListener("click", loadPortfolio);

// Logout
const logout = document.getElementById("logout");
logout.addEventListener("click", () => { localStorage.clear(); window.location.href = "/"; });

// Allocation chart
let allocChart;
function renderAllocation(assets, currency) {
  const ctx = document.getElementById('allocChart');
  const groups = assets.reduce((acc, a) => {
    const key = a.type;
    acc[key] = (acc[key] || 0) + (a.currentValue || 0);
    return acc;
  }, {});
  const labels = Object.keys(groups).map(k => k.replace('_',' '));
  const values = Object.values(groups);
  if (allocChart) allocChart.destroy();
  allocChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values }] },
    options: { plugins: { legend: { position: 'bottom' }, title: { display: true, text: `Allocation by Type (${currency})` } } }
  });
}

// Guard route: redirect to login if no token
(function init() {
  if (!getToken() || !getUser()) { window.location.href = "/"; return; }
  loadPortfolio().catch(err => alert(err.message));
})();

// === Symbol Search ===
const symbolInput = document.getElementById("symbol");
const typeSelect = document.getElementById("type"); // 👈 grab the asset type dropdown
const suggestionsList = document.getElementById("symbol-suggestions");
let searchTimeout;

if (symbolInput) {
  symbolInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = symbolInput.value.trim();
    if (query.length < 2) {
      suggestionsList.classList.add("hidden");
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const type = typeSelect ? typeSelect.value : "stock"; // pass type to backend
        const res = await fetch(
          `/api/portfolio/search?q=${encodeURIComponent(query)}&type=${type}`
        );
        const results = await res.json();
        suggestionsList.innerHTML = "";

        if (!results || results.length === 0) {
          const li = document.createElement("li");
          li.className = "px-3 py-2 text-gray-500 italic cursor-default";
          li.textContent = "No results found";
          suggestionsList.appendChild(li);
          suggestionsList.classList.remove("hidden");
          return;
        }

        results.forEach((r) => {
          const li = document.createElement("li");
          li.className =
            "px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700";
          li.textContent = `${r.symbol} — ${r.name} (${r.region}, ${r.currency})`;
          li.onclick = () => {
            symbolInput.value = r.symbol;
            suggestionsList.classList.add("hidden");
          };
          suggestionsList.appendChild(li);
        });

        suggestionsList.classList.remove("hidden");
      } catch (err) {
        console.error("Search error", err);
      }
    }, 400); // debounce delay
  });

  // Hide suggestions when clicking outside
  document.addEventListener("click", (e) => {
    if (!suggestionsList.contains(e.target) && e.target !== symbolInput) {
      suggestionsList.classList.add("hidden");
    }
  });
}
