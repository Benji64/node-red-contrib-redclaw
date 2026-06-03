/**
 * RedClaw — MCP Adapter (v4)
 *
 * inputTransform  : msg.payload = params LLM, msg.routeur accessible,
 *                   msg.adaptateur pré-initialisé avec callId
 *                   Mode simple (checkbox) si pas de code
 *
 * outputTransform : msg.payload = résultat nœud Node-RED
 *                   Doit définir msg.adaptateur = { ... }
 *                   callId injecté automatiquement dans msg.adaptateur
 *
 * MCP Router vérifie msg.adaptateur.callId avant de continuer
 */

module.exports = function (RED) {
  function McpAdapterNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.toolName    = (config.toolName    || "").trim();
    node.timeout     = parseInt(config.timeout, 10) || 15000;
    node.simpleMode  = config.simpleMode  === true;
    node.debugMode   = config.debugMode   === true; // checkbox mode simple entrée

    node._inputFn  = _compile(config.inputTransform,  "inputTransform",  node);
    node._outputFn = _compile(config.outputTransform, "outputTransform", node);

    node.status({
      fill:  node.toolName ? "green" : "yellow",
      shape: "dot",
      text:  node.toolName || "toolName manquant",
    });

    node.on("input", function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (e) { if (e) node.error(e, msg); };

      // ── CAS 1 : retour du nœud Node-RED (pas de msg.routeur) ─────────────
      if (!msg.routeur) {
        const callId = msg.redclaw_call_id;

        // Ignore les messages sans callId (mises à jour périodiques, status spontanés…)
        if (!callId) {
          if (node.debugMode) node.warn(`[mcp-adapter:${node.toolName}] message ignoré — pas de redclaw_call_id (mise à jour spontanée ?)`);
          done();
          return;
        }

        let outMsg = { ...msg };

        // Applique outputTransform
        if (node._outputFn) {
          outMsg = node._outputFn(outMsg) || outMsg;
        }

        // Vérifie que msg.adaptateur a été défini
        if (outMsg.adaptateur === undefined) {
          node.warn(`[mcp-adapter:${node.toolName}] msg.adaptateur non défini dans outputTransform — utilise le payload brut`);
          outMsg.adaptateur = { success: true, result: msg.payload };
        }

        // Injecte callId dans msg.adaptateur pour vérification par le Router
        outMsg.adaptateur.callId = callId;

        if (node.debugMode) node.warn(`[mcp-adapter:${node.toolName}] sortie → adaptateur:${JSON.stringify(outMsg.adaptateur)}`);

        node.status({ fill: "green", shape: "dot", text: `✓ ${node.toolName}` });

        // Output 2 → MCP Router
        send([null, outMsg]);
        done();
        return;
      }

      // ── CAS 2 : appel depuis le MCP Router ───────────────────────────────
      const { tool, params, callId } = msg.routeur;
      node.status({ fill: "blue", shape: "dot", text: `→ ${tool}` });
      if (node.debugMode) node.warn(`[mcp-adapter:${node.toolName}] entrée ← params:${JSON.stringify(params)} callId:${callId}`);

      // Pré-initialise msg.adaptateur avec callId — lisible dans inputTransform
      let outMsg = {
        ...msg,
        payload:         params || {},
        redclaw_call_id: callId,
        // msg.routeur conservé → accessible dans inputTransform
        // msg.adaptateur pré-initialisé → lisible dans inputTransform
        adaptateur: { callId },
      };

      if (node._inputFn) {
        // Mode code : inputTransform défini par l'utilisateur
        outMsg = node._inputFn(outMsg) || outMsg;
      } else if (node.simpleMode) {
        // Mode simple (checkbox) : msg.payload passé tel quel
        // Rien à faire — msg.payload est déjà = params
      }

      // Nettoie routeur après le transform
      outMsg.routeur = undefined;

      // Output 1 → nœud Node-RED
      send([outMsg, null]);
      done();
    });

    node.on("close", () => node.status({}));
  }

  function _compile(code, label, node) {
    if (!code || !code.trim()) return null;
    try {
      return new Function("msg", "node", `
        try { ${code} }
        catch(e) { node.error('[mcp-adapter] ${label}: ' + e.message); return msg; }
      `);
    } catch (e) {
      node.error(`[mcp-adapter] Compilation ${label} : ${e.message}`);
      return null;
    }
  }

  RED.nodes.registerType("mcp-adapter", McpAdapterNode);
};
