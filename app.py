"""
Tetris Web Server
-----------------
Flask backend: account login (hashed passwords), score submission and a
leaderboard. The Tetris game itself runs client-side (see static/tetris.js);
the server only handles authentication and persistence via SQLite.
"""

import os
import sqlite3
import secrets
from functools import wraps

from flask import (
    Flask, g, render_template, request, redirect, url_for,
    session, jsonify, flash,
)
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "tetris.db")
SECRET_PATH = os.path.join(BASE_DIR, "secret_key")

app = Flask(__name__)


# --------------------------------------------------------------------------
# Secret key (persisted to a file so sessions survive a restart)
# --------------------------------------------------------------------------
def load_or_create_secret() -> str:
    env = os.environ.get("TETRIS_SECRET_KEY")
    if env:
        return env
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    key = secrets.token_hex(32)
    with open(SECRET_PATH, "w", encoding="utf-8") as fh:
        fh.write(key)
    try:
        os.chmod(SECRET_PATH, 0o600)
    except OSError:
        pass
    return key


app.secret_key = load_or_create_secret()


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS scores (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            score      INTEGER NOT NULL,
            lines      INTEGER NOT NULL DEFAULT 0,
            level      INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_scores_user  ON scores(user_id);
        CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
        """
    )
    db.commit()
    db.close()


# Initialise on import so it also runs under waitress / gunicorn.
init_db()


# --------------------------------------------------------------------------
# Auth utilities
# --------------------------------------------------------------------------
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return get_db().execute(
        "SELECT id, username FROM users WHERE id = ?", (uid,)
    ).fetchone()


def safe_next(raw):
    """Only allow same-site relative redirect targets."""
    if not raw or not raw.startswith("/") or raw.startswith("//"):
        return url_for("game")
    return raw


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    if session.get("user_id"):
        return redirect(url_for("game"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if session.get("user_id"):
        return redirect(url_for("game"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        password2 = request.form.get("password2") or ""

        error = None
        if not (3 <= len(username) <= 20):
            error = "Username muss 3–20 Zeichen haben."
        elif not username.replace("_", "").isalnum():
            error = "Username: nur Buchstaben, Zahlen und Unterstrich."
        elif len(password) < 6:
            error = "Passwort muss mindestens 6 Zeichen haben."
        elif password != password2:
            error = "Passwörter stimmen nicht überein."

        if error is None:
            db = get_db()
            if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
                error = "Username ist schon vergeben."
            else:
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
                row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
                session.clear()
                session["user_id"] = row["id"]
                return redirect(url_for("game"))

        flash(error, "error")

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user_id"):
        return redirect(url_for("game"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = get_db().execute(
            "SELECT id, password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            return redirect(safe_next(request.args.get("next")))

        flash("Falscher Username oder Passwort.", "error")

    return render_template("login.html")


@app.route("/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/game")
@login_required
def game():
    user = current_user()
    return render_template("game.html", username=user["username"])


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.route("/api/leaderboard")
def api_leaderboard():
    db = get_db()
    # Best run per user (score + the lines/level of that run).
    rows = db.execute(
        """
        SELECT u.username AS username, s.score AS score,
               s.lines AS lines, s.level AS level
        FROM scores s
        JOIN users u ON u.id = s.user_id
        JOIN (SELECT user_id, MAX(score) AS mx FROM scores GROUP BY user_id) b
          ON b.user_id = s.user_id AND b.mx = s.score
        GROUP BY s.user_id
        ORDER BY s.score DESC, s.created_at ASC
        LIMIT 10
        """
    ).fetchall()
    leaderboard = [dict(r) for r in rows]

    me = None
    uid = session.get("user_id")
    if uid:
        u = db.execute("SELECT username FROM users WHERE id = ?", (uid,)).fetchone()
        best = db.execute(
            "SELECT MAX(score) AS best FROM scores WHERE user_id = ?", (uid,)
        ).fetchone()["best"] or 0
        rank = None
        if best > 0:
            rank = db.execute(
                """
                SELECT COUNT(*) + 1 AS rank FROM
                  (SELECT user_id, MAX(score) AS mx FROM scores GROUP BY user_id)
                WHERE mx > ?
                """,
                (best,),
            ).fetchone()["rank"]
        me = {"username": u["username"] if u else None, "best": best, "rank": rank}

    return jsonify({"leaderboard": leaderboard, "me": me})


@app.route("/api/score", methods=["POST"])
def api_score():
    if not session.get("user_id"):
        return jsonify({"error": "not_authenticated"}), 401

    data = request.get_json(silent=True) or {}
    try:
        score = int(data.get("score", 0))
        lines = int(data.get("lines", 0))
        level = int(data.get("level", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_payload"}), 400

    # Light sanity bounds. NOTE: the game is client-side, so scores are
    # inherently trust-based — fine for a LAN/homelab, not tamper-proof.
    if not (0 <= score <= 100_000_000 and 0 <= lines <= 100_000 and 1 <= level <= 999):
        return jsonify({"error": "out_of_range"}), 400

    db = get_db()
    db.execute(
        "INSERT INTO scores (user_id, score, lines, level) VALUES (?, ?, ?, ?)",
        (session["user_id"], score, lines, level),
    )
    db.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    # Development only. In production the systemd unit runs this via waitress.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
