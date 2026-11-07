(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const LABELS = { invoice: "Invoice", estimate: "Estimate", bill: "Bill" };
  const STORAGE_KEY = "albibi-draft-v1";

  const state = {
    user: null,
    company: { name: "Albibi Construction", currency: "USD", defaultTaxRate: 0 },
    doc: null,
    chat: [], // { role: "user" | "assistant" | "system", content }
    undo: [],
    busy: false,
    pdf: null, // { blob, url, key, name }
  };

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: state.company.currency || "USD" }).format(n || 0);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  function emptyDoc(type = "invoice") {
    return {
      type, number: "", date: today(), due_date: "",
      client: { name: "", company: "", email: "", phone: "", address: "" },
      project: { name: "", address: "" },
      line_items: [], tax_rate: state.company.defaultTaxRate || 0, discount: 0, amount_paid: 0, notes: "", terms: "",
    };
  }

  // Same maths as the server (netlify/lib/document.mjs).
  function totals(doc) {
    const lines = doc.line_items.map((it) => round2((it.quantity || 0) * (it.unit_price || 0)));
    const subtotal = round2(lines.reduce((a, b) => a + b, 0));
    const discount = round2(Math.min(doc.discount || 0, subtotal));
    const tax = round2(((subtotal - discount) * (doc.tax_rate || 0)) / 100);
    const total = round2(subtotal - discount + tax);
    const paid = round2(doc.amount_paid || 0);
    return { lines, subtotal, discount, tax, total, paid, balance: round2(total - paid) };
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3500);
  }

  async function api(path, body, { method = body ? "POST" : "GET", raw = false } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    if (res.status === 401 && state.user) {
      state.user = null;
      showLogin();
      throw new Error("Your session ended. Please sign in again.");
    }
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try { message = (await res.json()).error || message; } catch {}
      throw new Error(message);
    }
    return raw ? res : res.json();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: state.user, doc: state.doc, chat: state.chat.slice(-60) }));
    } catch {}
  }
  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (data && data.user === state.user && data.doc) {
        state.doc = data.doc;
        state.chat = Array.isArray(data.chat) ? data.chat : [];
        return true;
      }
    } catch {}
    return false;
  }

  // ---------------------------------------------------------------- login
  let pendingUser = "";

  function showLogin() {
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#login-email").hidden = false;
    $("#login-code").hidden = true;
    $("#login-error").textContent = "";
    setTimeout(() => $("#username").focus(), 50);
  }

  async function requestCode(username) {
    const btn = $("#login-email button[type=submit]");
    btn.disabled = true;
    $("#login-error").textContent = "";
    try {
      const { email } = await api("/api/auth/request", { username });
      pendingUser = username;
      $("#code-email").textContent = email;
      $("#login-email").hidden = true;
      $("#login-code").hidden = false;
      $("#code").value = "";
      $("#code").focus();
    } catch (err) {
      $("#login-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  $("#login-email").addEventListener("submit", (e) => {
    e.preventDefault();
    requestCode($("#username").value.trim());
  });

  $("#login-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-code button[type=submit]");
    btn.disabled = true;
    $("#login-error").textContent = "";
    try {
      await api("/api/auth/verify", { username: pendingUser, code: $("#code").value });
      await boot();
    } catch (err) {
      $("#login-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  $("#code").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6) $("#login-code").requestSubmit();
  });
  $("#resend").addEventListener("click", async () => {
    await requestCode(pendingUser);
    if (!$("#login-error").textContent) toast("A new code is on its way.");
  });
  $("#change-email").addEventListener("click", showLogin);

  $("#logout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", {}); } catch {}
    state.user = null;
    showLogin();
  });

  // ---------------------------------------------------------------- app start
  async function boot() {
    let session;
    try {
      session = await api("/api/auth/session");
    } catch {
      return showLogin();
    }
    state.user = session.email;
    state.company = session.company || state.company;
    $("#user-email").textContent = session.email;
    $("#reply-to").textContent = session.email;
    $("#login").hidden = true;
    $("#app").hidden = false;
    if (!restore()) startNew("invoice", false);
    renderChat();
    renderDoc();
  }

  function startNew(type, announce = true) {
    state.doc = emptyDoc(type);
    state.chat = [];
    state.undo = [];
    clearPdf();
    if (announce) {
      state.chat.push({ role: "system", content: `New ${LABELS[type].toLowerCase()} started.` });
    }
    renderChat();
    renderDoc();
    save();
    switchTab("chat");
    $("#input").focus();
  }

  $("#new-btn").addEventListener("click", (e) => toggleMenu("#new-menu", e.currentTarget));
  $("#user-btn").addEventListener("click", (e) => toggleMenu("#user-menu", e.currentTarget));
  $$("[data-new]").forEach((b) => b.addEventListener("click", () => {
    closeMenus();
    const hasWork = state.doc.line_items.length || state.doc.client.name || state.doc.client.company;
    if (hasWork && !state.doc.number && !confirm("Start a new document? The current draft hasn't been saved as a PDF yet.")) return;
    startNew(b.dataset.new);
  }));
  function toggleMenu(sel, btn) {
    const menu = $(sel);
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  }
  function closeMenus() {
    $$(".menu-list").forEach((m) => (m.hidden = true));
    $$("[aria-haspopup]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) closeMenus(); });

  // Tabs (phones)
  function switchTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
    if (name === "preview") $("#preview-badge").hidden = true;
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  const isPhone = () => window.matchMedia("(max-width: 860px)").matches;

  // ---------------------------------------------------------------- chat
  function renderChat() {
    const box = $("#messages");
    box.innerHTML = "";
    if (!state.chat.length) {
      const hello = document.createElement("div");
      hello.className = "msg assistant";
      hello.textContent =
        `Hi! Tell me about the job and I'll put the ${LABELS[state.doc.type].toLowerCase()} together. ` +
        "Who's it for, where was the work, what did you do and what are the prices? Any order is fine - you can also tap the mic and just talk.";
      box.appendChild(hello);
    }
    for (const m of state.chat) {
      const el = document.createElement("div");
      el.className = `msg ${m.role}`;
      el.textContent = m.content;
      box.appendChild(el);
    }
    if (state.busy) {
      const t = document.createElement("div");
      t.className = "msg assistant typing";
      t.innerHTML = "<span></span><span></span><span></span>";
      box.appendChild(t);
    }
    $("#suggestions").hidden = state.chat.some((m) => m.role === "user");
    box.scrollTop = box.scrollHeight;
  }

  async function sendMessage(text) {
    text = text.trim();
    if (!text || state.busy) return;
    state.chat.push({ role: "user", content: text });
    state.busy = true;
    $("#send").disabled = true;
    renderChat();
    save();
    try {
      const history = state.chat.filter((m) => m.role === "user" || m.role === "assistant");
      const result = await api("/api/assistant", { history, document: state.doc });
      const before = JSON.stringify(state.doc);
      if (JSON.stringify(result.document) !== before) {
        state.undo.push(before);
        state.doc = result.document;
        if (isPhone()) $("#preview-badge").hidden = false;
      }
      state.chat.push({ role: "assistant", content: result.reply });
    } catch (err) {
      state.chat.push({ role: "error", content: err.message });
    } finally {
      state.busy = false;
      $("#send").disabled = false;
      renderChat();
      renderDoc();
      save();
    }
  }

  const input = $("#input");
  const autosize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isPhone()) {
      e.preventDefault();
      $("#composer").requestSubmit();
    }
  });
  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    stopListening();
    const text = input.value;
    input.value = "";
    autosize();
    sendMessage(text);
  });
  $$("#suggestions button").forEach((b) => b.addEventListener("click", () => {
    input.value = b.textContent;
    autosize();
    input.focus();
  }));

  // Voice input (Chrome, Edge, Safari)
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let baseText = "";
  if (Recognition) {
    $("#mic").hidden = false;
    $("#mic").addEventListener("click", () => (recognizer ? stopListening() : startListening()));
  }
  function startListening() {
    recognizer = new Recognition();
    recognizer.lang = "en-US";
    recognizer.continuous = true;
    recognizer.interimResults = true;
    baseText = input.value ? input.value.replace(/\s*$/, " ") : "";
    recognizer.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      input.value = baseText + text;
      autosize();
    };
    recognizer.onerror = (e) => {
      if (e.error === "not-allowed") toast("Microphone access was blocked.");
      stopListening();
    };
    recognizer.onend = () => stopListening();
    recognizer.start();
    $("#mic").classList.add("listening");
  }
  function stopListening() {
    if (!recognizer) return;
    const r = recognizer;
    recognizer = null;
    try { r.stop(); } catch {}
    $("#mic").classList.remove("listening");
  }

  // ---------------------------------------------------------------- preview
  function renderDoc() {
    const d = state.doc;
    const t = totals(d);
    const label = LABELS[d.type];
    const missing = (s) => `<span class="missing">${esc(s)}</span>`;
    const c = d.client;
    const clientName = c.company || c.name;
    const clientLines = [c.company && c.name ? `Attn: ${c.name}` : "", c.address, c.phone, c.email].filter(Boolean);
    const p = d.project;

    const rows = d.line_items.map((it, i) => `
      <tr>
        <td><div class="desc">${esc(it.description)}</div>${it.details ? `<div class="details">${esc(it.details)}</div>` : ""}</td>
        <td class="num">${esc(+it.quantity.toFixed(2))}</td>
        <td class="unit-col">${esc(it.unit)}</td>
        <td class="num ${it.unit_price ? "" : "zero"}">${it.unit_price ? money(it.unit_price) : "price?"}</td>
        <td class="num"><b>${money(t.lines[i])}</b></td>
      </tr>`).join("");

    const hasContent = d.line_items.length || clientName || p.name || p.address;
    $("#paper").innerHTML = `
      <div class="doc-head">
        <div>
          <div class="doc-company">${esc(state.company.name.toUpperCase())}</div>
        </div>
        <div class="doc-title">
          <div class="kind">${label.toUpperCase()}</div>
          <div class="doc-meta">
            ${label} # <b>${esc(d.number || "Draft")}</b><br>
            Date <b>${esc(fmtDate(d.date))}</b>
            ${d.due_date ? `<br>${d.type === "estimate" ? "Valid until" : "Due"} <b>${esc(fmtDate(d.due_date))}</b>` : ""}
          </div>
        </div>
      </div>
      <div class="doc-parties">
        <div>
          <h4>${d.type === "estimate" ? "PREPARED FOR" : "BILL TO"}</h4>
          <div class="name">${clientName ? esc(clientName) : missing("Customer name")}</div>
          ${clientLines.map((l) => `<div class="line">${esc(l)}</div>`).join("")}
        </div>
        <div>
          <h4>PROJECT / JOB SITE</h4>
          <div class="name">${p.name ? esc(p.name) : p.address ? "Job site" : missing("Job / address")}</div>
          ${p.address ? `<div class="line">${esc(p.address)}</div>` : ""}
        </div>
      </div>
      <table class="items">
        <thead><tr><th>DESCRIPTION</th><th class="num">QTY</th><th class="unit-col">UNIT</th><th class="num">RATE</th><th class="num">AMOUNT</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="missing">Work and materials will appear here as you describe them.</td></tr>`}</tbody>
      </table>
      <div class="totals">
        <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        ${t.discount ? `<div><span>Discount</span><span>-${money(t.discount)}</span></div>` : ""}
        ${d.tax_rate ? `<div><span>Tax (${esc(d.tax_rate)}%)</span><span>${money(t.tax)}</span></div>` : ""}
        <div class="grand ${t.paid ? "soft" : ""}"><span>${d.type === "estimate" ? "Estimated total" : "Total"}</span><span>${money(t.total)}</span></div>
        ${t.paid ? `<div><span>Paid / deposit</span><span>-${money(t.paid)}</span></div>
        <div class="grand"><span>Balance due</span><span>${money(t.balance)}</span></div>` : ""}
      </div>
      ${d.notes ? `<div class="doc-notes"><h4>NOTES</h4><p>${esc(d.notes)}</p></div>` : ""}
      ${d.terms ? `<div class="doc-notes"><h4>TERMS</h4><p>${esc(d.terms)}</p></div>` : ""}
      ${hasContent ? "" : `<div class="empty">Start chatting and your ${label.toLowerCase()} builds itself here.</div>`}
    `;
    $("#undo").disabled = !state.undo.length;
    $("#make-pdf").disabled = !d.line_items.length;
    const fresh = state.pdf && state.pdf.key === pdfKey();
    $("#share-bar").hidden = !fresh;
    $("#make-pdf").hidden = fresh;
    $("#make-pdf").textContent = state.pdf || d.number ? "Update PDF" : "Create PDF";
  }

  $("#undo").addEventListener("click", () => {
    const prev = state.undo.pop();
    if (!prev) return;
    state.doc = JSON.parse(prev);
    state.chat.push({ role: "system", content: "Last change undone." });
    renderChat();
    renderDoc();
    save();
  });

  // ---------------------------------------------------------------- PDF
  const pdfKey = () => JSON.stringify(state.doc);
  function clearPdf() {
    if (state.pdf) URL.revokeObjectURL(state.pdf.url);
    state.pdf = null;
  }

  async function makePdf() {
    const btn = $("#make-pdf");
    btn.disabled = true;
    btn.textContent = "Creating...";
    try {
      const res = await api("/api/pdf", { document: state.doc }, { raw: true });
      const doc = JSON.parse(decodeURIComponent(res.headers.get("x-document")));
      const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "document.pdf";
      const blob = await res.blob();
      const isNew = !state.doc.number;
      state.doc = doc;
      clearPdf();
      state.pdf = { blob, url: URL.createObjectURL(blob), key: pdfKey(), name };
      save();
      toast(isNew ? `${LABELS[doc.type]} ${doc.number} created.` : "PDF updated.");
      return state.pdf;
    } catch (err) {
      toast(err.message);
      return null;
    } finally {
      renderDoc();
    }
  }
  const ensurePdf = async () => (state.pdf && state.pdf.key === pdfKey() ? state.pdf : makePdf());

  $("#make-pdf").addEventListener("click", makePdf);
  $("#download").addEventListener("click", async () => {
    const pdf = await ensurePdf();
    if (!pdf) return;
    const a = document.createElement("a");
    a.href = pdf.url;
    a.download = pdf.name;
    a.click();
  });
  $("#open-pdf").addEventListener("click", async () => {
    const pdf = await ensurePdf();
    if (pdf) window.open(pdf.url, "_blank");
  });
  $("#share").addEventListener("click", async () => {
    const pdf = await ensurePdf();
    if (!pdf) return;
    const file = new File([pdf.blob], pdf.name, { type: "application/pdf" });
    const label = LABELS[state.doc.type];
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${label} ${state.doc.number}`, text: `${label} ${state.doc.number} from ${state.company.name}` });
      } catch (err) {
        if (err.name !== "AbortError") toast("Sharing didn't work - try Download instead.");
      }
    } else {
      toast("Sharing isn't supported in this browser - the PDF was downloaded instead.");
      $("#download").click();
    }
  });

  // ---------------------------------------------------------------- email
  const emailDialog = $("#email-dialog");
  $("#email").addEventListener("click", () => {
    $("#email-to").value = state.doc.client.email || "";
    $("#email-cc").value = "";
    $("#email-message").value = "";
    $("#email-error").textContent = "";
    emailDialog.showModal();
    ($("#email-to").value ? $("#email-message") : $("#email-to")).focus();
  });
  $("#email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#email-send");
    btn.disabled = true;
    btn.textContent = "Sending...";
    $("#email-error").textContent = "";
    try {
      const result = await api("/api/send", {
        document: state.doc,
        to: $("#email-to").value,
        cc: $("#email-cc").value,
        message: $("#email-message").value,
      });
      const hadNumber = Boolean(state.doc.number);
      state.doc = result.document;
      if (!hadNumber) clearPdf();
      save();
      renderDoc();
      emailDialog.close();
      toast(`Sent to ${$("#email-to").value}.`);
    } catch (err) {
      $("#email-error").textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Send email";
    }
  });

  // ---------------------------------------------------------------- history
  const historyDialog = $("#history-dialog");
  $("#history-btn").addEventListener("click", async () => {
    const list = $("#history-list");
    list.innerHTML = `<p class="muted">Loading...</p>`;
    historyDialog.showModal();
    try {
      const { documents } = await api("/api/documents");
      if (!documents.length) {
        list.innerHTML = `<p class="muted">Nothing yet. Documents appear here once you create a PDF.</p>`;
        return;
      }
      list.innerHTML = documents.map((d) => `
        <button class="history-item" data-number="${esc(d.number)}">
          <span class="num">${esc(d.number)}${d.sent ? '<span class="pill sent">sent</span>' : ""}</span>
          <span class="amt">${money(d.total)}</span>
          <span class="sub">${esc(d.client || "No customer")}${d.project ? " - " + esc(d.project) : ""}</span>
          <span class="sub">${esc(fmtDate(d.date))}</span>
          <span class="sub" style="grid-column:1/-1">by ${esc(d.createdBy)}</span>
        </button>`).join("");
    } catch (err) {
      list.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  });
  $("#history-list").addEventListener("click", async (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    try {
      const record = await api(`/api/documents?number=${encodeURIComponent(item.dataset.number)}`);
      state.doc = record.document;
      state.chat = [{ role: "system", content: `Opened ${LABELS[record.document.type].toLowerCase()} ${record.document.number}. Tell me what to change.` }];
      state.undo = [];
      clearPdf();
      historyDialog.close();
      renderChat();
      renderDoc();
      save();
    } catch (err) {
      toast(err.message);
    }
  });

  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  boot();
})();
