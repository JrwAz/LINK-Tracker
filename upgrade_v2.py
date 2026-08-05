import os

app_py = r'''from flask import Flask, render_template
import requests
import json
import os

app = Flask(__name__)

DATA_FILE = "data.json"

DEFAULT = {
    "goal_tokens":1500,
    "target_price":7.5,
    "balance":0,
    "history":[]
}

def load():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE,"r") as f:
            return json.load(f)
    return DEFAULT

@app.route("/")
def index():

    data=load()

    try:
        r=requests.get("https://api.coingecko.com/api/v3/simple/price?ids=chainlink&vs_currencies=usd&include_24hr_change=true",timeout=5).json()

        live_price=r["chainlink"]["usd"]
        change24=r["chainlink"]["usd_24h_change"]

    except:

        live_price=0
        change24=0

    capital=data["goal_tokens"]*data["target_price"]

    progress=(data["balance"]/capital*100) if capital else 0

    tokens=(data["balance"]/live_price) if live_price else 0

    remaining=max(data["goal_tokens"]-tokens,0)

    return render_template(
        "index.html",
        data=data,
        capital=capital,
        progress=progress,
        live_price=live_price,
        change24=change24,
        tokens=tokens,
        remaining=remaining
    )

if __name__=="__main__":
    app.run(host="0.0.0.0",port=8081,debug=True)
'''

index_html = r'''<!DOCTYPE html>

<html>

<head>

<meta charset="utf-8">

<meta name="viewport" content="width=device-width,initial-scale=1">

<title>LINK Tracker</title>

<link rel="stylesheet" href="/static/style.css">

</head>

<body>

<div class="card">

<h1>🔵 LINK Tracker</h1>

<div class="grid">

<div class="box">

<h3>Prix LINK</h3>

<div class="big
