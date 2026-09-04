import Fastify from "fastify";
import { intentHash, parseAmount, toHex } from "@aegis/canonical";
import { IntentRequest } from "./schema.js";

/**
 * Intent Gateway (D2).
 *
 * The only path that turns an agent request into something the contract can
 * evaluate. The executor has NO second input path — it only accepts a
 * `decision_id`.
 *
 * This server's pino log IS the "request and response transcripts for the 20
 * submissions" evidence in §6.1 D2. Do not turn logging off.
 */
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    // every intent that passes through here becomes a transcript for the reviewer
    redact: { paths: [], remove: false },
  },
});

app.post("/v1/intents", async (req, reply) => {
  const parsed = IntentRequest.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_intent", detail: parsed.error.issues });
  }
  const body = parsed.data;

  const intent = {
    agentId: body.agent_id,
    serviceId: body.service_id,
    asset: body.asset,
    amount: parseAmount(body.amount),
    purpose: body.purpose,
    clientRef: body.client_ref,
  };
  const ih = toHex(intentHash(intent));

  req.log.info({ intent_hash: ih, agent_id: body.agent_id }, "intent received");

  // TODO(D2): call authorize(intent_hash, agent, service_id, asset, amount) via
  //           @aegis/bindings, store the returned decision_id on the intent, and
  //           for RequiresApproval push it onto the pending queue along with the
  //           rule that triggered.
  return reply.code(501).send({
    intent_hash: ih,
    error: "not_implemented",
    detail: "waiting on contract deploy + pnpm bindings — see README",
  });
});

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 8080);
app.listen({ port, host: "0.0.0.0" }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
