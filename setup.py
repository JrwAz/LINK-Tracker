import os

print("Création du projet LINK Tracker...")

folders = [
    "templates",
    "static"
]

files = {
    "app.py": "",
    "requirements.txt": "Flask\nrequests\n",
    "data.json": """{
    "goal_tokens": 1500,
    "target_price": 7.5,
    "balance": 0,
    "history": []
}
""",
    "templates/index.html": "",
    "static/style.css": "",
    "static/script.js": ""
}

for folder in folders:
    os.makedirs(folder, exist_ok=True)
    print(f"Dossier créé : {folder}")

for path, content in files.items():
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Fichier créé : {path}")
    else:
        print(f"Déjà présent : {path}")

print("\nProjet créé avec succès !")

