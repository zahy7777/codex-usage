(function (root) {
  "use strict";

  root.createLedgerView = function ({ api, t, escapeHTML, fullToken, openDialog, closeDialog }) {
    const dialog = document.querySelector("#ledgerDialog");
    const content = document.querySelector("#ledgerContent");
    const title = document.querySelector("#ledgerTitle");
    const link = document.querySelector("#ledgerCodexLink");
    const context = document.querySelector("#ledgerProjectionContext");
    const parts = ["cached", "regular", "reasoning", "direct"];
    let ledger = null;
    let threadID = "";
    let serial = 0;
    let pinned = null;

    const usageParts = (usage = {}) => ({
      cached: Number(usage.cached_input || 0),
      regular: Math.max(0, Number(usage.input || 0) - Number(usage.cached_input || 0)),
      reasoning: Number(usage.reasoning_output || 0),
      direct: Math.max(0, Number(usage.output || 0) - Number(usage.reasoning_output || 0))
    });
    const total = (usage = {}) => Number(usage.total || 0);
    const number = (value) => fullToken(Number(value || 0));
    const label = (part) => t(`ledger.${part}`);
    const price = (value = {}) => {
      const apiCost = value.api_equivalent || {};
      const credits = value.codex_credits || {};
      return `<div class="ledger-estimates"><span>${t("ledger.apiEstimate")}: ${apiCost.unpriced_tokens ? t("ledger.partial") + " " : ""}$${escapeHTML(apiCost.usd || "0")}</span><span>${t("ledger.creditEstimate")}: ${credits.unpriced_tokens ? t("ledger.partial") + " " : ""}${escapeHTML(credits.credits || t("ledger.unknown"))}</span></div>`;
    };
    const numbers = (usage = {}) => {
      const values = usageParts(usage);
      const items = [
        ["cached", values.cached], ["regular", values.regular],
        ["reasoning", values.reasoning], ["direct", values.direct],
        ["input", usage.input], ["output", usage.output],
        ["cacheWrite", usage.cache_write_input], ["total", usage.total]
      ];
      return `<dl class="ledger-numbers">${items.map(([key, value]) => `<div><dt>${t(`ledger.${key}`)}</dt><dd>${number(value)}</dd></div>`).join("")}</dl>`;
    };
    const bar = (usage, type, turnIndex = -1, callIndex = -1, interactive = true) => {
      const values = usageParts(usage);
      const sum = Object.values(values).reduce((a, b) => a + b, 0);
      const accessible = parts.map((part) => `${label(part)} ${number(values[part])}`).join(" · ");
      return `<div class="ledger-bar" role="${interactive ? "button" : "img"}" ${interactive ? 'tabindex="0" aria-pressed="false" data-ledger-bar' : "data-ledger-context-bar"} aria-label="${escapeHTML(interactive ? t("ledger.barLabel", { detail: accessible }) : accessible)}" data-level="${type}" data-turn-index="${turnIndex}" data-call-index="${callIndex}">${parts.map((part) => `<span class="ledger-segment ledger-${part}" data-part="${part}" style="width:${sum ? values[part] / sum * 100 : 0}%" title="${escapeHTML(`${label(part)} ${number(values[part])}`)}"><i class="ledger-projection"></i></span>`).join("")}</div>`;
    };
    const metrics = (value, type, turnIndex = -1, callIndex = -1) => `<div class="ledger-metrics">${bar(value.usage, type, turnIndex, callIndex)}${numbers(value.usage)}${price(value)}</div>`;
    const message = (item) => {
      const labels = { user: "user", assistant_commentary: "assistantCommentary", assistant_final: "assistantFinal", tool_call: "toolCall", tool_result: "toolResult" };
      const key = labels[item.kind] || "unknownMessage";
      const body = item.text || "";
      const text = body.length > 900
        ? `<details class="ledger-message-body"><summary>${t("ledger.expandMessage")}</summary><pre>${escapeHTML(body)}</pre></details><p class="ledger-preview">${escapeHTML(body.slice(0, 350))}…</p>`
        : `<pre>${escapeHTML(body)}</pre>`;
      return `<article class="ledger-message"><div class="ledger-message-head"><span class="ledger-tag ledger-tag-${escapeHTML(item.kind)}">${t(`ledger.${key}`)}</span>${item.name ? `<span class="ledger-tool-name">${escapeHTML(item.name)}</span>` : ""}</div>${text}</article>`;
    };
    const turnName = (turn, index) => t("ledger.turnNumber", { number: index + 1 });
    const modelName = (value) => value.model || value.models?.join(", ") || t("ledger.unknownModel");
    const turnCard = (turn, index) => `<section class="ledger-card ledger-turn" data-ledger-turn-index="${index}" data-ledger-turn-id="${escapeHTML(turn.id)}"><div class="ledger-card-head"><div><span class="ledger-eyebrow">${t("ledger.turn")}</span><h3>${escapeHTML(turnName(turn, index))}</h3><span class="ledger-model">${escapeHTML(modelName(turn))}</span></div><button class="ledger-expand pressable" type="button" data-ledger-expand="${index}" aria-expanded="false">${t("ledger.expandTurn")}</button></div>${metrics(turn, "turn", index)}<div class="ledger-turn-content" data-ledger-turn-content="${index}" hidden></div></section>`;

    function render() {
      content.innerHTML = `<section class="ledger-card ledger-chat" data-ledger-chat><div class="ledger-card-head"><div><span class="ledger-eyebrow">${t("ledger.chat")}</span><h3>${escapeHTML(title.textContent)}</h3><span class="ledger-thread-id">${escapeHTML(threadID)}</span></div><span class="ledger-count">${t("ledger.turnCount", { count: ledger.turns.length })}</span></div>${metrics(ledger, "chat")}<div class="ledger-turn-list">${ledger.turns.map(turnCard).join("")}</div></section>`;
    }

    function renderCall(call, turnIndex, callIndex) {
      return `<section class="ledger-card ledger-call" data-ledger-call-index="${turnIndex}:${callIndex}"><div class="ledger-card-head"><div><span class="ledger-eyebrow">${t("ledger.call")}</span><h4>${t("ledger.callNumber", { number: callIndex + 1 })}</h4><span class="ledger-model">${escapeHTML(modelName(call))}</span></div><button class="ledger-expand pressable" type="button" data-ledger-call-expand="${turnIndex}:${callIndex}" aria-expanded="false">${t("ledger.showMessages")}</button></div>${metrics(call, "call", turnIndex, callIndex)}<div class="ledger-call-messages" data-ledger-call-messages="${turnIndex}:${callIndex}" hidden></div></section>`;
    }

    function appendMessages(container, turn, turnIndex, messages) {
      const callIndexes = new Map(turn.calls.map((call, index) => [call.id, index]));
      const stream = container.querySelector("[data-ledger-stream]");
      for (const item of messages) {
        if (item.kind === "user") {
          stream.insertAdjacentHTML("beforeend", `<section class="ledger-card ledger-user"><div class="ledger-card-head"><div><span class="ledger-eyebrow">${t("ledger.userInput")}</span><h4>${t("ledger.userQuestion")}</h4></div><span class="ledger-inherited">${t("ledger.inheritedUsage")}: ${number(turn.usage.total)} Token</span></div>${message(item)}</section>`);
          continue;
        }
        const callIndex = callIndexes.get(item.response_id);
        if (callIndex === undefined) {
          stream.insertAdjacentHTML("beforeend", `<section class="ledger-unassigned"><h4>${t("ledger.unassigned")}</h4>${message(item)}</section>`);
          continue;
        }
        let target = container.querySelector(`[data-ledger-call-messages="${turnIndex}:${callIndex}"]`);
        if (!target) {
          stream.insertAdjacentHTML("beforeend", renderCall(turn.calls[callIndex], turnIndex, callIndex));
          target = container.querySelector(`[data-ledger-call-messages="${turnIndex}:${callIndex}"]`);
        } else if (!target.children.length) stream.append(target.closest(".ledger-call"));
        target.insertAdjacentHTML("beforeend", message(item));
      }
      turn.calls.forEach((call, index) => {
        if (!container.querySelector(`[data-ledger-call-messages="${turnIndex}:${index}"]`)) stream.insertAdjacentHTML("beforeend", renderCall(call, turnIndex, index));
      });
    }

    async function expandTurn(index, button) {
      const body = content.querySelector(`[data-ledger-turn-content="${index}"]`);
      if (!body.hidden) { body.hidden = true; button.setAttribute("aria-expanded", "false"); button.textContent = t("ledger.expandTurn"); return; }
      body.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.textContent = t("ledger.collapseTurn");
      if (body.dataset.loaded) return;
      body.textContent = t("ledger.loadingMessages");
      const turn = ledger.turns[index];
      const request = serial;
      try {
        const result = await api(`/api/v1/ledger?thread_id=${encodeURIComponent(threadID)}&turn_id=${encodeURIComponent(turn.id)}&limit=100`);
        if (serial !== request) return;
        const detailed = result.turns.find((item) => item.id === turn.id);
        if (!detailed) throw new Error(t("ledger.missingTurn"));
        ledger.turns[index] = detailed;
        body.innerHTML = `<div class="ledger-message-stream" data-ledger-stream></div>${detailed.calls.length ? "" : `<p class="ledger-unavailable">${t("ledger.noCalls")}</p>`}<button class="action-button quiet pressable ledger-more" type="button" data-ledger-more="${index}" ${detailed.message_count > detailed.messages.length ? "" : "hidden"}>${t("ledger.loadMore")}</button>`;
        appendMessages(body, detailed, index, detailed.messages || []);
        body.dataset.loaded = "true";
      } catch (error) { if (serial === request) body.textContent = error.message; }
    }

    async function loadMore(index, button) {
      const body = content.querySelector(`[data-ledger-turn-content="${index}"]`);
      const turn = ledger.turns[index];
      const offset = Number(body.dataset.offset || turn.messages.length);
      const request = serial;
      button.disabled = true;
      try {
        const result = await api(`/api/v1/ledger?thread_id=${encodeURIComponent(threadID)}&turn_id=${encodeURIComponent(turn.id)}&offset=${offset}&limit=100`);
        if (serial !== request) return;
        const page = result.turns.find((item) => item.id === turn.id);
        if (!page) throw new Error(t("ledger.missingTurn"));
        appendMessages(body, turn, index, page.messages || []);
        body.dataset.offset = String(offset + page.messages.length);
        button.hidden = offset + page.messages.length >= page.message_count;
        button.disabled = false;
      } catch (error) { if (serial === request) { button.textContent = error.message; button.disabled = false; } }
    }

    const identity = (bar) => ({ level: bar.dataset.level, turn: Number(bar.dataset.turnIndex), call: Number(bar.dataset.callIndex) });
    const same = (a, b) => Boolean(a && b && a.level === b.level && a.turn === b.turn && a.call === b.call);
    function project(bar, source, preceding) {
      const parent = usageParts(bar.dataset.level === "chat" ? ledger.usage : ledger.turns[Number(bar.dataset.turnIndex)].usage);
      const child = usageParts(source.usage);
      const before = usageParts(preceding);
      for (const part of parts) {
        const projection = bar.querySelector(`[data-part="${part}"] .ledger-projection`);
        projection.style.left = parent[part] ? `${before[part] / parent[part] * 100}%` : "0";
        projection.style.width = parent[part] ? `${child[part] / parent[part] * 100}%` : "0";
        projection.title = `${label(part)}: ${number(child[part])} / ${number(parent[part])}`;
      }
      bar.classList.add("has-projection");
    }
    const sumUsage = (items) => items.reduce((sum, item) => {
      for (const key of ["input", "cached_input", "output", "reasoning_output"]) sum[key] = (sum[key] || 0) + Number(item.usage?.[key] || 0);
      return sum;
    }, {});
    function activate(next) {
      context.hidden = !next || next.level === "chat";
      context.replaceChildren();
      content.querySelectorAll("[data-ledger-bar]").forEach((bar) => {
        bar.classList.remove("has-projection", "is-source", "is-contributor");
        bar.setAttribute("aria-pressed", String(same(identity(bar), pinned)));
      });
      if (!next || !ledger) return;
      const chatBar = content.querySelector('[data-level="chat"]');
      const turn = ledger.turns[next.turn];
      const source = next.level === "call" ? turn.calls[next.call] : turn;
      const share = (parent) => t("ledger.share", { percent: total(parent.usage) ? (total(source.usage) / total(parent.usage) * 100).toFixed(1) : "0" });
      if (next.level !== "chat") context.innerHTML = `<div><span class="ledger-context-label">${t("ledger.chat")} · ${share(ledger)}</span>${bar(ledger.usage, "chat", -1, -1, false)}</div>${next.level === "call" ? `<div><span class="ledger-context-label">${turnName(turn, next.turn)} · ${share(turn)}</span>${bar(turn.usage, "turn", next.turn, -1, false)}</div>` : ""}`;
      if (next.level === "turn") {
        project(chatBar, turn, sumUsage(ledger.turns.slice(0, next.turn)));
        project(context.querySelector('[data-level="chat"]'), turn, sumUsage(ledger.turns.slice(0, next.turn)));
        content.querySelector(`[data-level="turn"][data-turn-index="${next.turn}"]`)?.classList.add("is-source");
        content.querySelectorAll(`[data-level="call"][data-turn-index="${next.turn}"]`).forEach((bar) => bar.classList.add("is-contributor"));
      } else if (next.level === "call") {
        const call = turn.calls[next.call];
        project(content.querySelector(`[data-level="turn"][data-turn-index="${next.turn}"]`), call, sumUsage(turn.calls.slice(0, next.call)));
        project(context.querySelector('[data-level="turn"]'), call, sumUsage(turn.calls.slice(0, next.call)));
        const before = sumUsage([...ledger.turns.slice(0, next.turn), ...turn.calls.slice(0, next.call)]);
        project(chatBar, call, before);
        project(context.querySelector('[data-level="chat"]'), call, before);
        content.querySelector(`[data-level="call"][data-turn-index="${next.turn}"][data-call-index="${next.call}"]`)?.classList.add("is-source");
      } else chatBar.classList.add("is-source");
    }

    content.addEventListener("click", (event) => {
      const turnButton = event.target.closest("[data-ledger-expand]");
      if (turnButton) { expandTurn(Number(turnButton.dataset.ledgerExpand), turnButton); return; }
      const callButton = event.target.closest("[data-ledger-call-expand]");
      if (callButton) {
        const body = content.querySelector(`[data-ledger-call-messages="${callButton.dataset.ledgerCallExpand}"]`);
        body.hidden = !body.hidden;
        callButton.setAttribute("aria-expanded", String(!body.hidden));
        callButton.textContent = t(body.hidden ? "ledger.showMessages" : "ledger.hideMessages");
        return;
      }
      const more = event.target.closest("[data-ledger-more]");
      if (more) { loadMore(Number(more.dataset.ledgerMore), more); return; }
      const bar = event.target.closest("[data-ledger-bar]");
      if (bar) { const next = identity(bar); pinned = same(pinned, next) ? null : next; activate(pinned); }
    });
    content.addEventListener("pointerover", (event) => { const bar = event.target.closest("[data-ledger-bar]"); if (bar && !pinned) activate(identity(bar)); });
    content.addEventListener("pointerout", (event) => { const bar = event.target.closest("[data-ledger-bar]"); if (bar && !bar.contains(event.relatedTarget) && !pinned) activate(null); });
    content.addEventListener("focusin", (event) => { const bar = event.target.closest("[data-ledger-bar]"); if (bar && !pinned) activate(identity(bar)); });
    content.addEventListener("focusout", (event) => { if (event.target.matches("[data-ledger-bar]") && !pinned) activate(null); });
    content.addEventListener("keydown", (event) => { if (event.target.matches("[data-ledger-bar]") && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.target.click(); } });
    dialog.addEventListener("close", () => { serial++; pinned = null; ledger = null; context.hidden = true; context.replaceChildren(); content.replaceChildren(); });

    return {
      async open(id, name) {
        serial++;
        const request = serial;
        pinned = null;
        context.hidden = true;
        ledger = null;
        threadID = id;
        title.textContent = name || t("ledger.chatTitle");
        link.href = `codex://threads/${encodeURIComponent(id)}`;
        content.textContent = t("ledger.loadingSummary");
        openDialog(dialog);
        try {
          const result = await api(`/api/v1/ledger?thread_id=${encodeURIComponent(id)}`);
          if (request !== serial) return;
          ledger = result;
          render();
        } catch (error) { if (request === serial) content.textContent = error.message; }
      },
      close() { closeDialog(dialog); },
      refreshLocale() { if (dialog.open && ledger) { render(); pinned = null; activate(null); } }
    };
  };
})(window);
