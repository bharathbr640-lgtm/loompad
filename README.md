# Loompad

**Your workspace. Your knowledge. Your control.**

Loompad is a local-first, privacy-focused workspace that combines
Notion-style block editing, nested pages, and multi-view databases
with Obsidian-style wiki links and an interactive knowledge graph.

Built without AI features, third-party runtime dependencies,
or external cloud services for core functionality.

## Features

### Workspace & Navigation

- Multi-workspace management
- Desktop-style multi-tab navigation
- Back and Forward navigation history
- Collapsible and resizable sidebar
- Home dashboard
- Favorites
- Trash with restore and permanent deletion

### Page Management

- Unlimited nested sub-pages
- Drag-and-drop page organization
- Custom page icons and gradient covers
- Page tags and comments
- Word count
- Page locking

### Rich Block Editor

- Slash command menu (`/`)
- Markdown shortcuts
- Floating inline formatting toolbar
- Bold, italic, underline, and strikethrough
- Inline code, highlights, and text colors
- Drag-and-drop block reordering
- Two-column layouts
- Callouts and toggle blocks
- Code blocks
- Images and web bookmarks
- Equations
- Automatically updated table of contents

### Multi-View Databases

Create databases using the `/database` command.

Supported views:

| View | Purpose |
|------|---------|
| Table | Structured data management |
| Kanban Board | Visual task management |
| List | Simplified record navigation |
| Gallery | Visual content organization |

Databases support status and priority properties,
filtering, and sorting.

### Connected Knowledge

- Obsidian-style `[[Wiki Links]]`
- Automatic page backlinks
- Interactive knowledge graph
- Visual exploration of page relationships

### Quick Search

Open search using `Cmd+K` on macOS or `Ctrl+K`
on Windows and Linux.

- Search page titles
- Search block content
- Title-only filtering
- Favorites-only filtering

### Import, Export & Sharing

- Import Markdown files
- Export individual pages as Markdown
- Download complete workspace JSON backups
- Share pages and workspaces via email

### Authentication & Privacy

- Local user authentication
- PBKDF2-HMAC-SHA256 password hashing
- HttpOnly session cookies
- Profile and password management
- Light, Dark, and System themes
- Local SQLite storage diagnostics
- No mandatory cloud account
- No AI features

## Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3 Standard Library |
| HTTP Server | ThreadingHTTPServer |
| Frontend | HTML5, CSS3, JavaScript ES6 |
| Database | SQLite |
| Password Hashing | PBKDF2-HMAC-SHA256 |
| External Runtime Dependencies | None |

## Getting Started

### Prerequisites

- Python 3
- A modern web browser

No pip packages or npm dependencies are required.

### Run Locally

Navigate to the project directory:

```bash
cd /Users/bharathbr/Notion
```

Start the backend server:

```bash
python3 server.py
```

Open the local server address displayed in the terminal
using your web browser.

To stop the server, press `Ctrl+C`.

## Database Configuration

Loompad uses SQLite for local data persistence.

Default database file:

```text
notion.db
```

A custom database path can be configured using the
`NOTION_DB_PATH` environment variable:

```bash
NOTION_DB_PATH=./loompad.db python3 server.py
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl + K | Quick search |
| / | Open block command menu |
| [[ | Create a wiki link |
| # | Heading 1 |
| ## | Heading 2 |
| ### | Heading 3 |
| - | Bullet list |
| 1. | Numbered list |
| [] | Checklist |
| > | Quote |
| --- | Divider |

## Design Philosophy

Loompad is built around five principles:

1. **Local-first:** Keep workspace data on your device.
2. **Privacy:** Give users control over their information.
3. **Simplicity:** Avoid unnecessary frameworks and dependencies.
4. **Connected knowledge:** Organize ideas through meaningful relationships.
5. **Ownership:** Make knowledge portable through open export formats.

## Project Vision

Bring the structured productivity of Notion and the connected
knowledge experience of Obsidian into a lightweight,
independent, local-first workspace.

---

**Loompad — Build your workspace. Connect your knowledge.**
