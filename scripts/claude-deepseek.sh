#!/usr/bin/env bash
# Lance Claude Code branché sur DeepSeek (API compatible Anthropic) au lieu de l'abonnement Claude.
# La clé est lue dans .data/settings/secrets.json (jamais affichée). Arguments transmis tels quels à `claude`.
set -euo pipefail
cd "$(dirname "$0")/.."
KEY="$(node -e 'const s=require("./.data/settings/secrets.json");process.stdout.write(s.DEEPSEEK_API_KEY||"")')"
[ -n "$KEY" ] || { echo "Clé DeepSeek absente de .data/settings/secrets.json" >&2; exit 1; }
unset ANTHROPIC_API_KEY
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN="$KEY"
export ANTHROPIC_MODEL="${DS_MODEL:-deepseek-v4-pro}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$ANTHROPIC_MODEL"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$ANTHROPIC_MODEL"
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
exec claude "$@"
