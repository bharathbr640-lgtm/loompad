#!/usr/bin/env python3
"""
Notion Replica — Complete Non-AI Desktop Edition + Wiki Links & Graph View
Backed by Python 3 standard library + SQLite (notion.db) + PBKDF2 Auth.
"""

import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
import urllib.parse
import uuid
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DB_PATH = Path(os.environ.get("NOTION_DB_PATH", str(BASE_DIR / "notion.db")))
HOST = os.environ.get("NOTION_HOST", "0.0.0.0" if (os.environ.get("RENDER") or os.environ.get("PORT")) else "127.0.0.1")
PORT = int(os.environ.get("PORT", os.environ.get("NOTION_PORT", "3000")))
SESSION_COOKIE = "notion_replica_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days
WIKI_LINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")


def now_ms() -> int:
    return int(time.time() * 1000)


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    with conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                avatar_color TEXT NOT NULL DEFAULT '#2383e2',
                avatar_emoji TEXT NOT NULL DEFAULT '',
                theme TEXT NOT NULL DEFAULT 'light',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT 'N',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS pages (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                parent_id TEXT,
                title TEXT NOT NULL DEFAULT '',
                icon TEXT NOT NULL DEFAULT '',
                cover TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                is_favorite INTEGER NOT NULL DEFAULT 0,
                is_trashed INTEGER NOT NULL DEFAULT 0,
                full_width INTEGER NOT NULL DEFAULT 0,
                small_text INTEGER NOT NULL DEFAULT 0,
                font_style TEXT NOT NULL DEFAULT 'sans',
                is_locked INTEGER NOT NULL DEFAULT 0,
                position INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES pages(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id TEXT PRIMARY KEY,
                page_id TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'paragraph',
                content TEXT NOT NULL DEFAULT '',
                checked INTEGER NOT NULL DEFAULT 0,
                collapsed INTEGER NOT NULL DEFAULT 0,
                meta_json TEXT NOT NULL DEFAULT '{}',
                position INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                page_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                content TEXT NOT NULL,
                resolved INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_pages_workspace ON pages(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
            CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id);
            CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(page_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            """
        )
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(pages)").fetchall()}
        if "font_style" not in cols:
            conn.execute("ALTER TABLE pages ADD COLUMN font_style TEXT NOT NULL DEFAULT 'sans'")
        if "is_locked" not in cols:
            conn.execute("ALTER TABLE pages ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0")
        if "tags_json" not in cols:
            conn.execute("ALTER TABLE pages ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'")
    conn.close()


def hash_password(password: str, salt_hex: str = None):
    if salt_hex is None:
        salt_hex = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt_hex),
        120_000,
    )
    return dk.hex(), salt_hex


def verify_password(password: str, stored_hash: str, salt_hex: str) -> bool:
    computed, _ = hash_password(password, salt_hex)
    return hmac.compare_digest(computed, stored_hash)


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "")


def extract_wiki_targets(blocks_rows) -> list:
    targets = []
    for b in blocks_rows:
        plain = strip_html(b["content"] or "")
        for m in WIKI_LINK_RE.findall(plain):
            t = m.strip()
            if t:
                targets.append(t)
        # Also scan meta_json for columns/toggle details
        meta_raw = b["meta_json"] or ""
        if "[[" in meta_raw:
            for m in WIKI_LINK_RE.findall(strip_html(meta_raw)):
                t = m.strip()
                if t:
                    targets.append(t)
    return targets


def serialize_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "avatarColor": row["avatar_color"],
        "avatarEmoji": row["avatar_emoji"],
        "theme": row["theme"],
        "createdAt": row["created_at"],
    }


def serialize_workspace(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "icon": row["icon"],
        "createdAt": row["created_at"],
    }


def serialize_page(row: sqlite3.Row) -> dict:
    keys = row.keys()
    try:
        tags = json.loads(row["tags_json"] or "[]") if "tags_json" in keys else []
        if not isinstance(tags, list):
            tags = []
    except Exception:
        tags = []
    return {
        "id": row["id"],
        "workspaceId": row["workspace_id"],
        "parentId": row["parent_id"],
        "title": row["title"],
        "icon": row["icon"],
        "cover": row["cover"],
        "tags": tags,
        "isFavorite": bool(row["is_favorite"]),
        "isTrashed": bool(row["is_trashed"]),
        "fullWidth": bool(row["full_width"]),
        "smallText": bool(row["small_text"]),
        "fontStyle": row["font_style"] if "font_style" in keys else "sans",
        "isLocked": bool(row["is_locked"]) if "is_locked" in keys else False,
        "position": row["position"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def serialize_block(row: sqlite3.Row) -> dict:
    try:
        meta = json.loads(row["meta_json"] or "{}")
    except json.JSONDecodeError:
        meta = {}
    return {
        "id": row["id"],
        "pageId": row["page_id"],
        "type": row["type"],
        "content": row["content"],
        "checked": bool(row["checked"]),
        "collapsed": bool(row["collapsed"]),
        "meta": meta,
        "position": row["position"],
    }


def serialize_comment(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "pageId": row["page_id"],
        "authorName": row["author_name"],
        "content": row["content"],
        "resolved": bool(row["resolved"]),
        "createdAt": row["created_at"],
    }


def seed_starter_workspace(conn: sqlite3.Connection, user_id: str, user_name: str) -> str:
    ws_id = str(uuid.uuid4())
    ts = now_ms()
    first_name = user_name.strip().split()[0] if user_name.strip() else "My"
    ws_name = f"{first_name}'s Notion"
    ws_icon = first_name[0].upper() if first_name else "N"

    conn.execute(
        "INSERT INTO workspaces (id, user_id, name, icon, created_at) VALUES (?, ?, ?, ?, ?)",
        (ws_id, user_id, ws_name, ws_icon, ts),
    )

    p1_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, tags_json, is_favorite, is_trashed, position, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, 1, 0, 0, ?, ?)
        """,
        (
            p1_id,
            ws_id,
            "Getting Started",
            "👋",
            "linear-gradient(120deg, #f6d365 0%, #fda085 100%)",
            json.dumps(["Guide", "Workspace"]),
            ts,
            ts,
        ),
    )
    p1_blocks = [
        ("callout", "Welcome to your complete non-AI Notion workspace! Try linking pages with [[Quick Note]] or [[Personal Home]], then open Graph View in the sidebar.", 0, 0, {"emoji": "✨"}),
        ("toc", "", 0, 0, {}),
        ("heading_2", "Core features to try", 0, 0, {}),
        ("todo", "Type [[ to insert a Wiki Link to any page and see it appear in Graph View & Backlinks", 0, 0, {}),
        ("todo", "Type /database for interactive Table, Kanban Board, List, and Gallery views", 0, 0, {}),
        ("todo", "Drag blocks by their ⋮⋮ handle to reorder, or drag pages in the sidebar to nest them", 0, 0, {}),
        ("todo", "Check [[Keyboard Shortcuts]] for fast navigation and formatting", 0, 0, {}),
        ("divider", "", 0, 0, {}),
        ("heading_2", "Project Database", 0, 0, {}),
        ("database", "", 0, 0, {
            "title": "Workspace Roadmap",
            "view": "table",
            "rows": [
                {"id": str(uuid.uuid4()), "name": "Nested Pages & Drag-Drop", "status": "Done", "priority": "High", "tag": "Core", "date": "2026-11-24"},
                {"id": str(uuid.uuid4()), "name": "Multi-View Databases", "status": "Done", "priority": "High", "tag": "Data", "date": "2026-11-24"},
                {"id": str(uuid.uuid4()), "name": "Wiki Links & Graph View", "status": "Done", "priority": "High", "tag": "Knowledge", "date": "2026-11-24"},
                {"id": str(uuid.uuid4()), "name": "Write Weekly Review", "status": "In Progress", "priority": "Medium", "tag": "Personal", "date": "2026-11-25"},
            ]
        }),
    ]
    for idx, (btype, content, checked, collapsed, meta) in enumerate(p1_blocks):
        conn.execute(
            "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), p1_id, btype, content, checked, collapsed, json.dumps(meta), idx),
        )

    p1_sub_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, tags_json, is_favorite, is_trashed, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', ?, 0, 0, 0, ?, ?)
        """,
        (p1_sub_id, ws_id, p1_id, "Keyboard Shortcuts", "⌨️", json.dumps(["Reference"]), ts + 1, ts + 1),
    )
    sub_blocks = [
        ("paragraph", "Return to [[Getting Started]] anytime, or use these shortcuts:"),
        ("bulleted_list", "Cmd / Ctrl + K — Open Quick Search"),
        ("bulleted_list", "Cmd / Ctrl + \\ — Toggle sidebar"),
        ("bulleted_list", "[[ — Insert Wiki Link to another page"),
        ("bulleted_list", "/ — Open block slash command menu"),
        ("code", "# Start your local Notion server:\npython3 server.py",),
    ]
    for idx, (btype, content) in enumerate(sub_blocks):
        meta = {"language": "bash"} if btype == "code" else {}
        conn.execute(
            "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
            (str(uuid.uuid4()), p1_sub_id, btype, content, json.dumps(meta), idx),
        )

    p2_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, tags_json, is_favorite, is_trashed, position, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, '', ?, 0, 0, 1, ?, ?)
        """,
        (p2_id, ws_id, "Quick Note", "📝", json.dumps(["Notes"]), ts + 2, ts + 2),
    )
    p2_blocks = [
        ("paragraph", "Linked from [[Getting Started]] and connected to [[Personal Home]]."),
        ("heading_3", "Today's Focus"),
        ("todo", "Organize ideas with [[Wiki Links]]"),
        ("todo", "Switch database view to Kanban Board"),
    ]
    for idx, (btype, content) in enumerate(p2_blocks):
        conn.execute(
            "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, ?, ?, 0, 0, '{}', ?)",
            (str(uuid.uuid4()), p2_id, btype, content, idx),
        )

    p3_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, tags_json, is_favorite, is_trashed, position, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, 0, 0, 2, ?, ?)
        """,
        (
            p3_id,
            ws_id,
            "Personal Home",
            "🏡",
            "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)",
            json.dumps(["Hub"]),
            ts + 3,
            ts + 3,
        ),
    )
    p3_blocks = [
        ("callout", "Your distraction-free hub linking [[Getting Started]] and [[Quick Note]].", {"emoji": "📌"}),
        ("columns", "", {"left": "Left Column:\nAdd goals, milestones, or links here.", "right": "Right Column:\nKeep weekly notes or checklists side-by-side."}),
        ("toggle", "Archive & Reference Notes", {"details": "Keep completed notes neatly tucked away inside toggle blocks."}),
    ]
    for idx, item in enumerate(p3_blocks):
        btype, content = item[0], item[1]
        meta = item[2] if len(item) > 2 else {}
        conn.execute(
            "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
            (str(uuid.uuid4()), p3_id, btype, content, json.dumps(meta), idx),
        )

    return ws_id


class NotionHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[Notion] {self.address_string()} - {fmt % args}\n")

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def send_json(self, status: int, data: dict, set_cookie_header: str = None) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        if set_cookie_header is not None:
            self.send_header("Set-Cookie", set_cookie_header)
        self.end_headers()
        self.wfile.write(payload)

    def send_error_json(self, status: int, message: str) -> None:
        self.send_json(status, {"error": message})

    def get_session_token(self) -> str:
        raw_cookie = self.headers.get("Cookie", "")
        if not raw_cookie:
            return ""
        jar = cookies.SimpleCookie()
        try:
            jar.load(raw_cookie)
        except Exception:
            return ""
        morsel = jar.get(SESSION_COOKIE)
        return morsel.value if morsel else ""

    def get_current_user(self, conn: sqlite3.Connection):
        token = self.get_session_token()
        if not token:
            return None, None
        row = conn.execute(
            """
            SELECT u.* FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (token, now_ms()),
        ).fetchone()
        if not row:
            return None, None
        return row, token

    def make_session_cookie(self, token: str, clear: bool = False) -> str:
        is_https = os.environ.get("NOTION_HTTPS") == "1" or bool(os.environ.get("RENDER"))
        secure_flag = "; Secure" if is_https else ""
        if clear:
            return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax{secure_flag}; Max-Age=0"
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax{secure_flag}; Max-Age={SESSION_TTL_SECONDS}"

    def verify_workspace_owner(self, conn: sqlite3.Connection, ws_id: str, user_id: str):
        return conn.execute(
            "SELECT * FROM workspaces WHERE id = ? AND user_id = ?",
            (ws_id, user_id),
        ).fetchone()

    def verify_page_owner(self, conn: sqlite3.Connection, page_id: str, user_id: str):
        return conn.execute(
            """
            SELECT p.* FROM pages p
            JOIN workspaces w ON w.id = p.workspace_id
            WHERE p.id = ? AND w.user_id = ?
            """,
            (page_id, user_id),
        ).fetchone()

    def serve_static(self, rel_path: str) -> None:
        if rel_path == "" or rel_path == "/":
            rel_path = "index.html"
        clean = os.path.normpath(rel_path).lstrip("/")
        target = (PUBLIC_DIR / clean).resolve()
        if not str(target).startswith(str(PUBLIC_DIR.resolve())) or not target.is_file():
            target = PUBLIC_DIR / "index.html"
            if not target.is_file():
                self.send_error_json(404, "Not found")
                return

        mime_type, _ = mimetypes.guess_type(str(target))
        if not mime_type:
            mime_type = "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header(
            "Content-Type",
            f"{mime_type}; charset=utf-8"
            if mime_type.startswith("text/") or mime_type in ("application/javascript", "application/json")
            else mime_type,
        )
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---------- HTTP VERBS ----------

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/healthz":
            self.send_json(200, {"ok": True})
            return

        if not path.startswith("/api/"):
            self.serve_static(path)
            return

        conn = get_db()
        try:
            if path == "/api/auth/me":
                user, _ = self.get_current_user(conn)
                if not user:
                    self.send_json(200, {"user": None, "workspaces": []})
                    return
                workspaces = conn.execute(
                    "SELECT * FROM workspaces WHERE user_id = ? ORDER BY created_at ASC",
                    (user["id"],),
                ).fetchall()
                self.send_json(
                    200,
                    {
                        "user": serialize_user(user),
                        "workspaces": [serialize_workspace(w) for w in workspaces],
                    },
                )
                return

            user, _ = self.get_current_user(conn)
            if not user:
                self.send_error_json(401, "Authentication required")
                return

            if path == "/api/storage/stats":
                db_bytes = DB_PATH.stat().st_size if DB_PATH.exists() else 0
                ws_count = conn.execute("SELECT COUNT(*) FROM workspaces WHERE user_id = ?", (user["id"],)).fetchone()[0]
                page_count = conn.execute(
                    "SELECT COUNT(*) FROM pages p JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ? AND p.is_trashed = 0",
                    (user["id"],),
                ).fetchone()[0]
                trashed_count = conn.execute(
                    "SELECT COUNT(*) FROM pages p JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ? AND p.is_trashed = 1",
                    (user["id"],),
                ).fetchone()[0]
                block_count = conn.execute(
                    "SELECT COUNT(*) FROM blocks b JOIN pages p ON p.id = b.page_id JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ?",
                    (user["id"],),
                ).fetchone()[0]
                session_count = conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ?", (user["id"], now_ms())).fetchone()[0]
                self.send_json(
                    200,
                    {
                        "databaseFile": DB_PATH.name,
                        "diskUsageBytes": db_bytes,
                        "sqliteVersion": sqlite3.sqlite_version,
                        "workspaces": ws_count,
                        "activePages": page_count,
                        "trashedPages": trashed_count,
                        "blocks": block_count,
                        "activeSessions": session_count,
                    },
                )
                return

            if path == "/api/workspaces":
                rows = conn.execute(
                    "SELECT * FROM workspaces WHERE user_id = ? ORDER BY created_at ASC",
                    (user["id"],),
                ).fetchall()
                self.send_json(200, {"workspaces": [serialize_workspace(w) for w in rows]})
                return

            parts = [p for p in path.split("/") if p]

            # GET /api/workspaces/<ws_id>/home
            if len(parts) == 4 and parts[1] == "workspaces" and parts[3] == "home":
                ws_id = parts[2]
                if not self.verify_workspace_owner(conn, ws_id, user["id"]):
                    self.send_error_json(404, "Workspace not found")
                    return
                recent = conn.execute(
                    "SELECT * FROM pages WHERE workspace_id = ? AND is_trashed = 0 ORDER BY updated_at DESC LIMIT 8",
                    (ws_id,),
                ).fetchall()
                todos = conn.execute(
                    """
                    SELECT b.id, b.content, b.checked, p.id AS page_id, p.title AS page_title, p.icon AS page_icon
                    FROM blocks b
                    JOIN pages p ON p.id = b.page_id
                    WHERE p.workspace_id = ? AND p.is_trashed = 0 AND b.type = 'todo' AND b.checked = 0 AND TRIM(b.content) != ''
                    ORDER BY p.updated_at DESC, b.position ASC
                    LIMIT 12
                    """,
                    (ws_id,),
                ).fetchall()
                self.send_json(
                    200,
                    {
                        "recentPages": [serialize_page(r) for r in recent],
                        "openTodos": [
                            {
                                "id": t["id"],
                                "content": strip_html(t["content"]),
                                "pageId": t["page_id"],
                                "pageTitle": t["page_title"] or "Untitled",
                                "pageIcon": t["page_icon"] or "📄",
                            }
                            for t in todos
                        ],
                    },
                )
                return

            # GET /api/workspaces/<ws_id>/graph (Pages + Hierarchy Edges + [[Wiki Link]] Edges)
            if len(parts) == 4 and parts[1] == "workspaces" and parts[3] == "graph":
                ws_id = parts[2]
                if not self.verify_workspace_owner(conn, ws_id, user["id"]):
                    self.send_error_json(404, "Workspace not found")
                    return
                pages = conn.execute(
                    "SELECT * FROM pages WHERE workspace_id = ? AND is_trashed = 0 ORDER BY created_at ASC",
                    (ws_id,),
                ).fetchall()
                title_to_id = {}
                for p in pages:
                    t = (p["title"] or "").strip().lower()
                    if t and t not in title_to_id:
                        title_to_id[t] = p["id"]

                nodes = []
                edges = []
                edge_seen = set()
                degree = {p["id"]: 0 for p in pages}

                for p in pages:
                    # Hierarchy edge
                    if p["parent_id"] and p["parent_id"] in degree:
                        key = (p["parent_id"], p["id"], "hierarchy")
                        if key not in edge_seen:
                            edge_seen.add(key)
                            edges.append({"source": p["parent_id"], "target": p["id"], "kind": "hierarchy"})
                            degree[p["parent_id"]] += 1
                            degree[p["id"]] += 1

                    # Wiki link edges from page blocks
                    blks = conn.execute("SELECT content, meta_json FROM blocks WHERE page_id = ?", (p["id"],)).fetchall()
                    for target_title in extract_wiki_targets(blks):
                        target_id = title_to_id.get(target_title.lower())
                        if target_id and target_id != p["id"]:
                            key = (p["id"], target_id, "wiki")
                            if key not in edge_seen:
                                edge_seen.add(key)
                                edges.append({"source": p["id"], "target": target_id, "kind": "wiki"})
                                degree[p["id"]] += 1
                                degree[target_id] += 1

                for p in pages:
                    nodes.append(
                        {
                            "id": p["id"],
                            "title": p["title"] or "Untitled",
                            "icon": p["icon"] or "📄",
                            "isFavorite": bool(p["is_favorite"]),
                            "degree": degree.get(p["id"], 0),
                        }
                    )

                self.send_json(200, {"nodes": nodes, "edges": edges})
                return

            # GET /api/workspaces/<ws_id>/export
            if len(parts) == 4 and parts[1] == "workspaces" and parts[3] == "export":
                ws_id = parts[2]
                ws = self.verify_workspace_owner(conn, ws_id, user["id"])
                if not ws:
                    self.send_error_json(404, "Workspace not found")
                    return
                pages = conn.execute(
                    "SELECT * FROM pages WHERE workspace_id = ? ORDER BY position ASC, created_at ASC",
                    (ws_id,),
                ).fetchall()
                export_pages = []
                for p in pages:
                    blks = conn.execute("SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC", (p["id"],)).fetchall()
                    export_pages.append({**serialize_page(p), "blocks": [serialize_block(b) for b in blks]})
                self.send_json(
                    200,
                    {
                        "exportedAt": now_ms(),
                        "workspace": serialize_workspace(ws),
                        "pages": export_pages,
                    },
                )
                return

            # GET /api/workspaces/<ws_id>/pages
            if len(parts) == 4 and parts[1] == "workspaces" and parts[3] == "pages":
                ws_id = parts[2]
                if not self.verify_workspace_owner(conn, ws_id, user["id"]):
                    self.send_error_json(404, "Workspace not found")
                    return
                trashed = 1 if query.get("trashed", ["0"])[0] == "1" else 0
                rows = conn.execute(
                    "SELECT * FROM pages WHERE workspace_id = ? AND is_trashed = ? ORDER BY position ASC, created_at ASC",
                    (ws_id, trashed),
                ).fetchall()
                self.send_json(200, {"pages": [serialize_page(r) for r in rows]})
                return

            # GET /api/workspaces/<ws_id>/search
            if len(parts) == 4 and parts[1] == "workspaces" and parts[3] == "search":
                ws_id = parts[2]
                if not self.verify_workspace_owner(conn, ws_id, user["id"]):
                    self.send_error_json(404, "Workspace not found")
                    return
                q = (query.get("q", [""])[0] or "").strip().lower()
                title_only = query.get("titleOnly", ["0"])[0] == "1"
                favorites_only = query.get("favoritesOnly", ["0"])[0] == "1"

                pages = conn.execute(
                    "SELECT * FROM pages WHERE workspace_id = ? AND is_trashed = 0 ORDER BY updated_at DESC",
                    (ws_id,),
                ).fetchall()
                page_map = {p["id"]: p for p in pages}

                def build_path(pid):
                    chain = []
                    cur = page_map.get(pid)
                    seen = set()
                    while cur and cur["parent_id"] and cur["parent_id"] not in seen:
                        seen.add(cur["id"])
                        parent = page_map.get(cur["parent_id"])
                        if not parent:
                            break
                        chain.append(parent["title"] or "Untitled")
                        cur = parent
                    chain.reverse()
                    return " / ".join(chain)

                filtered_pages = [p for p in pages if (not favorites_only or bool(p["is_favorite"]))]

                results = []
                if not q:
                    for p in filtered_pages[:15]:
                        results.append(
                            {
                                **serialize_page(p),
                                "breadcrumb": build_path(p["id"]),
                                "snippet": "",
                            }
                        )
                else:
                    snippet_by_page = {}
                    if not title_only:
                        like_q = f"%{q}%"
                        block_matches = conn.execute(
                            """
                            SELECT b.page_id, b.content, b.meta_json
                            FROM blocks b
                            JOIN pages p ON p.id = b.page_id
                            WHERE p.workspace_id = ? AND p.is_trashed = 0 AND (LOWER(b.content) LIKE ? OR LOWER(b.meta_json) LIKE ?)
                            ORDER BY b.position ASC
                            """,
                            (ws_id, like_q, like_q),
                        ).fetchall()
                        for bm in block_matches:
                            if bm["page_id"] not in snippet_by_page:
                                text = strip_html(bm["content"] or "") or bm["meta_json"] or ""
                                snippet_by_page[bm["page_id"]] = text

                    for p in filtered_pages:
                        title_l = (p["title"] or "").lower()
                        snippet = snippet_by_page.get(p["id"], "")
                        if q in title_l or (not title_only and snippet):
                            results.append(
                                {
                                    **serialize_page(p),
                                    "breadcrumb": build_path(p["id"]),
                                    "snippet": snippet[:140],
                                }
                            )
                self.send_json(200, {"results": results})
                return

            # GET /api/pages/<page_id>
            if len(parts) == 3 and parts[1] == "pages":
                page_id = parts[2]
                page = self.verify_page_owner(conn, page_id, user["id"])
                if not page:
                    self.send_error_json(404, "Page not found")
                    return
                blocks = conn.execute(
                    "SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC",
                    (page_id,),
                ).fetchall()
                children = conn.execute(
                    "SELECT * FROM pages WHERE parent_id = ? AND is_trashed = 0 ORDER BY position ASC, created_at ASC",
                    (page_id,),
                ).fetchall()
                comments = conn.execute(
                    "SELECT * FROM comments WHERE page_id = ? ORDER BY created_at ASC",
                    (page_id,),
                ).fetchall()

                # Compute Backlinks (other pages linking to this page via [[Title]])
                backlinks = []
                my_title = (page["title"] or "").strip().lower()
                if my_title:
                    other_pages = conn.execute(
                        "SELECT id, title, icon FROM pages WHERE workspace_id = ? AND is_trashed = 0 AND id != ?",
                        (page["workspace_id"], page_id),
                    ).fetchall()
                    for op in other_pages:
                        oblks = conn.execute("SELECT content, meta_json FROM blocks WHERE page_id = ?", (op["id"],)).fetchall()
                        targets = [t.lower() for t in extract_wiki_targets(oblks)]
                        if my_title in targets:
                            backlinks.append({"id": op["id"], "title": op["title"] or "Untitled", "icon": op["icon"] or "📄"})

                breadcrumbs = []
                cur_parent = page["parent_id"]
                seen = {page["id"]}
                while cur_parent and cur_parent not in seen:
                    seen.add(cur_parent)
                    prow = conn.execute("SELECT id, parent_id, title, icon FROM pages WHERE id = ?", (cur_parent,)).fetchone()
                    if not prow:
                        break
                    breadcrumbs.append({"id": prow["id"], "title": prow["title"] or "Untitled", "icon": prow["icon"]})
                    cur_parent = prow["parent_id"]
                breadcrumbs.reverse()

                self.send_json(
                    200,
                    {
                        "page": serialize_page(page),
                        "blocks": [serialize_block(b) for b in blocks],
                        "children": [serialize_page(c) for c in children],
                        "breadcrumbs": breadcrumbs,
                        "backlinks": backlinks,
                        "comments": [serialize_comment(c) for c in comments],
                    },
                )
                return

            self.send_error_json(404, "Endpoint not found")
        finally:
            conn.close()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()
        conn = get_db()
        try:
            if path == "/api/auth/register":
                email = (body.get("email") or "").strip().lower()
                password = body.get("password") or ""
                name = (body.get("name") or "").strip() or email.split("@")[0]

                if not email or "@" not in email:
                    self.send_error_json(400, "Please enter a valid email address.")
                    return
                if len(password) < 6:
                    self.send_error_json(400, "Password must be at least 6 characters.")
                    return

                existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
                if existing:
                    self.send_error_json(409, "An account with that email already exists.")
                    return

                user_id = str(uuid.uuid4())
                pw_hash, salt = hash_password(password)
                ts = now_ms()
                palette = ["#2383e2", "#e16259", "#0f7b6c", "#9065b0", "#d9730d", "#ad1a72"]
                color = palette[hash(email) % len(palette)]

                with conn:
                    conn.execute(
                        "INSERT INTO users (id, email, name, password_hash, salt, avatar_color, avatar_emoji, theme, created_at) VALUES (?, ?, ?, ?, ?, ?, '', 'light', ?)",
                        (user_id, email, name, pw_hash, salt, color, ts),
                    )
                    seed_starter_workspace(conn, user_id, name)
                    token = secrets.token_urlsafe(32)
                    conn.execute(
                        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                        (token, user_id, ts, ts + SESSION_TTL_SECONDS * 1000),
                    )

                user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                workspaces = conn.execute(
                    "SELECT * FROM workspaces WHERE user_id = ? ORDER BY created_at ASC",
                    (user_id,),
                ).fetchall()
                self.send_json(
                    201,
                    {
                        "user": serialize_user(user_row),
                        "workspaces": [serialize_workspace(w) for w in workspaces],
                    },
                    set_cookie_header=self.make_session_cookie(token),
                )
                return

            if path == "/api/auth/login":
                email = (body.get("email") or "").strip().lower()
                password = body.get("password") or ""
                user_row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
                if not user_row or not verify_password(password, user_row["password_hash"], user_row["salt"]):
                    self.send_error_json(401, "Invalid email or password.")
                    return

                ts = now_ms()
                token = secrets.token_urlsafe(32)
                with conn:
                    conn.execute(
                        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                        (token, user_row["id"], ts, ts + SESSION_TTL_SECONDS * 1000),
                    )

                workspaces = conn.execute(
                    "SELECT * FROM workspaces WHERE user_id = ? ORDER BY created_at ASC",
                    (user_row["id"],),
                ).fetchall()
                self.send_json(
                    200,
                    {
                        "user": serialize_user(user_row),
                        "workspaces": [serialize_workspace(w) for w in workspaces],
                    },
                    set_cookie_header=self.make_session_cookie(token),
                )
                return

            if path == "/api/auth/logout":
                token = self.get_session_token()
                if token:
                    with conn:
                        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                self.send_json(200, {"ok": True}, set_cookie_header=self.make_session_cookie("", clear=True))
                return

            user, token = self.get_current_user(conn)
            if not user:
                self.send_error_json(401, "Authentication required")
                return

            if path == "/api/auth/logout-all":
                with conn:
                    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
                self.send_json(200, {"ok": True}, set_cookie_header=self.make_session_cookie("", clear=True))
                return

            if path == "/api/auth/password":
                current_pw = body.get("currentPassword") or ""
                new_pw = body.get("newPassword") or ""
                if not verify_password(current_pw, user["password_hash"], user["salt"]):
                    self.send_error_json(400, "Current password is incorrect.")
                    return
                if len(new_pw) < 6:
                    self.send_error_json(400, "New password must be at least 6 characters.")
                    return
                new_hash, new_salt = hash_password(new_pw)
                with conn:
                    conn.execute(
                        "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
                        (new_hash, new_salt, user["id"]),
                    )
                self.send_json(200, {"ok": True})
                return

            if path == "/api/workspaces":
                name = (body.get("name") or "").strip() or "New Workspace"
                icon = (body.get("icon") or name[0].upper()).strip()[:2]
                ws_id = str(uuid.uuid4())
                ts = now_ms()
                with conn:
                    conn.execute(
                        "INSERT INTO workspaces (id, user_id, name, icon, created_at) VALUES (?, ?, ?, ?, ?)",
                        (ws_id, user["id"], name, icon, ts),
                    )
                    p_id = str(uuid.uuid4())
                    conn.execute(
                        "INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, is_favorite, is_trashed, position, created_at, updated_at) VALUES (?, ?, NULL, 'Welcome', '📄', '', 0, 0, 0, ?, ?)",
                        (p_id, ws_id, ts, ts),
                    )
                    conn.execute(
                        "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, 'paragraph', 'Start writing in your new workspace...', 0, 0, '{}', 0)",
                        (str(uuid.uuid4()), p_id),
                    )
                ws = conn.execute("SELECT * FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
                self.send_json(201, {"workspace": serialize_workspace(ws)})
                return

            parts = [p for p in path.split("/") if p]
            if len(parts) == 4 and parts[1] == "workspaces" and parts[3] == "pages":
                ws_id = parts[2]
                if not self.verify_workspace_owner(conn, ws_id, user["id"]):
                    self.send_error_json(404, "Workspace not found")
                    return
                parent_id = body.get("parentId") or None
                if parent_id:
                    parent = self.verify_page_owner(conn, parent_id, user["id"])
                    if not parent or parent["workspace_id"] != ws_id:
                        self.send_error_json(400, "Invalid parent page")
                        return
                title = body.get("title") if body.get("title") is not None else ""
                icon = body.get("icon") or ""
                cover = body.get("cover") or ""
                initial_blocks = body.get("blocks")
                ts = now_ms()
                max_pos = conn.execute(
                    "SELECT COALESCE(MAX(position), -1) FROM pages WHERE workspace_id = ? AND parent_id IS ?",
                    (ws_id, parent_id),
                ).fetchone()[0]
                page_id = str(uuid.uuid4())
                with conn:
                    conn.execute(
                        """
                        INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, is_favorite, is_trashed, position, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
                        """,
                        (page_id, ws_id, parent_id, title, icon, cover, max_pos + 1, ts, ts),
                    )
                    if isinstance(initial_blocks, list) and initial_blocks:
                        for idx, b in enumerate(initial_blocks):
                            conn.execute(
                                "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                (
                                    str(uuid.uuid4()),
                                    page_id,
                                    b.get("type") or "paragraph",
                                    b.get("content") or "",
                                    1 if b.get("checked") else 0,
                                    1 if b.get("collapsed") else 0,
                                    json.dumps(b.get("meta") or {}),
                                    idx,
                                ),
                            )
                    else:
                        conn.execute(
                            "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, 'paragraph', '', 0, 0, '{}', 0)",
                            (str(uuid.uuid4()), page_id),
                        )
                page = conn.execute("SELECT * FROM pages WHERE id = ?", (page_id,)).fetchone()
                self.send_json(201, {"page": serialize_page(page)})
                return

            # POST /api/pages/<page_id>/comments
            if len(parts) == 4 and parts[1] == "pages" and parts[3] == "comments":
                page_id = parts[2]
                if not self.verify_page_owner(conn, page_id, user["id"]):
                    self.send_error_json(404, "Page not found")
                    return
                content = (body.get("content") or "").strip()
                if not content:
                    self.send_error_json(400, "Comment cannot be empty.")
                    return
                cid = str(uuid.uuid4())
                ts = now_ms()
                with conn:
                    conn.execute(
                        "INSERT INTO comments (id, page_id, user_id, author_name, content, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
                        (cid, page_id, user["id"], user["name"], content, ts),
                    )
                row = conn.execute("SELECT * FROM comments WHERE id = ?", (cid,)).fetchone()
                self.send_json(201, {"comment": serialize_comment(row)})
                return

            if len(parts) == 4 and parts[1] == "pages" and parts[3] == "duplicate":
                page_id = parts[2]
                orig = self.verify_page_owner(conn, page_id, user["id"])
                if not orig:
                    self.send_error_json(404, "Page not found")
                    return
                new_id = str(uuid.uuid4())
                ts = now_ms()
                new_title = f"{orig['title'] or 'Untitled'} (Copy)"
                blocks = conn.execute("SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC", (page_id,)).fetchall()
                with conn:
                    conn.execute(
                        """
                        INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, tags_json, is_favorite, is_trashed, full_width, small_text, font_style, is_locked, position, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 0, ?, ?, ?)
                        """,
                        (
                            new_id,
                            orig["workspace_id"],
                            orig["parent_id"],
                            new_title,
                            orig["icon"],
                            orig["cover"],
                            orig["tags_json"] if "tags_json" in orig.keys() else "[]",
                            orig["full_width"],
                            orig["small_text"],
                            orig["font_style"] if "font_style" in orig.keys() else "sans",
                            orig["position"] + 1,
                            ts,
                            ts,
                        ),
                    )
                    for b in blocks:
                        conn.execute(
                            "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (str(uuid.uuid4()), new_id, b["type"], b["content"], b["checked"], b["collapsed"], b["meta_json"], b["position"]),
                        )
                new_page = conn.execute("SELECT * FROM pages WHERE id = ?", (new_id,)).fetchone()
                self.send_json(201, {"page": serialize_page(new_page)})
                return

            self.send_error_json(404, "Endpoint not found")
        finally:
            conn.close()

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()
        conn = get_db()
        try:
            user, _ = self.get_current_user(conn)
            if not user:
                self.send_error_json(401, "Authentication required")
                return

            if path == "/api/auth/profile":
                name = body.get("name")
                email = body.get("email")
                avatar_color = body.get("avatarColor")
                avatar_emoji = body.get("avatarEmoji")
                theme = body.get("theme")

                updates = []
                params = []
                if name is not None:
                    name = name.strip()
                    if not name:
                        self.send_error_json(400, "Name cannot be empty.")
                        return
                    updates.append("name = ?")
                    params.append(name)
                if email is not None:
                    email = email.strip().lower()
                    if "@" not in email:
                        self.send_error_json(400, "Invalid email address.")
                        return
                    dup = conn.execute("SELECT id FROM users WHERE email = ? AND id != ?", (email, user["id"])).fetchone()
                    if dup:
                        self.send_error_json(409, "Email already in use.")
                        return
                    updates.append("email = ?")
                    params.append(email)
                if avatar_color is not None:
                    updates.append("avatar_color = ?")
                    params.append(str(avatar_color)[:20])
                if avatar_emoji is not None:
                    updates.append("avatar_emoji = ?")
                    params.append(str(avatar_emoji)[:8])
                if theme in ("light", "dark", "system"):
                    updates.append("theme = ?")
                    params.append(theme)

                if updates:
                    params.append(user["id"])
                    with conn:
                        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)

                updated = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
                self.send_json(200, {"user": serialize_user(updated)})
                return

            parts = [p for p in path.split("/") if p]
            if len(parts) == 3 and parts[1] == "workspaces":
                ws_id = parts[2]
                ws = self.verify_workspace_owner(conn, ws_id, user["id"])
                if not ws:
                    self.send_error_json(404, "Workspace not found")
                    return
                updates = []
                params = []
                if "name" in body and str(body["name"]).strip():
                    updates.append("name = ?")
                    params.append(str(body["name"]).strip())
                if "icon" in body and str(body["icon"]).strip():
                    updates.append("icon = ?")
                    params.append(str(body["icon"]).strip()[:4])
                if updates:
                    params.append(ws_id)
                    with conn:
                        conn.execute(f"UPDATE workspaces SET {', '.join(updates)} WHERE id = ?", params)
                updated = conn.execute("SELECT * FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
                self.send_json(200, {"workspace": serialize_workspace(updated)})
                return

            if len(parts) == 3 and parts[1] == "pages":
                page_id = parts[2]
                page = self.verify_page_owner(conn, page_id, user["id"])
                if not page:
                    self.send_error_json(404, "Page not found")
                    return

                field_map = {
                    "title": "title",
                    "icon": "icon",
                    "cover": "cover",
                    "isFavorite": "is_favorite",
                    "isTrashed": "is_trashed",
                    "fullWidth": "full_width",
                    "smallText": "small_text",
                    "fontStyle": "font_style",
                    "isLocked": "is_locked",
                    "parentId": "parent_id",
                }
                updates = []
                params = []
                for js_key, col in field_map.items():
                    if js_key in body:
                        val = body[js_key]
                        if col == "parent_id" and val == page_id:
                            continue  # prevent self-parenting
                        if col in ("is_favorite", "is_trashed", "full_width", "small_text", "is_locked"):
                            val = 1 if val else 0
                        if col == "font_style" and val not in ("sans", "serif", "mono"):
                            continue
                        updates.append(f"{col} = ?")
                        params.append(val)

                if "tags" in body and isinstance(body["tags"], list):
                    clean_tags = [str(t).strip()[:32] for t in body["tags"] if str(t).strip()]
                    updates.append("tags_json = ?")
                    params.append(json.dumps(clean_tags[:12]))

                if updates:
                    updates.append("updated_at = ?")
                    params.append(now_ms())
                    params.append(page_id)
                    with conn:
                        conn.execute(f"UPDATE pages SET {', '.join(updates)} WHERE id = ?", params)
                        if "isTrashed" in body:
                            trashed_val = 1 if body["isTrashed"] else 0
                            queue = [page_id]
                            while queue:
                                cid = queue.pop(0)
                                children = conn.execute("SELECT id FROM pages WHERE parent_id = ?", (cid,)).fetchall()
                                for ch in children:
                                    conn.execute("UPDATE pages SET is_trashed = ? WHERE id = ?", (trashed_val, ch["id"]))
                                    queue.append(ch["id"])

                updated = conn.execute("SELECT * FROM pages WHERE id = ?", (page_id,)).fetchone()
                self.send_json(200, {"page": serialize_page(updated)})
                return

            self.send_error_json(404, "Endpoint not found")
        finally:
            conn.close()

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()
        conn = get_db()
        try:
            user, _ = self.get_current_user(conn)
            if not user:
                self.send_error_json(401, "Authentication required")
                return

            parts = [p for p in path.split("/") if p]
            if len(parts) == 4 and parts[1] == "pages" and parts[3] == "blocks":
                page_id = parts[2]
                page = self.verify_page_owner(conn, page_id, user["id"])
                if not page:
                    self.send_error_json(404, "Page not found")
                    return
                blocks = body.get("blocks", [])
                if not isinstance(blocks, list):
                    self.send_error_json(400, "blocks must be a list")
                    return

                ts = now_ms()
                with conn:
                    conn.execute("DELETE FROM blocks WHERE page_id = ?", (page_id,))
                    for idx, b in enumerate(blocks):
                        b_id = b.get("id") or str(uuid.uuid4())
                        b_type = b.get("type") or "paragraph"
                        b_content = b.get("content") or ""
                        b_checked = 1 if b.get("checked") else 0
                        b_collapsed = 1 if b.get("collapsed") else 0
                        b_meta = json.dumps(b.get("meta") or {})
                        conn.execute(
                            "INSERT INTO blocks (id, page_id, type, content, checked, collapsed, meta_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (b_id, page_id, b_type, b_content, b_checked, b_collapsed, b_meta, idx),
                        )
                    conn.execute("UPDATE pages SET updated_at = ? WHERE id = ?", (ts, page_id))

                self.send_json(200, {"ok": True, "updatedAt": ts})
                return

            self.send_error_json(404, "Endpoint not found")
        finally:
            conn.close()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        conn = get_db()
        try:
            user, _ = self.get_current_user(conn)
            if not user:
                self.send_error_json(401, "Authentication required")
                return

            parts = [p for p in path.split("/") if p]
            if len(parts) == 3 and parts[1] == "pages":
                page_id = parts[2]
                page = self.verify_page_owner(conn, page_id, user["id"])
                if not page:
                    self.send_error_json(404, "Page not found")
                    return
                with conn:
                    conn.execute("DELETE FROM pages WHERE id = ?", (page_id,))
                self.send_json(200, {"ok": True})
                return

            # DELETE /api/workspaces/<ws_id>
            if len(parts) == 3 and parts[1] == "workspaces":
                ws_id = parts[2]
                ws = self.verify_workspace_owner(conn, ws_id, user["id"])
                if not ws:
                    self.send_error_json(404, "Workspace not found")
                    return
                total_ws = conn.execute("SELECT COUNT(*) FROM workspaces WHERE user_id = ?", (user["id"],)).fetchone()[0]
                if total_ws <= 1:
                    self.send_error_json(400, "You cannot delete your only workspace. Create another workspace first.")
                    return
                with conn:
                    conn.execute("DELETE FROM workspaces WHERE id = ?", (ws_id,))
                self.send_json(200, {"ok": True})
                return

            # DELETE /api/comments/<comment_id>
            if len(parts) == 3 and parts[1] == "comments":
                cid = parts[2]
                row = conn.execute("SELECT * FROM comments WHERE id = ? AND user_id = ?", (cid, user["id"])).fetchone()
                if not row:
                    self.send_error_json(404, "Comment not found")
                    return
                with conn:
                    conn.execute("DELETE FROM comments WHERE id = ?", (cid,))
                self.send_json(200, {"ok": True})
                return

            self.send_error_json(404, "Endpoint not found")
        finally:
            conn.close()


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), NotionHandler)
    print(f"Notion Replica running at http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Notion Replica...")
        server.server_close()


if __name__ == "__main__":
    main()
