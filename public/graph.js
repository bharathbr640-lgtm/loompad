export class GraphView {
  constructor({ canvas, statsEl, onOpenPage }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.statsEl = statsEl;
    this.onOpenPage = onOpenPage;

    this.nodes = [];
    this.edges = [];
    this.showWiki = true;
    this.showHierarchy = true;
    this.searchQuery = "";
    this.hoveredNode = null;
    this.dragNode = null;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.offset = { x: 0, y: 0 };
    this.scale = 1;
    this.rafId = null;
    this.active = false;

    this.bindPointerEvents();
  }

  setData({ nodes = [], edges = [] }) {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(400, rect.width || 800);
    const h = Math.max(300, rect.height || 500);
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.3;

    this.nodes = nodes.map((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      return {
        ...n,
        x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 30,
        y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        r: Math.min(20, 8 + (n.degree || 0) * 2.2),
      };
    });
    this.edges = edges;
    this.offset = { x: 0, y: 0 };
    this.scale = 1;
    this.updateStats();
    this.resize();
    this.start();
  }

  setFilters({ showWiki, showHierarchy, searchQuery }) {
    if (showWiki !== undefined) this.showWiki = showWiki;
    if (showHierarchy !== undefined) this.showHierarchy = showHierarchy;
    if (searchQuery !== undefined) this.searchQuery = (searchQuery || "").trim().toLowerCase();
    this.updateStats();
  }

  updateStats() {
    if (!this.statsEl) return;
    const wikiCount = this.edges.filter((e) => e.kind === "wiki").length;
    const hierCount = this.edges.filter((e) => e.kind === "hierarchy").length;
    this.statsEl.textContent = `${this.nodes.length} pages · ${wikiCount} wiki links · ${hierCount} nested links`;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(300, parent.clientWidth);
    const h = Math.max(260, parent.clientHeight);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    this.active = true;
    cancelAnimationFrame(this.rafId);
    const tick = () => {
      if (!this.active) return;
      this.stepPhysics();
      this.draw();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.rafId);
  }

  resetLayout() {
    this.setData({ nodes: this.nodes, edges: this.edges });
  }

  getVisibleEdges() {
    return this.edges.filter(
      (e) => (e.kind === "wiki" && this.showWiki) || (e.kind === "hierarchy" && this.showHierarchy)
    );
  }

  stepPhysics() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    const cx = w / 2;
    const cy = h / 2;
    const byId = new Map(this.nodes.map((n) => [n.id, n]));

    // Repulsion
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy) || 1;
        const force = 2600 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
      // Gentle center gravity
      a.vx += (cx - a.x) * 0.0025;
      a.vy += (cy - a.y) * 0.0025;
    }

    // Spring attraction along visible edges
    for (const edge of this.getVisibleEdges()) {
      const s = byId.get(edge.source);
      const t = byId.get(edge.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      const targetLen = edge.kind === "wiki" ? 130 : 105;
      const force = (dist - targetLen) * 0.015;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Integrate with damping
    for (const n of this.nodes) {
      if (n === this.dragNode) continue;
      n.vx *= 0.84;
      n.vy *= 0.84;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.offset.x) / this.scale,
      y: (sy - this.offset.y) / this.scale,
    };
  }

  findNodeAt(sx, sy) {
    const pt = this.screenToWorld(sx, sy);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (Math.hypot(pt.x - n.x, pt.y - n.y) <= n.r + 6) return n;
    }
    return null;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.scale, this.scale);

    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const visibleEdges = this.getVisibleEdges();

    // Draw edges
    for (const e of visibleEdges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t) continue;
      const isHighlighted =
        this.hoveredNode && (s.id === this.hoveredNode.id || t.id === this.hoveredNode.id);

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      if (e.kind === "wiki") {
        ctx.strokeStyle = isHighlighted ? "#2383e2" : isDark ? "rgba(98, 174, 255, 0.55)" : "rgba(35, 131, 226, 0.45)";
        ctx.lineWidth = isHighlighted ? 2.4 : 1.5;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = isHighlighted
          ? isDark ? "#ffffff" : "#37352f"
          : isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(55, 53, 47, 0.22)";
        ctx.lineWidth = isHighlighted ? 2 : 1.2;
        ctx.setLineDash([4, 4]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw nodes
    for (const n of this.nodes) {
      const matchesSearch =
        !this.searchQuery || (n.title || "").toLowerCase().includes(this.searchQuery);
      const isHovered = this.hoveredNode && this.hoveredNode.id === n.id;

      ctx.globalAlpha = matchesSearch ? 1 : 0.22;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = isHovered
        ? "#2383e2"
        : n.isFavorite
        ? "#f5b400"
        : isDark
        ? "#9065b0"
        : "#37352f";
      ctx.fill();

      ctx.lineWidth = isHovered ? 3 : 1.5;
      ctx.strokeStyle = isDark ? "#191919" : "#ffffff";
      ctx.stroke();

      // Label
      ctx.font = `${isHovered ? "600 " : ""}12px ui-sans-serif, -apple-system, sans-serif`;
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.88)" : "#37352f";
      ctx.textAlign = "center";
      ctx.fillText(`${n.icon || "📄"} ${n.title || "Untitled"}`, n.x, n.y + n.r + 15);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  bindPointerEvents() {
    let downPos = null;
    let moved = false;

    this.canvas.addEventListener("mousedown", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      downPos = { x: sx, y: sy };
      moved = false;

      const hit = this.findNodeAt(sx, sy);
      if (hit) {
        this.dragNode = hit;
      } else {
        this.isPanning = true;
        this.panStart = { x: sx - this.offset.x, y: sy - this.offset.y };
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.active) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (downPos && Math.hypot(sx - downPos.x, sy - downPos.y) > 4) {
        moved = true;
      }

      if (this.dragNode) {
        const pt = this.screenToWorld(sx, sy);
        this.dragNode.x = pt.x;
        this.dragNode.y = pt.y;
        this.dragNode.vx = 0;
        this.dragNode.vy = 0;
      } else if (this.isPanning) {
        this.offset.x = sx - this.panStart.x;
        this.offset.y = sy - this.panStart.y;
      } else {
        const hit = this.findNodeAt(sx, sy);
        this.hoveredNode = hit;
        this.canvas.style.cursor = hit ? "pointer" : "grab";
      }
    });

    window.addEventListener("mouseup", () => {
      if (this.dragNode && !moved && this.onOpenPage) {
        this.onOpenPage(this.dragNode.id);
      }
      this.dragNode = null;
      this.isPanning = false;
      downPos = null;
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        this.scale = Math.max(0.4, Math.min(2.6, this.scale * factor));
      },
      { passive: false }
    );

    window.addEventListener("resize", () => {
      if (this.active) this.resize();
    });
  }
}
