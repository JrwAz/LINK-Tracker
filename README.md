# LINK Tracker — v3.0 Premium

Outil de suivi personnel d'accumulation de capital en vue d'un achat cible de
Chainlink (LINK), avec un objectif en nombre de tokens et un prix moyen visé.

## Démarrage rapide

```bash
pip install -r requirements.txt
python app.py
```

Puis ouvrir : http://localhost:8081

Sous Windows, double-cliquer sur `LANCER.bat`. Sous Linux/Mac :
`chmod +x LANCER.sh && ./LANCER.sh`.

## Ce qui a changé par rapport à la v2

**Backend (`app.py`)**
- Passage en API JSON (`/api/deposit`, `/api/withdraw`, `/api/settings`,
  `/api/history/delete`, `/api/reset`, `/api/status`) : le frontend ne
  recharge plus jamais la page entière.
- Cache du prix CoinGecko (30s) pour éviter le rate-limit de l'API en cas
  de clics rapides ou d'onglets multiples ouverts.
- Historique enrichi : chaque transaction garde son type, son montant, le
  solde après opération et un horodatage réel (au lieu d'une simple chaîne
  `"+ 100.00 $"`). Migration automatique de l'ancien format au premier
  chargement — aucune donnée perdue.
- Historique de prix (`price_history`, 60 points max) pour alimenter la
  mini-courbe de tendance affichée à côté du prix.
- Validation stricte des montants (positifs, solde suffisant pour un
  retrait) avec messages d'erreur explicites au lieu de plantages.
- Verrou (`threading.Lock`) autour des lectures/écritures de `data.json`
  pour éviter les corruptions en cas de requêtes concurrentes.

**Frontend (`templates/index.html`, `static/`)**
- Design premium sombre, glassmorphism, dégradés bleu Chainlink / cyan,
  cartes en verre dépoli, animations douces (barre de progression avec
  effet shimmer, apparition des cartes, pastille "live").
- Mini sparkline de tendance du prix dessinée en Canvas natif (aucune
  dépendance externe, donc pas de risque de blocage réseau).
- Boutons rapides (+50 / +100 / +500 / +1000) pour déposer en un clic.
- Aperçu en direct du capital cible pendant la saisie de l'objectif.
- Suppression individuelle d'une ligne d'historique.
- Réinitialisation complète (avec confirmation) via l'icône 🗑️.
- Notifications "toast" au lieu d'un simple rechargement silencieux.
- Rafraîchissement automatique du prix et du solde toutes les 30 secondes
  sans jamais perdre la saisie en cours dans le formulaire objectif.
- Responsive : passage en une colonne sous 760px.

## V2 — Simulateur DCA & PNL

Nouvelle section pleine largeur en bas de page, indépendante du capital
réel suivi plus haut (c'est un bac à sable de simulation, pas ton solde
réel — le bouton reset du DCA ne touche jamais à ton capital).

**Saisie des achats simulés**
- Montant investi ($) + prix d'achat ($) → nombre de LINK obtenus calculé
  automatiquement et prévisualisé avant validation.
- Chaque achat est listé avec une mini-barre : verte s'il est en dessous
  du PRU (bon point d'entrée), rouge s'il est au-dessus.
- Suppression individuelle d'un achat.

**Prix de revient moyen (PRU)**
- Calculé en pondéré : `PRU = total investi / total LINK acquis` — donc un
  gros achat à bas prix pèse plus dans la moyenne qu'un petit achat, comme
  en DCA réel.

**Simulation de revente**
- Champ « prix de revente cible » avec 4 raccourcis rapides : prix actuel
  du marché, PRU +25%, PRU +50%, PRU x2.
- Deux blocs de résultat côte à côte :
  - **Au prix cible** : PNL projeté si tu revendais à ce prix ($ et %).
  - **Au prix actuel (latent)** : ton PNL non réalisé en temps réel, basé
    sur le prix live de LINK — utile pour voir où tu en es sans rien
    saisir de plus.
- Le prix cible est sauvegardé (persisté dans `data.json`), donc il
  survit aux rechargements et aux redémarrages du serveur.

**Backend** : 4 nouvelles routes API — `/api/dca/add`, `/api/dca/delete`,
`/api/dca/target`, `/api/dca/reset` — toutes protégées par le même verrou
et la même validation stricte que le reste de l'app.

## Fichiers supprimés

`setup.py` et `upgrade_v2.py` (scripts de bootstrap/migration d'une
version antérieure, incomplets et devenus obsolets) ont été retirés : la
structure du projet est désormais stable et livrée directement complète.

## Structure

```
LINK-Tracker/
├── app.py                 # Backend Flask + API JSON
├── data.json               # Données persistées (solde, historique, objectif)
├── requirements.txt
├── LANCER.bat / LANCER.sh
├── templates/
│   └── index.html
└── static/
    ├── style.css
    └── script.js
```
