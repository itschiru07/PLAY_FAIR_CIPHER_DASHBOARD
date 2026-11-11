"""
playfair.py — Playfair Cipher engine.

The Playfair cipher (Charles Wheatstone, 1854; popularised by Lord Playfair)
is a *digraph substitution cipher*: it encrypts PAIRS of letters using a
5 x 5 key square built from a secret keyword.

Conventions used in this project (the standard textbook ones):
  * Only the letters A-Z are used. Spaces, digits and symbols are removed.
  * I and J share one cell, so every J is treated as I (25-letter square).
  * If both letters of a pair are the same, a filler 'X' is inserted
    between them (a 'Q' is used if the letter itself is X).
  * If the message has an odd number of letters, a filler 'X' (or 'Q'
    after a final X) is added at the end.

Rules for each pair (a, b):
  1. Same row       -> encrypt: take the letter to the RIGHT (wrap around)
                       decrypt: take the letter to the LEFT
  2. Same column    -> encrypt: take the letter BELOW (wrap around)
                       decrypt: take the letter ABOVE
  3. Rectangle      -> each letter is replaced by the letter in its OWN row
                       but in the OTHER letter's column (same for both ways)
"""

ALPHABET = "ABCDEFGHIKLMNOPQRSTUVWXYZ"  # 25 letters — no J
SIZE = 5


class PlayfairError(ValueError):
    """Raised for input that cannot be processed (shown to the user)."""


# --------------------------------------------------------------------------
# Text helpers
# --------------------------------------------------------------------------
def clean_letters(text):
    """Return a list of uppercase A-Z letters with J converted to I.

    Each item is a dict so the UI can show which letters were changed.
    """
    letters = []
    for ch in (text or "").upper():
        if "A" <= ch <= "Z":
            if ch == "J":
                letters.append({"char": "I", "original": "J", "converted": True})
            else:
                letters.append({"char": ch, "original": ch, "converted": False})
    return letters


def count_alpha(text):
    return sum(1 for ch in (text or "").upper() if "A" <= ch <= "Z")


# --------------------------------------------------------------------------
# Key square
# --------------------------------------------------------------------------
def generate_key_matrix(key):
    """Build the 5x5 key square.

    Returns (matrix, key_letters) where matrix is a list of 5 rows and
    key_letters is the de-duplicated keyword sequence placed first.
    """
    if not key or not key.strip():
        raise PlayfairError("Please enter a key.")
    if count_alpha(key) == 0:
        raise PlayfairError("Key must contain at least one alphabetic character.")

    key_letters = []
    for item in clean_letters(key):
        if item["char"] not in key_letters:
            key_letters.append(item["char"])

    sequence = key_letters + [c for c in ALPHABET if c not in key_letters]
    matrix = [sequence[r * SIZE:(r + 1) * SIZE] for r in range(SIZE)]
    return matrix, key_letters


def build_positions(matrix):
    """Map every letter to its (row, col) inside the key square."""
    return {matrix[r][c]: (r, c) for r in range(SIZE) for c in range(SIZE)}


# --------------------------------------------------------------------------
# Digraph preparation
# --------------------------------------------------------------------------
def _filler_for(letter):
    return "Q" if letter == "X" else "X"


def prepare_digraphs(text):
    """Split plaintext into digraphs following the Playfair rules.

    Returns a list of pairs; each pair is a list of two dicts:
      {"char": "X", "filler": True/False, "converted": True/False}
    """
    letters = clean_letters(text)
    if not letters:
        raise PlayfairError("Message must contain at least one alphabetic character.")

    pairs = []
    i = 0
    while i < len(letters):
        first = dict(letters[i], filler=False)
        if i + 1 < len(letters):
            second = letters[i + 1]
            if second["char"] == first["char"]:
                # Repeated letter in a pair -> insert filler, reuse second next time
                filler = _filler_for(first["char"])
                pairs.append([first, {"char": filler, "original": "", "converted": False, "filler": True}])
                i += 1
            else:
                pairs.append([first, dict(second, filler=False)])
                i += 2
        else:
            # Odd length -> pad the final letter
            filler = _filler_for(first["char"])
            pairs.append([first, {"char": filler, "original": "", "converted": False, "filler": True}])
            i += 1
    return pairs


def split_ciphertext(text):
    """Split ciphertext into digraphs (no fillers are ever added here)."""
    letters = clean_letters(text)
    if not letters:
        raise PlayfairError("Message must contain at least one alphabetic character.")
    if len(letters) % 2 != 0:
        raise PlayfairError(
            "Ciphertext must contain an even number of letters "
            f"(found {len(letters)}). Playfair always produces letter pairs."
        )
    pairs = []
    for i in range(0, len(letters), 2):
        a, b = dict(letters[i], filler=False), dict(letters[i + 1], filler=False)
        if a["char"] == b["char"]:
            raise PlayfairError(
                f"Invalid ciphertext: pair {i // 2 + 1} is '{a['char']}{b['char']}'. "
                "A Playfair ciphertext pair can never contain the same letter twice."
            )
        pairs.append([a, b])
    return pairs


