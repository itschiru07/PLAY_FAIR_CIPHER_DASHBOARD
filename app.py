"""
app.py — Playfair Cipher Dashboard (Flask + SQLite + SQLAlchemy)

Run:  python app.py   then open  http://127.0.0.1:5000
Default login:  admin / admin123
"""
import os
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, abort, flash, jsonify, redirect, render_template,
                   request, session, url_for)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

import playfair

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config.update(
    # Set SECRET_KEY in the environment for a fixed key; otherwise a random
    # key is generated at start-up (users simply log in again after restart).
    SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_hex(32),
    SQLALCHEMY_DATABASE_URI="sqlite:///" + os.path.join(BASE_DIR, "database.db"),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
    MAX_CONTENT_LENGTH=64 * 1024,  # requests larger than 64 KB are rejected
    TEMPLATES_AUTO_RELOAD=True,
    SEND_FILE_MAX_AGE_DEFAULT=0,
)

db = SQLAlchemy(app)


# --------------------------------------------------------------------------
# Database models
# --------------------------------------------------------------------------
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Operation(db.Model):
    __tablename__ = "operations"
    id = db.Column(db.Integer, primary_key=True)
    operation_type = db.Column(db.String(20), nullable=False)  # Encryption / Decryption
    input_text = db.Column(db.Text, nullable=False)
    key = db.Column(db.String(100), nullable=False)
    result = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "operation_type": self.operation_type,
            "input_text": self.input_text,
            "key": self.key,
            "result": self.result,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        }


def init_db():
    """Create tables and the default admin account (admin / admin123)."""
    with app.app_context():
        db.create_all()
        if not User.query.filter_by(username="admin").first():
            admin = User(username="admin")
            admin.set_password("admin123")
            db.session.add(admin)
            db.session.commit()


# --------------------------------------------------------------------------
# Security helpers: login protection + CSRF token
# --------------------------------------------------------------------------
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            if request.is_json or request.path.startswith("/api/") or request.method == "POST":
                return jsonify({"error": "Your session has expired. Please log in again."}), 401
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def get_csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


app.jinja_env.globals["csrf_token"] = get_csrf_token


@app.before_request
def verify_csrf():
    if request.method == "POST":
        sent = request.headers.get("X-CSRFToken") or request.form.get("csrf_token")
        if not sent or not secrets.compare_digest(sent, session.get("csrf_token", "")):
            if request.is_json:
                return jsonify({"error": "Security token missing or invalid. Refresh the page."}), 400
            abort(400, description="Security token missing or invalid. Please refresh the page.")


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.context_processor
def inject_user():
    return {"current_user": session.get("username")}


def current_user_id():
    return session.get("user_id")


# --------------------------------------------------------------------------
# Page routes
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if "user_id" in session:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        if not username or not password:
            flash("Please enter both username and password.", "danger")
            return render_template("login.html", username=username), 400

        user = User.query.filter_by(username=username).first()  # parameterised by SQLAlchemy
        if user and user.check_password(password):
            csrf = session.get("csrf_token")
            session.clear()  # prevent session fixation
            session.permanent = True
            session["user_id"] = user.id
            session["username"] = user.username
            session["csrf_token"] = csrf or secrets.token_urlsafe(32)
            flash(f"Welcome back, {user.username}!", "success")
            next_url = request.args.get("next", "")
            if next_url.startswith("/") and not next_url.startswith("//"):
                return redirect(next_url)
            return redirect(url_for("dashboard"))

        flash("Invalid username or password.", "danger")
        return render_template("login.html", username=username), 401

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html", stats=get_statistics(current_user_id()))


@app.route("/how-it-works")
def how_it_works():
    example = playfair.encrypt("INSTRUMENTS", "MONARCHY")
    return render_template("how_it_works.html", example=example)


@app.route("/history")
@login_required
def history():
    query = (request.args.get("q") or "").strip()
    op_filter = request.args.get("type", "all")
    ops = Operation.query.filter_by(user_id=current_user_id())
    if op_filter in ("Encryption", "Decryption"):
        ops = ops.filter_by(operation_type=op_filter)
    if query:
        like = f"%{query}%"
        ops = ops.filter(db.or_(Operation.input_text.ilike(like),
                                Operation.key.ilike(like),
                                Operation.result.ilike(like)))
    operations = ops.order_by(Operation.created_at.desc(), Operation.id.desc()).all()
    return render_template("history.html", operations=operations,
                           query=query, op_filter=op_filter)


