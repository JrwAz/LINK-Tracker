"""
LINK Tracker — v3.0 "Premium"
--------------------------------
Suivi d'objectif d'accumulation de capital pour l'achat de Chainlink (LINK).

Nouveautés v3 :
- API JSON (/api/*) consommée en AJAX par le frontend -> plus de rechargement
  de page complet, tout se met à jour en direct (prix, solde, progression).
- Cache du prix LINK (TTL 30s) pour ne pas spammer l'API CoinGecko à chaque
  requête utilisateur / auto-refresh.
- Historique enrichi : chaque entrée garde son type, son montant, le solde
  après opération et un horodatage. Suppression individuelle possible.
- Migration automatique de l'ancien format d'historique (simples strings)
  vers le nouveau format objet, sans perte de données.
- Historique du prix LINK (sparkline) : à chaque appel réel à l'API (hors
  cache), on garde un point d'historique (jusqu'à 60 points) pour tracer une
  mini-courbe de tendance côté frontend.
- Validation stricte des entrées utilisateur (montants positifs, JSON propre,
  réponses d'erreur explicites) au lieu de laisser planter la route.
- Endpoint /api/reset pour repartir de zéro (avec confirmation côté client).
"""

from flask import Flask, render_template, request, jsonify
import requests
import json
import os
import time
from datetime import datetime
from threading import Lock

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
DATA_LOCK = Lock()  # évite les écritures concurrentes sur data.json

DEFAULT_DATA = {
    "goal_tokens": 1500,
    "target_price": 7.5,
    "balance": 0,
    "history": [],
    "price_history": [],
    "dca_entries": [],
    "dca_target_price": 0
}

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=chainlink&vs_currencies=usd&include_24hr_change=true"
)

CACHE_TTL = 30          # secondes avant de re-taper l'API CoinGecko
MAX_HISTORY = 200       # nombre max d'entrées de transactions conservées
MAX_PRICE_POINTS = 96   # 96 points = 1 pt toutes les 15 min sur 24h
MAX_DCA_ENTRIES = 500   # nombre max d'achats simulés conservés

_price_cache = {"price": 0.0, "change24": 0.0, "timestamp": 0.0}


# ----------------------------------------------------------------------
# Persistance
# ----------------------------------------------------------------------

def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            data = DEFAULT_DATA.copy()
    else:
        data = DEFAULT_DATA.copy()

    # Complète les clés manquantes (nouvelles versions du fichier)
    for key, value in DEFAULT_DATA.items():
        data.setdefault(key, value.copy() if isinstance(value, list) else value)

    # Migration : anciennes entrées d'historique "+ 100.00 $" -> objets
    migrated = []
    for entry in data["history"]:
        if isinstance(entry, str):
            is_deposit = entry.strip().startswith("+")
            cleaned = entry.replace("+", "").replace("-", "").replace("$", "").strip()
            try:
                amount = float(cleaned)
            except ValueError:
                amount = 0.0
            migrated.append({
                "type": "deposit" if is_deposit else "withdraw",
                "amount": amount,
                "balance_after": None,
                "timestamp": None
            })
        else:
            migrated.append(entry)
    data["history"] = migrated

    return data


def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


# ----------------------------------------------------------------------
# Prix LINK (avec cache + historique pour la sparkline)
# ----------------------------------------------------------------------

def get_link_price():
    """
    Récupère le prix LINK via CoinGecko avec cache.
    Fallback : retourne la dernière valeur connue en cas d'erreur réseau.
    """
    now = time.time()
    is_fresh = (now - _price_cache["timestamp"]) < CACHE_TTL

    if is_fresh and _price_cache["timestamp"] > 0:
        return _price_cache["price"], _price_cache["change24"], False

    try:
        r = requests.get(COINGECKO_URL, timeout=5).json()
        price = float(r["chainlink"]["usd"])
        change = float(r["chainlink"]["usd_24h_change"])
        _price_cache.update({"price": price, "change24": change, "timestamp": now})
        return price, change, True
    except Exception as e:
        # En cas d'erreur réseau, on retombe sur la dernière valeur connue
        if _price_cache["timestamp"] > 0:
            return _price_cache["price"], _price_cache["change24"], False
        # Si aucune valeur en cache du tout, retour neutre (0, 0)
        return 0.0, 0.0, False


