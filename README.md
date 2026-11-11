# Playfair Cipher Dashboard

**Digraph Substitution Cipher — Cryptography & Cybersecurity College Project**

## Description

An interactive full-stack web dashboard that demonstrates how the **Playfair Cipher** works. Users log in, enter a message and a secret key, and encrypt or decrypt it. The app builds the 5 × 5 key square live, splits the message into letter pairs (digraphs), shows which of the three Playfair rules applies to each pair, highlights the pair on the key square, and saves every operation to SQLite.

> This application is intended for **educational purposes only**. The Playfair cipher is not secure for modern communication.

## Features

- Login / logout with Flask sessions and hashed passwords (default `admin` / `admin123`)
- Encrypt and decrypt with the Playfair algorithm (Python backend, called via `fetch`, no page reload)
- **Live 5 × 5 key square** that rebuilds as you type the key (duplicates skipped, J merged with I)
- **Digraph preparation** view: letters only, J → I, inserted `X` fillers highlighted
- **Step-by-step table**: pair, row/column positions, rule applied (Row / Column / Rectangle), explanation, result
- **Rule Visualizer**: click any step (or press Play) to see the input pair and output pair highlighted on the key square
- Result card with **Copy Result** and **Download Result** (`playfair_result.txt` with key square and all steps)
- Decryption also shows a **probable plaintext** with filler X's removed
- Statistics cards (Total, Encrypted, Decrypted, Average Key Length) from SQLite
- Chart.js activity chart (last 7 days) and recent operations list
- History page with search, filter, **View** (modal + "Open in Dashboard") and **Delete** / Clear All
- "How It Works" page: key square construction, preparation rules, the three rules with diagrams, worked example, advantages and limitations
- Input validation, CSRF protection, parameterised queries (SQLAlchemy), output escaping
- Responsive dark glassmorphism UI for desktop, tablet and mobile
- Bootstrap, Font Awesome, Chart.js and fonts are bundled in `static/vendor` — **works offline** during the viva

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Bootstrap 5, JavaScript, Font Awesome, Chart.js |
| Backend | Python, Flask |
| Database | SQLite with Flask-SQLAlchemy |
| Security | Werkzeug password hashing, Flask sessions, CSRF token |

```text
Frontend (HTML + CSS + Bootstrap + JavaScript)
              ↓  fetch / forms
          Flask routes (app.py)
              ↓
     Python cipher logic (playfair.py)
              ↓
          SQLite (database.db)
```

## Project Structure

```text
playfair_cipher_dashboard/
├── app.py               # Flask app: models, auth, routes, APIs
├── playfair.py          # Playfair cipher engine (key square, digraphs, rules, steps)
├── requirements.txt
├── database.db          # created automatically on first run
├── templates/
│   ├── base.html        # shared layout + navbar
│   ├── index.html       # landing page
│   ├── login.html
│   ├── dashboard.html
│   ├── history.html
│   ├── how_it_works.html
│   └── error.html
├── static/
│   ├── css/style.css
│   ├── js/script.js
│   └── vendor/          # Bootstrap, Font Awesome, Chart.js, fonts (offline)
└── README.md
```

## Installation

```bash
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

## Open

```text
http://127.0.0.1:5000
```

## Default Login

```text
Username: admin
Password: admin123
```

## Algorithm

### 1. Build the 5 × 5 key square
1. Write the key letters in order, skipping repeats (J counts as I).
2. Fill the remaining cells with the rest of the alphabet (A–Z without J).

Key `MONARCHY`:

```text
M O N A R
C H Y B D
E F G I K
L P Q S T
U V W X Z
```

### 2. Prepare the plaintext
- Remove spaces, digits and symbols; convert to uppercase; replace J with I.
- Split into pairs. If both letters of a pair are the same, insert `X` between them (`Q` if the letter is X).
- If one letter is left over, pad it with `X`.

### 3. Apply the rules to each pair

| Case | Encryption | Decryption |
|---|---|---|
| Same row | Letter to the **right** (wrap around) | Letter to the **left** |
| Same column | Letter **below** (wrap around) | Letter **above** |
| Rectangle | Each letter takes the **other letter's column**, same row | Same as encryption |

With row `r` and column `c` numbered 0–4:

```text
Same row     Encrypt: (r, (c + 1) mod 5)    Decrypt: (r, (c − 1 + 5) mod 5)
Same column  Encrypt: ((r + 1) mod 5, c)    Decrypt: ((r − 1 + 5) mod 5, c)
Rectangle    (r1, c1), (r2, c2)  →  (r1, c2), (r2, c1)
```

### Example

```text
Plaintext : INSTRUMENTS
Key       : MONARCHY
Digraphs  : IN ST RU ME NT SX     (X = padding)
Ciphertext: GA TL MZ CL RQ XA
```

Decrypting `GATLMZCLRQXA` gives `INSTRUMENTSX`; the final X is the filler.

## Advantages
- Encrypts pairs of letters, hiding single-letter frequencies
- 600 possible digraphs make frequency analysis harder than for Caesar
- Needs only a keyword and a 5 × 5 grid
- Great for learning substitution ciphers

## Limitations
- Vulnerable to digraph frequency analysis with enough ciphertext
- Reversed pairs give reversed outputs (AB → XY means BA → YX)
- A letter never encrypts to itself
- I/J merging and fillers make decryption slightly ambiguous
- Not suitable for modern secure communication

## Notes
- Set the `SECRET_KEY` environment variable for a fixed session key; otherwise a random key is generated on each start (you just log in again).
- Delete `database.db` to reset all data; it is recreated with the admin account on the next run.
