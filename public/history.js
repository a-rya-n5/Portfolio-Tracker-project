const params = new URLSearchParams(window.location.search);
const symbol = params.get("symbol");

let chart;

// Load history from backend
async function loadHistory() {
  try {
    const range = document.getElementById("range").value;
    const interval = document.getElementById("interval").value;

    const res = await fetch(
      `/api/portfolio/history/${symbol}?range=${range}&interval=${interval}`,
      {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch history");

    // ✅ Ensure history exists
    const history = data.history || [];
    if (!history.length) {
      throw new Error("No historical data available for this symbol");
    }

    // ✅ Sync dropdowns with backend response
    if (data.range) document.getElementById("range").value = data.range;
    if (data.interval) document.getElementById("interval").value = data.interval;

    // Destroy previous chart if exists
    if (chart) chart.destroy();

    const ctx = document.getElementById("historyChart");
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: history.map(d => new Date(d.date).toLocaleDateString()),
        datasets: [
          {
            label: `${symbol} Price`,
            data: history.map(d => d.close),
            borderColor: "#4f46e5",
            backgroundColor: "rgba(79,70,229,0.1)",
            tension: 0.2,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          title: {
            display: true,
            text: `${symbol} Price History (${data.range}, ${data.interval})`
          },
          legend: { display: false }
        },
        scales: {
          x: { display: true, title: { display: true, text: "Date" } },
          y: { display: true, title: { display: true, text: "Price" } }
        }
      }
    });
  } catch (err) {
    console.error("History fetch error:", err);
    document.getElementById("historyChart").replaceWith(
      (() => {
        const p = document.createElement("p");
        p.className = "text-red-600";
        p.textContent = err.message;
        return p;
      })()
    );
  }
}

// Hook dropdown changes
document.getElementById("range").addEventListener("change", loadHistory);
document.getElementById("interval").addEventListener("change", loadHistory);

// Back button - FIX: Changed from index.html to dashboard.html
document.getElementById("back").addEventListener("click", () => {
  window.location.href = "dashboard.html"; // 👈 changed to dashboard.html
});

// Initial load
loadHistory();