def record_price_point(data, price):
    """Ajoute un point à l'historique de prix (utilisé pour la sparkline)."""
    if price <= 0:
        return
    data["price_history"].append({
        "price": price,
        "timestamp": datetime.now().isoformat(timespec="seconds")
    })
    data["price_history"] = data["price_history"][-MAX_PRICE_POINTS:]


# ----------------------------------------------------------------------
# Calculs
# ----------------------------------------------------------------------

def compute_stats(data, live_price):
    capital_target = data["goal_tokens"] * data["target_price"]

    progress = 0.0
    if capital_target > 0:
        progress = round(min(data["balance"] / capital_target * 100, 100), 2)

    link_possible = 0.0
    if live_price > 0:
        link_possible = round(data["balance"] / live_price, 4)

    remaining_tokens = round(max(data["goal_tokens"] - link_possible, 0), 4)
    remaining_capital = round(max(capital_target - data["balance"], 0), 2)

    return {
        "capital_target": round(capital_target, 2),
        "progress": progress,
        "link_possible": link_possible,
        "remaining_tokens": remaining_tokens,
        "remaining_capital": remaining_capital
    }


def compute_dca_stats(data, live_price):
    """
    Calcule le prix de revient moyen pondéré (PRU) à partir des achats
    simulés, puis projette le PNL au prix cible saisi et au prix live
    actuel (PNL latent, non réalisé).
    
    Ajoute aussi les stats avancées :
    - Écart-type des prix d'achat
    - Volatilité (écart-type des rendements sur l'historique 24h)
    - Ratio Sharpe
    """
    entries = data["dca_entries"]

    total_invested = round(sum(e["amount"] for e in entries), 2)
    total_tokens = round(sum(e["tokens"] for e in entries), 6)
    avg_price = round(total_invested / total_tokens, 6) if total_tokens > 0 else 0.0

    target = data.get("dca_target_price") or 0.0

    value_at_target = round(total_tokens * target, 2) if target > 0 else 0.0
    pnl_target_usd = round(value_at_target - total_invested, 2) if target > 0 else 0.0
    pnl_target_pct = round((target / avg_price - 1) * 100, 2) if (avg_price > 0 and target > 0) else 0.0

    value_at_live = round(total_tokens * live_price, 2) if live_price > 0 else 0.0
    pnl_live_usd = round(value_at_live - total_invested, 2) if live_price > 0 else 0.0
    pnl_live_pct = round((live_price / avg_price - 1) * 100, 2) if (avg_price > 0 and live_price > 0) else 0.0

    # Stats avancées
    avg_gain_per_trade = round(total_invested / len(entries), 2) if len(entries) > 0 else 0.0
    
    # Écart-type des prix d'achat
    if len(entries) > 1:
        prices = [e["price"] for e in entries]
        mean_price = sum(prices) / len(prices)
        variance = sum((p - mean_price) ** 2 for p in prices) / len(prices)
        price_std = round(variance ** 0.5, 6)
    else:
        price_std = 0.0

    # Volatilité : écart-type des rendements sur l'historique 24h
    volatility = 0.0
    if len(data["price_history"]) > 1:
        prices_hist = [p["price"] for p in data["price_history"]]
        returns = [(prices_hist[i] / prices_hist[i-1] - 1) * 100 
                   for i in range(1, len(prices_hist))]
        if returns:
            mean_return = sum(returns) / len(returns)
            var_returns = sum((r - mean_return) ** 2 for r in returns) / len(returns)
            volatility = round((var_returns ** 0.5) / 100, 4)  # en décimal

    # Ratio Sharpe : (rendement du PRU par rapport au prix live - taux sans risque) / volatilité
    # Taux sans risque annuel = 4%, soit ~0.01% par jour (simplifié)
    # Pour la simulation, on le rapporte au rendement observé
    sharpe = 0.0
    if volatility > 0 and avg_price > 0:
        daily_return = (live_price / avg_price - 1) if live_price > 0 else 0
        risk_free_rate = 0.0001  # ~4% annuel
        sharpe = round((daily_return - risk_free_rate) / volatility, 2)

    return {
        "dca_entries": entries,
        "dca_total_invested": total_invested,
        "dca_total_tokens": total_tokens,
        "dca_avg_price": avg_price,
        "dca_target_price": target,
        "dca_value_at_target": value_at_target,
        "dca_pnl_target_usd": pnl_target_usd,
        "dca_pnl_target_pct": pnl_target_pct,
        "dca_value_at_live": value_at_live,
        "dca_pnl_live_usd": pnl_live_usd,
        "dca_pnl_live_pct": pnl_live_pct,
        "dca_avg_gain_per_trade": avg_gain_per_trade,
        "dca_price_std": price_std,
        "dca_volatility": volatility,
        "dca_sharpe": sharpe,
    }


