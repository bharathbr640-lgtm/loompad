import { ICONS } from "./icons.js";

export const SLASH_COMMANDS = [
  { type: "paragraph", title: "Text", desc: "Start writing with plain text", badge: "Aa", keywords: "text paragraph p" },
  { type: "heading_1", title: "Heading 1", desc: "Big section heading", badge: "H1", keywords: "h1 heading title" },
  { type: "heading_2", title: "Heading 2", desc: "Medium section heading", badge: "H2", keywords: "h2 heading subtitle" },
  { type: "heading_3", title: "Heading 3", desc: "Small section heading", badge: "H3", keywords: "h3 heading" },
  { type: "database", title: "Database (Table / Board / List / Gallery)", desc: "Full Notion database with 4 views, filter & sort", badge: "⊞", keywords: "database db kanban board gallery list tracker" },
  { type: "table", title: "Simple table", desc: "Add a simple editable table", badge: "▦", keywords: "table grid sheet" },
  { type: "todo", title: "To-do list", desc: "Track tasks with a checkbox", badge: "☑", keywords: "todo checkbox task checklist" },
  { type: "bulleted_list", title: "Bulleted list", desc: "Create a simple bulleted list", badge: "•", keywords: "bullet list ul" },
  { type: "numbered_list", title: "Numbered list", desc: "Create a list with numbering", badge: "1.", keywords: "number list ol" },
  { type: "toggle", title: "Toggle list", desc: "Toggles can hide and show content", badge: "▸", keywords: "toggle collapse accordion" },
  { type: "columns", title: "2 Columns", desc: "Side-by-side editable column layout", badge: "▥", keywords: "columns layout split two" },
  { type: "quote", title: "Quote", desc: "Capture a quote", badge: "❝", keywords: "quote blockquote" },
  { type: "callout", title: "Callout", desc: "Make writing stand out", badge: "💡", keywords: "callout note info box" },
  { type: "code", title: "Code", desc: "Capture a code snippet", badge: "</>", keywords: "code snippet pre" },
  { type: "image", title: "Image", desc: "Upload or embed an image URL", badge: "🖼️", keywords: "image photo picture img" },
  { type: "bookmark", title: "Web bookmark", desc: "Save a clickable link card", badge: "🔗", keywords: "bookmark link url web" },
  { type: "toc", title: "Table of contents", desc: "Auto-outline of page headings", badge: "☰", keywords: "toc table of contents outline" },
  { type: "equation", title: "Block equation", desc: "Display a math expression", badge: "∑", keywords: "equation math latex formula" },
  { type: "divider", title: "Divider", desc: "Visually divide blocks", badge: "—", keywords: "divider hr line separator" },
  { type: "subpage", title: "Page", desc: "Embed a sub-page inside this page", badge: "📄", keywords: "page subpage nested" },
];

const STATUSES = ["Not Started", "In Progress", "Done"];
const PRIORITIES = ["Low", "Medium", "High"];

