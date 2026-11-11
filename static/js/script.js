/* ==========================================================================
   Playfair Cipher Dashboard — front-end logic
   The Flask API (playfair.py) is the source of truth for encryption and
   decryption; the browser renders the result, steps and visualisations.
   generateKeyMatrix() is mirrored here only for the live key-square preview.
   ========================================================================== */
(function () {
  "use strict";

  const ALPHABET = "ABCDEFGHIKLMNOPQRSTUVWXYZ"; // 25 letters, no J
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------------------------------------------------------- helpers
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function toast(message, type = "info") {
    const stack = $("#toastStack");
    if (!stack) return;
    const icons = { success: "fa-circle-check", danger: "fa-circle-exclamation", warning: "fa-triangle-exclamation", info: "fa-circle-info" };
    const el = document.createElement("div");
    el.className = `app-toast app-toast-${type}`;
    el.setAttribute("role", "status");
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add("hide"); setTimeout(() => el.remove(), 350); }, 3200);
  }

  // Auto-hide server flash messages
  $$(".toast-stack .app-toast").forEach((el) => {
    setTimeout(() => { el.classList.add("hide"); setTimeout(() => el.remove(), 350); }, 3800);
  });

  async function postJSON(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken, "Accept": "application/json" },
      body: JSON.stringify(payload || {}),
      credentials: "same-origin",
    });
    let data = {};
    try { data = await res.json(); } catch (e) { data = { error: "Unexpected server response." }; }
    if (res.status === 401) {
      toast(data.error || "Session expired. Please log in again.", "warning");
      setTimeout(() => { window.location.href = "/login"; }, 1200);
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    return data;
  }

  function storageGet(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, v) { try { window.sessionStorage.setItem(key, v); } catch (e) { /* ignore */ } }
  function storageDel(key) { try { window.sessionStorage.removeItem(key); } catch (e) { /* ignore */ } }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  // ------------------------------------------------------- cipher helpers
  /** Build the 5x5 key square (mirror of playfair.generate_key_matrix). */
  function generateKeyMatrix(key) {
    const keyLetters = [];
    const typed = [];
    for (const raw of String(key || "").toUpperCase()) {
      if (raw < "A" || raw > "Z") continue;
      const ch = raw === "J" ? "I" : raw;
      typed.push({ ch, dup: keyLetters.includes(ch), fromJ: raw === "J" });
      if (!keyLetters.includes(ch)) keyLetters.push(ch);
    }
    const seq = keyLetters.concat(ALPHABET.split("").filter((c) => !keyLetters.includes(c)));
    const matrix = [];
    for (let r = 0; r < 5; r++) matrix.push(seq.slice(r * 5, r * 5 + 5));
    return { matrix, keyLetters, typed };
  }

  /** Count letters after cleaning (used for the live counter). */
  function countLetters(text) { return (String(text || "").match(/[a-z]/gi) || []).length; }

  // ================================================================ LOGIN
  const pwToggle = $("#pwToggle");
  if (pwToggle) {
    pwToggle.addEventListener("click", () => {
      const input = $("#password");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      pwToggle.innerHTML = `<i class="fa-solid ${show ? "fa-eye-slash" : "fa-eye"}"></i>`;
      pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
    $("#loginForm")?.addEventListener("submit", (e) => {
      if (!$("#username").value.trim() || !$("#password").value) {
        e.preventDefault();
        toast("Please enter both username and password.", "danger");
      }
    });
  }

  // ============================================================ DASHBOARD
  const cipherForm = $("#cipherForm");
  if (cipherForm) initDashboard();

  function initDashboard() {
    const messageInput = $("#messageInput");
    const keyInput = $("#keyInput");
    const btnEncrypt = $("#btnEncrypt");
    const btnDecrypt = $("#btnDecrypt");
    let lastResult = null;
    let preferredMode = "encrypt";
    const viz = { steps: [], matrix: [], index: 0, timer: null };
    let chart = null;

    // ---------- live key square ----------
    function renderKeySquare(container, matrix, keyLetters, opts = {}) {
      container.innerHTML = "";
      matrix.forEach((row, r) => row.forEach((ch, c) => {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r; cell.dataset.c = c; cell.dataset.ch = ch;
        if (!opts.plain && keyLetters.includes(ch)) cell.classList.add("is-key");
        cell.innerHTML = ch === "I" ? 'I<span class="ij">/J</span>' : ch;
        container.appendChild(cell);
      }));
    }

    function updateLiveSquare(animate) {
      const key = keyInput.value;
      const { matrix, keyLetters, typed } = generateKeyMatrix(key);
      renderKeySquare($("#liveSquare"), matrix, keyLetters);
      if (animate) $$("#liveSquare .cell.is-key").forEach((c, i) => setTimeout(() => c.classList.add("pop"), i * 25));

      const label = $("#keySquareLabel");
      label.textContent = keyLetters.length ? `Key: ${keyLetters.join("")}` : "No key yet";

      const seq = $("#keySequence");
      if (!typed.length) {
        seq.innerHTML = '<span><i class="fa-solid fa-keyboard"></i> Type a key to build the square.</span>';
      } else {
        seq.innerHTML = '<span>Key letters:</span>' + typed.map((t) =>
          `<span class="k ${t.dup ? "dup" : ""}" title="${t.dup ? "Repeated — skipped" : t.fromJ ? "J becomes I" : "Placed in square"}">${t.fromJ ? "J→I" : t.ch}</span>`
        ).join("");
      }

      // 26-letter alphabet panel: key letters highlighted, J merged with I
      const grid = $("#alphaGrid");
      grid.innerHTML = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((ch) => {
        let cls = "a";
        if (ch === "J") cls += " merged";
        else if (keyLetters.includes(ch)) cls += " used";
        return `<span class="${cls}" title="${ch === "J" ? "Shares the I cell" : ""}">${ch}</span>`;
      }).join("");
    }

    // ---------- validation ----------
    function setError(field, errorEl, message) {
      field.classList.toggle("is-invalid", !!message);
      errorEl.innerHTML = message ? `<i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(message)}` : "";
      errorEl.classList.toggle("show", !!message);
    }

    function validateInput(mode) {
      const msg = messageInput.value;
      const key = keyInput.value;
      let ok = true;
      let msgErr = "", keyErr = "";

      if (!msg.trim()) msgErr = "Please enter a message.";
      else if (countLetters(msg) === 0) msgErr = "Message must contain at least one alphabetic character.";
      else if (mode === "decrypt" && countLetters(msg) % 2 !== 0) msgErr = `Ciphertext must contain an even number of letters (found ${countLetters(msg)}).`;

      if (!key.trim()) keyErr = "Please enter a key.";
      else if (countLetters(key) === 0) keyErr = "Key must contain at least one alphabetic character.";

      setError(messageInput, $("#messageError"), msgErr);
      setError(keyInput, $("#keyError"), keyErr);
      if (msgErr || keyErr) {
        ok = false;
        (msgErr ? messageInput : keyInput).focus();
      }
      return ok;
    }

    // ---------- encrypt / decrypt ----------
    async function runCipher(mode) {
      if (!validateInput(mode)) return;
      const btn = mode === "encrypt" ? btnEncrypt : btnDecrypt;
      const original = btn.innerHTML;
      btnEncrypt.disabled = btnDecrypt.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Working...';
      try {
        const data = await postJSON(`/${mode}`, { message: messageInput.value, key: keyInput.value });
        lastResult = data;
        renderResult(data);
        renderDigraphs(data);
        calculateSteps(data);
        updateStatistics(data.statistics);
        toast(mode === "encrypt" ? "Message encrypted and saved to history." : "Message decrypted and saved to history.", "success");
        $("#resultSection").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        const message = err.message || "Something went wrong.";
        if (/key/i.test(message) && !/ciphertext|message/i.test(message)) setError(keyInput, $("#keyError"), message);
        else setError(messageInput, $("#messageError"), message);
        toast(message, "danger");
      } finally {
        btnEncrypt.disabled = btnDecrypt.disabled = false;
        btn.innerHTML = original;
      }
    }
    function encryptPlayfair() { preferredMode = "encrypt"; return runCipher("encrypt"); }
    function decryptPlayfair() { preferredMode = "decrypt"; return runCipher("decrypt"); }

    function renderResult(data) {
      $("#resultSection").classList.remove("d-none");
      const isEnc = data.mode === "encrypt";
      const modeChip = $("#resultMode");
      modeChip.textContent = isEnc ? "Encryption" : "Decryption";
      modeChip.className = `chip chip-sm ms-2 ${isEnc ? "" : "chip-green"}`;

      const out = $("#resultText");
      out.textContent = data.result;
      out.classList.remove("reveal"); void out.offsetWidth; out.classList.add("reveal");

      const probable = $("#probableBox");
      if (!isEnc && data.probable_plaintext && data.probable_plaintext !== data.result_plain) {
        probable.classList.remove("d-none");
        $("#probableText").textContent = data.probable_plaintext;
      } else {
        probable.classList.add("d-none");
      }

      const rc = data.rule_counts;
      $("#resultMeta").innerHTML = [
        `<span class="chip chip-sm"><i class="fa-solid fa-key"></i> Key: ${escapeHtml(data.key_letters.join(""))}</span>`,
        `<span class="chip chip-sm chip-purple"><i class="fa-solid fa-link"></i> ${data.steps.length} pairs</span>`,
        `<span class="rule-pill rule-pill-row">Row × ${rc.row}</span>`,
        `<span class="rule-pill rule-pill-column">Column × ${rc.column}</span>`,
        `<span class="rule-pill rule-pill-rectangle">Rectangle × ${rc.rectangle}</span>`,
        isEnc ? `<span class="chip chip-sm chip-cyan">Fillers added: ${data.fillers_added}</span>` : "",
        data.j_converted ? `<span class="chip chip-sm chip-cyan">J → I: ${data.j_converted}</span>` : "",
      ].join("");
    }

    function prepareDigraphs(data) {
      // Clean letters exactly as the server did (J shown as converted)
      const clean = data.digraphs.flat().filter((l) => !l.filler).map((l) => l.char).join("");
      return { clean, pairs: data.digraphs };
    }

    function renderDigraphs(data) {
      $("#digraphSection").classList.remove("d-none");
      const { clean, pairs } = prepareDigraphs(data);
      $("#prepOriginal").textContent = data.input_text;
      $("#prepClean").textContent = clean;
      $("#digraphList").innerHTML = pairs.map((pair) =>
        '<span class="digraph">' + pair.map((l) => {
          const cls = l.filler ? "filler" : (l.converted ? "conv" : "");
          const title = l.filler ? "Filler letter inserted" : (l.converted ? "J converted to I" : "");
          return `<span class="${cls}" title="${title}">${escapeHtml(l.char)}</span>`;
        }).join("") + "</span>"
      ).join("");
    }

    // ---------- step table ----------
    function calculateSteps(data) {
      $("#stepsSection").classList.remove("d-none");
      const tbody = $("#stepsTable tbody");
      const ruleIcon = { row: "fa-arrows-left-right", column: "fa-arrows-up-down", rectangle: "fa-vector-square" };
      tbody.innerHTML = data.steps.map((s, i) => {
        const [a, b] = s.pair;
        const [pa, pb] = s.in_pos;
        const fillerNote = s.letters[1].filler ? ' <span class="mini-note">filler</span>' : "";
        return `<tr data-index="${i}" tabindex="0">
          <td>${s.position}</td>
          <td class="mono fw-semibold">${escapeHtml(s.pair)}${fillerNote}</td>
          <td class="mono small text-nowrap">${a}(${pa[0] + 1},${pa[1] + 1}) · ${b}(${pb[0] + 1},${pb[1] + 1})</td>
          <td><span class="rule-pill rule-pill-${s.rule}"><i class="fa-solid ${ruleIcon[s.rule]}"></i> ${s.rule[0].toUpperCase() + s.rule.slice(1)}</span></td>
          <td class="how-cell">${escapeHtml(s.explanation)}</td>
          <td class="mono fw-semibold text-accent">${escapeHtml(s.result)}</td>
        </tr>`;
      }).join("");

      viz.steps = data.steps;
      viz.matrix = data.matrix;
      viz.mode = data.mode;
      stopPlay();
      highlightStep(0);
    }

    // ---------- visualizer ----------
    function highlightStep(index) {
      if (!viz.steps.length) return;
      viz.index = (index + viz.steps.length) % viz.steps.length;
      const s = viz.steps[viz.index];
      const container = $("#vizSquare");
      renderKeySquare(container, viz.matrix, [], { plain: true });

      const cellAt = (r, c) => container.children[r * 5 + c];
      $$(".cell", container).forEach((c) => c.classList.add("dim"));
      if (s.rule === "rectangle") {
        const [r1, r2] = [s.in_pos[0][0], s.in_pos[1][0]].sort((x, y) => x - y);
        const [c1, c2] = [s.in_pos[0][1], s.in_pos[1][1]].sort((x, y) => x - y);
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
          cellAt(r, c).classList.add("rect-area"); cellAt(r, c).classList.remove("dim");
        }
      } else if (s.rule === "row") {
        for (let c = 0; c < 5; c++) cellAt(s.in_pos[0][0], c).classList.remove("dim");
      } else {
        for (let r = 0; r < 5; r++) cellAt(r, s.in_pos[0][1]).classList.remove("dim");
      }
      s.in_pos.forEach(([r, c], k) => {
        const el = cellAt(r, c);
        el.classList.add("is-in"); el.classList.remove("dim", "rect-area");
        el.insertAdjacentHTML("beforeend", `<span class="tag">${k + 1}</span>`);
      });
      s.out_pos.forEach(([r, c]) => {
        const el = cellAt(r, c);
        el.classList.add("is-out"); el.classList.remove("dim", "rect-area");
      });

      $("#vizCounter").textContent = `${viz.index + 1} / ${viz.steps.length}`;
      $("#vizCaption").innerHTML =
        `<span class="big">${escapeHtml(s.pair)} <i class="fa-solid fa-arrow-right-long text-soft"></i> <span class="text-accent">${escapeHtml(s.result)}</span></span>` +
        `<span class="rule-pill rule-pill-${s.rule} mb-1">${s.rule[0].toUpperCase() + s.rule.slice(1)} rule</span><br>${escapeHtml(s.explanation)}`;

      $$("#stepsTable tbody tr").forEach((tr) => tr.classList.toggle("active", Number(tr.dataset.index) === viz.index));
    }

    function stopPlay() {
      if (viz.timer) clearInterval(viz.timer);
      viz.timer = null;
      $("#vizPlay").innerHTML = '<i class="fa-solid fa-play"></i> Play';
    }
    function togglePlay() {
      if (viz.timer) return stopPlay();
      if (viz.index >= viz.steps.length - 1) highlightStep(0);
      $("#vizPlay").innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
      viz.timer = setInterval(() => {
        if (viz.index >= viz.steps.length - 1) return stopPlay();
        highlightStep(viz.index + 1);
      }, 1500);
    }

    // ---------- statistics + chart + recent ----------
    function setStat(id, value) {
      const el = $(id);
      if (!el || String(el.textContent) === String(value)) return;
      el.textContent = value;
      el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    }

    function updateStatistics(stats) {
      if (!stats) return;
      setStat("#statTotal", stats.total);
      setStat("#statEncrypted", stats.encrypted);
      setStat("#statDecrypted", stats.decrypted);
      setStat("#statAvgKey", stats.avg_key_length);
      renderChart(stats.chart);
      renderRecent(stats.recent);
    }

    function renderChart(chartData) {
      const canvas = $("#activityChart");
      if (!canvas || typeof Chart === "undefined" || !chartData) return;
      if (chart) {
        chart.data.labels = chartData.labels;
        chart.data.datasets[0].data = chartData.encrypted;
        chart.data.datasets[1].data = chartData.decrypted;
        chart.update();
        return;
      }
      Chart.defaults.color = "#8f9bb8";
      Chart.defaults.font.family = "'Space Grotesk', system-ui, sans-serif";
      chart = new Chart(canvas, {
        type: "bar",
        data: {
          labels: chartData.labels,
          datasets: [
            { label: "Encrypted", data: chartData.encrypted, backgroundColor: "rgba(79,140,255,0.75)", borderRadius: 6, maxBarThickness: 28 },
            { label: "Decrypted", data: chartData.decrypted, backgroundColor: "rgba(52,211,153,0.7)", borderRadius: 6, maxBarThickness: 28 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(255,255,255,0.06)" } },
          },
        },
      });
    }

    function renderRecent(recent) {
      const list = $("#recentList");
      if (!list) return;
      if (!recent || !recent.length) {
        list.innerHTML = '<li class="recent-empty"><i class="fa-solid fa-box-open"></i>&nbsp; No operations yet — try an example above.</li>';
        return;
      }
      list.innerHTML = recent.map((op) => {
        const enc = op.operation_type === "Encryption";
        return `<li>
          <span class="r-icon ${enc ? "r-enc" : "r-dec"}"><i class="fa-solid ${enc ? "fa-lock" : "fa-lock-open"}"></i></span>
          <div class="r-body">
            <div class="r-line">${escapeHtml(op.input_text)} <span class="text-soft">→</span> <span class="text-accent">${escapeHtml(op.result)}</span></div>
            <div class="r-time">${escapeHtml(op.operation_type)} · key ${escapeHtml(op.key)} · ${escapeHtml(op.created_at)}</div>
          </div>
        </li>`;
      }).join("");
    }

    // ---------- copy / download / clear ----------
    async function copyResult() {
      if (!lastResult) return toast("Nothing to copy yet.", "warning");
      const ok = await copyText(lastResult.result);
      const btn = $("#btnCopy");
      if (ok) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy Result'; }, 1600);
        toast("Result copied to clipboard.", "success");
      } else {
        toast("Copy failed — select the result and copy manually.", "danger");
      }
    }

    function downloadResult() {
      if (!lastResult) return toast("Nothing to download yet.", "warning");
      const d = lastResult;
      const lines = [
        "PLAYFAIR CIPHER RESULT",
        "======================",
        `Operation   : ${d.mode === "encrypt" ? "Encryption" : "Decryption"}`,
        `Date        : ${d.operation ? d.operation.created_at : new Date().toLocaleString()}`,
        `Key         : ${d.key}`,
        `Input       : ${d.input_text}`,
        `Result      : ${d.result}`,
      ];
      if (d.mode === "decrypt" && d.probable_plaintext) lines.push(`Probable    : ${d.probable_plaintext}  (fillers removed)`);
      lines.push("", "Key Square (I/J share a cell):");
      d.matrix.forEach((row) => lines.push("   " + row.join(" ")));
      lines.push("", "Step-by-step:");
      d.steps.forEach((s) => lines.push(`  ${String(s.position).padStart(2)}. ${s.pair} -> ${s.result}  [${s.rule}] ${s.explanation}`));
      lines.push("", "Generated by Playfair Cipher Dashboard (educational use only).");

      const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "playfair_result.txt";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Downloaded playfair_result.txt", "success");
    }

    function clearDashboard() {
      stopPlay();
      messageInput.value = ""; keyInput.value = "";
      setError(messageInput, $("#messageError"), "");
      setError(keyInput, $("#keyError"), "");
      ["#resultSection", "#digraphSection", "#stepsSection"].forEach((s) => $(s).classList.add("d-none"));
      lastResult = null; viz.steps = [];
      $("#letterCount").textContent = "0 letters";
      updateLiveSquare(false);
      messageInput.focus();
    }

    // ---------- wire up events ----------
    keyInput.addEventListener("input", () => { updateLiveSquare(true); setError(keyInput, $("#keyError"), ""); });
    messageInput.addEventListener("input", () => {
      const n = countLetters(messageInput.value);
      $("#letterCount").textContent = `${n} letter${n === 1 ? "" : "s"}`;
      setError(messageInput, $("#messageError"), "");
    });
    [messageInput, keyInput].forEach((el) => el.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runCipher(preferredMode); }
      if (el === keyInput && e.key === "Enter") { e.preventDefault(); runCipher(preferredMode); }
    }));
    btnEncrypt.addEventListener("click", encryptPlayfair);
    btnDecrypt.addEventListener("click", decryptPlayfair);
    $("#btnClear").addEventListener("click", clearDashboard);
    $("#btnCopy").addEventListener("click", copyResult);
    $("#btnDownload").addEventListener("click", downloadResult);
    $("#vizPrev").addEventListener("click", () => { stopPlay(); highlightStep(viz.index - 1); });
    $("#vizNext").addEventListener("click", () => { stopPlay(); highlightStep(viz.index + 1); });
    $("#vizPlay").addEventListener("click", togglePlay);
    $("#stepsTable tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-index]");
      if (tr) { stopPlay(); highlightStep(Number(tr.dataset.index)); }
    });
    $("#stepsTable tbody").addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr[data-index]");
      if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); stopPlay(); highlightStep(Number(tr.dataset.index)); }
    });
    $$("[data-example]").forEach((btn) => btn.addEventListener("click", () => {
      const [msg, key] = btn.dataset.example.split("|");
      messageInput.value = msg; keyInput.value = key;
      messageInput.dispatchEvent(new Event("input"));
      updateLiveSquare(true);
      toast("Example loaded — press Encrypt.", "info");
      btnEncrypt.focus();
    }));

    // Navbar "Encrypt" / "Decrypt" links on this page
    function applyModeFromHash() {
      const mode = window.location.hash.replace("#", "");
      if (mode !== "encrypt" && mode !== "decrypt") return;
      preferredMode = mode;
      messageInput.placeholder = mode === "encrypt" ? "Enter your message to encrypt..." : "Enter ciphertext to decrypt...";
      (mode === "encrypt" ? btnEncrypt : btnDecrypt).classList.add("pulse-once");
      setTimeout(() => messageInput.focus({ preventScroll: true }), 300);
    }
    $$("[data-mode-link]").forEach((a) => a.addEventListener("click", () => {
      const nav = $("#mainNav");
      if (nav && nav.classList.contains("show") && window.bootstrap) bootstrap.Collapse.getOrCreateInstance(nav).hide();
    }));
    window.addEventListener("hashchange", applyModeFromHash);

    // Replay from the history page
    const replay = storageGet("pf_replay");
    if (replay) {
      storageDel("pf_replay");
      try {
        const r = JSON.parse(replay);
        messageInput.value = r.message || "";
        keyInput.value = r.key || "";
        messageInput.dispatchEvent(new Event("input"));
        preferredMode = r.mode === "decrypt" ? "decrypt" : "encrypt";
        toast(`Loaded from history — press ${preferredMode === "encrypt" ? "Encrypt" : "Decrypt"} to run it again.`, "info");
      } catch (e) { /* ignore */ }
    }

    // Initial render
    updateLiveSquare(false);
    applyModeFromHash();
    try { updateStatistics(JSON.parse($("#initialStats").textContent)); } catch (e) { /* ignore */ }
  }

  // ============================================================== HISTORY
  if ($("#historyTable") || $("#viewModal")) initHistory();

  function initHistory() {
    let current = null;
    const modalEl = $("#viewModal");
    const modal = modalEl && window.bootstrap ? new bootstrap.Modal(modalEl) : null;

    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-view-id]");
      if (!btn) return;
      try {
        const res = await fetch(`/api/history/${encodeURIComponent(btn.dataset.viewId)}`, { headers: { Accept: "application/json" } });
        const op = await res.json();
        if (!res.ok) throw new Error(op.error || "Could not load record.");
        current = op;
        const enc = op.operation_type === "Encryption";
        $("#viewModalBody").innerHTML = `
          <div class="detail-grid">
            <div class="d-flex flex-wrap gap-2">
              <span class="badge-op ${enc ? "badge-enc" : "badge-dec"}"><i class="fa-solid ${enc ? "fa-lock" : "fa-lock-open"}"></i> ${escapeHtml(op.operation_type)}</span>
              <span class="chip chip-sm"><i class="fa-regular fa-clock"></i> ${escapeHtml(op.created_at)}</span>
              <span class="chip chip-sm chip-purple">ID #${op.id}</span>
            </div>
            <div class="detail-item"><div class="lbl">Input</div><div class="val">${escapeHtml(op.input_text)}</div></div>
            <div class="detail-item"><div class="lbl">Key</div><div class="val">${escapeHtml(op.key)}</div></div>
            <div class="detail-item"><div class="lbl">Result</div><div class="val text-accent fw-semibold">${escapeHtml(op.result)}</div></div>
          </div>`;
        modal ? modal.show() : alert(`${op.operation_type}\n${op.input_text}\n→ ${op.result}`);
      } catch (err) {
        toast(err.message, "danger");
      }
    });

    $("#modalCopy")?.addEventListener("click", async () => {
      if (!current) return;
      (await copyText(current.result)) ? toast("Result copied to clipboard.", "success") : toast("Copy failed.", "danger");
    });
    $("#modalReplay")?.addEventListener("click", () => {
      if (!current) return;
      storageSet("pf_replay", JSON.stringify({
        message: current.input_text, key: current.key,
        mode: current.operation_type === "Encryption" ? "encrypt" : "decrypt",
      }));
      window.location.href = "/dashboard";
    });

    $$("form[data-delete-form]").forEach((form) => form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!confirm("Delete this history record?")) return;
      try {
        await postJSON(form.action, {});
        const row = form.closest("tr");
        row.classList.add("removing");
        setTimeout(() => {
          row.remove();
          const left = $$("#historyTable tbody tr").length;
          if (!left) window.location.reload();
        }, 350);
        toast("History record deleted.", "success");
      } catch (err) {
        toast(err.message, "danger");
      }
    }));
  }

  // ------------------------------------------------------------- Theme Switcher
  const themeNames = {
    cyber: "Cyber Neon",
    matrix: "Emerald Matrix",
    sunset: "Sunset Flare",
    ocean: "Ocean Abyss",
    amethyst: "Obsidian Amethyst"
  };

  function applyTheme(theme) {
    if (!themeNames[theme]) theme = "cyber";
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("pf_theme", theme); } catch (e) {}
    $$("#currentThemeLabel").forEach((lbl) => { lbl.textContent = themeNames[theme]; });
    $$("[data-set-theme]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-set-theme") === theme);
    });
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-set-theme]");
    if (btn) {
      const t = btn.getAttribute("data-set-theme");
      applyTheme(t);
    }
  });

  try {
    const savedTheme = localStorage.getItem("pf_theme") || "cyber";
    applyTheme(savedTheme);
  } catch (e) {
    applyTheme("cyber");
  }
})();
