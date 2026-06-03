# ⚡ AIRouter v2

Smart AI routing proxy — works **out of the box with free providers**, no credit card needed.

```
http://localhost:20128/v1   ← your new OPENAI_BASE_URL
```

## Free Providers (no credit card)

| Provider | Free Limit | Sign Up |
|----------|-----------|---------|
| **OpenRouter** | 200 req/day, 35+ models | https://openrouter.ai |
| **Gemini** | 1,500 req/day | https://aistudio.google.com |
| **Groq** | 30 RPM, fastest inference | https://console.groq.com |
| **Cerebras** | 60K tokens/min | https://cloud.cerebras.ai |
| **GitHub Models** | Free for GitHub users | https://github.com/marketplace/models |
| **NVIDIA NIM** | 40 RPM, no daily cap | https://build.nvidia.com |

> Stack them all → ~5,000 free requests/day with auto-fallback.

## Quick Start

```bash
git clone https://github.com/yourusername/airouter.git
cd airouter
npm install
cp .env.example .env
# Add at least one free API key to .env
npm start
```

Open **http://localhost:20128** · password: `admin123`

## Deploy to VPS

```bash
bash install.sh
```

## Connect your tools

| Tool | Setting |
|------|---------|
| Cursor | Settings → Models → OpenAI Base URL |
| Cline | Settings → API → OpenAI Compatible |
| Claude Code | `ANTHROPIC_BASE_URL=http://vps:20128/v1` |
| Aider | `--openai-api-base http://vps:20128/v1` |
| Any OpenAI SDK | `OPENAI_BASE_URL=http://vps:20128/v1` |

## Push to GitHub

```bash
git init && git add . && git commit -m "feat: AIRouter v2"
gh repo create airouter --public --push
```

## Model Prefixes

```
or/deepseek/deepseek-chat-v3-0324:free   → OpenRouter
gm/gemini-2.0-flash                      → Google Gemini
gq/llama-3.3-70b-versatile               → Groq
cb/llama3.1-70b                          → Cerebras
gh/gpt-4o-mini                           → GitHub Models
nv/meta/llama-3.3-70b-instruct           → NVIDIA NIM
cc/claude-sonnet-4-5                     → Anthropic (paid)
ds/deepseek-chat                         → DeepSeek (paid, cheap)
```

Or use `auto` to let AIRouter pick the best available provider.

## License MIT