def compute_portfolio_stats(data, live_price):
    """
    Calcule les stats du portefeuille RÉEL (achats confirmés via /api/buy,
    donc de l'argent réellement déduit du capital) — distinct de la
    simulation DCA qui est un bac à sable.
    """
    buys = [e for e in data["history"] if e.get("type") == "buy"]

    total_invested = round(sum(e["amount"] for e in buys), 2)
    total_tokens = round(sum(e.get("tokens", 0) for e in buys), 6)
    avg_price = round(total_invested / total_tokens, 6) if total_tokens > 0 else 0.0

    value_now = round(total_tokens * live_price, 2) if live_price > 0 else 0.0
    pnl_usd = round(value_now - total_invested, 2) if live_price > 0 else 0.0
    pnl_pct = round((live_price / avg_price - 1) * 100, 2) if (avg_price > 0 and live_price > 0) else 0.0

    return {
        "portfolio_tokens": total_tokens,
        "portfolio_invested": total_invested,
        "portfolio_avg_price": avg_price,
        "portfolio_value": value_now,
        "portfolio_pnl_usd": pnl_usd,
        "portfolio_pnl_pct": pnl_pct,
    }


def build_payload(data):
    """Construit la réponse JSON complète utilisée par le frontend AJAX."""
    live_price, change24, refreshed = get_link_price()
    if refreshed:
        record_price_point(data, live_price)
        save_data(data)

    stats = compute_stats(data, live_price)
    dca_stats = compute_dca_stats(data, live_price)
    portfolio_stats = compute_portfolio_stats(data, live_price)

    return {
        "balance": round(data["balance"], 2),
        "goal_tokens": data["goal_tokens"],
        "target_price": data["target_price"],
        "live_price": live_price,
        "change24": round(change24, 2),
        "history": data["history"][:15],
        "price_history": [p["price"] for p in data["price_history"]],
        **stats,
        **dca_stats,
        **portfolio_stats
    }


def recalculate_balance(data):
    """Recalcule le solde à partir de l'historique complet."""
    balance = 0.0
    for entry in reversed(data["history"]):  # traverser en ordre inverse (plus récent d'abord)
        if entry["type"] == "deposit":
            balance += entry["amount"]
        elif entry["type"] in ("withdraw", "buy"):
            balance -= entry["amount"]
    data["balance"] = round(balance, 2)
    return data


def parse_positive_amount(raw):
    try:
        amount = float(raw)
    except (TypeError, ValueError):
        raise ValueError("Montant invalide.")
    if amount <= 0:
        raise ValueError("Le montant doit être supérieur à 0.")
    return round(amount, 2)


# ----------------------------------------------------------------------
# Routes pages
# ----------------------------------------------------------------------

@app.route("/")
def index():
    data = load_data()
    payload = build_payload(data)
    return render_template("index.html", initial=payload)


