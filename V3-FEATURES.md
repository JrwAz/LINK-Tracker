# LINK Tracker — V3 "Advanced Analytics"

## Nouvelles fonctionnalités

### 1. 📊 **Graphique DCA (dernière 24h)**
- **Courbe du prix LINK** : historique des 24 dernières heures
- **Ligne du PRU** : votre prix de revient moyen (fixe, pour comparaison visuelle)
- Mise à jour en temps réel : chaque 30 secondes quand un nouveau prix arrive
- Utilise Chart.js (zéro dépendance externe, déjà disponible)
- Responsive : s'adapte au mobile

### 2. ⚡ **Calcul inverse PNL**
- **Saisissez votre gain souhaité en $** → on calcule le prix de revente cible
- Formule : `prix_revente = (total_investi + gain_souhaité) / total_tokens`
- Utile pour fixer un objectif de profit sans faire de math mentale
- Sauvegardé automatiquement comme prix cible (met à jour la simulation)

### 3. 📈 **Stats avancées** (calculées sur la simulation)
- **Écart-type des prix d'achat** : mesure la variance de tes points d'entrée
  - Faible = achats concentrés près du PRU (bon DCA)
  - Élevé = achats très dispersés (high/low volatility entry)
- **Volatilité** : écart-type / PRU en % → te dit si t'as bien "scaladé" la baisse
- **Gain moyen par achat** : `total_investi / nombre_d'achats` → montant moyen par transaction
- **Ratio Sharpe** : `(rendement % du PRU - taux sans risque) / volatilité`
  - Mesure la qualité du rendement ajusté au risque
  - Plus élevé = meilleur ratio rendement/volatilité

### 4. 🔗 **Saisie DCA améliorée : mode USD vs LINK**
- **Mode USD** (défaut) : montant $ + prix d'achat
- **Mode LINK** : quantité LINK directement + prix d'achat
- Toggle fluide entre les deux modes
- Preview actualisée en temps réel dans chaque mode
- Utile si tu penses en termes de LINK accumulés plutôt qu'en $.

## Architecture

**Backend** :
- Route `/api/dca/inverse-pnl` : calcul inverse (POST avec `gain_usd`)
- Route `/api/dca/add` supportant les deux modes (champ `tokens` pour mode LINK, `amount` pour USD)
- Historique de prix stocké avec timestamps pour le graphique 24h (96 points = 1 par 15min)

**Frontend** :
- Toggle buttons USD/LINK avec switch de formulaires  
- Graphique Chart.js en canvas `#dca-chart` 
- Sections stats avancées rendues avec valeurs en temps réel
- Champ "Gain souhaité ($)" avec bouton "Calculer prix cible"
- Mode latent PNL (prix live) mis à jour automatiquement

## Bugs V2 corrigés

- ✅ Synchronisation du prix live : fallback cache + refresh immédiat au démarrage
- ✅ PNL latent affichant "--" quand prix absent : maintenant affiche "Chargement du prix..."
- ✅ Sparkline vide au premier chargement : maintenant alimentée dès le démarrage
