/**
 * RedClaw - Agent Orchestrator
 *
 * Deux modes LLM :
 *   INTERNE  : utilise llm-config (Ollama, OpenAI, Anthropic, REST…)
 *   EXTERNE  : envoie le prompt sur Output 3 vers n'importe quel nœud LLM Node-RED
 *              (node-red-contrib-llama-cpp, etc.) et attend la réponse sur Input
 *
 * ─── Entrées ─────────────────────────────────────────────────────────────────
 *  msg.redclaw.userMessage + msg.redclaw.skill  → nouvelle demande
 *  msg.redclaw_call_id (tool)                   → retour MCP Router
 *  msg.redclaw_llm_id  (LLM)                    → retour nœud LLM externe
 *
 * ─── Sorties ─────────────────────────────────────────────────────────────────
 *  Output 1 : tool call      → Security Gate / MCP Router
 *  Output 2 : réponse finale → utilisateur
 *  Output 3 : prompt LLM     → nœud LLM externe (mode externe uniquement)
 */

const { randomUUID }     = require("crypto");
const ConversationMemory = require("../lib/conversation-memory");
const LlmClient          = require("../lib/llm-client");
const path               = require("path");
const os                 = require("os");

module.exports = function (RED) {
  function AgentOrchestratorNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.llmMode     = config.llmMode     || "internal"; // "internal" | "external"
    node.maxSteps    = parseInt(config.maxSteps,   10) || 5;
    node.maxHistory  = parseInt(config.maxHistory, 10) || 6;
    node.memoryEnabled = config.memoryEnabled !== false;
    node.debugMode   = config.debugMode   === true;
    node.ttlHours    = parseInt(config.ttlHours, 10) || 24;

    // ── LLM interne ──────────────────────────────────────────────────────────
    let llm = null;
    if (node.llmMode === "internal") {
      const llmConfig = RED.nodes.getNode(config.llmConfig);
      if (!llmConfig) {
        node.error("Mode interne : configuration LLM manquante.");
        node.status({ fill:"red", shape:"ring", text:"Config LLM manquante" });
        return;
      }
      llm = llmConfig.client;
    }

    // ── Mémoire ───────────────────────────────────────────────────────────────
    const memDir = config.memoryDir?.trim()
      || path.join(RED.settings.userDir || os.homedir() + "/.node-red", "redclaw-memory");
    node.memory = new ConversationMemory(memDir, {
      maxMessages: node.maxHistory * 4,
      ttlHours:    node.ttlHours,
    });
    const purged = node.memory.purgeExpired();
    if (purged) node.log(`[RedClaw] ${purged} session(s) purgée(s)`);

    // ── Sessions en attente ───────────────────────────────────────────────────
    // tool calls  : callId → { resolve, reject, timer }
    node._toolSessions = new Map();
    // LLM externe : llmId  → { resolve, reject, timer }
    node._llmSessions  = new Map();

    node.status({
      fill:"green", shape:"dot",
      text: node.llmMode === "external"
        ? `Mode externe · ${node.memory.list().length} session(s)`
        : `${llm ? "LLM OK" : "?"} · ${node.memory.list().length} session(s)`,
    });

    // ─── ENTRÉE ───────────────────────────────────────────────────────────────
    node.on("input", async function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (e) { if (e) node.error(e, msg); };

      // ── Retour LLM externe ────────────────────────────────────────────────
      if (msg.redclaw_llm_id) {
        const s = node._llmSessions.get(msg.redclaw_llm_id);
        if (s) {
          clearTimeout(s.timer);
          node._llmSessions.delete(msg.redclaw_llm_id);
          // llama-cpp retourne msg.payload = string
          const text = typeof msg.payload === "string"
            ? msg.payload
            : (msg.payload?.content || msg.payload?.message || JSON.stringify(msg.payload));
          s.resolve(text.trim());
        }
        done(); return;
      }

      // ── Retour tool MCP Router ────────────────────────────────────────────
      if (msg.redclaw_call_id) {
        const s = node._toolSessions.get(msg.redclaw_call_id);
        if (s) {
          clearTimeout(s.timer);
          node._toolSessions.delete(msg.redclaw_call_id);
          msg.redclaw_error ? s.reject(new Error(msg.redclaw_error)) : s.resolve(msg.payload);
        }
        done(); return;
      }

      // ── Commandes de contrôle ─────────────────────────────────────────────
      if (msg.redclaw_cmd) { _handleCmd(msg, send); done(); return; }

      // ── Nouvelle demande ──────────────────────────────────────────────────
      const rc = msg.redclaw;
      if (!rc?.userMessage || !rc?.skill) {
        node.warn("[RedClaw] msg.redclaw.userMessage ou msg.redclaw.skill manquant");
        done(); return;
      }

      const { userMessage, skill } = rc;
      const sessionId = msg.sessionId || `${skill.name}-${Date.now().toString(36)}`;

      node.status({ fill:"blue", shape:"dot", text:`[${skill.name}] En cours…` });
      if (node.memoryEnabled) node.memory.addMessage(sessionId, "user", userMessage);

      try {
        const response = await _agentLoop(userMessage, skill, sessionId, msg, send);
        if (node.memoryEnabled) node.memory.addMessage(sessionId, "assistant", response);
        node.status({ fill:"green", shape:"dot", text:`[${skill.name}] ✓` });

        send([null, { ...msg, payload:response, sessionId,
          redclaw:{ userMessage, skill, finalResponse:response, sessionId, success:true }
        }, null]);
      } catch (e) {
        node.status({ fill:"red", shape:"ring", text:e.message.slice(0,40) });
        node.error(`[RedClaw] ${e.message}`, msg);
        send([null, null, { ...msg, payload:e.message, sessionId,
          redclaw:{ userMessage, skill, error:e.message, sessionId, success:false }
        }]);
      }
      done();
    });

    // ─── BOUCLE AGENTIQUE ─────────────────────────────────────────────────────
    async function _agentLoop(userMessage, skill, sessionId, origMsg, send) {
      const historyCtx   = node.memoryEnabled ? node.memory.getSummary(sessionId, node.maxHistory) : "";
      const systemPrompt = _buildSystem(skill, historyCtx);
      const loopHistory  = [{ role:"user", content:userMessage }];
      let steps = 0;

      while (steps < node.maxSteps) {
        steps++;
        if (node.debugMode) node.warn(`[RedClaw] Étape ${steps}/${node.maxSteps}`);

        const raw      = await _callLlm(systemPrompt, _buildPrompt(loopHistory), origMsg, send);

        // Log réponse brute — toujours en cas de réponse vide
        if (!raw || !raw.trim()) {
          node.warn("[RedClaw] Réponse LLM vide — vérifier URL/format dans llm-config");
        }
        if (node.debugMode) {
          node.warn(`[RedClaw] LLM → (${raw.length} chars) ${raw.slice(0, 400)}`);
        }

        const decision = _parse(raw);
        if (!decision || decision.action === "respond") return (decision?.message || raw).trim();

        if (decision.action === "tool") {
          const { tool, params } = decision;
          loopHistory.push({ role:"tool_call", content:`"${tool}" params:${JSON.stringify(params||{})}` });
          if (node.memoryEnabled) node.memory.addMessage(sessionId, "tool_call", `"${tool}" params:${JSON.stringify(params||{})}`);

          node.status({ fill:"blue", shape:"dot", text:`→ ${tool} (${steps})` });
          const result    = await _callTool(tool, params, skill.mcpServer, origMsg, send);
          const resultStr = typeof result === "string" ? result : JSON.stringify(result);

          loopHistory.push({ role:"tool_result", content:`"${tool}": ${resultStr}` });
          if (node.memoryEnabled) node.memory.addMessage(sessionId, "tool_result", `"${tool}": ${resultStr}`);
          continue;
        }
        return raw.trim();
      }

      // Max étapes → synthèse
      const synth = await _callLlm(systemPrompt,
        _buildPrompt([...loopHistory, { role:"user", content:"Résume en une phrase." }]),
        origMsg, send);
      return synth.trim();
    }

    // ─── APPEL LLM ────────────────────────────────────────────────────────────
    async function _callLlm(systemPrompt, userPrompt, origMsg, send) {
      // Mode interne : appel direct via llm-client
      if (node.llmMode === "internal") {
        return await llm.chat(systemPrompt, userPrompt, { temperature:0.1, maxTokens:400 });
      }

      // Mode externe : envoie sur Output 3, attend la réponse sur Input
      return new Promise((resolve, reject) => {
        const llmId = randomUUID();
        const timer = setTimeout(() => {
          node._llmSessions.delete(llmId);
          reject(new Error(`Timeout LLM externe (${node.maxSteps * 15000}ms)`));
        }, node.maxSteps * 15000);

        node._llmSessions.set(llmId, { resolve, reject, timer });

        // Construit le msg pour llama-cpp (mode chat)
        // msg.payload = messages[] OU string selon la config du nœud llama-cpp
        const messages = [
          { role:"system", content:systemPrompt },
          { role:"user",   content:userPrompt   },
        ];

        // Output 3 : vers le nœud LLM externe
        send([null, null, {
          ...origMsg,
          payload:        messages,       // format chat (llama-cpp mode chat)
          redclaw_llm_id: llmId,
          topic:          "llm_request",  // optionnel, pour identifier dans un switch
        }]);
      });
    }

    // ─── APPEL TOOL ───────────────────────────────────────────────────────────
    function _callTool(tool, params, mcpServer, origMsg, send) {
      return new Promise((resolve, reject) => {
        const callId = randomUUID();
        const timer  = setTimeout(() => {
          node._toolSessions.delete(callId);
          reject(new Error(`Timeout tool "${tool}"`));
        }, node.maxSteps * 20000);

        node._toolSessions.set(callId, { resolve, reject, timer });

        send([{ ...origMsg,
          payload:         params || {},
          redclaw:         { ...origMsg.redclaw, tool, params:params||{}, mcpServer },
          redclaw_call_id: callId,
        }, null, null]);
      });
    }

    // ─── PROMPTS ──────────────────────────────────────────────────────────────
    function _buildSystem(skill, historyCtx) {
      const tools = skill.tools
        ? skill.tools.split(",").map(t => t.trim()).filter(Boolean)
        : [];
      return [
        "Tu es un agent IA. Réponds UNIQUEMENT en JSON valide, sans texte autour.",
        "",
        "Pour appeler un tool :",
        `{"action":"tool","tool":"nom_tool","params":{}}`,
        "",
        "Pour répondre à l'utilisateur :",
        `{"action":"respond","message":"ta réponse"}`,
        "",
        `Skill : ${skill.name}`,
        skill.context      ? `Contexte : ${skill.context}`     : "",
        skill.systemContext? skill.systemContext                : "",
        tools.length       ? `Tools : ${tools.join(", ")}`     : "",
        historyCtx         ? `\n${historyCtx}`                 : "",
      ].filter(Boolean).join("\n");
    }

    function _buildPrompt(history) {
      return history.map(h => {
        switch (h.role) {
          case "user":        return `Demande: ${h.content}`;
          case "tool_call":   return `[Action: ${h.content}]`;
          case "tool_result": return `[Résultat: ${h.content}]`;
          default:            return h.content;
        }
      }).join("\n");
    }

    function _parse(text) {
      try { const d = JSON.parse(text.trim()); if (d.action) return d; } catch (_) {}
      const m = text.match(/\{[\s\S]*?\}/);
      if (m) { try { const d = JSON.parse(m[0]); if (d.action) return d; } catch (_) {} }
      return null;
    }

    // ─── COMMANDES ────────────────────────────────────────────────────────────
    function _handleCmd(msg, send) {
      switch (msg.redclaw_cmd) {
        case "memory_list":   send([null, { ...msg, payload:node.memory.list()                               }, null]); break;
        case "memory_get":    send([null, { ...msg, payload:node.memory.getHistoryForLlm(msg.sessionId, 100) }, null]); break;
        case "memory_clear":  node.memory.clear(msg.sessionId);  send([null, { ...msg, payload:{ cleared:msg.sessionId }}, null]); break;
        case "memory_delete": node.memory.delete(msg.sessionId); send([null, { ...msg, payload:{ deleted:msg.sessionId }}, null]); break;
        case "memory_purge":  const n = node.memory.purgeExpired(); send([null, { ...msg, payload:{ purged:n }}, null]); break;
      }
    }

    node.on("close", function () {
      for (const [,s] of node._toolSessions) { clearTimeout(s.timer); s.reject(new Error("Nœud fermé")); }
      for (const [,s] of node._llmSessions)  { clearTimeout(s.timer); s.reject(new Error("Nœud fermé")); }
      if (node.memory?.destroy) node.memory.destroy();
      node._toolSessions.clear();
      node._llmSessions.clear();
      node.status({});
    });
  }

  RED.httpAdmin.get("/redclaw/sessions", RED.auth.needsPermission("flows.read"), (req, res) => {
    let mem = null;
    RED.nodes.eachNode(n => {
      if (n.type === "agent-orchestrator" && !mem) {
        const inst = RED.nodes.getNode(n.id);
        if (inst?.memory) mem = inst.memory;
      }
    });
    res.json({ sessions: mem ? mem.list() : [] });
  });

  RED.nodes.registerType("agent-orchestrator", AgentOrchestratorNode);
};