function genId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "blk-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function stripTags(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return tmp.textContent || "";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class BlockEditor {
  constructor({
    container,
    slashMenu,
    slashList,
    wikiMenu,
    wikiList,
    blockMenu,
    formatToolbar,
    getPages,
    onNavigateWikiLink,
    onChange,
    onCreateSubpage,
  }) {
    this.container = container;
    this.slashMenu = slashMenu;
    this.slashList = slashList;
    this.wikiMenu = wikiMenu;
    this.wikiList = wikiList;
    this.blockMenu = blockMenu;
    this.formatToolbar = formatToolbar;
    this.getPages = getPages || (() => []);
    this.onNavigateWikiLink = onNavigateWikiLink;
    this.onChange = onChange;
    this.onCreateSubpage = onCreateSubpage;

    this.blocks = [];
    this.locked = false;
    this.slashState = { open: false, blockIndex: -1, query: "", selectedIdx: 0 };
    this.wikiState = { open: false, blockIndex: -1, query: "", selectedIdx: 0 };
    this.activeBlockMenuIndex = -1;
    this.dragBlockIdx = -1;

    this.bindBlockMenu();
    this.bindFormatToolbar();
    this.bindGlobalDismiss();
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    this.render();
  }

  setBlocks(blocks, locked = false) {
    this.locked = Boolean(locked);
    this.blocks = blocks && blocks.length
      ? blocks.map((b) => ({
          id: b.id || genId(),
          type: b.type || "paragraph",
          content: b.content || "",
          checked: Boolean(b.checked),
          collapsed: Boolean(b.collapsed),
          meta: b.meta || {},
        }))
      : [this.makeBlock("paragraph")];
    this.closeSlashMenu();
    this.closeWikiMenu();
    this.render();
  }

  makeBlock(type = "paragraph", content = "") {
    let meta = {};
    if (type === "callout") meta = { emoji: "💡" };
    else if (type === "code") meta = { language: "plain text" };
    else if (type === "columns") meta = { left: "", right: "" };
    else if (type === "bookmark") meta = { url: "", title: "" };
    else if (type === "image") meta = { src: "", caption: "" };
    else if (type === "table") {
      meta = {
        hasHeader: true,
        rows: [
          ["Column 1", "Column 2", "Column 3"],
          ["", "", ""],
          ["", "", ""],
        ],
      };
    } else if (type === "database") {
      meta = {
        title: "Untitled Database",
        view: "table",
        filterStatus: "All",
        sortBy: "default",
        rows: [
          { id: genId(), name: "First item", status: "Not Started", priority: "Medium", tag: "General", date: new Date().toISOString().slice(0, 10) },
          { id: genId(), name: "Second item", status: "In Progress", priority: "High", tag: "Core", date: new Date().toISOString().slice(0, 10) },
        ],
      };
    }
    return {
      id: genId(),
      type,
      content,
      checked: false,
      collapsed: false,
      meta,
    };
  }

  notifyChange() {
    if (this.locked) return;
    this.onChange(this.blocks);
  }

  getWordCount() {
    let words = 0;
    for (const b of this.blocks) {
      const txt = stripTags(b.content || "");
      words += txt.trim().split(/\s+/).filter(Boolean).length;
      if (b.type === "table" && b.meta?.rows) {
        for (const r of b.meta.rows) {
          for (const c of r) words += String(c || "").trim().split(/\s+/).filter(Boolean).length;
        }
      } else if (b.type === "database" && b.meta?.rows) {
        for (const r of b.meta.rows) words += String(r.name || "").trim().split(/\s+/).filter(Boolean).length;
      } else if (b.type === "columns") {
        words += String(b.meta?.left || "").trim().split(/\s+/).filter(Boolean).length;
        words += String(b.meta?.right || "").trim().split(/\s+/).filter(Boolean).length;
      }
    }
    return words;
  }

  toMarkdown(title = "Untitled") {
    const lines = [`# ${title || "Untitled"}`, ""];
    let numIdx = 0;
    for (const b of this.blocks) {
      const text = stripTags(b.content || "");
      if (b.type !== "numbered_list") numIdx = 0;
      if (b.type === "heading_1") lines.push(`# ${text}`, "");
      else if (b.type === "heading_2") lines.push(`## ${text}`, "");
      else if (b.type === "heading_3") lines.push(`### ${text}`, "");
      else if (b.type === "todo") lines.push(`- [${b.checked ? "x" : " "}] ${text}`);
      else if (b.type === "bulleted_list") lines.push(`- ${text}`);
      else if (b.type === "numbered_list") {
        numIdx++;
        lines.push(`${numIdx}. ${text}`);
      } else if (b.type === "quote") lines.push(`> ${text}`, "");
      else if (b.type === "callout") lines.push(`> ${(b.meta?.emoji || "💡")} ${text}`, "");
      else if (b.type === "code") lines.push("```" + (b.meta?.language || ""), text, "```", "");
      else if (b.type === "equation") lines.push("$$", text, "$$", "");
      else if (b.type === "divider") lines.push("---", "");
      else if (b.type === "bookmark" && b.meta?.url) lines.push(`[${b.meta.title || b.meta.url}](${b.meta.url})`, "");
      else if (b.type === "image" && b.meta?.src) lines.push(`![${b.meta.caption || "Image"}](${b.meta.src})`, "");
      else if (b.type === "columns") lines.push(b.meta?.left || "", "", b.meta?.right || "", "");
      else if (b.type === "toggle") lines.push(`<details><summary>${text}</summary>\n\n${b.meta?.details || ""}\n</details>`, "");
      else if (b.type === "table" && Array.isArray(b.meta?.rows) && b.meta.rows.length) {
        const rows = b.meta.rows;
        lines.push("| " + rows[0].join(" | ") + " |");
        lines.push("| " + rows[0].map(() => "---").join(" | ") + " |");
        for (let i = 1; i < rows.length; i++) lines.push("| " + rows[i].join(" | ") + " |");
        lines.push("");
      } else if (b.type === "database" && Array.isArray(b.meta?.rows)) {
        lines.push(`### ${b.meta.title || "Database"}`, "");
        lines.push("| Name | Status | Priority | Tag | Date |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const r of b.meta.rows) {
          lines.push(`| ${r.name || ""} | ${r.status || ""} | ${r.priority || ""} | ${r.tag || ""} | ${r.date || ""} |`);
        }
        lines.push("");
      } else if (b.type !== "toc") {
        lines.push(text, "");
      }
    }
    return lines.join("\n").trim() + "\n";
  }

  getNumberedIndex(index) {
    let count = 1;
    for (let i = index - 1; i >= 0; i--) {
      if (this.blocks[i].type === "numbered_list") count++;
      else break;
    }
    return count;
  }

  render(focusIndex = -1, caretAtEnd = true) {
    this.container.innerHTML = "";
    this.blocks.forEach((block, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = `block-wrapper block-${block.type}`;
      wrapper.dataset.index = String(idx);

      if (!this.locked) {
        // Drag-and-drop dropzone on block wrapper
        wrapper.addEventListener("dragover", (e) => {
          if (this.dragBlockIdx === -1 || this.dragBlockIdx === idx) return;
          e.preventDefault();
          wrapper.classList.add("drag-over-block");
        });
        wrapper.addEventListener("dragleave", () => wrapper.classList.remove("drag-over-block"));
        wrapper.addEventListener("drop", (e) => {
          wrapper.classList.remove("drag-over-block");
          if (this.dragBlockIdx === -1 || this.dragBlockIdx === idx) return;
          e.preventDefault();
          const [moved] = this.blocks.splice(this.dragBlockIdx, 1);
          const targetIdx = this.dragBlockIdx < idx ? idx : idx;
          this.blocks.splice(targetIdx, 0, moved);
          this.dragBlockIdx = -1;
          this.render();
          this.notifyChange();
        });

        const gutter = document.createElement("div");
        gutter.className = "block-gutter";

        const addBtn = document.createElement("button");
        addBtn.className = "gutter-btn";
        addBtn.title = "Click to add a block below";
        addBtn.innerHTML = ICONS.plus;
        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.insertBlockAfter(idx, "paragraph", true);
        });

        const gripBtn = document.createElement("button");
        gripBtn.className = "gutter-btn";
        gripBtn.title = "Drag to reorder or click for menu";
        gripBtn.draggable = true;
        gripBtn.innerHTML = ICONS.grip;
        gripBtn.addEventListener("dragstart", (e) => {
          this.dragBlockIdx = idx;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(idx));
        });
        gripBtn.addEventListener("dragend", () => {
          this.dragBlockIdx = -1;
          this.container.querySelectorAll(".drag-over-block").forEach((el) => el.classList.remove("drag-over-block"));
        });
        gripBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openBlockMenu(idx, gripBtn);
        });

        gutter.append(addBtn, gripBtn);
        wrapper.appendChild(gutter);
      }

      const body = document.createElement("div");
      body.className = "block-body";

      if (block.type === "divider") {
        const hr = document.createElement("hr");
        hr.className = "block-divider-line";
        body.appendChild(hr);
      } else if (block.type === "table") {
        body.appendChild(this.createTableElement(block));
      } else if (block.type === "database") {
        body.appendChild(this.createDatabaseElement(block));
      } else if (block.type === "columns") {
        body.appendChild(this.createColumnsElement(block));
      } else if (block.type === "image") {
        body.appendChild(this.createImageElement(block));
      } else if (block.type === "bookmark") {
        body.appendChild(this.createBookmarkElement(block));
      } else if (block.type === "toc") {
        body.appendChild(this.createTocElement());
      } else if (block.type === "equation") {
        const box = document.createElement("div");
        box.className = "block-equation-box";
        box.appendChild(this.createEditable(block, idx, "E = mc^2", true));
        body.appendChild(box);
      } else if (block.type === "todo") {
        const row = document.createElement("div");
        row.className = `block-todo-row ${block.checked ? "checked" : ""}`;
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "block-checkbox";
        cb.checked = block.checked;
        cb.disabled = this.locked;
        cb.addEventListener("change", () => {
          block.checked = cb.checked;
          row.classList.toggle("checked", block.checked);
          this.notifyChange();
        });
        const ed = this.createEditable(block, idx, "To-do");
        row.append(cb, ed);
        body.appendChild(row);
      } else if (block.type === "bulleted_list") {
        const row = document.createElement("div");
        row.className = "block-list-row";
        const bullet = document.createElement("span");
        bullet.className = "block-bullet";
        bullet.textContent = "•";
        row.append(bullet, this.createEditable(block, idx, "List"));
        body.appendChild(row);
      } else if (block.type === "numbered_list") {
        const row = document.createElement("div");
        row.className = "block-list-row";
        const num = document.createElement("span");
        num.className = "block-number";
        num.textContent = `${this.getNumberedIndex(idx)}.`;
        row.append(num, this.createEditable(block, idx, "List"));
        body.appendChild(row);
      } else if (block.type === "quote") {
        const box = document.createElement("div");
        box.className = "block-quote-box";
        box.appendChild(this.createEditable(block, idx, "Empty quote"));
        body.appendChild(box);
      } else if (block.type === "callout") {
        const box = document.createElement("div");
        box.className = "block-callout-box";
        const emoji = document.createElement("span");
        emoji.className = "callout-emoji";
        emoji.textContent = (block.meta && block.meta.emoji) || "💡";
        if (!this.locked) {
          emoji.title = "Click to cycle callout icon";
          emoji.addEventListener("click", () => {
            const cycle = ["💡", "✨", "📌", "⚠️", "🔥", "📝", "✅"];
            const next = cycle[(cycle.indexOf(emoji.textContent) + 1) % cycle.length];
            block.meta = { ...(block.meta || {}), emoji: next };
            emoji.textContent = next;
            this.notifyChange();
          });
        }
        box.append(emoji, this.createEditable(block, idx, "Type something..."));
        body.appendChild(box);
      } else if (block.type === "code") {
        const box = document.createElement("div");
        box.className = "block-code-box";
        const header = document.createElement("div");
        header.className = "block-code-header";
        const lang = document.createElement("span");
        lang.textContent = (block.meta && block.meta.language) || "code";
        const copyBtn = document.createElement("button");
        copyBtn.className = "link-btn-sm";
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", () => {
          navigator.clipboard?.writeText(stripTags(block.content || ""));
          copyBtn.textContent = "Copied!";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
        });
        header.append(lang, copyBtn);
        box.append(header, this.createEditable(block, idx, "Write code...", true));
        body.appendChild(box);
      } else if (block.type === "toggle") {
        const row = document.createElement("div");
        row.className = "block-toggle-row";
        const caret = document.createElement("button");
        caret.className = `toggle-caret ${block.collapsed ? "" : "open"}`;
        caret.innerHTML = ICONS.chevronRight;
        caret.addEventListener("click", () => {
          block.collapsed = !block.collapsed;
          this.render();
          this.notifyChange();
        });
        row.append(caret, this.createEditable(block, idx, "Toggle"));
        body.appendChild(row);

        if (!block.collapsed) {
          const details = document.createElement("div");
          details.className = "toggle-details block-editable always-placeholder";
          details.contentEditable = this.locked ? "false" : "true";
          details.dataset.placeholder = "Empty toggle. Type details here...";
          details.textContent = (block.meta && block.meta.details) || "";
          if (!this.locked) {
            details.addEventListener("input", () => {
              block.meta = { ...(block.meta || {}), details: details.textContent };
              this.notifyChange();
            });
          }
          body.appendChild(details);
        }
      } else {
        const placeholderMap = {
          heading_1: "Heading 1",
          heading_2: "Heading 2",
          heading_3: "Heading 3",
          paragraph: "Type '/' for commands, or '[[' for Wiki Links",
        };
        const ed = this.createEditable(block, idx, placeholderMap[block.type] || "Type '/' for commands");
        if (this.blocks.length === 1 && idx === 0) ed.classList.add("always-placeholder");
        body.appendChild(ed);
      }

      // Clickable [[Wiki Link]] chips detected in this block
      const wikiMatches = this.extractBlockWikiLinks(block);
      if (wikiMatches.length) {
        const chipsRow = document.createElement("div");
        chipsRow.className = "inline-wiki-chips";
        wikiMatches.forEach((title) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "wiki-link-chip";
          chip.textContent = `↗ [[${title}]]`;
          chip.title = `Open "${title}"`;
          chip.addEventListener("click", () => {
            if (this.onNavigateWikiLink) this.onNavigateWikiLink(title);
          });
          chipsRow.appendChild(chip);
        });
        body.appendChild(chipsRow);
      }

      wrapper.appendChild(body);
      this.container.appendChild(wrapper);
    });

    if (focusIndex >= 0 && focusIndex < this.blocks.length && !this.locked) {
      this.focusBlock(focusIndex, caretAtEnd);
    }
  }

  extractBlockWikiLinks(block) {
    const text = stripTags(block.content || "") + " " + (block.type === "columns" ? `${block.meta?.left || ""} ${block.meta?.right || ""}` : "");
    const found = [];
    const re = /\[\[([^\[\]]+)\]\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = m[1].trim();
      if (t && !found.includes(t)) found.push(t);
    }
    return found;
  }

  // ---------- FULL NOTION MULTI-VIEW DATABASE BLOCK ----------
  createDatabaseElement(block) {
    if (!block.meta || !Array.isArray(block.meta.rows)) {
      block.meta = this.makeBlock("database").meta;
    }
    const meta = block.meta;
    const view = meta.view || "table";
    const filterStatus = meta.filterStatus || "All";
    const sortBy = meta.sortBy || "default";

    const wrap = document.createElement("div");
    wrap.className = "db-block";

    // Header
    const header = document.createElement("div");
    header.className = "db-header";

    const titleEl = document.createElement("div");
    titleEl.className = "db-title";
    titleEl.contentEditable = this.locked ? "false" : "true";
    titleEl.textContent = meta.title || "Untitled Database";
    if (!this.locked) {
      titleEl.addEventListener("input", () => {
        meta.title = titleEl.textContent || "Untitled Database";
        this.notifyChange();
      });
    }

    const controls = document.createElement("div");
    controls.className = "db-controls";

    // View tabs
    const viewTabs = document.createElement("div");
    viewTabs.className = "db-view-tabs";
    [
      { id: "table", label: "Table" },
      { id: "board", label: "Board" },
      { id: "list", label: "List" },
      { id: "gallery", label: "Gallery" },
    ].forEach((vt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `db-view-tab ${view === vt.id ? "active" : ""}`;
      btn.textContent = vt.label;
      btn.addEventListener("click", () => {
        meta.view = vt.id;
        this.render();
        this.notifyChange();
      });
      viewTabs.appendChild(btn);
    });

    // Filter status
    const filterSel = document.createElement("select");
    filterSel.className = "db-select";
    ["All", ...STATUSES].forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st;
      opt.textContent = st === "All" ? "Filter: All" : st;
      if (filterStatus === st) opt.selected = true;
      filterSel.appendChild(opt);
    });
    filterSel.addEventListener("change", () => {
      meta.filterStatus = filterSel.value;
      this.render();
      this.notifyChange();
    });

    // Sort
    const sortSel = document.createElement("select");
    sortSel.className = "db-select";
    [
      { id: "default", label: "Sort: Manual" },
      { id: "name", label: "Sort: Name" },
      { id: "priority", label: "Sort: Priority" },
    ].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      if (sortBy === s.id) opt.selected = true;
      sortSel.appendChild(opt);
    });
    sortSel.addEventListener("change", () => {
      meta.sortBy = sortSel.value;
      this.render();
      this.notifyChange();
    });

    controls.append(viewTabs, filterSel, sortSel);

    if (!this.locked) {
      const newBtn = document.createElement("button");
      newBtn.type = "button";
      newBtn.className = "btn-primary-sm";
      newBtn.textContent = "+ New";
      newBtn.addEventListener("click", () => {
        meta.rows.push({
          id: genId(),
          name: "New item",
          status: filterStatus !== "All" ? filterStatus : "Not Started",
          priority: "Medium",
          tag: "Task",
          date: new Date().toISOString().slice(0, 10),
        });
        this.render();
        this.notifyChange();
      });
      controls.appendChild(newBtn);
    }

    header.append(titleEl, controls);
    wrap.appendChild(header);

    // Compute filtered & sorted rows
    let rows = meta.rows.filter((r) => filterStatus === "All" || r.status === filterStatus);
    if (sortBy === "name") {
      rows = [...rows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    } else if (sortBy === "priority") {
      const rank = { High: 0, Medium: 1, Low: 2 };
      rows = [...rows].sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
    }

    const statusClass = (s) =>
      s === "Done" ? "pill-done" : s === "In Progress" ? "pill-progress" : "pill-todo";
    const prioClass = (p) =>
      p === "High" ? "pill-high" : p === "Medium" ? "pill-med" : "pill-low";

    if (view === "table") {
      const tblWrap = document.createElement("div");
      tblWrap.className = "block-table-wrap";
      const table = document.createElement("table");
      table.className = "notion-table";
      table.innerHTML = `<thead><tr><th>Name</th><th>Status</th><th>Priority</th><th>Tag</th><th>Date</th>${this.locked ? "" : "<th style='width:36px;'></th>"}</tr></thead>`;
      const tbody = document.createElement("tbody");

      rows.forEach((r) => {
        const tr = document.createElement("tr");

        const tdName = document.createElement("td");
        tdName.contentEditable = this.locked ? "false" : "true";
        tdName.textContent = r.name || "";
        if (!this.locked) {
          tdName.addEventListener("input", () => {
            r.name = tdName.textContent || "";
            this.notifyChange();
          });
        }

        const tdStatus = document.createElement("td");
        const stBtn = document.createElement("button");
        stBtn.type = "button";
        stBtn.className = `db-pill ${statusClass(r.status)}`;
        stBtn.textContent = r.status || "Not Started";
        if (!this.locked) {
          stBtn.title = "Click to cycle status";
          stBtn.addEventListener("click", () => {
            r.status = STATUSES[(STATUSES.indexOf(r.status) + 1) % STATUSES.length];
            this.render();
            this.notifyChange();
          });
        }
        tdStatus.appendChild(stBtn);

        const tdPrio = document.createElement("td");
        const prBtn = document.createElement("button");
        prBtn.type = "button";
        prBtn.className = `db-pill ${prioClass(r.priority)}`;
        prBtn.textContent = r.priority || "Medium";
        if (!this.locked) {
          prBtn.title = "Click to cycle priority";
          prBtn.addEventListener("click", () => {
            r.priority = PRIORITIES[(PRIORITIES.indexOf(r.priority) + 1) % PRIORITIES.length];
            this.render();
            this.notifyChange();
          });
        }
        tdPrio.appendChild(prBtn);

        const tdTag = document.createElement("td");
        tdTag.contentEditable = this.locked ? "false" : "true";
        tdTag.textContent = r.tag || "";
        if (!this.locked) {
          tdTag.addEventListener("input", () => {
            r.tag = tdTag.textContent || "";
            this.notifyChange();
          });
        }

        const tdDate = document.createElement("td");
        tdDate.contentEditable = this.locked ? "false" : "true";
        tdDate.textContent = r.date || "";
        if (!this.locked) {
          tdDate.addEventListener("input", () => {
            r.date = tdDate.textContent || "";
            this.notifyChange();
          });
        }

        tr.append(tdName, tdStatus, tdPrio, tdTag, tdDate);
        if (!this.locked) {
          const tdDel = document.createElement("td");
          const del = document.createElement("button");
          del.type = "button";
          del.className = "icon-btn-sm danger-text";
          del.textContent = "✕";
          del.addEventListener("click", () => {
            meta.rows = meta.rows.filter((x) => x.id !== r.id);
            this.render();
            this.notifyChange();
          });
          tdDel.appendChild(del);
          tr.appendChild(tdDel);
        }
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tblWrap.appendChild(table);
      wrap.appendChild(tblWrap);
    } else if (view === "board") {
      const board = document.createElement("div");
      board.className = "db-board";
      STATUSES.forEach((colStatus) => {
        const col = document.createElement("div");
        col.className = "db-board-col";
        const colRows = rows.filter((r) => (r.status || "Not Started") === colStatus);
        col.innerHTML = `<div class="db-board-col-header"><span class="db-pill ${statusClass(colStatus)}">${colStatus}</span><span class="db-col-count">${colRows.length}</span></div>`;

        colRows.forEach((r) => {
          const card = document.createElement("div");
          card.className = "db-card";
          card.innerHTML = `
            <div class="db-card-title">${escapeHtml(r.name || "Untitled")}</div>
            <div class="db-card-meta">
              <span class="db-pill ${prioClass(r.priority)}">${escapeHtml(r.priority || "Medium")}</span>
              ${r.tag ? `<span class="db-tag-chip">${escapeHtml(r.tag)}</span>` : ""}
              ${r.date ? `<span class="db-date-chip">${escapeHtml(r.date)}</span>` : ""}
            </div>
          `;
          if (!this.locked) {
            card.title = "Click to move to next status column";
            card.addEventListener("click", () => {
              r.status = STATUSES[(STATUSES.indexOf(r.status) + 1) % STATUSES.length];
              this.render();
              this.notifyChange();
            });
          }
          col.appendChild(card);
        });
        board.appendChild(col);
      });
      wrap.appendChild(board);
    } else if (view === "list") {
      const list = document.createElement("div");
      list.className = "db-list";
      rows.forEach((r) => {
        const item = document.createElement("div");
        item.className = "db-list-row";
        item.innerHTML = `
          <span class="db-list-name">📄 ${escapeHtml(r.name || "Untitled")}</span>
          <div class="db-card-meta">
            <span class="db-pill ${statusClass(r.status)}">${escapeHtml(r.status || "Not Started")}</span>
            <span class="db-pill ${prioClass(r.priority)}">${escapeHtml(r.priority || "Medium")}</span>
            ${r.date ? `<span class="db-date-chip">${escapeHtml(r.date)}</span>` : ""}
          </div>
        `;
        if (!this.locked) {
          item.addEventListener("click", () => {
            r.status = STATUSES[(STATUSES.indexOf(r.status) + 1) % STATUSES.length];
            this.render();
            this.notifyChange();
          });
        }
        list.appendChild(item);
      });
      wrap.appendChild(list);
    } else {
      // Gallery view
      const grid = document.createElement("div");
      grid.className = "db-gallery";
      rows.forEach((r) => {
        const card = document.createElement("div");
        card.className = "db-gallery-card";
        card.innerHTML = `
          <div class="db-gallery-cover ${statusClass(r.status)}"></div>
          <div class="db-gallery-body">
            <div class="db-card-title">${escapeHtml(r.name || "Untitled")}</div>
            <div class="db-card-meta">
              <span class="db-pill ${statusClass(r.status)}">${escapeHtml(r.status || "Not Started")}</span>
              ${r.tag ? `<span class="db-tag-chip">${escapeHtml(r.tag)}</span>` : ""}
            </div>
          </div>
        `;
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }

    return wrap;
  }

  createColumnsElement(block) {
    if (!block.meta) block.meta = { left: "", right: "" };
    const grid = document.createElement("div");
    grid.className = "block-columns-grid";

    ["left", "right"].forEach((side) => {
      const col = document.createElement("div");
      col.className = "block-column-cell block-editable always-placeholder";
      col.contentEditable = this.locked ? "false" : "true";
      col.dataset.placeholder = side === "left" ? "Left column..." : "Right column...";
      col.textContent = block.meta[side] || "";
      if (!this.locked) {
        col.addEventListener("input", () => {
          block.meta[side] = col.textContent || "";
          this.notifyChange();
        });
      }
      grid.appendChild(col);
    });
    return grid;
  }

  createImageElement(block) {
    if (!block.meta) block.meta = { src: "", caption: "" };
    const wrap = document.createElement("div");
    wrap.className = "block-image-wrap";

    if (block.meta.src) {
      const img = document.createElement("img");
      img.src = block.meta.src;
      img.alt = block.meta.caption || "Embedded image";
      img.className = "block-image-el";
      wrap.appendChild(img);

      const cap = document.createElement("div");
      cap.className = "block-image-caption";
      cap.contentEditable = this.locked ? "false" : "true";
      cap.dataset.placeholder = "Write a caption...";
      cap.textContent = block.meta.caption || "";
      if (!this.locked) {
        cap.addEventListener("input", () => {
          block.meta.caption = cap.textContent || "";
          this.notifyChange();
        });
      }
      wrap.appendChild(cap);
    } else if (!this.locked) {
      const promptBox = document.createElement("div");
      promptBox.className = "block-media-prompt";
      const urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.className = "text-input";
      urlInput.placeholder = "Paste image URL and press Enter...";
      urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && urlInput.value.trim()) {
          block.meta.src = urlInput.value.trim();
          this.render();
          this.notifyChange();
        }
      });

      const fileLabel = document.createElement("label");
      fileLabel.className = "btn-outline-sm";
      fileLabel.textContent = "Upload image";
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.className = "hidden";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          block.meta.src = reader.result;
          this.render();
          this.notifyChange();
        };
        reader.readAsDataURL(file);
      });
      fileLabel.appendChild(fileInput);
      promptBox.append(urlInput, fileLabel);
      wrap.appendChild(promptBox);
    }
    return wrap;
  }

  createBookmarkElement(block) {
    if (!block.meta) block.meta = { url: "", title: "" };
    const wrap = document.createElement("div");
    if (block.meta.url) {
      const a = document.createElement("a");
      a.className = "block-bookmark-card";
      a.href = block.meta.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `
        <div class="bookmark-title">🔗 ${escapeHtml(block.meta.title || block.meta.url)}</div>
        <div class="bookmark-url">${escapeHtml(block.meta.url)}</div>
      `;
      wrap.appendChild(a);
    } else if (!this.locked) {
      const box = document.createElement("div");
      box.className = "block-media-prompt";
      const urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.className = "text-input";
      urlInput.placeholder = "https://example.com";
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "text-input";
      titleInput.placeholder = "Bookmark label (optional)";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-primary-sm";
      addBtn.textContent = "Embed";
      addBtn.addEventListener("click", () => {
        if (!urlInput.value.trim()) return;
        block.meta.url = urlInput.value.trim();
        block.meta.title = titleInput.value.trim() || urlInput.value.trim();
        this.render();
        this.notifyChange();
      });
      box.append(urlInput, titleInput, addBtn);
      wrap.appendChild(box);
    }
    return wrap;
  }

  createTocElement() {
    const box = document.createElement("div");
    box.className = "block-toc-box";
    const headings = this.blocks
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => ["heading_1", "heading_2", "heading_3"].includes(b.type) && stripTags(b.content).trim());

    if (!headings.length) {
      box.innerHTML = `<div class="toc-empty">Table of Contents — add Heading 1, 2, or 3 blocks to populate.</div>`;
      return box;
    }

    headings.forEach(({ b, i }) => {
      const item = document.createElement("button");
      item.type = "button";
      const indent = b.type === "heading_1" ? 0 : b.type === "heading_2" ? 16 : 32;
      item.className = "toc-item";
      item.style.paddingLeft = `${indent}px`;
      item.textContent = stripTags(b.content);
      item.addEventListener("click", () => {
        const target = this.container.querySelector(`.block-wrapper[data-index="${i}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      box.appendChild(item);
    });
    return box;
  }

  createTableElement(block) {
    if (!block.meta || !Array.isArray(block.meta.rows) || !block.meta.rows.length) {
      block.meta = this.makeBlock("table").meta;
    }
    const wrap = document.createElement("div");
    wrap.className = "block-table-wrap";
    const table = document.createElement("table");
    table.className = "notion-table";

    block.meta.rows.forEach((rowArr, rIdx) => {
      const tr = document.createElement("tr");
      rowArr.forEach((cellVal, cIdx) => {
        const cell = document.createElement(rIdx === 0 && block.meta.hasHeader ? "th" : "td");
        cell.contentEditable = this.locked ? "false" : "true";
        cell.textContent = cellVal || "";
        if (!this.locked) {
          cell.addEventListener("input", () => {
            block.meta.rows[rIdx][cIdx] = cell.textContent || "";
            this.notifyChange();
          });
        }
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);

    if (!this.locked) {
      const tb = document.createElement("div");
      tb.className = "table-toolbar";
      const addRow = document.createElement("button");
      addRow.className = "table-mini-btn";
      addRow.textContent = "+ Row";
      addRow.addEventListener("click", () => {
        const cols = block.meta.rows[0]?.length || 3;
        block.meta.rows.push(Array(cols).fill(""));
        this.render();
        this.notifyChange();
      });
      const addCol = document.createElement("button");
      addCol.className = "table-mini-btn";
      addCol.textContent = "+ Column";
      addCol.addEventListener("click", () => {
        block.meta.rows.forEach((r, i) => r.push(i === 0 ? `Column ${r.length + 1}` : ""));
        this.render();
        this.notifyChange();
      });
      const delRow = document.createElement("button");
      delRow.className = "table-mini-btn";
      delRow.textContent = "− Row";
      delRow.addEventListener("click", () => {
        if (block.meta.rows.length > 1) {
          block.meta.rows.pop();
          this.render();
          this.notifyChange();
        }
      });
      tb.append(addRow, addCol, delRow);
      wrap.appendChild(tb);
    }
    return wrap;
  }

  createEditable(block, idx, placeholder, plainTextOnly = false) {
    const el = document.createElement("div");
    el.className = "block-editable";
    el.contentEditable = this.locked ? "false" : "true";
    el.dataset.placeholder = placeholder;
    el.dataset.blockIndex = String(idx);

    if (plainTextOnly) el.textContent = stripTags(block.content || "");
    else el.innerHTML = block.content || "";

    if (this.locked) return el;

    el.addEventListener("input", () => {
      const plain = el.textContent || "";
      block.content = plainTextOnly ? plain : el.innerHTML;

      if (block.type === "paragraph") {
        const shortcuts = [
          { prefix: "# ", type: "heading_1" },
          { prefix: "## ", type: "heading_2" },
          { prefix: "### ", type: "heading_3" },
          { prefix: "- ", type: "bulleted_list" },
          { prefix: "* ", type: "bulleted_list" },
          { prefix: "1. ", type: "numbered_list" },
          { prefix: "[] ", type: "todo" },
          { prefix: "[ ] ", type: "todo" },
          { prefix: "> ", type: "quote" },
        ];
        for (const s of shortcuts) {
          if (plain.startsWith(s.prefix)) {
            block.type = s.type;
            block.content = plain.slice(s.prefix.length);
            this.render(idx, true);
            this.notifyChange();
            return;
          }
        }
        if (plain === "---") {
          block.type = "divider";
          block.content = "";
          this.blocks.splice(idx + 1, 0, this.makeBlock("paragraph"));
          this.render(idx + 1, false);
          this.notifyChange();
          return;
        }
      }

      // Detect [[ wiki link autocomplete
      const wikiMatch = plain.match(/\[\[([^\[\]]*)$/);
      if (wikiMatch) {
        this.closeSlashMenu();
        this.openWikiMenu(idx, wikiMatch[1], el);
      } else if (this.wikiState.open && this.wikiState.blockIndex === idx) {
        this.closeWikiMenu();
      }

      // Detect / slash menu
      if (plain.startsWith("/")) {
        this.openSlashMenu(idx, plain.slice(1), el);
      } else if (this.slashState.open && this.slashState.blockIndex === idx) {
        this.closeSlashMenu();
      }

      this.notifyChange();
    });

    el.addEventListener("keydown", (e) => {
      // Wiki menu navigation
      if (this.wikiState.open && this.wikiState.blockIndex === idx) {
        const items = this.getFilteredWikiPages();
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.wikiState.selectedIdx = (this.wikiState.selectedIdx + 1) % Math.max(1, items.length);
          this.renderWikiMenu();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.wikiState.selectedIdx = (this.wikiState.selectedIdx - 1 + Math.max(1, items.length)) % Math.max(1, items.length);
          this.renderWikiMenu();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const chosen = items[this.wikiState.selectedIdx];
          if (chosen) this.applyWikiLink(chosen.title || "Untitled");
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.closeWikiMenu();
          return;
        }
      }

      // Slash menu navigation
      if (this.slashState.open && this.slashState.blockIndex === idx) {
        const filtered = this.getFilteredSlashCommands();
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.slashState.selectedIdx = (this.slashState.selectedIdx + 1) % Math.max(1, filtered.length);
          this.renderSlashMenu();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.slashState.selectedIdx = (this.slashState.selectedIdx - 1 + filtered.length) % Math.max(1, filtered.length);
          this.renderSlashMenu();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (filtered[this.slashState.selectedIdx]) {
            this.applySlashCommand(filtered[this.slashState.selectedIdx].type);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.closeSlashMenu();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
        e.preventDefault();
        if (!stripTags(block.content).trim() && ["bulleted_list", "numbered_list", "todo", "quote"].includes(block.type)) {
          block.type = "paragraph";
          this.render(idx, true);
          this.notifyChange();
          return;
        }
        const nextType = ["bulleted_list", "numbered_list", "todo"].includes(block.type) ? block.type : "paragraph";
        this.insertBlockAfter(idx, nextType, true);
        return;
      }

      if (e.key === "Backspace" && !stripTags(block.content)) {
        if (block.type !== "paragraph") {
          e.preventDefault();
          block.type = "paragraph";
          this.render(idx, true);
          this.notifyChange();
          return;
        }
        if (this.blocks.length > 1) {
          e.preventDefault();
          this.blocks.splice(idx, 1);
          this.render(Math.max(0, idx - 1), true);
          this.notifyChange();
          return;
        }
      }

      if (e.key === "ArrowUp" && idx > 0) {
        const sel = window.getSelection();
        if (sel && sel.anchorOffset === 0) {
          e.preventDefault();
          this.focusBlock(idx - 1, true);
        }
      } else if (e.key === "ArrowDown" && idx < this.blocks.length - 1) {
        const sel = window.getSelection();
        if (sel && sel.anchorOffset >= (el.textContent || "").length) {
          e.preventDefault();
          this.focusBlock(idx + 1, false);
        }
      }
    });

    return el;
  }

  insertBlockAfter(idx, type = "paragraph", focus = true) {
    if (this.locked) return;
    this.blocks.splice(idx + 1, 0, this.makeBlock(type));
    this.render(focus ? idx + 1 : -1, false);
    this.notifyChange();
  }

  appendAndFocus() {
    if (this.locked) return;
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type === "paragraph" && !stripTags(last.content)) {
      this.focusBlock(this.blocks.length - 1, true);
      return;
    }
    this.blocks.push(this.makeBlock("paragraph"));
    this.render(this.blocks.length - 1, false);
    this.notifyChange();
  }

  focusBlock(idx, atEnd = true) {
    const target = this.container.querySelector(`.block-editable[data-block-index="${idx}"]`);
    if (!target) return;
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(!atEnd);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- WIKI LINK AUTOCOMPLETE ([[) ----------
  getFilteredWikiPages() {
    const q = (this.wikiState.query || "").trim().toLowerCase();
    const pages = this.getPages() || [];
    const filtered = q ? pages.filter((p) => (p.title || "Untitled").toLowerCase().includes(q)) : pages;
    return filtered.slice(0, 10);
  }

  openWikiMenu(blockIndex, query, anchorEl) {
    if (!this.wikiMenu) return;
    this.wikiState = { open: true, blockIndex, query, selectedIdx: 0 };
    const rect = anchorEl.getBoundingClientRect();
    this.wikiMenu.style.top = `${Math.max(12, Math.min(window.innerHeight - 280, rect.bottom + 6))}px`;
    this.wikiMenu.style.left = `${Math.max(12, Math.min(window.innerWidth - 300, rect.left))}px`;
    this.wikiMenu.classList.remove("hidden");
    this.renderWikiMenu();
  }

  renderWikiMenu() {
    if (!this.wikiList) return;
    const items = this.getFilteredWikiPages();
    this.wikiList.innerHTML = "";
    if (!items.length) {
      const q = (this.wikiState.query || "").trim();
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "slash-item selected";
      empty.innerHTML = `<span class="slash-item-badge">+</span><div class="slash-item-meta"><div class="slash-item-title">Link to "[[${escapeHtml(q || "New Page")}]]"</div><div class="slash-item-desc">Creates page when clicked</div></div>`;
      empty.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.applyWikiLink(q || "New Page");
      });
      this.wikiList.appendChild(empty);
      return;
    }
    items.forEach((p, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `slash-item ${i === this.wikiState.selectedIdx ? "selected" : ""}`;
      btn.innerHTML = `
        <span class="slash-item-badge">${p.icon || "📄"}</span>
        <div class="slash-item-meta">
          <div class="slash-item-title">${escapeHtml(p.title || "Untitled")}</div>
          <div class="slash-item-desc">Insert [[${escapeHtml(p.title || "Untitled")}]]</div>
        </div>
      `;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.applyWikiLink(p.title || "Untitled");
      });
      this.wikiList.appendChild(btn);
    });
  }

  applyWikiLink(targetTitle) {
    const idx = this.wikiState.blockIndex;
    this.closeWikiMenu();
    if (idx < 0 || idx >= this.blocks.length) return;
    const block = this.blocks[idx];
    const plain = stripTags(block.content || "");
    block.content = plain.replace(/\[\[([^\[\]]*)$/, `[[${targetTitle}]] `);
    this.render(idx, true);
    this.notifyChange();
  }

  closeWikiMenu() {
    this.wikiState.open = false;
    if (this.wikiMenu) this.wikiMenu.classList.add("hidden");
  }

  // ---------- FLOATING FORMATTING TOOLBAR ----------
  bindFormatToolbar() {
    if (!this.formatToolbar) return;

    const updateToolbar = () => {
      if (this.locked) {
        this.formatToolbar.classList.add("hidden");
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        this.formatToolbar.classList.add("hidden");
        return;
      }
      const anchor = sel.anchorNode?.parentElement?.closest?.(".block-editable");
      if (!anchor || !this.container.contains(anchor)) {
        this.formatToolbar.classList.add("hidden");
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      this.formatToolbar.classList.remove("hidden");
      const tbRect = this.formatToolbar.getBoundingClientRect();
      this.formatToolbar.style.top = `${Math.max(10, rect.top - tbRect.height - 8)}px`;
      this.formatToolbar.style.left = `${Math.max(12, Math.min(window.innerWidth - tbRect.width - 12, rect.left + rect.width / 2 - tbRect.width / 2))}px`;
    };

    document.addEventListener("selectionchange", updateToolbar);

    this.formatToolbar.querySelectorAll(".fmt-btn").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const ed = sel.anchorNode?.parentElement?.closest?.(".block-editable");
        if (!ed) return;

        if (cmd === "code" || cmd === "highlight") {
          const tag = cmd === "code" ? "code" : "mark";
          document.execCommand("insertHTML", false, `<${tag}>${escapeHtml(sel.toString())}</${tag}>`);
        } else if (cmd === "color") {
          document.execCommand("foreColor", false, val);
        } else {
          document.execCommand(cmd, false, null);
        }

        const idx = Number(ed.dataset.blockIndex);
        if (!Number.isNaN(idx) && this.blocks[idx]) {
          this.blocks[idx].content = ed.innerHTML;
          this.notifyChange();
        }
      });
    });
  }

  // ---------- SLASH MENU ----------
  getFilteredSlashCommands() {
    const q = (this.slashState.query || "").trim().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (c) => c.title.toLowerCase().includes(q) || c.keywords.includes(q) || c.desc.toLowerCase().includes(q)
    );
  }

  openSlashMenu(blockIndex, query, anchorEl) {
    this.slashState = { open: true, blockIndex, query, selectedIdx: 0 };
    const rect = anchorEl.getBoundingClientRect();
    this.slashMenu.style.top = `${Math.max(12, Math.min(window.innerHeight - 330, rect.bottom + 6))}px`;
    this.slashMenu.style.left = `${Math.max(12, Math.min(window.innerWidth - 300, rect.left))}px`;
    this.slashMenu.classList.remove("hidden");
    this.renderSlashMenu();
  }

  renderSlashMenu() {
    const items = this.getFilteredSlashCommands();
    this.slashList.innerHTML = "";
    if (!items.length) {
      this.slashList.innerHTML = `<div class="trash-empty">No matching blocks</div>`;
      return;
    }
    items.forEach((cmd, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `slash-item ${i === this.slashState.selectedIdx ? "selected" : ""}`;
      btn.innerHTML = `
        <span class="slash-item-badge">${cmd.badge}</span>
        <div class="slash-item-meta">
          <div class="slash-item-title">${cmd.title}</div>
          <div class="slash-item-desc">${cmd.desc}</div>
        </div>
      `;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.applySlashCommand(cmd.type);
      });
      this.slashList.appendChild(btn);
    });
  }

  applySlashCommand(type) {
    const idx = this.slashState.blockIndex;
    this.closeSlashMenu();
    if (idx < 0 || idx >= this.blocks.length) return;

    if (type === "subpage") {
      this.blocks[idx].content = "";
      this.render();
      this.notifyChange();
      if (this.onCreateSubpage) this.onCreateSubpage();
      return;
    }

    const fresh = this.makeBlock(type);
    this.blocks[idx] = fresh;

    if (["divider", "table", "database", "columns", "image", "bookmark", "toc"].includes(type)) {
      this.blocks.splice(idx + 1, 0, this.makeBlock("paragraph"));
      this.render(type === "divider" ? idx + 1 : -1, false);
    } else {
      this.render(idx, false);
    }
    this.notifyChange();
  }

  closeSlashMenu() {
    this.slashState.open = false;
    this.slashMenu.classList.add("hidden");
  }

  // ---------- BLOCK ACTIONS MENU ----------
  openBlockMenu(idx, anchorEl) {
    this.activeBlockMenuIndex = idx;
    const rect = anchorEl.getBoundingClientRect();
    this.blockMenu.style.top = `${Math.min(window.innerHeight - 180, rect.bottom + 4)}px`;
    this.blockMenu.style.left = `${Math.max(12, rect.left)}px`;
    this.blockMenu.classList.remove("hidden");
  }

  bindBlockMenu() {
    document.getElementById("bm-duplicate").addEventListener("click", () => {
      const idx = this.activeBlockMenuIndex;
      if (idx >= 0 && idx < this.blocks.length) {
        const copy = JSON.parse(JSON.stringify(this.blocks[idx]));
        copy.id = genId();
        this.blocks.splice(idx + 1, 0, copy);
        this.render(idx + 1, true);
        this.notifyChange();
      }
      this.blockMenu.classList.add("hidden");
    });

    document.getElementById("bm-move-up").addEventListener("click", () => {
      const idx = this.activeBlockMenuIndex;
      if (idx > 0) {
        [this.blocks[idx - 1], this.blocks[idx]] = [this.blocks[idx], this.blocks[idx - 1]];
        this.render(idx - 1, true);
        this.notifyChange();
      }
      this.blockMenu.classList.add("hidden");
    });

    document.getElementById("bm-move-down").addEventListener("click", () => {
      const idx = this.activeBlockMenuIndex;
      if (idx >= 0 && idx < this.blocks.length - 1) {
        [this.blocks[idx + 1], this.blocks[idx]] = [this.blocks[idx], this.blocks[idx + 1]];
        this.render(idx + 1, true);
        this.notifyChange();
      }
      this.blockMenu.classList.add("hidden");
    });

    document.getElementById("bm-delete").addEventListener("click", () => {
      const idx = this.activeBlockMenuIndex;
      if (idx >= 0 && idx < this.blocks.length) {
        this.blocks.splice(idx, 1);
        if (!this.blocks.length) this.blocks.push(this.makeBlock("paragraph"));
        this.render(Math.max(0, idx - 1), true);
        this.notifyChange();
      }
      this.blockMenu.classList.add("hidden");
    });
  }

  bindGlobalDismiss() {
    document.addEventListener("click", (e) => {
      if (!this.slashMenu.contains(e.target)) this.closeSlashMenu();
      if (this.wikiMenu && !this.wikiMenu.contains(e.target)) this.closeWikiMenu();
      if (!this.blockMenu.contains(e.target)) this.blockMenu.classList.add("hidden");
    });
  }
}
