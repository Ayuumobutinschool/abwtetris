# Tetris Web Server

Browser-Tetris mit Login (gehashte Passwörter) und Leaderboard.
Backend: Flask + SQLite. Das Spiel selbst läuft client-side im Browser
(HTML5 Canvas + JavaScript) – der Server kümmert sich nur um Auth und
das Speichern der Scores.

## Struktur

```
tetris-server/
├── app.py              # Flask: Auth, Score-/Leaderboard-API, DB-Init
├── requirements.txt    # Flask, waitress
├── install.sh          # Deploy-Skript (venv + systemd)
├── templates/          # base / login / register / game
└── static/             # style.css, tetris.js
```

## Deployment (im Debian-Container)

```bash
# Ordner in den Container kopieren, dann:
cd tetris-server
sudo ./install.sh
```

Danach läuft der Dienst unter `http://<container-ip>:5000`.

Anderer Port: `sudo PORT=8080 ./install.sh`

## Verwaltung

```bash
systemctl status tetris        # Status
systemctl restart tetris       # Neustart
journalctl -u tetris -f        # Live-Logs
```

## Daten

* Datenbank:   `/opt/tetris/tetris.db`  (SQLite)
* Session-Key: `/opt/tetris/secret_key` (wird beim ersten Start erzeugt)

Leaderboard zurücksetzen:

```bash
systemctl stop tetris
rm /opt/tetris/tetris.db
systemctl start tetris         # DB wird leer neu angelegt
```

## Lokaler Test (ohne systemd)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py        # http://localhost:5000
```

## Hinweis zu Scores

Das Spiel läuft im Browser des Spielers, daher sind die übermittelten
Scores prinzipiell manipulierbar. Für ein LAN/Homelab unter Freunden ist
das ok; es ist kein manipulationssicheres Wettkampf-System.
