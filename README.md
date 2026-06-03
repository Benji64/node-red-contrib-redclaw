# node-red-contrib-redclaw

> Plateforme d'agents IA pour Node-RED.
> Skills, orchestrateur LLM, MCP Router/Adapter, mémoire, sécurité, coding agent.

[![npm version](https://badge.fury.io/js/node-red-contrib-redclaw.svg)](https://www.npmjs.com/package/node-red-contrib-redclaw)
[![Node-RED](https://img.shields.io/badge/Node--RED-%E2%89%A53.0.0-red)](https://nodered.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-redclaw
# Redémarre Node-RED
```

**Prérequis LLM local :**
```bash
# Ollama + modèle (recommandé)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma3:4b

# Pour le coding agent
ollama pull qwen2.5-coder:7b
```

---

## Architecture

```
[Source A] ──► [redclaw-skill: domotique] ──┐
[Source B] ──► [redclaw-skill: météo]     ──┼──► [agent-orchestrator]
                                              │         │
                                   Output 1 ──┼──► [security-gate] ──► [mcp-router]
                                              │         ↑                    │
                                   entrée ◄───┘─────────┴────────────────────┘
                                              │
                                   Output 2 ──┴──► [réponse utilisateur]
```

---

## Les 14 nœuds

### Catégorie : RedClaw

| Nœud | Rôle |
|------|------|
| `llm-config` | Config LLM partagée — Ollama, OpenAI, Anthropic, LM Studio, REST |
| `redclaw-skill` | 1 entrée / 1 sortie — définit un skill, injecte msg.redclaw.skill |
| `agent-orchestrator` | Boucle agentique LLM + mémoire de conversation |
| `mcp-router` | Route les tool calls vers les adapters (N sorties + ⚡ retour) |
| `mcp-adapter` | Adapte n'importe quel nœud Node-RED pour le MCP Router |
| `security-gate` | Valide chaque tool call avant exécution |

### Catégorie : RedClaw Coding

| Nœud | Rôle |
|------|------|
| `rc-coding-skill` | Skill spécialisé coding avec contexte projet (REDCLAW.md) |
| `rc-tool-bash` | Exécute des commandes shell |
| `rc-tool-read-file` | Lit un fichier (avec sélection de plage) |
| `rc-tool-write-file` | Crée ou remplace un fichier |
| `rc-tool-edit-file` | str_replace ciblé dans un fichier |
| `rc-tool-search` | Grep par contenu ou find par nom |
| `rc-tool-git` | Opérations git (status, diff, commit…) |
| `rc-tool-list-dir` | Liste un dossier avec métadonnées |

---

## LLM supportés

| Backend | URL défaut | Notes |
|---------|-----------|-------|
| **Ollama** | `http://localhost:11434` | Gemma, Mistral, LLaMA, Qwen… |
| **LM Studio** | `http://localhost:1234` | Interface OpenAI-compatible |
| **LocalAI** | `http://localhost:8080` | |
| **Jan** | `http://localhost:1337` | |
| **OpenAI** | `https://api.openai.com` | GPT-4o, GPT-4o-mini |
| **Anthropic** | `https://api.anthropic.com` | Claude |
| **Mistral AI** | `https://api.mistral.ai` | |
| **REST custom** | configurable | Tout serveur OpenAI-compatible |

---

## Flow complet

### Agent domotique

```
[MQTT "voice/cmd"] ──► [redclaw-skill: domotique]
                              ↓ msg.redclaw.skill
                       [agent-orchestrator]
                       LLM: choisit tool + params
                              ↓ Output 1
                       [security-gate]
                              ↓
                       [mcp-router]
                    ├─► [mcp-adapter: turn_on]  ──► [node-tuya] ──► [mcp-adapter]
                    ├─► [mcp-adapter: turn_off] ──► [node-tuya] ──► [mcp-adapter]
                    └─► ⚡ ──────────────────────────────────────► [orchestrateur]
                              ↓ Output 2
                       [réponse: "Lumière allumée ✓"]
```

### mcp-adapter — protocole

```js
// Transformation entrée
// msg.routeur.params = params du LLM
// msg.adaptateur.callId = injecté automatiquement (ne pas modifier)
if (msg.routeur.params.state === "ON") {
  msg.payload = { dps: 1, set: true };
} else {
  msg.payload = { dps: 1, set: false };
}
return msg;

// Transformation sortie
// msg.adaptateur est pré-initialisé avec { callId }
// Ajouter des propriétés sans écraser l'objet
msg.adaptateur.success = true;
msg.adaptateur.state   = msg.payload?.data?.dps?.["1"] ? "ON" : "OFF";
return msg;
```

---

## Mémoire de conversation

Un fichier JSON par skill dans `~/.node-red/redclaw-memory/` :

```
domotique-lumiere.json   ← historique du skill domotique
meteo.json               ← historique météo
coding.json              ← historique coding agent
```

Rechargé automatiquement au démarrage. Sliding window configurable.

---

## Fichier contexte projet (coding)

Placez `REDCLAW.md` à la racine du projet :

```markdown
# Mon Projet
## Structure
src/ — code source | tests/ — tests
## Commandes
npm test — lance les tests | npm run build — build prod
## Conventions
2 espaces · camelCase · tester après chaque modification
```

---

## Sécurité

Le `security-gate` supporte :
- **Blocage** de tools dangereux par pattern ou nom
- **Rate limiting** par session et par tool
- **Confirmation humaine** avant exécution (avec timeout)
- **Détection automatique** : path traversal, injection shell, SQL injection, rm -rf…

---

## Contribuer

```bash
git clone https://github.com/RedClaw-Project/node-red-contrib-redclaw
cd node-red-contrib-redclaw
npm install
# Lien local dans Node-RED pour tester
cd ~/.node-red && npm install /chemin/vers/node-red-contrib-redclaw
```

---

## Licence

MIT © RedClaw Project
