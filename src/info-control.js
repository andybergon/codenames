export function createInfoControl(definition, namespace) {
  const control = document.createElement("span");
  control.className = "info-control";
  control.addEventListener("pointerenter", () => {
    closeInfoPopovers(control);
    control.classList.remove("is-dismissed");
    positionInfoPopover(button, popover);
  });
  control.addEventListener("focusin", () => {
    closeInfoPopovers(control);
    control.classList.remove("is-dismissed");
    positionInfoPopover(button, popover);
  });

  const tooltipId = `info-${namespace}-${definition.id}`;
  const button = document.createElement("button");
  button.className = "info-button";
  button.type = "button";
  button.setAttribute(
    "aria-label",
    definition.aboutLabel ?? `About ${definition.label}`,
  );
  button.setAttribute("aria-controls", tooltipId);
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    closeInfoPopovers();
    if (wasOpen) {
      return;
    }
    control.classList.remove("is-dismissed");
    button.setAttribute("aria-expanded", "true");
    positionInfoPopover(button, popover);
  });

  const popover = document.createElement("span");
  popover.className = "info-popover";
  popover.id = tooltipId;
  popover.role = "tooltip";
  if (definition.table) {
    popover.classList.add("has-table");
    popover.append(createInfoTable(definition));
    if (definition.note) {
      const note = document.createElement("span");
      note.className = "info-table-note";
      note.textContent = definition.note;
      popover.append(note);
    }
  } else {
    popover.textContent = definition.info;
  }

  control.append(button, popover);
  return control;
}

export function closeInfoPopovers(exceptControl = null) {
  for (const control of document.querySelectorAll(".info-control")) {
    if (control === exceptControl) {
      continue;
    }
    control.querySelector(".info-button")?.setAttribute("aria-expanded", "false");
    control.classList.add("is-dismissed");
  }
}

function positionInfoPopover(button, popover) {
  requestAnimationFrame(() => {
    const buttonBounds = button.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const gutter = 12;
    const gap = 8;
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const left = Math.max(
      gutter,
      Math.min(buttonBounds.left, viewportWidth - popoverBounds.width - gutter),
    );
    const below = buttonBounds.bottom + gap;
    const top =
      below + popoverBounds.height <= viewportHeight - gutter
        ? below
        : Math.max(gutter, buttonBounds.top - popoverBounds.height - gap);
    popover.style.setProperty("--info-left", `${left}px`);
    popover.style.setProperty("--info-top", `${top}px`);
  });
}

function createInfoTable(definition) {
  const table = document.createElement("table");
  table.className = "info-table";
  table.setAttribute("aria-label", `${definition.label} comparison`);

  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const [index, label] of definition.table.headers.entries()) {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = label;
    header.classList.toggle(
      "is-numeric",
      definition.table.numericColumns?.includes(index) ?? false,
    );
    headerRow.append(header);
  }
  head.append(headerRow);

  const body = document.createElement("tbody");
  for (const values of definition.table.rows) {
    const row = document.createElement("tr");
    for (const [index, value] of values.entries()) {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) {
        cell.scope = "row";
      }
      cell.textContent = value;
      cell.classList.toggle(
        "is-numeric",
        definition.table.numericColumns?.includes(index) ?? false,
      );
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  return table;
}
