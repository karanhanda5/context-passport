# Context Passport

A personal context layer MCP server. Fill in your profile once, then any MCP-compatible AI (Claude Desktop, Cursor, etc.) instantly knows who you are, what you're working on, and how you like to work — without you re-explaining yourself every session.

Everything is stored locally in `context.json`. Nothing leaves your machine (except when you explicitly call `sync_from_github`, which reads from the GitHub API).

---

## Setup

### 1. Install

```bash
# Option A — clone and install
git clone https://github.com/karanhanda/context-passport
cd context-passport
npm install

# Option B — run directly with npx (no clone needed)
npx context-passport
```

### 2. Fill in your context

Open `context.json` and fill in your details:

```json
{
  "name": "Jane Smith",
  "role": "Senior Product Manager",
  "working_on": ["Q2 roadmap", "mobile redesign"],
  "expertise": ["product strategy", "SQL", "user research"],
  "work_style": "Prefer concise answers. Always give me the 'why' before the 'how'.",
  "goals": "Ship mobile v2 by end of Q2, get promoted to Director by EOY",
  "do_not": ["don't give me bullet points for everything", "don't be sycophantic"],
  "current_project": {
    "name": "Mobile Redesign v2",
    "description": "Full redesign of the iOS and Android apps for 2M+ users",
    "status": "In design review",
    "next_steps": ["Finalize nav patterns", "Handoff to eng by May 1"]
  },
  "last_updated": ""
}
```

Or skip this entirely and call `sync_from_github` to auto-populate from your GitHub activity.

### 3. Connect to Claude Desktop

Open your Claude Desktop config file (locations below) and add the `mcpServers` block:

```json
{
  "mcpServers": {
    "context-passport": {
      "command": "/usr/local/bin/node",
      "args": ["/ABSOLUTE/PATH/TO/context-passport/server.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

The `env` block is optional — only needed for GitHub sync. Leave it out if filling in `context.json` manually.

---

## Config file locations

| Platform | Path |
|----------|------|
| **Mac**  | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |

After saving, **restart Claude Desktop** for the changes to take effect.

---

## GitHub auto-sync

Instead of filling in `context.json` by hand, call `sync_from_github` and Context Passport will automatically pull in:

- Your recently active repos → `working_on`
- Languages used across those repos → merged into `expertise`
- Your open pull requests → stored in `github.open_prs`
- Your GitHub display name → `name` (if not already set)

### Getting a GitHub token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Name it `context-passport`
4. Check the `repo` scope (or `public_repo` for public repos only)
5. Copy the token and paste it into `env.GITHUB_TOKEN` in your MCP config

---

## How to test it

Once Claude Desktop is restarted, open a new conversation and type:

```
Load my context passport.
```

Claude will call `get_context` and greet you with a summary of your profile. Also try:

```
Sync my GitHub activity into my context.
```

```
What am I currently working on?
```

```
Update my context — I just started a new project called "API overhaul".
```

---

## The four tools

| Tool | What it does |
|------|-------------|
| `get_context` | Returns your full profile as formatted markdown — name, role, expertise, goals, work style, and current project |
| `update_context` | Updates any field(s) and saves to disk. Pass only the fields you want to change. |
| `get_current_project` | Returns just your current project block. If empty, prompts the AI to ask you. |
| `sync_from_github` | Pulls your repos, languages, and open PRs from GitHub and merges them into your profile. Requires `GITHUB_TOKEN`. |

---

## Publishing / using via npx

Anyone can run Context Passport without cloning:

```bash
npx context-passport
```

Or install globally:

```bash
npm install -g context-passport
```

Then use `context-passport` as the command in the MCP config instead of a full `node /path/to/server.js`.

---

## Listing on Smithery

[Smithery](https://smithery.ai) is the public registry for MCP servers. To list Context Passport:

1. Push this repo to GitHub
2. Go to [smithery.ai](https://smithery.ai) and sign in with GitHub
3. Click **Submit a server** and paste your GitHub repo URL
4. Smithery reads `smithery.yaml` automatically — config schema and install instructions are already set up

---

## Privacy

All data is stored in `context.json` on your local machine. The server runs as a local process communicating only over stdin/stdout with your AI client. **No data is sent to any external server.** The only outbound network call is to `api.github.com` when you explicitly call `sync_from_github`.
