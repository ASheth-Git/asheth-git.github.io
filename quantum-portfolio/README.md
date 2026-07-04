# Quantum Portfolio — front end

Portfolio optimization presented as what it is physically: a ground-state search on an
Ising/QUBO Hamiltonian, solved by simulated annealing. Theme shared with
[asheth-git.github.io](https://asheth-git.github.io).

## Two modes, one interface

### Demo mode (default) — safe to host publicly
Open `index.html` (or host the folder on GitHub Pages / Netlify / any static host).
The interface runs on a bundled data snapshot and a **textbook single-flip annealer**
written for display purposes. It is intentionally generic: the production constraint
encoding, schedule, and data pipeline are not in this repository.

### Production mode — private demos against the real engine
Set one line in `app.js`:

```js
const CONFIG = { backendURL: "http://127.0.0.1:8000" };
```

The GUI then sends every solve to your backend and only renders the results.
Expected contract:

```
POST {backendURL}/solve
  body: {
    tickers:  ["AAPL", ...],
    dateFrom: "2024-01-01",
    dateTo:   "2024-12-31",
    params:   { K, maxSector, lambda, epochs }
  }
  response: {
    selection: ["AAPL", ...],
    trace:     [E_0, E_1, ...],          // energy per annealing step
    metrics:   { return, vol, sharpe, hhi, maxSector }   // optional
  }
```

Add this route as a thin adapter in front of the existing solver; no solver code
needs to change. If the backend serves on another port, allow CORS for the GUI origin.

## Files

- `index.html` — structure and physics copy (KaTeX-rendered Hamiltonian)
- `app.css` — theme (deep-space black, cyan/orange, Computer Modern + JetBrains Mono)
- `app.js` — UI logic, demo annealer, backend adapter (`CONFIG` at the top)

## Notes

- Demo data is synthetic and labeled as such; nothing here is investment advice.
- Equal weighting is used for displayed metrics in demo mode; production metrics
  come from the engine when provided.
