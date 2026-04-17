#!/usr/bin/env node

// ─────────────────────────────────────────────────────────────────────────────
// Imports — MCP SDK gives us the server and transport layer;
// zod handles input validation; fs/path are Node built-ins for file I/O.
// ─────────────────────────────────────────────────────────────────────────────
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─────────────────────────────────────────────────────────────────────────────
// __dirname shim — ES modules don't have __dirname by default, so we
// derive it from import.meta.url so relative file paths resolve correctly.
// ─────────────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the JSON file that stores all user context on disk.
const CONTEXT_FILE = path.join(__dirname, "context.json");

// ─────────────────────────────────────────────────────────────────────────────
// readContext — loads context.json from disk and parses it.
// Returns the parsed object, or throws a descriptive error if the file
// can't be found or contains invalid JSON.
// ─────────────────────────────────────────────────────────────────────────────
function readContext() {
  try {
    const raw = fs.readFileSync(CONTEXT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Could not read context.json: ${err.message}. ` +
      `Make sure the file exists at: ${CONTEXT_FILE}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// writeContext — serializes the context object and saves it to context.json.
// Always pretty-prints with 2-space indent for human readability.
// ─────────────────────────────────────────────────────────────────────────────
function writeContext(data) {
  try {
    fs.writeFileSync(CONTEXT_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    throw new Error(
      `Could not write context.json: ${err.message}. ` +
      `Check that the file is not read-only and the directory is writable.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// formatContextAsMarkdown — takes the raw context object and renders it as
// a clean markdown block that an AI can paste directly into its system prompt
// or use as grounding context. Skips fields that are empty/unpopulated.
// ─────────────────────────────────────────────────────────────────────────────
function formatContextAsMarkdown(ctx) {
  const lines = ["## User Context (Context Passport)\n"];

  if (ctx.name)       lines.push(`**Name:** ${ctx.name}`);
  if (ctx.role)       lines.push(`**Role:** ${ctx.role}`);
  if (ctx.work_style) lines.push(`**Work Style:** ${ctx.work_style}`);
  if (ctx.goals)      lines.push(`**Goals:** ${ctx.goals}`);

  if (ctx.working_on?.length)
    lines.push(`**Currently Working On:**\n${ctx.working_on.map(i => `- ${i}`).join("\n")}`);

  if (ctx.expertise?.length)
    lines.push(`**Expertise:**\n${ctx.expertise.map(i => `- ${i}`).join("\n")}`);

  if (ctx.do_not?.length)
    lines.push(`**Do NOT do these things:**\n${ctx.do_not.map(i => `- ${i}`).join("\n")}`);

  // Current project block
  const p = ctx.current_project;
  if (p?.name) {
    lines.push(`\n**Current Project: ${p.name}**`);
    if (p.description) lines.push(`Description: ${p.description}`);
    if (p.status)      lines.push(`Status: ${p.status}`);
    if (p.next_steps?.length)
      lines.push(`Next Steps:\n${p.next_steps.map(s => `- ${s}`).join("\n")}`);
  }

  if (ctx.last_updated)
    lines.push(`\n_Last updated: ${ctx.last_updated}_`);

  return lines.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// githubFetch — a small helper that makes authenticated requests to the
// GitHub REST API. Uses Node's built-in fetch (available since Node 18).
// Throws a clear error if the token is missing or the request fails.
// ─────────────────────────────────────────────────────────────────────────────
async function githubFetch(endpoint, token) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "context-passport-mcp/1.0",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${endpoint} → ${res.status}: ${body}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server setup — create the server with a name and version.
// The name shows up in MCP client UIs (like Claude Desktop's tool list).
// ─────────────────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "context-passport",
  version: "1.1.0",
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: get_context
// Reads context.json and returns the full user profile as formatted markdown.
// The AI calls this at the start of a conversation to get full context.
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "get_context",
  "Get the user's full personal context — name, role, expertise, goals, work style, and current project. Call this at the start of any session to understand who you're talking to.",
  {}, // no inputs needed
  async () => {
    try {
      const ctx = readContext();
      const markdown = formatContextAsMarkdown(ctx);
      return {
        content: [{ type: "text", text: markdown }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2: update_context
// Accepts any subset of the context fields, merges them into the existing
// context.json, and saves. Always stamps last_updated with the current time.
// The AI calls this when the user shares new info about themselves or their work.
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "update_context",
  "Update one or more fields of the user's context. Only pass the fields you want to change — everything else stays as-is. Call this whenever the user shares new info about themselves, their project, or their preferences.",
  {
    name:            z.string().optional().describe("User's full name"),
    role:            z.string().optional().describe("Job title or role, e.g. 'Senior Product Manager'"),
    working_on:      z.array(z.string()).optional().describe("List of things currently being worked on"),
    expertise:       z.array(z.string()).optional().describe("Skills and areas of expertise"),
    work_style:      z.string().optional().describe("How the user likes to work and communicate"),
    goals:           z.string().optional().describe("Short-term and long-term goals"),
    do_not:          z.array(z.string()).optional().describe("Things the AI should never do (pet peeves, anti-patterns, etc.)"),
    current_project: z.object({
      name:        z.string().optional(),
      description: z.string().optional(),
      status:      z.string().optional(),
      next_steps:  z.array(z.string()).optional(),
    }).optional().describe("The project the user is actively focused on right now"),
  },
  async (inputs) => {
    try {
      const ctx = readContext();

      // Track which top-level fields are being changed for the confirmation message.
      const changedFields = Object.keys(inputs);

      // Merge top-level fields. For current_project we do a nested merge so
      // passing only { status: "done" } doesn't wipe out the project name/description.
      if (inputs.current_project) {
        ctx.current_project = Object.assign(
          {},
          ctx.current_project,
          inputs.current_project
        );
        // Remove from inputs before the top-level assign to avoid overwriting
        const { current_project, ...rest } = inputs;
        Object.assign(ctx, rest);
      } else {
        Object.assign(ctx, inputs);
      }

      // Always stamp the update time so we know when context was last touched.
      ctx.last_updated = new Date().toISOString();

      writeContext(ctx);

      const fieldList = changedFields.length
        ? changedFields.map(f => `- ${f}`).join("\n")
        : "- (no fields provided)";

      return {
        content: [{
          type: "text",
          text: `Context updated successfully.\n\nChanged fields:\n${fieldList}\n\nLast updated: ${ctx.last_updated}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3: get_current_project
// Returns only the current_project block from context.json, formatted clearly.
// Useful when the AI only needs project focus without loading the full profile.
// If no project is set, it tells the AI to ask the user and call update_context.
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "get_current_project",
  "Get just the user's current project — name, description, status, and next steps. Use this when you need to focus on what the user is actively building right now.",
  {}, // no inputs needed
  async () => {
    try {
      const ctx = readContext();
      const p = ctx.current_project;

      // If no project has been set, guide the AI to ask the user.
      if (!p?.name) {
        return {
          content: [{
            type: "text",
            text: [
              "No current project has been set in Context Passport.",
              "",
              "Please ask the user what they're working on, then call `update_context`",
              "with a `current_project` object containing at minimum a `name` field.",
              "",
              "Example:",
              "```json",
              '{',
              '  "current_project": {',
              '    "name": "My App",',
              '    "description": "What the project does",',
              '    "status": "In progress",',
              '    "next_steps": ["Step 1", "Step 2"]',
              '  }',
              '}',
              "```",
            ].join("\n"),
          }],
        };
      }

      // Format the project details as readable markdown.
      const lines = [`## Current Project: ${p.name}\n`];
      if (p.description) lines.push(`**Description:** ${p.description}`);
      if (p.status)      lines.push(`**Status:** ${p.status}`);
      if (p.next_steps?.length) {
        lines.push(`**Next Steps:**`);
        p.next_steps.forEach(s => lines.push(`- ${s}`));
      }
      if (ctx.last_updated)
        lines.push(`\n_Context last updated: ${ctx.last_updated}_`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 4: sync_from_github
// Pulls live data from the GitHub API and merges it into context.json.
// Fetches: your display name, top repos by recent activity, languages used
// across those repos, and any pull requests you have open right now.
//
// Requires a GITHUB_TOKEN environment variable — a GitHub Personal Access
// Token with at least "repo" scope. Add it to your MCP config (see README).
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "sync_from_github",
  "Pull your latest GitHub activity into Context Passport — repos you're actively working in, languages you're using, and open pull requests. Requires a GITHUB_TOKEN env var set in your MCP config.",
  {
    max_repos: z.number().optional().default(8).describe("How many of your most recently-updated repos to inspect (default 8)"),
  },
  async ({ max_repos = 8 }) => {
    // ── 1. Check for token ──────────────────────────────────────────────────
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        content: [{
          type: "text",
          text: [
            "No GITHUB_TOKEN found.",
            "",
            "To fix this, add an `env` block to your MCP config in claude_desktop_config.json:",
            "",
            '```json',
            '"context-passport": {',
            '  "command": "/usr/local/bin/node",',
            '  "args": ["/path/to/context-passport/server.js"],',
            '  "env": {',
            '    "GITHUB_TOKEN": "ghp_your_token_here"',
            '  }',
            '}',
            '```',
            "",
            "Create a token at: https://github.com/settings/tokens",
            "Required scopes: repo (for private repos) or public_repo (public only)",
          ].join("\n"),
        }],
      };
    }

    try {
      // ── 2. Fetch authenticated user profile ────────────────────────────────
      const user = await githubFetch("/user", token);
      const username = user.login;

      // ── 3. Fetch most recently updated repos ───────────────────────────────
      const repos = await githubFetch(
        `/user/repos?sort=updated&per_page=${max_repos}&affiliation=owner,collaborator`,
        token
      );

      // ── 4. Collect repo names and languages ────────────────────────────────
      // Build a deduplicated list of languages across all fetched repos.
      const repoNames = repos
        .filter(r => !r.archived && !r.fork)
        .map(r => r.full_name);

      const languageSet = new Set();
      for (const repo of repos) {
        if (repo.language) languageSet.add(repo.language);
      }
      const languages = [...languageSet];

      // ── 5. Fetch open pull requests authored by this user ──────────────────
      const prSearch = await githubFetch(
        `/search/issues?q=is:pr+is:open+author:${username}&per_page=5`,
        token
      );
      const openPRs = prSearch.items.map(pr => `${pr.title} (${pr.repository_url.split("/").slice(-2).join("/")})`);

      // ── 6. Merge everything into context.json ──────────────────────────────
      const ctx = readContext();

      // Only set name if not already filled in by the user.
      if (!ctx.name && user.name) ctx.name = user.name;

      // Replace working_on with the active repo list.
      ctx.working_on = repoNames;

      // Merge GitHub languages into existing expertise without wiping manual entries.
      const existingExpertise = new Set(ctx.expertise || []);
      languages.forEach(l => existingExpertise.add(l));
      ctx.expertise = [...existingExpertise];

      // Store open PRs in a new github block for reference.
      ctx.github = {
        username,
        open_prs: openPRs,
        last_synced: new Date().toISOString(),
      };

      ctx.last_updated = new Date().toISOString();
      writeContext(ctx);

      // ── 7. Return a summary of what was pulled in ──────────────────────────
      const lines = [
        `## GitHub sync complete for @${username}`,
        "",
        `**Repos pulled in (${repoNames.length}):**`,
        ...repoNames.map(r => `- ${r}`),
        "",
        `**Languages detected:** ${languages.join(", ") || "none"}`,
        "",
      ];

      if (openPRs.length) {
        lines.push(`**Open PRs (${openPRs.length}):**`);
        openPRs.forEach(pr => lines.push(`- ${pr}`));
      } else {
        lines.push("**Open PRs:** none");
      }

      lines.push("", `_Synced at: ${ctx.github.last_synced}_`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };

    } catch (err) {
      return {
        content: [{ type: "text", text: `GitHub sync failed: ${err.message}` }],
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Start the server — StdioServerTransport means the server communicates over
// stdin/stdout, which is how Claude Desktop and other MCP clients talk to it.
// The process hangs here waiting for MCP messages — that is expected behavior.
// ─────────────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
