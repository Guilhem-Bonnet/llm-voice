// The list "Réponses", in its two pages: the block under the player and the view of
// its own. Rows arrive by postMessage and hold the start of an untrusted reply: they
// are only ever written with `textContent`. Nothing here starts a reading on its own:
// a message draws, only a click posts.
(function () {
  "use strict";

  // VS Code hands out its API once per page, and in the panel player.js already has it.
  const vscode = window.llmVoiceApi || acquireVsCodeApi();

  // Outlines of the Codicons `play` (U+EB2C) and `kebab-horizontal` (U+EA7C), taken from
  // VS Code's codicon.ttf (CC BY 4.0, Microsoft) as a webview cannot reach its font.
  const ICON_PLAY =
    "M4.747 3.04Q4.48 2.933 4.24 3.067Q4 3.2 4 3.52L4 12.48Q4 12.8 4.24 12.933Q4.48 13.067 4.747 12.96L12.747 8.427Q13.013 8.267 13.013 8Q13.013 7.733 12.747 7.573L4.747 3.04ZM2.987 3.52Q2.987 2.933 3.333 2.533Q3.68 2.133 4.213 2.027Q4.747 1.92 5.227 2.187L13.227 6.667Q13.707 6.987 13.893 7.493Q14.08 8 13.893 8.507Q13.707 9.013 13.227 9.333L5.227 13.813Q4.747 14.08 4.213 13.973Q3.68 13.867 3.333 13.467Q2.987 13.067 2.987 12.48L2.987 3.52Z";
  const ICON_MORE =
    "M5.013 8Q5.013 8.427 4.72 8.72Q4.427 9.013 4 9.013Q3.573 9.013 3.28 8.72Q2.987 8.427 2.987 8Q2.987 7.573 3.28 7.28Q3.573 6.987 4 6.987Q4.427 6.987 4.72 7.28Q5.013 7.573 5.013 8ZM9.013 8Q9.013 8.427 8.72 8.72Q8.427 9.013 8 9.013Q7.573 9.013 7.28 8.72Q6.987 8.427 6.987 8Q6.987 7.573 7.28 7.28Q7.573 6.987 8 6.987Q8.427 6.987 8.72 7.28Q9.013 7.573 9.013 8ZM12 9.013Q12.427 9.013 12.72 8.72Q13.013 8.427 13.013 8Q13.013 7.573 12.72 7.28Q12.427 6.987 12 6.987Q11.573 6.987 11.28 7.28Q10.987 7.573 10.987 8Q10.987 8.427 11.28 8.72Q11.573 9.013 12 9.013Z";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const PANEL_LINES = 2;

  const byId = (id) => document.getElementById(id);

  function post(action, id) {
    vscode.postMessage(id === undefined ? { type: "responseAction", action } : { type: "responseAction", action, id });
  }

  function text(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = typeof value === "string" ? value : "";
    return element;
  }

  function icon(path) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "currentColor");
    const outline = document.createElementNS(SVG_NS, "path");
    outline.setAttribute("d", path);
    svg.appendChild(outline);
    return svg;
  }

  function iconButton(path, label, className, focusKey, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `response-icon-button ${className}`;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("data-focus", focusKey);
    button.appendChild(icon(path));
    button.addEventListener("click", onClick);
    return button;
  }

  // ---- The menu "…" -------------------------------------------------------

  let openMenu = null;
  let pendingList = null;

  function closeMenu(restoreFocus) {
    if (openMenu === null) {
      return;
    }
    const { element, opener } = openMenu;
    openMenu = null;
    element.remove();
    opener.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      opener.focus();
    }
    if (pendingList !== null) {
      const view = pendingList;
      pendingList = null;
      renderList(view);
    }
  }

  function showMenu(row, holder, opener) {
    const reopening = openMenu !== null && openMenu.opener === opener;
    closeMenu(false);
    if (reopening) {
      return;
    }
    const menu = document.createElement("div");
    menu.className = "response-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Autres actions");
    const items = [
      ["Ouvrir le texte", "openText"],
      [row.read === true ? "Marquer comme non lue" : "Marquer comme lue", "toggleRead"],
      ["Supprimer", "remove"]
    ].map(([label, action]) => {
      const item = text("button", "response-menu-item", label);
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        closeMenu(false);
        post(action, row.id);
      });
      menu.appendChild(item);
      return item;
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const at = items.indexOf(document.activeElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(at + step + items.length) % items.length].focus();
      }
    });
    holder.appendChild(menu);
    // At the bottom of a short view the menu opens upward rather than out of sight.
    if (menu.getBoundingClientRect().bottom > window.innerHeight) {
      menu.className = "response-menu response-menu-up";
    }
    opener.setAttribute("aria-expanded", "true");
    openMenu = { element: menu, opener };
    items[0].focus();
  }

  document.addEventListener("click", () => closeMenu(false));

  // ---- A line --------------------------------------------------------------

  function renderRow(row, withMenu) {
    const element = document.createElement("div");
    element.className = row.read === true ? "response-row response-row-read" : "response-row";
    element.setAttribute("role", "listitem");

    const dot = document.createElement("span");
    dot.className = "response-dot";
    if (row.read !== true) {
      dot.className = "response-dot response-dot-unread";
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "Non lue");
    }
    element.appendChild(dot);

    const body = document.createElement("div");
    body.className = "response-text";
    body.appendChild(text("span", "response-title", row.title));
    body.appendChild(text("span", "response-line", row.line));
    element.appendChild(body);

    element.appendChild(
      iconButton(ICON_PLAY, `Lire : ${row.title}`, "response-read", `read:${row.id}`, () => post("speak", row.id))
    );
    if (withMenu) {
      const more = iconButton(ICON_MORE, "Autres actions", "response-more", `more:${row.id}`, (event) => {
        event.stopPropagation();
        showMenu(row, element, more);
      });
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      element.appendChild(more);
    }
    return element;
  }

  // Lines are drawn again every minute, and a keyboard user must not lose their place.
  function keepingFocus(draw) {
    const key = document.activeElement ? document.activeElement.getAttribute("data-focus") : null;
    const lines = draw();
    if (key !== null && key !== undefined) {
      for (const button of lines.flatMap((line) => line.children)) {
        if (button.getAttribute("data-focus") === key) {
          button.focus();
        }
      }
    }
  }

  // ---- The view "Réponses" -------------------------------------------------

  const list = {
    root: byId("responses-list"),
    empty: byId("responses-empty"),
    older: byId("btn-responses-older"),
    clipboard: byId("btn-responses-clipboard"),
    connect: byId("btn-responses-connect")
  };

  function renderList(view) {
    if (openMenu !== null) {
      pendingList = view;
      return;
    }
    const rows = Array.isArray(view.rows) ? view.rows : [];
    list.empty.hidden = view.total !== 0;
    list.root.hidden = view.total === 0;
    list.older.hidden = view.hasMore !== true;
    keepingFocus(() => {
      const lines = rows.map((row) => renderRow(row, true));
      list.root.replaceChildren(...lines);
      return lines;
    });
  }

  if (list.root) {
    list.older.addEventListener("click", () => post("showMore"));
    list.clipboard.addEventListener("click", () => post("readClipboard"));
    list.connect.addEventListener("click", () => post("connectTool"));
  }

  // ---- The panel's block ---------------------------------------------------

  const panel = {
    root: byId("responses"),
    source: byId("response-latest-source"),
    title: byId("response-latest-title"),
    where: byId("response-latest-where"),
    duration: byId("response-latest-duration"),
    read: byId("btn-response-read"),
    heading: byId("responses-others-heading"),
    others: byId("responses-others"),
    all: byId("btn-responses-all"),
    allLong: byId("responses-all-long"),
    allShort: byId("responses-all-short")
  };

  let latestId = null;

  function headingOf(unread) {
    if (!(unread > 0)) {
      return "Réponses";
    }
    return unread === 1 ? "Réponses · 1 nouvelle" : `Réponses · ${unread} nouvelles`;
  }

  function renderPanel(view) {
    const latest = view.latest;
    panel.root.hidden = latest === null || typeof latest !== "object";
    if (panel.root.hidden) {
      latestId = null;
      return;
    }
    latestId = latest.id;
    panel.source.textContent = latest.source;
    panel.title.textContent = latest.title;
    panel.where.textContent = [latest.project, latest.age].filter((part) => typeof part === "string").join(" · ");
    panel.duration.textContent = latest.duration;
    panel.read.setAttribute("aria-label", `Tout lire : ${latest.title}`);
    panel.heading.textContent = headingOf(view.unread);
    const others = (Array.isArray(view.others) ? view.others : []).slice(0, PANEL_LINES);
    panel.heading.hidden = others.length === 0;
    keepingFocus(() => {
      const lines = others.map((row) => renderRow(row, false));
      panel.others.replaceChildren(...lines);
      return lines;
    });
    const label = `Toutes les réponses (${view.total})`;
    panel.allLong.textContent = label;
    panel.allShort.textContent = `Toutes (${view.total})`;
    panel.all.setAttribute("aria-label", label);
  }

  if (panel.root) {
    panel.read.addEventListener("click", () => {
      if (latestId !== null) {
        post("speak", latestId);
      }
    });
    panel.all.addEventListener("click", () => post("showAll"));
  }

  // ---- Extension Host -> Webview -------------------------------------------

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "responses" && panel.root) {
      renderPanel(message.view);
    } else if (message.type === "responsesList" && list.root) {
      renderList(message.view);
    }
  });

  // player.js says "ready" before this script is even loaded: this page says so itself.
  vscode.postMessage({ type: "responsesReady" });
})();
