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
# Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma3:4b          # agent IA général
ollama pull qwen2.5-coder:7b   # coding agent
```

---

## Architecture

```
[Source A] ──► [redclaw-skill: domotique] ──┐
[Source B] ──► [redclaw-skill: météo]     ──┼──► [agent-orchestrator]
[Source C] ──► [redclaw-skill: coding]    ──┘         │
                                               Output 1 ──► [security-gate]
                                                                  │
                                                           [mcp-router]
                                              ├─► [mcp-adapter: turn_on]  ──► [node-tuya] ──► [mcp-adapter]
                                              ├─► [mcp-adapter: turn_off] ──► [node-tuya] ──► [mcp-adapter]
                                              └─► ⚡ ──────────────────────────────────────► [orchestrator]
                                               Output 2 ──► [réponse utilisateur]
```

---

## Les 14 nœuds

### Catégorie : RedClaw

| Nœud | Rôle |
|------|------|
| `llm-config` | Config LLM — Ollama, OpenAI, Anthropic, LM Studio, LocalAI, Jan, REST |
| `redclaw-skill` | 1 entrée / 1 sortie — définit un skill, injecte `msg.redclaw.skill` |
| `agent-orchestrator` | Boucle agentique LLM + mémoire de conversation persistante |
| `mcp-router` | Route les tool calls vers les adapters (N sorties + ⚡ retour) |
| `mcp-adapter` | Adapte n'importe quel nœud Node-RED pour le MCP Router |
| `security-gate` | Valide chaque tool call avant exécution |

### Catégorie : RedClaw Coding

| Nœud | Rôle |
|------|------|
| `rc-coding-skill` | Skill coding avec contexte projet (REDCLAW.md) |
| `rc-tool-bash` | Exécute des commandes shell |
| `rc-tool-read-file` | Lit un fichier (avec sélection de plage de lignes) |
| `rc-tool-write-file` | Crée ou remplace un fichier |
| `rc-tool-edit-file` | Remplacement ciblé dans un fichier (str_replace) |
| `rc-tool-search` | Recherche par contenu (grep) ou par nom (find) |
| `rc-tool-git` | Opérations git : status, diff, add, commit, push, pull… |
| `rc-tool-list-dir` | Liste un dossier avec métadonnées |

---

## LLM supportés

| Backend | URL défaut | Notes |
|---------|-----------|-------|
| **Ollama** | `http://localhost:11434` | Gemma, Mistral, LLaMA, Qwen… · recommandé |
| **LM Studio** | `http://localhost:1234` | OpenAI-compatible |
| **LocalAI** | `http://localhost:8080` | OpenAI-compatible |
| **Jan** | `http://localhost:1337` | OpenAI-compatible |
| **OpenAI** | `https://api.openai.com` | GPT-4o, GPT-4o-mini |
| **Anthropic** | `https://api.anthropic.com` | Claude |
| **Mistral AI** | `https://api.mistral.ai` | |
| **REST custom** | configurable | Tout serveur OpenAI-compatible |

> Timeout par défaut : **60 secondes** (adapté aux modèles locaux sur CPU).

---

## Nœud redclaw-skill

1 nœud = 1 skill. Pour plusieurs skills, placer plusieurs nœuds en parallèle.

```
[MQTT]  ──► [skill: domotique] ──┐
[HTTP]  ──► [skill: météo]     ──┼──► [agent-orchestrator]
[inject]──► [skill: database]  ──┘
```

**Config d'un skill :**
- **Nom du skill** — identifiant stable (utilisé comme nom du fichier mémoire)
- **Contexte** — description, règles, exemples pour le LLM
- **Tools** — noms des tools séparés par des virgules (doivent correspondre au MCP Router)
- **Serveur MCP** — URL optionnelle pour les tools MCP externes

---

## Nœud mcp-router

**2 types de sorties :**
- **Sortie 1..N** — une par tool configuré, envoie `msg.routeur = { tool, params, callId }`
- **Sortie ⚡** — retour vers l'orchestrateur (toujours la dernière sortie)

```
[mcp-router]
  ├─ 1 ──► [mcp-adapter: turn_on]    ──Output2──► [mcp-router] entrée
  ├─ 2 ──► [mcp-adapter: turn_off]   ──Output2──► [mcp-router] entrée
  └─ ⚡ ──────────────────────────────────────────► [orchestrateur] entrée
```

> Les sorties sont persistées au redémarrage de Node-RED.

---

## Nœud mcp-adapter

Adapte n'importe quel nœud Node-RED pour fonctionner avec le MCP Router.

### Câblage

```
[mcp-router sortie N] ──► [mcp-adapter] ──Output1──► [nœud Node-RED]
                                                           ↓ retour
                              entrée ◄───────────────────┘
[mcp-adapter] ──Output2──► [mcp-router] entrée
```

### Transformation entrée

Reçoit `msg.payload = params LLM`. Transformer pour le nœud Node-RED cible.
`msg.routeur.params` et `msg.routeur.tool` sont également accessibles.

