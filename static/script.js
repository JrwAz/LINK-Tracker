/* ==========================================================================
   LINK Tracker — script.js
   Gère tout le cycle de vie côté client : rendu initial, appels API,
   mise à jour du DOM sans rechargement, sparkline canvas, toasts, polling.
   ========================================================================== */

(function () {
  "use strict";

  const REFRESH_INTERVAL = 30000; // 30s, aligné sur le cache backend

  const el = {
    livePrice: document.getElementById("live-price"),
    changeBadge: document.getElementById("change-badge"),
    sparkline: document.getElementById("sparkline"),
    balance: document.getElementById("balance"),
    depositAmount: document.getElementById("deposit-amount"),
    withdrawAmount: document.getElementById("withdraw-amount"),
    btnDeposit: document.getElementById("btn-deposit"),
    btnWithdraw: document.getElementById("btn-withdraw"),
    goalInput: document.getElementById("goal-input"),
    priceInput: document.getElementById("price-input"),
    goalPreview: document.getElementById("goal-preview-value"),
    btnSettings: document.getElementById("btn-settings"),
    progressFill: document.getElementById("progress-fill"),
    progressPercent: document.getElementById("progress-percent"),
    capitalTarget: document.getElementById("capital-target"),
    remainingCapital: document.getElementById("remaining-capital"),
    linkPossible: document.getElementById("link-possible"),
    remainingTokens: document.getElementById("remaining-tokens"),
    historyList: document.getElementById("history-list"),
    btnReset: document.getElementById("btn-reset"),
    lastUpdateLabel: document.getElementById("last-update-label"),
    toastContainer: document.getElementById("toast-container"),
    quickChips: document.getElementById("quick-chips-deposit"),

    // Simulateur DCA
    dcaAmount: document.getElementById("dca-amount"),
    dcaPrice: document.getElementById("dca-price"),
    dcaTokensPreview: document.getElementById("dca-tokens-preview"),
    btnDcaAdd: document.getElementById("btn-dca-add"),
    dcaTotalInvested: document.getElementById("dca-total-invested"),
    dcaTotalTokens: document.getElementById("dca-total-tokens"),
    dcaAvgPrice: document.getElementById("dca-avg-price"),
    dcaEntriesList: document.getElementById("dca-entries-list"),
    dcaTargetChips: document.getElementById("dca-target-chips"),
    dcaTargetPrice: document.getElementById("dca-target-price"),
    btnDcaTarget: document.getElementById("btn-dca-target"),
    pnlTargetBox: document.getElementById("pnl-target-box"),
    pnlTargetUsd: document.getElementById("pnl-target-usd"),
    pnlTargetPct: document.getElementById("pnl-target-pct"),
    pnlLiveBox: document.getElementById("pnl-live-box"),
    pnlLiveUsd: document.getElementById("pnl-live-usd"),
    pnlLivePct: document.getElementById("pnl-live-pct"),
    btnDcaReset: document.getElementById("btn-dca-reset"),

    // Stats avancées
    statAvgGain: document.getElementById("stat-avg-gain"),
    statPriceStd: document.getElementById("stat-price-std"),
    statVolatility: document.getElementById("stat-volatility"),
    statSharpe: document.getElementById("stat-sharpe"),

    // Graphique
    dcaChart: document.getElementById("dca-chart"),

    // Calcul inverse PNL
    inverseGain: document.getElementById("inverse-gain"),
    btnInverseCalc: document.getElementById("btn-inverse-calc"),
    inverseResult: document.getElementById("inverse-result"),
    inverseTargetPrice: document.getElementById("inverse-target-price"),
    inverseTargetValue: document.getElementById("inverse-target-value"),
    btnApplyInverse: document.getElementById("btn-apply-inverse"),

    // Mode toggle
    modeUsd: document.getElementById("mode-usd"),
    modeLink: document.getElementById("mode-link"),
    dcaTokens: document.getElementById("dca-tokens"),
    dcaPriceLink: document.getElementById("dca-price-link"),

    // Simulateur d'achat
    simCapitalCurrent: document.getElementById("sim-capital-current"),
    simPriceLive: document.getElementById("sim-price-live"),
    buySimAmount: document.getElementById("buy-sim-amount"),
    buySimPrice: document.getElementById("buy-sim-price"),
    btnSimulateBuy: document.getElementById("btn-simulate-buy"),
    buySimResult: document.getElementById("buy-sim-result"),
    simTokensAcquired: document.getElementById("sim-tokens-acquired"),
    simBalanceAfter: document.getElementById("sim-balance-after"),
    portfolioTokens: document.getElementById("portfolio-tokens"),
    portfolioInvested: document.getElementById("portfolio-invested"),
    portfolioAvgPrice: document.getElementById("portfolio-avg-price"),
    portfolioPnl: document.getElementById("portfolio-pnl"),
    portfolioPnlBox: document.getElementById("portfolio-pnl-box"),
    btnSaveSimBuy: document.getElementById("btn-save-sim-buy"),
  };

  let lastSimulation = null; // garde le résultat de la dernière simulation pour l'enregistrement
  let editingSimPrice = false; // évite d'écraser la saisie manuelle du prix pendant le polling

  let state = null;
  let editingSettings = false;  // évite d'écraser la saisie objectif en cours pendant le polling
  let editingDcaTarget = false; // idem pour le champ "prix de revente cible"

  // ------------------------------------------------------------------
  // Utilitaires de formatage
  // ------------------------------------------------------------------

  const fmtUsd = (n) =>
    "$" + Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtToken = (n) =>
    Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " LINK";

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  // ------------------------------------------------------------------
  // Toasts
  // ------------------------------------------------------------------

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(6px)";
      toast.style.transition = ".25s ease";
      setTimeout(() => toast.remove(), 250);
    }, 2600);
  }

  // ------------------------------------------------------------------
  // Sparkline (mini courbe de tendance du prix, sans dépendance externe)
  // ------------------------------------------------------------------

  function drawSparkline(points) {
    const canvas = el.sparkline;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!points || points.length < 2) return;

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const step = w / (points.length - 1);

    ctx.beginPath();
    points.forEach((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / range) * (h - 6) - 3;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, "#2f81f7");
    gradient.addColorStop(1, "#00d4ff");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Point final mis en évidence
    const lastX = (points.length - 1) * step;
    const lastY = h - ((points[points.length - 1] - min) / range) * (h - 6) - 3;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#00d4ff";
    ctx.fill();
  }

  // ------------------------------------------------------------------
  // Rendu principal à partir d'un objet "state" renvoyé par l'API
  // ------------------------------------------------------------------

  function render(data) {
    state = data;

    // Prix
    const priceAvailable = data.live_price > 0;
    el.livePrice.textContent = priceAvailable ? fmtUsd(data.live_price) : "Chargement...";
    el.livePrice.style.opacity = priceAvailable ? "1" : "0.6";
    
    const change = data.change24 || 0;
    el.changeBadge.textContent = (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(2) + "%";
    el.changeBadge.className = "badge " + (priceAvailable ? (change >= 0 ? "up" : "down") : "");
    drawSparkline(data.price_history);

    // Capital
    el.balance.textContent = fmtUsd(data.balance);

    // Objectif (on n'écrase pas la saisie si l'utilisateur est en train d'éditer)
    if (!editingSettings) {
      el.goalInput.value = data.goal_tokens;
      el.priceInput.value = data.target_price;
    }
    updateGoalPreview();

    // Progression
    el.progressFill.style.width = Math.min(data.progress, 100) + "%";
    el.progressPercent.textContent = data.progress.toFixed(2) + "%";
    el.capitalTarget.textContent = fmtUsd(data.capital_target);
    el.remainingCapital.textContent = fmtUsd(data.remaining_capital);

    // Estimation
    el.linkPossible.textContent = fmtToken(data.link_possible);
    el.remainingTokens.textContent = fmtToken(data.remaining_tokens);

    // Historique
    renderHistory(data.history);

    // Simulateur d'achat avec capital réel
    el.simCapitalCurrent.textContent = fmtUsd(data.balance);
    el.simPriceLive.textContent = data.live_price > 0 ? fmtUsd(data.live_price) : "Indisponible";

    // Préremplit le champ prix modifiable avec le prix live, sauf si l'utilisateur est en train de le modifier
    if (!editingSimPrice && data.live_price > 0 && !el.buySimPrice.value) {
      el.buySimPrice.value = data.live_price;
    }

    // Portefeuille réel (achats confirmés)
    el.portfolioTokens.textContent = fmtToken(data.portfolio_tokens || 0);
    el.portfolioInvested.textContent = fmtUsd(data.portfolio_invested || 0);
    el.portfolioAvgPrice.textContent = data.portfolio_avg_price > 0 ? fmtUsd(data.portfolio_avg_price) : "$--";

    if (data.portfolio_tokens > 0 && data.live_price > 0) {
      el.portfolioPnl.textContent =
        (data.portfolio_pnl_usd >= 0 ? "+" : "") + fmtUsd(data.portfolio_pnl_usd) +
        " (" + (data.portfolio_pnl_pct >= 0 ? "+" : "") + data.portfolio_pnl_pct.toFixed(2) + "%)";
      el.portfolioPnlBox.className = "portfolio-stat" + (data.portfolio_pnl_usd >= 0 ? " up" : " down");
    } else {
      el.portfolioPnl.textContent = "$--";
      el.portfolioPnlBox.className = "portfolio-stat";
    }

    // Simulateur DCA
    renderDca(data);

    // Horodatage
    const now = new Date();
    el.lastUpdateLabel.textContent =
      "Mis à jour à " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function renderHistory(history) {
    el.historyList.innerHTML = "";

    if (!history || history.length === 0) {
      const li = document.createElement("li");
      li.className = "history-empty";
      li.textContent = "Aucune transaction pour l'instant.";
      el.historyList.appendChild(li);
      return;
    }

    history.forEach((entry, index) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const isDeposit = entry.type === "deposit";
      const isBuy = entry.type === "buy";
      const iconClass = isDeposit ? "deposit" : (isBuy ? "buy" : "withdraw");
      const icon = isDeposit ? "➕" : (isBuy ? "🛒" : "➖");
      const sign = isDeposit ? "+" : "-";

      const meta = [];
      if (entry.timestamp) meta.push(fmtDate(entry.timestamp));
      if (isBuy && entry.tokens) {
        meta.push(fmtToken(entry.tokens) + " à " + fmtUsd(entry.price));
      }
      if (entry.balance_after !== null && entry.balance_after !== undefined) {
        meta.push("solde " + fmtUsd(entry.balance_after));
      }

      li.innerHTML = `
        <div class="left">
          <div class="history-icon ${iconClass}">
            ${icon}
          </div>
          <div>
            <div class="history-amount ${iconClass}">
              ${sign} ${fmtUsd(entry.amount)}
            </div>
            <div class="history-meta">${meta.join(" · ")}</div>
          </div>
        </div>
        <button class="history-delete" data-index="${index}" title="Supprimer">✕</button>
      `;

      el.historyList.appendChild(li);
    });
  }

  function renderDca(data) {
    // Stats globales
    el.dcaTotalInvested.textContent = fmtUsd(data.dca_total_invested);
    el.dcaTotalTokens.textContent = fmtToken(data.dca_total_tokens);
    el.dcaAvgPrice.textContent = data.dca_avg_price > 0 ? fmtUsd(data.dca_avg_price) : "$--";

    // Liste des achats simulés
    el.dcaEntriesList.innerHTML = "";
    const entries = data.dca_entries || [];

    if (entries.length === 0) {
      const li = document.createElement("li");
      li.className = "history-empty";
      li.textContent = "Aucun achat simulé pour l'instant.";
      el.dcaEntriesList.appendChild(li);
    } else {
      const maxAmount = Math.max(...entries.map((e) => e.amount));
      const avg = data.dca_avg_price;

      entries.forEach((entry, index) => {
        const li = document.createElement("li");
        li.className = "dca-entry";

        const belowAvg = avg > 0 && entry.price <= avg;
        const barWidth = maxAmount > 0 ? Math.max((entry.amount / maxAmount) * 100, 6) : 0;

        li.innerHTML = `
          <div class="dca-entry-top">
            <div class="dca-entry-info">
              <b>${fmtUsd(entry.amount)}</b> à <b>${fmtUsd(entry.price)}</b>
              <div class="dca-entry-meta">
                ≈ ${fmtToken(entry.tokens)} ${entry.timestamp ? "· " + fmtDate(entry.timestamp) : ""}
              </div>
            </div>
            <button class="history-delete" data-index="${index}" title="Supprimer">✕</button>
          </div>
          <div class="dca-entry-bar-track">
            <div class="dca-entry-bar ${belowAvg ? "below-avg" : "above-avg"}" style="width:${barWidth}%;"></div>
          </div>
        `;

        el.dcaEntriesList.appendChild(li);
      });
    }

    // Champ prix cible (on n'écrase pas la saisie en cours)
    if (!editingDcaTarget) {
      el.dcaTargetPrice.value = data.dca_target_price > 0 ? data.dca_target_price : "";
    }

    // PNL au prix cible
    const hasTarget = data.dca_target_price > 0 && data.dca_total_tokens > 0;
    el.pnlTargetUsd.textContent = hasTarget ? fmtUsd(data.dca_pnl_target_usd) : "--";
    el.pnlTargetPct.textContent = hasTarget ? (data.dca_pnl_target_pct >= 0 ? "+" : "") + data.dca_pnl_target_pct.toFixed(2) + "%" : "--%";
    el.pnlTargetBox.className = "pnl-box" + (hasTarget ? (data.dca_pnl_target_usd >= 0 ? " up" : " down") : "");

    // PNL latent au prix live
    const hasLive = data.live_price > 0 && data.dca_total_tokens > 0;
    if (hasLive) {
      el.pnlLiveUsd.textContent = fmtUsd(data.dca_pnl_live_usd);
      el.pnlLivePct.textContent = (data.dca_pnl_live_pct >= 0 ? "+" : "") + data.dca_pnl_live_pct.toFixed(2) + "%";
      el.pnlLiveBox.className = "pnl-box" + (data.dca_pnl_live_usd >= 0 ? " up" : " down");
    } else if (data.dca_total_tokens > 0) {
      el.pnlLiveUsd.textContent = "Chargement du prix...";
      el.pnlLivePct.textContent = "--";
      el.pnlLiveBox.className = "pnl-box";
      el.pnlLiveBox.style.opacity = "0.6";
    } else {
      el.pnlLiveUsd.textContent = "--";
      el.pnlLivePct.textContent = "--%";
      el.pnlLiveBox.className = "pnl-box";
      el.pnlLiveBox.style.opacity = "1";
    }

    // Stats avancées
    el.statAvgGain.textContent = data.dca_avg_gain_per_trade > 0 ? fmtUsd(data.dca_avg_gain_per_trade) : "$--";
    el.statPriceStd.textContent = data.dca_price_std > 0 ? fmtUsd(data.dca_price_std) : "$--";
    el.statVolatility.textContent = data.dca_volatility > 0 ? (data.dca_volatility * 100).toFixed(2) + "%" : "--";
    el.statSharpe.textContent = data.dca_sharpe !== undefined && data.dca_sharpe !== null ? data.dca_sharpe.toFixed(2) : "--";

    // Graphique 24h
    drawDcaChart(data);
  }

  function updateDcaPreview() {
    const amount = parseFloat(el.dcaAmount.value) || 0;
    const price = parseFloat(el.dcaPrice.value) || 0;
    el.dcaTokensPreview.textContent = price > 0 ? "≈ " + fmtToken(amount / price) : "≈ -- LINK";
  }

  function updateGoalPreview() {
    const goal = parseFloat(el.goalInput.value) || 0;
    const price = parseFloat(el.priceInput.value) || 0;
    el.goalPreview.textContent = fmtUsd(goal * price);
  }

  // ------------------------------------------------------------------
  // Appels API
  // ------------------------------------------------------------------

  async function apiCall(url, body) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Une erreur est survenue.", "error");
        return null;
      }
      return data;
    } catch (err) {
      showToast("Connexion au serveur impossible.", "error");
      return null;
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (res.ok) render(data);
    } catch (err) {
      /* silencieux : on garde le dernier état affiché */
    }
  }

  // ------------------------------------------------------------------
  // Actions utilisateur
  // ------------------------------------------------------------------

  async function doDeposit(amount) {
    if (!amount || amount <= 0) {
      showToast("Entre un montant valide.", "error");
      return;
    }
    const data = await apiCall("/api/deposit", { amount });
    if (data) {
      render(data);
      el.depositAmount.value = "";
      showToast(`+${fmtUsd(amount)} ajouté au capital.`, "success");
    }
  }

  async function doWithdraw(amount) {
    if (!amount || amount <= 0) {
      showToast("Entre un montant valide.", "error");
      return;
    }
    const data = await apiCall("/api/withdraw", { amount });
    if (data) {
      render(data);
      el.withdrawAmount.value = "";
      showToast(`-${fmtUsd(amount)} retiré du capital.`, "success");
    }
  }

  el.btnDeposit.addEventListener("click", () => doDeposit(parseFloat(el.depositAmount.value)));
  el.btnWithdraw.addEventListener("click", () => doWithdraw(parseFloat(el.withdrawAmount.value)));

  [el.depositAmount, el.withdrawAmount].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        input === el.depositAmount
          ? doDeposit(parseFloat(el.depositAmount.value))
          : doWithdraw(parseFloat(el.withdrawAmount.value));
      }
    });
  });

  el.quickChips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    doDeposit(parseFloat(btn.dataset.amount));
  });

  el.goalInput.addEventListener("input", () => {
    editingSettings = true;
    updateGoalPreview();
  });
  el.priceInput.addEventListener("input", () => {
    editingSettings = true;
    updateGoalPreview();
  });

  el.btnSettings.addEventListener("click", async () => {
    const goal = parseFloat(el.goalInput.value);
    const price = parseFloat(el.priceInput.value);
    if (!goal || goal <= 0 || !price || price <= 0) {
      showToast("Objectif et prix doivent être positifs.", "error");
      return;
    }
    const data = await apiCall("/api/settings", { goal, price });
    if (data) {
      editingSettings = false;
      render(data);
      showToast("Objectif mis à jour.", "success");
    }
  });

  el.historyList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".history-delete");
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    const data = await apiCall("/api/history/delete", { index });
    if (data) {
      render(data);
      showToast("Entrée supprimée.", "success");
    }
  });

  // -- Ajout d'un achat simulé --
  [el.dcaAmount, el.dcaPrice].forEach((input) => {
    input.addEventListener("input", updateDcaPreview);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doDcaAdd();
    });
  });

  async function doDcaAdd() {
    const amount = parseFloat(el.dcaAmount.value);
    const price = parseFloat(el.dcaPrice.value);
    if (!amount || amount <= 0 || !price || price <= 0) {
      showToast("Montant et prix doivent être positifs.", "error");
      return;
    }
    const data = await apiCall("/api/dca/add", { amount, price });
    if (data) {
      render(data);
      el.dcaAmount.value = "";
      el.dcaPrice.value = "";
      el.dcaTokensPreview.textContent = "≈ -- LINK";
      showToast(`Achat simulé ajouté : ${fmtUsd(amount)} à ${fmtUsd(price)}.`, "success");
    }
  }

  el.btnDcaAdd.addEventListener("click", doDcaAdd);

  // -- Suppression d'un achat simulé --
  el.dcaEntriesList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".history-delete");
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    const data = await apiCall("/api/dca/delete", { index });
    if (data) {
      render(data);
      showToast("Achat supprimé de la simulation.", "success");
    }
  });

  // -- Prix de revente cible : saisie manuelle + chips rapides --
  el.dcaTargetPrice.addEventListener("input", () => {
    editingDcaTarget = true;
  });
  el.dcaTargetPrice.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doDcaTarget(parseFloat(el.dcaTargetPrice.value));
  });

  async function doDcaTarget(price) {
    if (!price || price <= 0) {
      showToast("Entre un prix de revente valide.", "error");
      return;
    }
    const data = await apiCall("/api/dca/target", { price });
    if (data) {
      editingDcaTarget = false;
      render(data);
      showToast(`Simulation mise à jour au prix de ${fmtUsd(price)}.`, "success");
    }
  }

  el.btnDcaTarget.addEventListener("click", () => doDcaTarget(parseFloat(el.dcaTargetPrice.value)));

  el.dcaTargetChips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn || !state) return;

    let target = null;
    if (btn.dataset.mode === "live") {
      target = state.live_price;
    } else if (btn.dataset.pct) {
      if (!state.dca_avg_price || state.dca_avg_price <= 0) {
        showToast("Ajoute au moins un achat simulé pour calculer le PRU.", "error");
        return;
      }
      target = state.dca_avg_price * (1 + parseFloat(btn.dataset.pct) / 100);
    }

    if (target && target > 0) {
      el.dcaTargetPrice.value = target.toFixed(4);
      doDcaTarget(target);
    }
  });

  // -- Réinitialisation de la simulation DCA --
  el.btnDcaReset.addEventListener("click", async () => {
    if (!confirm("Réinitialiser la simulation DCA (tous les achats simulés et le prix cible) ?")) return;
    const data = await apiCall("/api/dca/reset", {});
    if (data) {
      render(data);
      showToast("Simulation DCA réinitialisée.", "success");
    }
  });

  el.btnReset.addEventListener("click", async () => {
    if (!confirm("Réinitialiser le solde et tout l'historique ? Cette action est irréversible.")) return;
    const data = await apiCall("/api/reset", {});
    if (data) {
      render(data);
      showToast("Tracker réinitialisé.", "success");
    }
  });

  // ------------------------------------------------------------------
  // Initialisation
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Graphique DCA — PRU vs Prix live (24h)
  // ------------------------------------------------------------------

  function drawDcaChart(data) {
    const ctx = el.dcaChart.getContext("2d");
    const priceHistory = data.price_history || [];
    const pru = data.dca_avg_price || 0;

    if (priceHistory.length < 1 || pru <= 0) {
      ctx.clearRect(0, 0, el.dcaChart.width, el.dcaChart.height);
      return;
    }

    const prices = priceHistory.map((p) => (typeof p === "object" ? p.price : p));
    const minPrice = Math.min(...prices, pru * 0.95);
    const maxPrice = Math.max(...prices, pru * 1.05);
    const priceRange = maxPrice - minPrice || 1;

    const w = el.dcaChart.width;
    const h = el.dcaChart.height;
    const padding = 40;

    ctx.clearRect(0, 0, w, h);

    // Fond et grille
    ctx.fillStyle = "rgba(255,255,255,.01)";
    ctx.fillRect(padding, padding, w - padding * 1.5, h - padding * 1.5);

    // Ligne PRU horizontale
    const pruY = padding + ((maxPrice - pru) / priceRange) * (h - padding * 1.5);
    ctx.strokeStyle = "rgba(248,81,73,.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(padding, pruY);
    ctx.lineTo(w - padding * 0.5, pruY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Courbe des prix live
    ctx.beginPath();
    prices.forEach((price, i) => {
      const x = padding + (i / (prices.length - 1)) * (w - padding * 1.5);
      const y = padding + ((maxPrice - price) / priceRange) * (h - padding * 1.5);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const gradient = ctx.createLinearGradient(0, padding, 0, h);
    gradient.addColorStop(0, "rgba(47,129,247,.6)");
    gradient.addColorStop(1, "rgba(0,212,255,.1)");
    ctx.strokeStyle = "rgba(47,129,247,.8)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Axes et labels
    ctx.fillStyle = "rgba(139,150,165,.6)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(fmtUsd(maxPrice), padding - 5, padding + 10);
    ctx.fillText(fmtUsd(minPrice), padding - 5, h - padding * 0.5 + 4);
    ctx.textAlign = "center";
    ctx.fillText("PRU: " + fmtUsd(pru), w / 2, h - 10);
  }

  // ------------------------------------------------------------------
  // Calcul inverse PNL
  // ------------------------------------------------------------------

  async function doInverseCalc() {
    const desiredGain = parseFloat(el.inverseGain.value);
    if (!desiredGain || isNaN(desiredGain)) {
      showToast("Entre un gain souhaité valide.", "error");
      return;
    }

    const data = await apiCall("/api/dca/inverse-pnl", { gain_usd: desiredGain });
    if (data) {
      const targetPrice = data.dca_target_price || 0;
      const targetValue = data.dca_value_at_target || 0;

      el.inverseTargetPrice.textContent = targetPrice > 0 ? fmtUsd(targetPrice) : "$--";
      el.inverseTargetValue.textContent = targetValue > 0 ? fmtUsd(targetValue) : "$--";
      el.inverseResult.classList.remove("hidden");

      showToast("Calcul terminé. Prix cible : " + fmtUsd(targetPrice), "success");
    }
  }

  el.btnInverseCalc.addEventListener("click", doInverseCalc);
  el.inverseGain.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doInverseCalc();
  });

  el.btnApplyInverse.addEventListener("click", async () => {
    const targetPrice = parseFloat(el.inverseTargetPrice.textContent.replace("$", "").replace(",", "."));
    if (targetPrice > 0) {
      await doDcaTarget(targetPrice);
      el.dcaTargetPrice.value = targetPrice.toFixed(4);
      el.inverseGain.value = "";
      el.inverseResult.classList.add("hidden");
    }
  });

  // ------------------------------------------------------------------
  // Mode toggle USD/LINK
  // ------------------------------------------------------------------

  const modeToggleBtns = document.querySelectorAll(".dca-mode-switch .mode-btn");
  modeToggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeToggleBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const mode = btn.dataset.mode;
      if (mode === "usd") {
        el.modeUsd.style.display = "block";
        el.modeLink.style.display = "none";
      } else {
        el.modeUsd.style.display = "none";
        el.modeLink.style.display = "block";
      }
    });
  });

  // Preview pour mode LINK
  [el.dcaTokens, el.dcaPriceLink].forEach((input) => {
    if (input) {
      input.addEventListener("input", () => {
        const tokens = parseFloat(el.dcaTokens.value) || 0;
        const price = parseFloat(el.dcaPriceLink.value) || 0;
        el.dcaTokensPreview.textContent =
          price > 0 ? "≈ " + fmtUsd(tokens * price) : "≈ $-- investi";
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          if (el.modeLink.style.display !== "none") {
            doDcaAddLink();
          }
        }
      });
    }
  });

  async function doDcaAddLink() {
    const tokens = parseFloat(el.dcaTokens.value);
    const price = parseFloat(el.dcaPriceLink.value);
    if (!tokens || tokens <= 0 || !price || price <= 0) {
      showToast("Quantité et prix doivent être positifs.", "error");
      return;
    }
    const data = await apiCall("/api/dca/add", { tokens, price });
    if (data) {
      render(data);
      el.dcaTokens.value = "";
      el.dcaPriceLink.value = "";
      el.dcaTokensPreview.textContent = "≈ $-- investi";
      showToast(`Achat simulé : ${fmtToken(tokens)} à ${fmtUsd(price)}.`, "success");
    }
  }

  // Override du btn-dca-add pour gérer les deux modes
  el.btnDcaAdd.removeEventListener("click", doDcaAdd);
  el.btnDcaAdd.addEventListener("click", () => {
    if (el.modeUsd.style.display !== "none") {
      doDcaAdd();
    } else {
      doDcaAddLink();
    }
  });

  // -- Simulateur d'achat avec capital réel --
  el.buySimPrice.addEventListener("input", () => {
    editingSimPrice = true;
  });

  async function doSimulateBuy() {
    const amount = parseFloat(el.buySimAmount.value);
    if (!amount || amount <= 0) {
      showToast("Entre un montant valide.", "error");
      return;
    }

    const manualPrice = parseFloat(el.buySimPrice.value);
    const body = { amount };
    if (manualPrice && manualPrice > 0) {
      body.price = manualPrice;
    }

    const data = await apiCall("/api/simulate-buy", body);
    if (data) {
      lastSimulation = { amount: data.amount_to_invest, price: data.used_price };

      el.simTokensAcquired.textContent = fmtToken(data.tokens_acquired);
      el.simBalanceAfter.textContent = fmtUsd(data.remaining_balance);
      el.buySimResult.classList.remove("hidden");

      // Si le champ prix était vide, on le préremplit avec le prix utilisé pour info
      if (!el.buySimPrice.value) {
        el.buySimPrice.value = data.used_price;
      }

      showToast(`Simulation : ${fmtToken(data.tokens_acquired)} à ${fmtUsd(data.used_price)}.`, "success");
    }
  }

  el.btnSimulateBuy.addEventListener("click", doSimulateBuy);
  el.buySimAmount.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSimulateBuy();
  });
  [el.buySimAmount, el.buySimPrice].forEach((input) => {
    input.addEventListener("input", () => {
      // Cache le résultat précédent tant qu'on n'a pas relancé la simulation
      el.buySimResult.classList.add("hidden");
      lastSimulation = null;
    });
  });

  // -- Enregistrer la simulation comme achat RÉEL (déduit du capital) --
  el.btnSaveSimBuy.addEventListener("click", async () => {
    if (!lastSimulation) {
      showToast("Relance d'abord une simulation.", "error");
      return;
    }
    const data = await apiCall("/api/buy", { amount: lastSimulation.amount, price: lastSimulation.price });
    if (data) {
      render(data);
      editingSimPrice = false;
      el.buySimResult.classList.add("hidden");
      el.buySimAmount.value = "";
      el.buySimPrice.value = "";
      showToast(`Achat enregistré : ${fmtToken(data.balance !== undefined ? lastSimulation.amount / lastSimulation.price : 0)} — capital déduit.`, "success");
      lastSimulation = null;
    }
  });

  function init() {
    const initialDataEl = document.getElementById("initial-data");
    if (initialDataEl) {
      try {
        render(JSON.parse(initialDataEl.textContent));
      } catch (e) {
        refreshStatus();
      }
    } else {
      refreshStatus();
    }

    // Refresh immédiat du prix au démarrage (pour éviter le cache vide)
    setTimeout(() => refreshStatus(), 1000);

    // Polling régulier
    setInterval(() => {
      if (!editingSettings && !editingDcaTarget) refreshStatus();
    }, REFRESH_INTERVAL);
  }

  init();
})();