# ----------------------------------------------------------------------
# API JSON
# ----------------------------------------------------------------------

@app.get("/api/status")
def api_status():
    with DATA_LOCK:
        data = load_data()
        return jsonify(build_payload(data))


@app.post("/api/deposit")
def api_deposit():
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            amount = parse_positive_amount(payload.get("amount"))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        data["balance"] = round(data["balance"] + amount, 2)
        data["history"].insert(0, {
            "type": "deposit",
            "amount": amount,
            "balance_after": data["balance"],
            "timestamp": datetime.now().isoformat(timespec="seconds")
        })
        data["history"] = data["history"][:MAX_HISTORY]
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/withdraw")
def api_withdraw():
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            amount = parse_positive_amount(payload.get("amount"))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        if amount > data["balance"]:
            return jsonify({"error": "Solde insuffisant pour ce retrait."}), 400

        data["balance"] = round(data["balance"] - amount, 2)
        data["history"].insert(0, {
            "type": "withdraw",
            "amount": amount,
            "balance_after": data["balance"],
            "timestamp": datetime.now().isoformat(timespec="seconds")
        })
        data["history"] = data["history"][:MAX_HISTORY]
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/settings")
def api_settings():
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            goal = float(payload.get("goal"))
            price = float(payload.get("price"))
        except (TypeError, ValueError):
            return jsonify({"error": "Objectif ou prix invalide."}), 400

        if goal <= 0 or price <= 0:
            return jsonify({"error": "L'objectif et le prix doivent être positifs."}), 400

        data["goal_tokens"] = goal
        data["target_price"] = round(price, 4)
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/history/delete")
def api_history_delete():
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            index = int(payload.get("index"))
        except (TypeError, ValueError):
            return jsonify({"error": "Index invalide."}), 400

        if not (0 <= index < len(data["history"])):
            return jsonify({"error": "Entrée introuvable."}), 404

        data["history"].pop(index)
        recalculate_balance(data)  # Recalculer le solde après suppression
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/dca/inverse-pnl")
def api_dca_inverse_pnl():
    """Calcul inverse : saisis le gain souhaité en $, on te dit le prix de revente."""
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            desired_gain_usd = float(payload.get("gain_usd"))
        except (TypeError, ValueError):
            return jsonify({"error": "Gain souhaité invalide."}), 400

        total_invested = sum(e["amount"] for e in data["dca_entries"])
        total_tokens = sum(e["tokens"] for e in data["dca_entries"])

        if total_tokens <= 0:
            return jsonify({"error": "Aucun achat simulé. Ajoute au moins un achat."}), 400

        # prix_revente = (total_investi + gain_souhaité) / total_tokens
        target_price = (total_invested + desired_gain_usd) / total_tokens

        if target_price <= 0:
            return jsonify({"error": "Le gain/perte calculé donne un prix invalide."}), 400

        data["dca_target_price"] = round(target_price, 6)
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/dca/add")
def api_dca_add():
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            # Mode USD ou LINK ?
            if "tokens" in payload and payload.get("tokens"):
                # Mode LINK : tokens + price
                tokens = float(payload.get("tokens"))
                price = parse_positive_amount(payload.get("price"))
                if tokens <= 0:
                    raise ValueError("Quantité de LINK invalide.")
                amount = round(tokens * price, 2)
            else:
                # Mode USD : amount + price
                amount = parse_positive_amount(payload.get("amount"))
                price = parse_positive_amount(payload.get("price"))
                tokens = round(amount / price, 6)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        data["dca_entries"].append({
            "amount": amount,
            "price": price,
            "tokens": tokens,
            "timestamp": datetime.now().isoformat(timespec="seconds")
        })
        data["dca_entries"] = data["dca_entries"][-MAX_DCA_ENTRIES:]
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/dca/delete")
def api_dca_delete():
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            index = int(payload.get("index"))
        except (TypeError, ValueError):
            return jsonify({"error": "Index invalide."}), 400

        if not (0 <= index < len(data["dca_entries"])):
            return jsonify({"error": "Achat introuvable."}), 404

        data["dca_entries"].pop(index)
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/dca/target")
def api_dca_target():
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            price = float(payload.get("price"))
        except (TypeError, ValueError):
            return jsonify({"error": "Prix de revente invalide."}), 400

        if price <= 0:
            return jsonify({"error": "Le prix de revente doit être positif."}), 400

        data["dca_target_price"] = round(price, 6)
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/dca/reset")
def api_dca_reset():
    with DATA_LOCK:
        data = load_data()
        data["dca_entries"] = []
        data["dca_target_price"] = 0
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/simulate-buy")
def api_simulate_buy():
    """
    Simule un achat de LINK avec le capital actuel, sans affecter le solde réel.
    Accepte un prix manuel (payload["price"]) pour ne plus dépendre du prix live
    quand l'API CoinGecko est indisponible.
    """
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            amount_to_invest = parse_positive_amount(payload.get("amount"))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        live_price, _, _ = get_link_price()

        # Prix manuel fourni par l'utilisateur -> prioritaire sur le live
        manual_price_raw = payload.get("price")
        used_price = live_price
        if manual_price_raw not in (None, ""):
            try:
                manual_price = float(manual_price_raw)
                if manual_price > 0:
                    used_price = manual_price
            except (TypeError, ValueError):
                return jsonify({"error": "Prix saisi invalide."}), 400

        if used_price <= 0:
            return jsonify({"error": "Aucun prix disponible : saisis un prix manuellement."}), 400

        if amount_to_invest > data["balance"]:
            return jsonify({"error": "Solde insuffisant pour cet achat."}), 400

        # Calculs
        tokens_acquired = round(amount_to_invest / used_price, 6)
        remaining_balance = round(data["balance"] - amount_to_invest, 2)

        return jsonify({
            "current_balance": data["balance"],
            "amount_to_invest": amount_to_invest,
            "live_price": live_price,
            "used_price": used_price,
            "tokens_acquired": tokens_acquired,
            "remaining_balance": remaining_balance,
            "simulation_valid": True
        })