# --------------------------------------------------------------------------
# Core transformation
# --------------------------------------------------------------------------
def _transform_pair(a, b, matrix, positions, mode):
    shift = 1 if mode == "encrypt" else -1
    ra, ca = positions[a]
    rb, cb = positions[b]

    if ra == rb:
        rule = "row"
        na, nb = (ra, (ca + shift) % SIZE), (rb, (cb + shift) % SIZE)
        direction = "right" if mode == "encrypt" else "left"
        explanation = (f"{a} and {b} are in the same row {ra + 1} → "
                       f"take the letter to the {direction} of each (wrap around).")
    elif ca == cb:
        rule = "column"
        na, nb = ((ra + shift) % SIZE, ca), ((rb + shift) % SIZE, cb)
        direction = "below" if mode == "encrypt" else "above"
        explanation = (f"{a} and {b} are in the same column {ca + 1} → "
                       f"take the letter {direction} each (wrap around).")
    else:
        rule = "rectangle"
        na, nb = (ra, cb), (rb, ca)
        explanation = (f"{a} and {b} form a rectangle → swap columns: "
                       f"{a} takes column {cb + 1}, {b} takes column {ca + 1}.")

    out_a, out_b = matrix[na[0]][na[1]], matrix[nb[0]][nb[1]]
    return {
        "rule": rule,
        "explanation": explanation,
        "in_pos": [[ra, ca], [rb, cb]],
        "out_pos": [list(na), list(nb)],
        "output": [out_a, out_b],
    }


def remove_fillers(text_pairs):
    """Best-effort clean-up of decrypted text (fillers can't be known for sure).

    Removes an X/Q that sits between two identical letters (e.g. BAL XL OON ->
    BALLOON) and a trailing X/Q padding letter.
    """
    letters = "".join(text_pairs)
    out = []
    n = len(letters)
    for i, ch in enumerate(letters):
        is_second_of_pair = i % 2 == 1
        if (ch in "XQ" and is_second_of_pair and 0 < i < n - 1
                and letters[i - 1] == letters[i + 1]):
            continue
        out.append(ch)
    if out and out[-1] in "XQ" and n % 2 == 0:
        out.pop()
    return "".join(out)


def process(text, key, mode):
    """Run Playfair encryption or decryption with full step details."""
    if mode not in ("encrypt", "decrypt"):
        raise PlayfairError("Mode must be 'encrypt' or 'decrypt'.")
    if text is None or not str(text).strip():
        raise PlayfairError("Please enter a message.")
    if len(text) > 5000:
        raise PlayfairError("Message is too long (maximum 5000 characters).")
    if key is not None and len(key) > 100:
        raise PlayfairError("Key is too long (maximum 100 characters).")

    matrix, key_letters = generate_key_matrix(key)
    positions = build_positions(matrix)
    pairs = prepare_digraphs(text) if mode == "encrypt" else split_ciphertext(text)

    steps, out_pairs = [], []
    for index, pair in enumerate(pairs, start=1):
        a, b = pair[0]["char"], pair[1]["char"]
        detail = _transform_pair(a, b, matrix, positions, mode)
        out_pair = "".join(detail["output"])
        out_pairs.append(out_pair)
        steps.append({
            "position": index,
            "pair": a + b,
            "letters": pair,
            **detail,
            "result": out_pair,
        })

    result = " ".join(out_pairs)
    response = {
        "mode": mode,
        "input_text": text,
        "key": key,
        "key_letters": key_letters,
        "matrix": matrix,
        "digraphs": pairs,
        "steps": steps,
        "result": result,
        "result_plain": "".join(out_pairs),
        "fillers_added": sum(1 for p in pairs for l in p if l["filler"]),
        "j_converted": sum(1 for p in pairs for l in p if l.get("converted")),
        "rule_counts": {
            r: sum(1 for s in steps if s["rule"] == r) for r in ("row", "column", "rectangle")
        },
    }
    if mode == "decrypt":
        response["probable_plaintext"] = remove_fillers(out_pairs)
    return response


def encrypt(text, key):
    return process(text, key, "encrypt")


def decrypt(text, key):
    return process(text, key, "decrypt")


if __name__ == "__main__":
    demo = encrypt("INSTRUMENTS", "MONARCHY")
    print("Key square:")
    for row in demo["matrix"]:
        print("  " + " ".join(row))
    print("Plaintext : INSTRUMENTS")
    print("Ciphertext:", demo["result"])
    print("Decrypted :", decrypt(demo["result"], "MONARCHY")["result"])
