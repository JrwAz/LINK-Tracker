#!/usr/bin/env bash
cd "$(dirname "$0")"

if [ ! -d venv ]; then
    echo "Création de l'environnement virtuel..."
    python3 -m venv venv
fi

source venv/bin/activate

echo "Installation des dépendances..."
pip install -r requirements.txt --quiet

echo ""
echo "Lancement de LINK Tracker sur http://localhost:8081"
echo ""

python app.py