@app.route("/history/delete/<int:op_id>", methods=["POST"])
@login_required
def delete_history(op_id):
    op = Operation.query.filter_by(id=op_id, user_id=current_user_id()).first()
    if not op:
        if request.is_json:
            return jsonify({"error": "Record not found."}), 404
        flash("Record not found.", "warning")
        return redirect(url_for("history"))
    db.session.delete(op)
    db.session.commit()
    if request.is_json:
        return jsonify({"ok": True, "statistics": get_statistics(current_user_id())})
    flash("History record deleted.", "success")
    return redirect(url_for("history"))


@app.route("/history/clear", methods=["POST"])
@login_required
def clear_history():
    Operation.query.filter_by(user_id=current_user_id()).delete()
    db.session.commit()
    flash("All history cleared.", "success")
    return redirect(url_for("history"))


# --------------------------------------------------------------------------
# Cipher API routes (called with fetch() from script.js)
# --------------------------------------------------------------------------
def run_cipher(mode):
    data = request.get_json(silent=True) or {}
    text, key = data.get("message"), data.get("key")
    if not isinstance(text, str) or not isinstance(key, str):
        return jsonify({"error": "Message and key must be text."}), 400
    try:
        output = playfair.process(text, key, mode)
    except playfair.PlayfairError as exc:
        return jsonify({"error": str(exc)}), 400

    op = Operation(
        operation_type="Encryption" if mode == "encrypt" else "Decryption",
        input_text=text.strip(),
        key=key.strip(),
        result=output["result"],
        user_id=current_user_id(),
    )
    db.session.add(op)
    db.session.commit()

    output["operation"] = op.to_dict()
    output["statistics"] = get_statistics(current_user_id())
    return jsonify(output)


@app.route("/encrypt", methods=["POST"])
@login_required
def encrypt_route():
    return run_cipher("encrypt")


@app.route("/decrypt", methods=["POST"])
@login_required
def decrypt_route():
    return run_cipher("decrypt")


def get_statistics(user_id):
    base = Operation.query.filter_by(user_id=user_id)
    total = base.count()
    encrypted = base.filter_by(operation_type="Encryption").count()
    decrypted = base.filter_by(operation_type="Decryption").count()

    # Average key length counts only the alphabetic letters of each key
    keys = [k for (k,) in db.session.query(Operation.key).filter_by(user_id=user_id)]
    avg_key = round(sum(playfair.count_alpha(k) for k in keys) / len(keys), 1) if keys else 0

    # Operations per day for the last 7 days (for the Chart.js chart)
    today = datetime.now().date()
    start = today - timedelta(days=6)
    rows = (db.session.query(func.date(Operation.created_at), Operation.operation_type, func.count())
            .filter(Operation.user_id == user_id,
                    Operation.created_at >= datetime.combine(start, datetime.min.time()))
            .group_by(func.date(Operation.created_at), Operation.operation_type).all())
    days = [(start + timedelta(days=i)) for i in range(7)]
    enc = {d.isoformat(): 0 for d in days}
    dec = {d.isoformat(): 0 for d in days}
    for day, op_type, count in rows:
        target = enc if op_type == "Encryption" else dec
        if day in target:
            target[day] = count

    recent = base.order_by(Operation.created_at.desc(), Operation.id.desc()).limit(5).all()
    return {
        "total": total,
        "encrypted": encrypted,
        "decrypted": decrypted,
        "avg_key_length": avg_key,
        "chart": {
            "labels": [d.strftime("%d %b") for d in days],
            "encrypted": list(enc.values()),
            "decrypted": list(dec.values()),
        },
        "recent": [op.to_dict() for op in recent],
    }


@app.route("/api/statistics")
@login_required
def api_statistics():
    return jsonify(get_statistics(current_user_id()))


@app.route("/api/history/<int:op_id>")
@login_required
def api_history_item(op_id):
    op = Operation.query.filter_by(id=op_id, user_id=current_user_id()).first()
    if not op:
        return jsonify({"error": "Record not found."}), 404
    return jsonify(op.to_dict())


# --------------------------------------------------------------------------
# Error pages
# --------------------------------------------------------------------------
@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(413)
@app.errorhandler(500)
def handle_error(err):
    code = getattr(err, "code", 500) or 500
    message = getattr(err, "description", "Something went wrong.")
    if request.path.startswith("/api/") or request.is_json:
        return jsonify({"error": message}), code
    return render_template("error.html", code=code, message=message), code


init_db()

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1", host="127.0.0.1", port=5000)
