import { replayPlayActionStates } from "../play/game-state.js";

const DEFAULT_ENDPOINT = "/api/play-analytics";
const ACTION_TYPES = new Set([
  "clue-given",
  "card-guessed",
  "turn-passed",
]);

export function createAnalyticsReviewMode({
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  const root = document.querySelector("#analytics-review-mode");
  if (!root) return { setActive() {} };

  root.replaceChildren(buildShell());
  const elements = {
    auth: root.querySelector("#analytics-review-auth"),
    authForm: root.querySelector("#analytics-review-auth-form"),
    authKey: root.querySelector("#analytics-review-key"),
    authStatus: root.querySelector("#analytics-review-auth-status"),
    content: root.querySelector("#analytics-review-content"),
    cohort: root.querySelector("#analytics-review-cohort"),
    phase: root.querySelector("#analytics-review-phase"),
    status: root.querySelector("#analytics-review-status-filter"),
    refresh: root.querySelector("#analytics-review-refresh"),
    list: root.querySelector("#analytics-review-list"),
    detail: root.querySelector("#analytics-review-detail"),
  };
  let initialized = false;
  let games = [];
  let selected = null;
  let actionStates = [];
  let selectedActionIndex = -1;

  elements.authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void authenticate();
  });
  for (const filter of [
    elements.cohort,
    elements.phase,
    elements.status,
  ]) {
    filter.addEventListener("change", () => void loadGames());
  }
  elements.refresh.addEventListener("click", () => void loadGames());

  return {
    async setActive(active) {
      root.hidden = !active;
      if (!active || initialized) return;
      initialized = true;
      await loadGames();
    },
  };

  async function authenticate() {
    elements.authStatus.textContent = "";
    const result = await request("POST", {
      action: "authenticate",
      key: elements.authKey.value,
    });
    if (!result.ok) {
      elements.authStatus.textContent =
        result.body?.error ?? "Authentication failed.";
      return;
    }
    elements.authKey.value = "";
    await loadGames();
  }

  async function loadGames() {
    elements.list.setAttribute("aria-busy", "true");
    const query = new URLSearchParams({
      cohort: elements.cohort.value,
      ...(elements.phase.value
        ? { phase: elements.phase.value }
        : {}),
      ...(elements.status.value
        ? { status: elements.status.value }
        : {}),
    });
    const result = await request("GET", null, `?${query}`);
    elements.list.removeAttribute("aria-busy");
    if (result.status === 401) {
      elements.auth.hidden = false;
      elements.content.hidden = true;
      return;
    }
    if (!result.ok) {
      elements.auth.hidden = true;
      elements.content.hidden = false;
      elements.list.textContent =
        result.body?.error ?? "Analytics games could not be loaded.";
      return;
    }
    elements.auth.hidden = true;
    elements.content.hidden = false;
    games = result.body.games ?? [];
    renderList();
    if (
      selected &&
      !games.some(
        (game) => game.analyticsId === selected.analyticsId,
      )
    ) {
      selected = null;
      renderDetail();
    }
  }

  async function loadGame(analyticsId) {
    elements.detail.setAttribute("aria-busy", "true");
    const result = await request(
      "GET",
      null,
      `?game=${encodeURIComponent(analyticsId)}`,
    );
    elements.detail.removeAttribute("aria-busy");
    if (!result.ok) {
      elements.detail.textContent =
        result.body?.error ?? "The game could not be loaded.";
      return;
    }
    selected = result.body.game;
    actionStates = selected.game
      ? replayPlayActionStates(selected.game)
      : [];
    selectedActionIndex = actionStates.length - 1;
    renderList();
    renderDetail();
  }

  function renderList() {
    if (games.length === 0) {
      const empty = document.createElement("p");
      empty.className = "analytics-review-empty";
      empty.textContent = "No games match these filters.";
      elements.list.replaceChildren(empty);
      return;
    }
    elements.list.replaceChildren(
      ...games.map((game) => {
        const button = document.createElement("button");
        const heading = document.createElement("strong");
        const metadata = document.createElement("span");
        const badges = document.createElement("span");
        button.type = "button";
        button.className = "analytics-review-game";
        button.dataset.selected = String(
          selected?.analyticsId === game.analyticsId,
        );
        heading.textContent = `${game.language.toUpperCase()} · ${
          game.phase === "complete" ? game.winner ?? "Complete" : game.phase
        }`;
        metadata.textContent = `${game.actionCount} actions · turn ${
          game.turnNumber
        } · ${formatDate(game.lastSeenAt)}`;
        badges.className = "analytics-review-badges";
        badges.append(
          ...(game.reviewStatus === "unreviewed"
            ? []
            : [badge(game.reviewStatus)]),
          ...(game.developerMode ? [badge("Developer")] : []),
          ...(game.feedbackCount
            ? [badge(`${game.feedbackCount} feedback`)]
            : []),
        );
        button.append(
          heading,
          metadata,
          ...(badges.childElementCount ? [badges] : []),
        );
        button.addEventListener("click", () => {
          void loadGame(game.analyticsId);
        });
        return button;
      }),
    );
  }

  function renderDetail() {
    if (!selected) {
      const empty = document.createElement("p");
      empty.className = "analytics-review-empty";
      empty.textContent = "Choose a game to review.";
      elements.detail.replaceChildren(empty);
      return;
    }
    const header = document.createElement("div");
    const title = document.createElement("div");
    const heading = document.createElement("h2");
    const metadata = document.createElement("p");
    header.className = "analytics-review-detail-header";
    heading.textContent = `Game ${selected.gameId}`;
    metadata.textContent = [
      selected.developerMode ? "Developer" : "Player",
      selected.phase,
      `${selected.actionCount} actions`,
      `first ${formatDate(selected.firstSeenAt)}`,
      `last ${formatDate(selected.lastSeenAt)}`,
    ].join(" · ");
    title.append(heading, metadata);
    header.append(title, badge(selected.reviewStatus));

    const overview = buildGameOverview();
    const timeline = buildTimeline();
    const feedback = buildFeedbackSummary();
    const review = buildReviewSection();
    elements.detail.replaceChildren(
      header,
      overview,
      timeline,
      feedback,
      review,
    );
  }

  function buildReviewSection() {
    const section = document.createElement("form");
    const heading = document.createElement("h3");
    const fields = document.createElement("div");
    const status = selectField(
      "Status",
      [
        "unreviewed",
        "reviewing",
        "actionable",
        "resolved",
        "ignored",
      ],
      selected.reviewStatus,
    );
    const labels = textField(
      "Labels",
      (selected.labels ?? []).join(", "),
      "Comma separated",
    );
    const scope = document.createElement("select");
    const scopeLabel = document.createElement("label");
    const scopeTitle = document.createElement("span");
    const note = textareaField("Note (optional)", "", 2_000);
    const save = document.createElement("button");
    const message = document.createElement("p");
    const existing = document.createElement("div");
    section.className = "analytics-review-form";
    heading.textContent = "Review";
    fields.className = "analytics-review-form-grid";
    scopeTitle.textContent = "Note scope";
    scopeLabel.append(scopeTitle, scope);
    existing.className = "analytics-review-feedback-list";
    existing.append(
      ...(selected.reviewNote
        ? [
            annotationItem({
              scopeType: "game",
              note: selected.reviewNote,
            }),
          ]
        : []),
      ...(selected.annotations ?? []).map(annotationItem),
    );
    scope.append(new Option("Whole game", "game"));
    const actions =
      selected.game?.history.filter((event) =>
        ACTION_TYPES.has(event.type),
      ) ?? [];
    const turns = [...new Set(actions.map((action) => action.turn))];
    for (const turn of turns) {
      scope.append(new Option(`Turn ${turn}`, `turn:${turn}`));
    }
    actions.forEach((action, index) => {
      scope.append(
        new Option(
          actionLabel(action),
          `action:${action.turn}:${index}`,
        ),
      );
    });
    save.type = "submit";
    save.className = "button primary";
    save.textContent = "Save review";
    message.setAttribute("role", "status");
    message.className = "analytics-review-save-status";
    fields.append(status.label, labels.label);
    section.append(
      heading,
      fields,
      ...(existing.childElementCount ? [existing] : []),
      scopeLabel,
      note.label,
      save,
      message,
    );
    section.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      const reviewResult = await request("PATCH", {
        action: "review",
        analyticsId: selected.analyticsId,
        reviewStatus: status.control.value,
        labels: labels.control.value
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        note: selected.reviewNote ?? "",
      });
      if (!reviewResult.ok) {
        save.disabled = false;
        message.textContent =
          reviewResult.body?.error ?? "Review could not be saved.";
        return;
      }
      selected.reviewStatus =
        reviewResult.body.review.reviewStatus;
      selected.labels = reviewResult.body.review.labels;
      selected.reviewNote = reviewResult.body.review.note;
      const summary = games.find(
        (game) => game.analyticsId === selected.analyticsId,
      );
      if (summary) {
        summary.reviewStatus = selected.reviewStatus;
        summary.labels = selected.labels;
      }

      const noteText = note.control.value.trim();
      let annotationResult = null;
      if (noteText) {
        const scopeValue = scope.value.split(":");
        const annotationScope =
          scopeValue[0] === "game"
            ? { type: "game" }
            : scopeValue[0] === "turn"
              ? { type: "turn", turn: Number(scopeValue[1]) }
              : {
                  type: "action",
                  turn: Number(scopeValue[1]),
                  actionIndex: Number(scopeValue[2]),
                };
        annotationResult = await request("POST", {
          action: "annotation",
          analyticsId: selected.analyticsId,
          scope: annotationScope,
          note: noteText,
        });
      }
      save.disabled = false;
      if (annotationResult && !annotationResult.ok) {
        renderList();
        const detailBadge = elements.detail.querySelector(
          ".analytics-review-detail-header .analytics-review-badge",
        );
        if (detailBadge) {
          detailBadge.textContent = selected.reviewStatus;
        }
        message.textContent =
          annotationResult.body?.error ??
          "Review saved, but the note could not be added.";
        return;
      }
      if (annotationResult) {
        selected.annotations ??= [];
        selected.annotations.push(annotationResult.body.annotation);
      }
      renderList();
      renderDetail();
      const savedMessage = elements.detail.querySelector(
        ".analytics-review-save-status",
      );
      if (savedMessage) {
        savedMessage.textContent = annotationResult
          ? "Review saved and note added."
          : "Review saved.";
      }
    });
    return section;
  }

  function buildGameOverview() {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const context = document.createElement("p");
    section.className = "analytics-review-overview";
    heading.textContent = "Board";
    section.append(heading);
    if (!selected.game) {
      const unavailable = document.createElement("p");
      unavailable.textContent =
        "This snapshot cannot be replayed by the current rules.";
      section.append(unavailable);
      return section;
    }
    const selectedState = actionStates[selectedActionIndex] ?? null;
    const boardState = selectedState?.game ?? selected.game;
    section.dataset.actionIndex = String(selectedActionIndex);
    context.className = "analytics-review-board-state";
    context.setAttribute("aria-live", "polite");
    context.textContent = selectedState
      ? `After ${actionLabel(selectedState.event)}`
      : "Stored board state";
    const board = document.createElement("div");
    board.className = "analytics-review-board play-board-grid";
    board.setAttribute("aria-label", context.textContent);
    board.append(
      ...boardState.cards.map((card) => {
        const item = document.createElement("button");
        const word = document.createElement("span");
        item.type = "button";
        item.disabled = true;
        item.className = "play-card";
        item.dataset.layoutId = String(card.layoutId);
        item.dataset.team = card.team;
        item.classList.toggle("is-done", card.done);
        item.setAttribute(
          "aria-label",
          `${card.word}, ${teamLabel(card.team)}${
            card.done ? ", revealed" : ""
          }`,
        );
        word.className = "play-card-word";
        word.textContent = card.word;
        item.append(word);
        return item;
      }),
    );
    section.append(context, board);
    return section;
  }

  function buildFeedbackSummary() {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const items = (selected.feedback ?? []).map(feedbackItem);
    section.className = "analytics-review-feedback";
    heading.textContent = `Player feedback (${items.length})`;
    section.append(heading);
    if (items.length) {
      const list = document.createElement("div");
      list.className = "analytics-review-feedback-list";
      list.append(...items);
      section.append(list);
    } else {
      const empty = document.createElement("p");
      empty.className = "analytics-review-empty";
      empty.textContent = "No player feedback.";
      section.append(empty);
    }
    return section;
  }

  function buildTimeline() {
    const section = document.createElement("section");
    const headingRow = document.createElement("div");
    const title = document.createElement("div");
    const heading = document.createElement("h3");
    const count = document.createElement("span");
    section.className = "analytics-review-timeline";
    headingRow.className =
      "play-section-heading play-history-heading";
    title.className = "play-history-title";
    heading.textContent = "Game timeline";
    count.textContent = `${actionStates.length} events`;
    title.append(heading, count);
    headingRow.append(title);
    section.append(headingRow);
    if (!actionStates.length) {
      const empty = document.createElement("p");
      empty.className = "analytics-review-empty";
      empty.textContent = "No replayable actions.";
      section.append(empty);
      return section;
    }
    const list = document.createElement("ol");
    list.className = "play-history-list";
    list.append(
      ...groupActionStates(actionStates).map(createTimelineTurn),
    );
    section.append(list);
    return section;
  }

  function createTimelineTurn(turn) {
    const item = document.createElement("li");
    const heading = document.createElement("div");
    const actions = document.createElement("ol");
    item.className = "play-history-turn";
    item.dataset.side = turn.side;
    item.dataset.turn = String(turn.turn);
    item.classList.toggle(
      "is-selected",
      turn.actions.some(
        ({ actionIndex }) => actionIndex === selectedActionIndex,
      ),
    );
    heading.className = "play-history-turn-header";
    heading.textContent = `${sideEmoji(turn.side)} ${sideLabel(
      turn.side,
    )} · Turn ${turn.turn}`;
    actions.className = "play-history-actions";
    actions.append(...turn.actions.map(createTimelineAction));
    item.append(heading, actions);
    return item;
  }

  function createTimelineAction(state) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const isSelected = state.actionIndex === selectedActionIndex;
    item.className = "play-history-action";
    item.dataset.action = state.event.type;
    item.dataset.actionIndex = String(state.actionIndex);
    button.type = "button";
    button.className = "analytics-review-history-action";
    button.setAttribute("aria-pressed", String(isSelected));
    button.setAttribute(
      "aria-label",
      `${isSelected ? "Viewing board after" : "View board after"} ${
        actionLabel(state.event)
      }`,
    );
    appendActionSummary(button, state.event, selected.game);
    button.addEventListener("click", () => {
      selectedActionIndex = state.actionIndex;
      const overview = elements.detail.querySelector(
        ".analytics-review-overview",
      );
      const timeline = elements.detail.querySelector(
        ".analytics-review-timeline",
      );
      overview?.replaceWith(buildGameOverview());
      timeline?.replaceWith(buildTimeline());
    });
    item.append(button);
    return item;
  }

  async function request(method, body, suffix = "") {
    try {
      const response = await fetchImpl(`${endpoint}${suffix}`, {
        method,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        ok: response.ok,
        status: response.status,
        body:
          response.status === 204
            ? null
            : await response.json().catch(() => ({})),
      };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  }
}

function buildShell() {
  const wrapper = document.createElement("div");
  wrapper.className = "analytics-review-shell";
  wrapper.innerHTML = `
    <section id="analytics-review-auth" class="analytics-review-auth" hidden>
      <form id="analytics-review-auth-form">
        <h2>Analytics review</h2>
        <p>Enter the review key to open stored Play games.</p>
        <label>Review key<input id="analytics-review-key" type="password" autocomplete="current-password" required></label>
        <button class="button primary" type="submit">Open review</button>
        <p id="analytics-review-auth-status" role="alert"></p>
      </form>
    </section>
    <div id="analytics-review-content" hidden>
      <div class="analytics-review-toolbar">
        <label>Cohort<select id="analytics-review-cohort"><option value="player">Players</option><option value="developer">Developer</option><option value="all">All</option></select></label>
        <label>Phase<select id="analytics-review-phase"><option value="">All</option><option value="complete">Complete</option><option value="awaiting-clue">Between turns</option><option value="awaiting-guess">In turn</option></select></label>
        <label>Status<select id="analytics-review-status-filter"><option value="">All</option><option value="unreviewed">Unreviewed</option><option value="reviewing">Reviewing</option><option value="actionable">Actionable</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option></select></label>
        <button id="analytics-review-refresh" class="button secondary" type="button">Refresh</button>
      </div>
      <div class="analytics-review-layout">
        <aside id="analytics-review-list" class="analytics-review-list" aria-label="Stored games"></aside>
        <article id="analytics-review-detail" class="analytics-review-detail"><p class="analytics-review-empty">Choose a game to review.</p></article>
      </div>
    </div>`;
  return wrapper;
}

function badge(text) {
  const item = document.createElement("span");
  item.className = "analytics-review-badge";
  item.textContent = text;
  return item;
}

function feedbackItem(feedback) {
  const item = document.createElement("article");
  const heading = document.createElement("strong");
  const note = document.createElement("p");
  item.className = "analytics-review-feedback-item";
  heading.textContent = `${feedback.category} · ${feedback.scopeType}`;
  note.textContent = feedback.note || "No note.";
  item.append(heading, note);
  return item;
}

function annotationItem(annotation) {
  const item = document.createElement("article");
  const heading = document.createElement("strong");
  const note = document.createElement("p");
  const scope =
    annotation.scopeType === "game"
      ? "Whole game"
      : annotation.scopeType === "turn"
        ? `Turn ${annotation.turnNumber}`
        : `Turn ${annotation.turnNumber}: ${annotation.actionType}`;
  item.className = "analytics-review-feedback-item";
  heading.textContent = scope;
  note.textContent = annotation.note;
  item.append(heading, note);
  return item;
}

function selectField(label, options, value) {
  const wrapper = document.createElement("label");
  const title = document.createElement("span");
  const control = document.createElement("select");
  title.textContent = label;
  control.append(...options.map((option) => new Option(option, option)));
  control.value = value;
  wrapper.append(title, control);
  return { label: wrapper, control };
}

function textField(label, value, placeholder = "") {
  const wrapper = document.createElement("label");
  const title = document.createElement("span");
  const control = document.createElement("input");
  title.textContent = label;
  control.value = value;
  control.placeholder = placeholder;
  wrapper.append(title, control);
  return { label: wrapper, control };
}

function textareaField(label, value, maxLength) {
  const wrapper = document.createElement("label");
  const title = document.createElement("span");
  const control = document.createElement("textarea");
  title.textContent = label;
  control.value = value;
  control.maxLength = maxLength;
  control.rows = 4;
  wrapper.append(title, control);
  return { label: wrapper, control };
}

function actionLabel(action) {
  if (action.type === "clue-given") {
    return `Turn ${action.turn}: clue ${action.clue} ${action.number}`;
  }
  if (action.type === "card-guessed") {
    return `Turn ${action.turn}: guessed ${action.word}`;
  }
  return `Turn ${action.turn}: passed`;
}

function groupActionStates(states) {
  const turns = [];
  for (const state of states) {
    const { event } = state;
    const current = turns.at(-1);
    if (
      current &&
      current.turn === event.turn &&
      current.side === event.side
    ) {
      current.actions.push(state);
    } else {
      turns.push({
        turn: event.turn,
        side: event.side,
        actions: [state],
      });
    }
  }
  return turns;
}

function appendActionSummary(container, event, game) {
  if (event.type === "clue-given") {
    container.append(
      historyActionLabel("Clue"),
      ": ",
      cluePill(event.clue),
      " ",
      clueNumberPill(event.number),
    );
    const targets = (event.intendedLayoutIds ?? [])
      .map((layoutId) =>
        game.cards.find((card) => card.layoutId === layoutId),
      )
      .filter(Boolean);
    if (targets.length) {
      container.append(", intended ");
      targets.forEach((target, index) => {
        if (index > 0) container.append(" + ");
        container.append(historyCardPill(target.word, target.team));
      });
    }
    return;
  }
  if (event.type === "card-guessed") {
    container.append(
      historyActionLabel("Guessed"),
      " ",
      historyCardPill(event.word, event.team),
    );
    return;
  }
  container.append(historyActionLabel("Passed"));
}

function historyActionLabel(text) {
  const label = document.createElement("strong");
  label.className = "play-history-action-label";
  label.textContent = text;
  return label;
}

function cluePill(clue) {
  const pill = document.createElement("span");
  pill.className = "play-clue-pill";
  pill.textContent = clue;
  return pill;
}

function clueNumberPill(number) {
  const pill = document.createElement("span");
  pill.className = "play-history-clue-number";
  pill.textContent = String(number);
  pill.setAttribute("aria-label", `Clue number ${number}`);
  return pill;
}

function historyCardPill(word, team) {
  const pill = document.createElement("span");
  pill.className = "play-history-card";
  pill.dataset.team = team;
  pill.textContent = word;
  pill.setAttribute("aria-label", `${word}, ${teamLabel(team)} card`);
  return pill;
}

function sideEmoji(side) {
  return side === "red" ? "🔴" : "🔵";
}

function sideLabel(side) {
  return side === "red" ? "Red" : "Blue";
}

function teamLabel(team) {
  if (team === "friendly") return "Blue";
  if (team === "enemy") return "Red";
  if (team === "neutral") return "Neutral";
  return "Assassin";
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
