## Context Usage

**Model:** claude-opus-5-5  
**Tokens:** 38.9k / 1m (4%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.5k | 0.2% |
| System tools | 10.1k | 1.0% |
| MCP tools | 676 | 0.1% |
| MCP server instructions | 1.1k | 0.1% |
| MCP tools (deferred) | 32.7k | 3.3% |
| System tools (deferred) | 17.1k | 1.7% |
| Custom agents | 423 | 0.0% |
| Memory files | 16k | 1.6% |
| Skills | 6.5k | 0.6% |
| Messages | 1.6k | 0.2% |
| Compact buffer | 3k | 0.3% |
| Free space | 958.1k | 95.8% |

### MCP Tools

| Tool | Server | Tokens |
|------|--------|--------|
| mcp__claude_ai_Claude_Data__certify_query | claude_ai_Claude_Data | 1.2k |
| mcp__claude_ai_Claude_Data__get_certified_query_source | claude_ai_Claude_Data | 476 |
| mcp__claude_ai_Claude_Data__get_live_results | claude_ai_Claude_Data | 1.9k |
| mcp__claude_ai_Claude_Data__list_certified_queries | claude_ai_Claude_Data | 627 |
| mcp__claude_ai_Claude_Data__set_certified_query_source | claude_ai_Claude_Data | 310 |
| mcp__claude_ai_Claude_Data__share_connector | claude_ai_Claude_Data | 1.2k |
| mcp__claude_ai_Claude_Data__share_live_queries | claude_ai_Claude_Data | 2k |
| mcp__claude_ai_Claude_Data__shared_results | claude_ai_Claude_Data | 1.3k |
| mcp__claude_ai_Claude_Data__uncertify_query | claude_ai_Claude_Data | 402 |
| mcp__claude_ai_Claude_Data__unshare_connector | claude_ai_Claude_Data | 264 |
| mcp__claude_ai_Claude_Data__unshare_live_queries | claude_ai_Claude_Data | 261 |
| mcp__claude_ai_Claude_Docs__batch | claude_ai_Claude_Docs | 166 |
| mcp__claude_ai_Claude_Docs__create | claude_ai_Claude_Docs | 258 |
| mcp__claude_ai_Claude_Docs__delete | claude_ai_Claude_Docs | 334 |
| mcp__claude_ai_Claude_Docs__export | claude_ai_Claude_Docs | 507 |
| mcp__claude_ai_Claude_Docs__guide | claude_ai_Claude_Docs | 210 |
| mcp__claude_ai_Claude_Docs__query | claude_ai_Claude_Docs | 183 |
| mcp__claude_ai_Claude_Docs__read | claude_ai_Claude_Docs | 327 |
| mcp__claude_ai_Claude_Docs__update | claude_ai_Claude_Docs | 300 |
| mcp__stitch__apply_design_system | stitch | 726 |
| mcp__stitch__create_design_system | stitch | 5.9k |
| mcp__stitch__create_design_system_from_design_md | stitch | 749 |
| mcp__stitch__create_project | stitch | 137 |
| mcp__stitch__delete_project | stitch | 236 |
| mcp__stitch__download_file | stitch | 480 |
| mcp__stitch__edit_screens | stitch | 690 |
| mcp__stitch__generate_screen_from_text | stitch | 1k |
| mcp__stitch__generate_variants | stitch | 1.3k |
| mcp__stitch__get_project | stitch | 190 |
| mcp__stitch__get_screen | stitch | 209 |
| mcp__stitch__list_design_systems | stitch | 176 |
| mcp__stitch__list_projects | stitch | 631 |
| mcp__stitch__list_screens | stitch | 178 |
| mcp__stitch__update_design_system | stitch | 5.9k |
| mcp__stitch__update_project | stitch | 1.7k |
| mcp__stitch__update_screen | stitch | 378 |
| mcp__stitch__upload_design_md | stitch | 403 |

### Custom Agents

| Agent Type | Source | Tokens |
|------------|--------|--------|
| code-simplifier:code-simplifier | Plugin | 73 |
| superpowers:code-reviewer | Plugin | 350 |

### Memory Files

| Type | Path | Tokens |
|------|------|--------|
| User | C:\Users\me\.claude\CLAUDE.md | 275 |
| AutoMem | C:\Users\me\.claude\projects\D--work-arcterm\memory\MEMORY.md | 923 |
| Project | D:\work\arcterm\AGENTS.md | 14.8k |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| graphify | User | ~80 |
| paper | User | ~160 |
| re-evaluate | User | ~30 |
| re-evaluate-crypto | User | ~30 |
| re-evaluate-vn | User | ~30 |
| review-plan | User | ~60 |
| arc:brainstorm | Plugin (arc) | ~110 |
| arc:cockpit | Plugin (arc) | ~80 |
| arc:council | Plugin (arc) | ~140 |
| arc:design | Plugin (arc) | ~130 |
| arc:detach | Plugin (arc) | ~70 |
| arc:doc-review | Plugin (arc) | ~60 |
| arc:initiatives | Plugin (arc) | ~60 |
| arc:learn | Plugin (arc) | ~70 |
| arc:notes | Plugin (arc) | ~50 |
| arc:runs | Plugin (arc) | ~130 |
| arc:visual | Plugin (arc) | ~90 |
| superpowers:brainstorming | Plugin (superpowers) | ~80 |
| superpowers:dispatching-parallel-agents | Plugin (superpowers) | ~50 |
| superpowers:executing-plans | Plugin (superpowers) | ~50 |
| superpowers:finishing-a-development-branch | Plugin (superpowers) | ~80 |
| superpowers:receiving-code-review | Plugin (superpowers) | ~90 |
| superpowers:requesting-code-review | Plugin (superpowers) | ~50 |
| superpowers:subagent-driven-development | Plugin (superpowers) | ~40 |
| superpowers:systematic-debugging | Plugin (superpowers) | ~40 |
| superpowers:test-driven-development | Plugin (superpowers) | ~40 |
| superpowers:using-git-worktrees | Plugin (superpowers) | ~80 |
| superpowers:using-superpowers | Plugin (superpowers) | ~60 |
| superpowers:verification-before-completion | Plugin (superpowers) | ~90 |
| superpowers:writing-plans | Plugin (superpowers) | ~40 |
| superpowers:writing-skills | Plugin (superpowers) | ~40 |
| dataviz | Built-in | ~480 |
| update-config | Built-in | ~240 |
| keybindings-help | Built-in | ~80 |
| code-review | Built-in | ~280 |
| simplify | Built-in | ~60 |
| fewer-permission-prompts | Built-in | ~60 |
| loop | Built-in | ~120 |
| schedule | Built-in | ~130 |
| claude-api | Built-in | ~390 |
| workflow-authoring | Built-in | ~80 |
| run | Built-in | ~120 |
| plugin-authoring | Built-in | ~90 |
| init | Built-in | ~20 |
| security-review | Built-in | ~30 |
| docs | claude.ai sync | ~340 |
| docx | claude.ai sync | ~320 |
| google-workspace | claude.ai sync | ~330 |
| import-memory | claude.ai sync | ~60 |
| morning | claude.ai sync | ~120 |
| pdf | claude.ai sync | ~150 |
| pptx | claude.ai sync | ~330 |
| skill-creator | claude.ai sync | ~120 |
| xlsx | claude.ai sync | ~320 |

