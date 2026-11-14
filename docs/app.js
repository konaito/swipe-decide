// swipe-decide: 区切った項目を1枚ずつ いいね(右)・却下(左)・保留(下) に振り分ける。
// 入力は URL の fragment（#items=...&title=...）か貼り付け欄。状態は画面内だけに持つ。
(() => {
  "use strict";

  const SEP = /[、,，\r\n]+/;
  const LABEL = { like: "いいね", nope: "却下", hold: "保留" };
  const ORDER = ["like", "nope", "hold"];

  const $ = (id) => document.getElementById(id);
  const views = { input: $("view-input"), swipe: $("view-swipe"), result: $("view-result") };

  const state = {
    title: "",
    items: [],        // 文字列の配列
    queue: [],        // さばく順の index
    pos: 0,           // queue 上の現在位置
    decisions: new Map(), // index -> "like" | "nope" | "hold"
    history: [],      // さばいた index の順（undo 用）
    busy: false,
  };

  // ---------- 入力の解釈 ----------

  function splitItems(text) {
    return String(text || "").split(SEP).map((s) => s.trim()).filter(Boolean);
  }

  function readParams() {
    const hash = location.hash.replace(/^#/, "");
    const fromHash = new URLSearchParams(hash);
    const fromQuery = new URLSearchParams(location.search);
    const pick = (k) => (fromHash.has(k) ? fromHash.get(k) : fromQuery.get(k));
    return { items: pick("items"), title: pick("title") };
  }

  function buildHash(itemsText, title) {
    const p = new URLSearchParams();
    p.set("items", itemsText);
    if (title) p.set("title", title);
    // URLSearchParams は空白を + にする。%20 のほうが読みやすく、どちらでも同じに読める。
    return "#" + p.toString().replace(/\+/g, "%20");
  }

  // ---------- 画面切り替え ----------

  function show(name) {
    for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  }

  function boot() {
    const { items, title } = readParams();
    const list = splitItems(items);
    if (list.length === 0) {
      startInput(items, title);
      return;
    }
    startDeck(list, title || "");
  }

  // ---------- 入力画面 ----------

  function startInput(itemsText, title) {
    document.title = "swipe-decide";
    $("in-items").value = itemsText || "";
    $("in-title").value = title || "";
    updateInputCount();
    show("input");
  }

  function updateInputCount() {
    const n = splitItems($("in-items").value).length;
    $("in-count").textContent = n ? `${n} 件` : "";
    $("btn-start").disabled = n === 0;
  }

  $("in-items").addEventListener("input", updateInputCount);
  $("btn-start").addEventListener("click", () => {
    const list = splitItems($("in-items").value);
    if (!list.length) return;
    // 一覧を正規化して URL に載せる。この URL を共有すれば同じ一覧から始められる。
    const next = buildHash(list.join("\n"), $("in-title").value.trim());
    if (location.hash === next) boot();
    else location.hash = next;
  });

  // ---------- スワイプ画面 ----------

  function startDeck(list, title) {
    state.title = title;
    state.items = list;
    state.queue = list.map((_, i) => i);
    state.pos = 0;
    state.decisions = new Map();
    state.history = [];
    state.busy = false;
    document.title = title ? `${title} - swipe-decide` : "swipe-decide";
    $("sw-title").textContent = title || "振り分け";
    renderDeck();
  }

  function renderDeck() {
    if (state.pos >= state.queue.length) {
      renderResult();
      return;
    }
    show("swipe");
    const stack = $("stack");
    stack.textContent = "";

    const nextIdx = state.queue[state.pos + 1];
    if (nextIdx !== undefined) {
      const under = document.createElement("div");
      under.className = "card under";
      under.textContent = state.items[nextIdx];
      stack.appendChild(under);
    }

    const idx = state.queue[state.pos];
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.index = String(idx);
    const text = document.createElement("span");
    text.textContent = state.items[idx];
    card.appendChild(text);
    for (const k of ORDER) {
      const s = document.createElement("span");
      s.className = `stamp ${k}`;
      s.textContent = LABEL[k];
      card.appendChild(s);
    }
    stack.appendChild(card);
    attachDrag(card);

    $("sw-progress").textContent = `${state.pos + 1} / ${state.queue.length}`;
    $("btn-undo").disabled = state.history.length === 0;
  }

  function topCard() {
    return $("stack").querySelector(".card:not(.under)");
  }

  function setStamps(card, kind, strength) {
    for (const k of ORDER) {
      const s = card.querySelector(`.stamp.${k}`);
      if (s) s.style.opacity = k === kind ? String(Math.min(1, strength)) : "0";
    }
  }

  // 方向と決定の対応: 右=いいね、左=却下、下=保留（Tinder と同じ）
  function kindFor(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "like" : dx < 0 ? "nope" : null;
    return dy > 0 ? "hold" : null;
  }

  function attachDrag(card) {
    let startX = 0, startY = 0, dx = 0, dy = 0, t0 = 0, active = false, pid = null;

    card.addEventListener("pointerdown", (e) => {
      if (state.busy || (e.pointerType === "mouse" && e.button !== 0)) return;
      active = true;
      pid = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dx = dy = 0;
      t0 = performance.now();
      card.setPointerCapture(pid);
      card.classList.add("dragging");
      card.classList.remove("anim");
    });

    card.addEventListener("pointermove", (e) => {
      if (!active || e.pointerId !== pid) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
      const kind = kindFor(dx, dy);
      const dist = kind === "hold" ? dy : Math.abs(dx);
      setStamps(card, kind, dist / 100);
    });

    const end = (e, cancelled) => {
      if (!active || e.pointerId !== pid) return;
      active = false;
      card.classList.remove("dragging");
      const w = card.offsetWidth || 300;
      const dt = Math.max(1, performance.now() - t0);
      const kind = cancelled ? null : kindFor(dx, dy);
      const dist = kind === "hold" ? dy : Math.abs(dx);
      const threshold = kind === "hold" ? 90 : Math.min(110, w * 0.28);
      const flick = dist > 40 && dist / dt > 0.6;
      if (kind && (dist > threshold || flick)) {
        decide(kind, { dx, dy });
      } else {
        card.classList.add("anim");
        card.style.transform = "";
        setStamps(card, null, 0);
      }
    };
    card.addEventListener("pointerup", (e) => end(e, false));
    card.addEventListener("pointercancel", (e) => end(e, true));
  }

  function decide(kind, from) {
    if (state.busy || state.pos >= state.queue.length) return;
    const card = topCard();
    const idx = state.queue[state.pos];
    state.busy = true;

    const commit = () => {
      state.decisions.set(idx, kind);
      state.history.push(idx);
      state.pos += 1;
      state.busy = false;
      renderDeck();
    };

    if (!card) { commit(); return; }
    setStamps(card, kind, 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    let tx = 0, ty = 0;
    if (kind === "like") { tx = w * 1.2; ty = from ? from.dy : 0; }
    if (kind === "nope") { tx = -w * 1.2; ty = from ? from.dy : 0; }
    if (kind === "hold") { tx = from ? from.dx : 0; ty = h; }
    card.classList.add("anim");
    card.style.transform = `translate(${tx}px, ${ty}px) rotate(${tx / 18}deg)`;
    card.style.opacity = "0";
    setTimeout(commit, 200);
  }

  function undo() {
    if (state.busy || state.history.length === 0) return;
    const idx = state.history.pop();
    state.decisions.delete(idx);
    state.pos = state.queue.indexOf(idx);
    renderDeck();
  }

  $("btn-like").addEventListener("click", () => decide("like"));
  $("btn-nope").addEventListener("click", () => decide("nope"));
  $("btn-hold").addEventListener("click", () => decide("hold"));
  $("btn-undo").addEventListener("click", undo);
  $("btn-undo2").addEventListener("click", undo);

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!views.swipe.hidden) {
      if (e.key === "ArrowRight") { e.preventDefault(); decide("like"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); decide("nope"); }
      else if (e.key === "ArrowDown") { e.preventDefault(); decide("hold"); }
      else if (e.key === "Backspace" || e.key === "z" || e.key === "ArrowUp") { e.preventDefault(); undo(); }
    } else if (!views.result.hidden) {
      if (e.key === "Backspace" || e.key === "z") { e.preventDefault(); undo(); }
    }
  });

  // ---------- 結果画面 ----------

  function grouped() {
    const g = { like: [], nope: [], hold: [] };
    // 元の並び順で出す
    state.items.forEach((item, i) => {
      const k = state.decisions.get(i);
      if (k) g[k].push(item);
    });
    return g;
  }

  function resultText() {
    const g = grouped();
    const lines = [];
    if (state.title) lines.push(state.title);
    for (const k of ORDER) lines.push(`${LABEL[k]}: ${g[k].join("、")}`.trimEnd());
    return lines.join("\n");
  }

  function renderResult() {
    show("result");
    $("rs-title").textContent = state.title || "振り分け";
    const g = grouped();
    const box = $("rs-groups");
    box.textContent = "";
    for (const k of ORDER) {
      const sec = document.createElement("div");
      sec.className = `group ${k}`;
      const h = document.createElement("h3");
      h.textContent = LABEL[k];
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = `${g[k].length} 件`;
      h.appendChild(n);
      sec.appendChild(h);
      if (g[k].length) {
        const ul = document.createElement("ul");
        for (const item of g[k]) {
          const li = document.createElement("li");
          li.textContent = item;
          ul.appendChild(li);
        }
        sec.appendChild(ul);
      } else {
        const p = document.createElement("p");
        p.className = "none";
        p.textContent = "なし";
        sec.appendChild(p);
      }
      box.appendChild(sec);
    }
    $("rs-text").value = resultText();
    $("btn-share").hidden = typeof navigator.share !== "function";
    $("btn-rehold").hidden = g.hold.length === 0;
    $("btn-undo2").disabled = state.history.length === 0;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = $("rs-text");
      ta.focus();
      ta.select();
      try { return document.execCommand("copy"); } catch { return false; }
    }
  }

  $("btn-copy").addEventListener("click", async () => {
    toast((await copyText(resultText())) ? "コピーしました" : "コピーできませんでした。テキストを選択してコピーしてください");
  });

  $("btn-share").addEventListener("click", async () => {
    try {
      await navigator.share({ title: state.title || "swipe-decide", text: resultText() });
    } catch (err) {
      if (err && err.name !== "AbortError") toast("共有できませんでした");
    }
  });

  $("btn-restart").addEventListener("click", () => startDeck(state.items, state.title));

  $("btn-rehold").addEventListener("click", () => {
    const held = state.queue.filter((i) => state.decisions.get(i) === "hold");
    if (!held.length) return;
    // 保留にした分だけ判定を消して、もう一巡する。いいね・却下はそのまま残す。
    for (const i of held) state.decisions.delete(i);
    state.queue = held;
    state.pos = 0;
    state.history = [];
    renderDeck();
  });

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }

  window.addEventListener("hashchange", boot);
  boot();
})();
