@echo off
title LINK Tracker
cd /d "%~dp0"

if not exist venv (
    echo Creation de l'environnement virtuel...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo Installation des dependances...
pip install -r requirements.txt --quiet

echo.
echo Lancement de LINK Tracker sur http://localhost:8081
echo.

python app.py

pause