@app.post("/api/buy")
def api_buy():
    """
    Enregistre un achat RÉEL : déduit le montant du capital et l'ajoute à
    l'historique avec le type 'buy' (tokens + prix conservés), pour pouvoir
    répertorier ce que tu as vraiment acheté au fil du temps.
    Accepte un prix manuel si le live n'est pas disponible.
    """
    payload = request.get_json(silent=True) or request.form
    with DATA_LOCK:
        data = load_data()
        try:
            amount = parse_positive_amount(payload.get("amount"))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        live_price, _, _ = get_link_price()

        manual_price_raw = payload.get("price")
        used_price = live_price
        if manual_price_raw not in (None, ""):
            try:
                manual_price = float(manual_price_raw)
                if manual_price > 0:
                    used_price = manual_price
            except (TypeError, ValueError):
                return jsonify({"error": "Prix saisi invalide."}), 400

        if used_price <= 0:
            return jsonify({"error": "Aucun prix disponible : saisis un prix manuellement."}), 400

        if amount > data["balance"]:
            return jsonify({"error": "Solde insuffisant pour cet achat."}), 400

        tokens = round(amount / used_price, 6)
        data["balance"] = round(data["balance"] - amount, 2)
        data["history"].insert(0, {
            "type": "buy",
            "amount": amount,
            "price": used_price,
            "tokens": tokens,
            "balance_after": data["balance"],
            "timestamp": datetime.now().isoformat(timespec="seconds")
        })
        data["history"] = data["history"][:MAX_HISTORY]
        save_data(data)
        return jsonify(build_payload(data))


@app.post("/api/reset")
def api_reset():
    with DATA_LOCK:
        data = load_data()
        data["balance"] = 0
        data["history"] = []
        save_data(data)
        return jsonify(build_payload(data))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081, debug=True)
