#!/usr/bin/env sh
# Launcher for the bookrecs MCP server. Works from any working directory.
cd "$(dirname "$0")/.." || exit 1
exec bun run src/mcp.ts
