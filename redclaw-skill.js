/**
 * RedClaw — Skill Node
 *
 * UN nœud = UN skill. 1 entrée / 1 sortie.
 * Pour plusieurs skills, on place plusieurs nœuds redclaw-skill
 * en parallèle — comme on multiplierait des nœuds function.
 *
 * Chaque nœud enrichit msg avec le contexte du skill
 * et transmet à l'Orchestrateur.
 *
 * ─── Câblage ─────────────────────────────────────────────────────────────────
 *
 *  [source A] ──► [skill: domotique] ──┐
 *  [source B] ──► [skill: météo]     ──┼──► [Orchestrateur]
 *  [source C] ──► [skill: database]  ──┘
 *
 * ─── msg enrichi en sortie ───────────────────────────────────────────────────
 *
 *  msg.redclaw = {
 *    userMessage : msg.payload,
 *    skill       : { name, context, tools, mcpServer }
 *  }
 */

module.exports = function (RED) {
  function RedclawSkillNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.skillName  = (config.skillName  || "").trim();
    node.context    = (config.context    || "").trim();
    node.tools      = (config.tools      || "").trim();
    node.mcpServer  = (config.mcpServer  || "").trim();

    if (!node.skillName) {
      node.warn("[redclaw-skill] Nom du skill manquant");
      node.status({ fill: "yellow", shape: "ring", text: "Nom manquant" });
    } else {
      node.status({
        fill:  "green",
        shape: "dot",
        text:  node.skillName + (node.tools ? ` · ${node.tools.split(",").length} tool(s)` : ""),
      });
    }

    node.on("input", function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (e) { if (e) node.error(e, msg); };

      const userMessage = typeof msg.payload === "string"
        ? msg.payload.trim()
        : JSON.stringify(msg.payload);

      if (!userMessage) { done(); return; }

      msg.redclaw = {
        userMessage,
        skill: {
          name:      node.skillName,
          context:   node.context,
          tools:     node.tools,
          mcpServer: node.mcpServer,
        },
      };

      // sessionId stable = nom du skill → 1 seul fichier JSON par skill
      // réécrit à chaque appel, accumule l'historique dans un seul fichier
      // L'utilisateur peut forcer un sessionId différent (ex: par utilisateur)
      // en passant msg.sessionId avant ce nœud
      if (!msg.sessionId) {
        msg.sessionId = node.skillName;
      }

      node.status({ fill: "green", shape: "dot", text: `✓ → ${node.skillName}` });
      send(msg);
      done();
    });

    node.on("close", () => node.status({}));
  }

  RED.nodes.registerType("redclaw-skill", RedclawSkillNode);
};
