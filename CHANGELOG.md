# Changelog — node-red-contrib-redclaw

## [1.0.0] — 2025

### Architecture
- Pipeline complet : `redclaw-skill` → `agent-orchestrator` → `mcp-router` → `mcp-adapter` → nœud Node-RED
- Protocole `msg.routeur` / `msg.adaptateur` avec `callId` pour corrélation requête/réponse
- Mémoire de conversation persistante par skill (1 fichier JSON par skill)
- Boucle agentique multi-étapes (LLM ↔ tools)

### Nœuds
- `llm-config` — multi-backend : Ollama, OpenAI, Anthropic, LM Studio, LocalAI, Jan, REST
- `redclaw-skill` — 1 nœud = 1 skill, sessionId stable = nom du skill
- `agent-orchestrator` — boucle agentique + mémoire + debug mode
- `mcp-router` — N sorties par tool + ⚡ retour orchestrateur
- `mcp-adapter` — mode simple (checkbox) + transformations JS + debug mode
- `security-gate` — blocage/confirmation/rate-limit + détection patterns dangereux
- `rc-coding-skill` + 7 outils coding : bash, read/write/edit file, search, git, list-dir

### Fixes notables
- Filtre messages périodiques dans `mcp-adapter` (nœuds qui envoient des updates automatiques)
- `callId` injecté dans `msg.adaptateur` et vérifié par le routeur
- Timeout LLM : message d'erreur clair au lieu de "The user aborted a request"
- Timeout par défaut 60s pour les modèles locaux
- `memory.destroy()` appelé au close de l'orchestrateur
- `msg.routeur` conservé pendant `inputTransform` puis nettoyé