```js
// Exemple Tuya prise
if (msg.routeur.params.state === "ON") {
  msg.payload = { dps: 1, set: true };
} else {
  msg.payload = { dps: 1, set: false };
}
return msg;
```

### Transformation sortie

`msg.payload` = résultat brut du nœud Node-RED.
**La variable `adaptateur` est pré-initialisée** — y mettre le résultat directement.
Le `callId` est injecté automatiquement.

```js
// Exemple Tuya prise
adaptateur.success = true;
adaptateur.state   = msg.payload?.data?.dps?.["1"] ? "ON" : "OFF";

// Exemple Tuya ampoule
const dps = msg.payload?.data?.dps || {};
adaptateur.success    = true;
adaptateur.state      = dps["1"] ? "ON" : "OFF";
adaptateur.brightness = dps["2"] ? Math.round(dps["2"] / 10) : undefined;

// Exemple HTTP
adaptateur.success = msg.statusCode >= 200 && msg.statusCode < 300;
adaptateur.data    = msg.payload;

// Exemple MQTT
adaptateur.success   = true;
adaptateur.published = true;
```

> Pas de `return` nécessaire. Ne pas remplacer `adaptateur` entièrement — y ajouter des propriétés.

### Mode simple (checkbox)

Pour les nœuds qui acceptent les params LLM tels quels — pas de code nécessaire.

---

## Mémoire de conversation

1 fichier JSON par skill dans `~/.node-red/redclaw-memory/` :

```
~/.node-red/redclaw-memory/
  domotique-lumiere.json
  meteo.json
  coding.json
```

- Rechargé automatiquement au démarrage de Node-RED
- Réécrit à chaque échange (pas d'accumulation de fichiers)
- Sliding window configurable dans l'orchestrateur (`maxHistory`)
- TTL configurable (sessions expirées purgées automatiquement)

**SessionId personnalisé** — pour un historique par utilisateur :
```js
// Dans un nœud change avant redclaw-skill :
msg.sessionId = "domotique-" + msg.userId;
```

---

## Security Gate

```
[orchestrateur] Output1 ──► [security-gate] ──► [mcp-router]
                                  ├─ Output2 ──► confirmation humaine
                                  └─ Output3 ──► log / alerte
```

**Fonctionnalités :**
- Blocage de tools par nom ou pattern (`delete*`, `exec*`…)
- Rate limiting par session et par tool
- Confirmation humaine avant exécution (avec timeout configurable)
- Détection automatique : path traversal, injection shell, SQL injection, `rm -rf`…

**Exemple de règles JSON :**
```json
[
  { "tool": "delete*",  "action": "deny",    "reason": "Suppression interdite" },
  { "tool": "*write*",  "action": "confirm", "reason": "Écriture nécessite confirmation" },
  { "tool": "*",        "action": "allow",   "rateLimit": { "maxCalls": 10, "windowMs": 60000 } }
]
```

---

## Coding Agent (équivalent Claude Code local)

```
[inject "Crée un serveur Express"] ──► [rc-coding-skill] ──► [agent-orchestrator]
                                                                      │
                                                         [security-gate] ──► [mcp-router]
                                             ├─► [rc-tool-bash]       ──► retour
                                             ├─► [rc-tool-read-file]  ──► retour
                                             ├─► [rc-tool-write-file] ──► retour
                                             ├─► [rc-tool-edit-file]  ──► retour
                                             ├─► [rc-tool-search]     ──► retour
                                             └─► [rc-tool-git]        ──► retour
```

**Fichier contexte projet — `REDCLAW.md`** (placé à la racine du projet) :
```markdown
# Mon Projet
## Structure
src/ — code source | tests/ — tests | docs/ — documentation
## Commandes
npm test — lance les tests | npm run build — build production
## Conventions
2 espaces · camelCase · toujours tester après modification
```

**Modèle recommandé :**
```bash
ollama pull qwen2.5-coder:7b
```

---

## Logs debug

Les nœuds `mcp-router`, `mcp-adapter` et `agent-orchestrator` ont un mode debug activable dans leur config. Les logs apparaissent dans le panneau debug de Node-RED.

**MCP Router :**
```
[MCP Router] → tool "turn_on" callId:abc params:{"state":"ON"}
[MCP Router] ✓ "turn_on" résultat:{"success":true,"state":"ON"}
```

**MCP Adapter :**
```
[mcp-adapter:turn_on] entrée ← params:{"state":"ON"} callId:abc
[mcp-adapter:turn_on] sortie → adaptateur:{"success":true,"state":"ON","callId":"abc"}
```

---

## Contribuer

```bash
git clone https://github.com/RedClaw-Project/node-red-contrib-redclaw
cd node-red-contrib-redclaw
npm install

# Test local
cd ~/.node-red
npm install /chemin/vers/node-red-contrib-redclaw

# Publier sur npm
npm login
npm publish --access public
```

---

## Licence

MIT © RedClaw Project
