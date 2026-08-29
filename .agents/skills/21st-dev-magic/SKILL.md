---
name: 21st-dev-magic
description: Search, generate, and insert production-ready React, Tailwind, and Framer Motion UI components from 21st.dev (Magic MCP). Use when asked for "21st component", "generate modern UI component", "find landing hero on 21st", "animated button", "pricing card", or "shadcn component".
metadata:
  provider: 21st.dev
  mcp-endpoint: https://21st.dev/api/mcp
---

# 21st.dev (Magic MCP) UI Component Guide

Connects AI coding assistants with [21st.dev](https://21st.dev), the open component library for design engineers.

## Capabilities

1. **Component Discovery & Search**: Find production-ready React/Tailwind components from thousands of community submissions (heroes, cards, headers, interactive switches, charts, modals, docks).
2. **Design-Engineered Quality**: Components leverage Tailwind CSS, Framer Motion, Radix UI, and shadcn/ui conventions.
3. **In-Editor Insertion**: Automatically formats and adapts imported components to your project's styling and icon sets.

## MCP Configuration

The MCP server is configured at `https://21st.dev/api/mcp`.

```json
{
  "mcpServers": {
    "21st-magic": {
      "serverUrl": "https://21st.dev/api/mcp",
      "headers": {
        "x-api-key": "YOUR_21ST_API_KEY"
      }
    }
  }
}
```

## How to Get an API Key

1. Visit [21st.dev/mcp](https://21st.dev/mcp)
2. Sign in with GitHub
3. Copy your personal API key
4. Paste into `C:\Users\HP\.gemini\config\mcp_config.json` or `.agents/mcp_config.json` under `headers: { "x-api-key": "..." }`.
