import { describe, expect, it } from "vitest";
import { Keypair } from "@aegis/bindings";
import { loadConfig } from "../src/config.js";

/** Generated per run — no real secret key is ever written into this repo. */
const operator = Keypair.random();
const agent = Keypair.random();

const base = {
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  CONTRACT_ID: "CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA",
  OPERATOR_SECRET: operator.secret(),
} as NodeJS.ProcessEnv;

const OPERATOR_ADDRESS = operator.publicKey();
const AGENT_ADDRESS = agent.publicKey();
const AGENT_SECRET = agent.secret();

describe("loadConfig", () => {
  it("prefers the operator, the least privileged of the two accepted callers", () => {
    const config = loadConfig(base);
    expect(config.callerRole).toBe("operator");
    expect(config.caller.publicKey()).toBe(OPERATOR_ADDRESS);
  });

  /**
   * DECISIONS.md #7 made `caller` a parameter accepted iff it is the owner OR
   * the configured operator, so the owner is a valid caller on its own.
   */
  it("falls back to the owner when no operator is configured", () => {
    const { OPERATOR_SECRET: _drop, ...rest } = base;
    const config = loadConfig({ ...rest, OWNER_SECRET: base.OPERATOR_SECRET });
    expect(config.callerRole).toBe("owner");
  });

  it("refuses to start with no caller at all", () => {
    const { OPERATOR_SECRET: _drop, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/OPERATOR_SECRET/);
  });

  it.each(["STELLAR_RPC_URL", "STELLAR_NETWORK_PASSPHRASE", "CONTRACT_ID"])(
    "fails at boot naming the missing variable %s",
    (name) => {
      expect(() => loadConfig({ ...base, [name]: undefined })).toThrow(name);
    },
  );

  /**
   * Silently trusting the key would mean signing an auth entry as an agent the
   * operator did not think it was signing for — the exact impersonation the
   * contract's separate `agent.require_auth()` exists to prevent.
   */
  it("rejects an AGENT_SECRETS entry whose key does not match its address", () => {
    expect(() =>
      loadConfig({
        ...base,
        AGENT_SECRETS: JSON.stringify({ [OPERATOR_ADDRESS]: AGENT_SECRET }),
      }),
    ).toThrow(/key mismatch/);
  });

  it("keys agent secrets by address, the way needsNonInvokerSigningBy reports them", () => {
    const config = loadConfig({
      ...base,
      AGENT_SECRETS: JSON.stringify({ [AGENT_ADDRESS]: AGENT_SECRET }),
    });
    expect([...config.agentSecrets.keys()]).toEqual([AGENT_ADDRESS]);
  });

  it("treats an absent or empty AGENT_SECRETS as no agents rather than an error", () => {
    expect(loadConfig(base).agentSecrets.size).toBe(0);
    expect(loadConfig({ ...base, AGENT_SECRETS: "" }).agentSecrets.size).toBe(0);
    expect(loadConfig({ ...base, AGENT_SECRETS: "{}" }).agentSecrets.size).toBe(0);
  });

  it("rejects AGENT_SECRETS that is not a JSON object", () => {
    expect(() => loadConfig({ ...base, AGENT_SECRETS: "[]" })).toThrow(/JSON object/);
    expect(() => loadConfig({ ...base, AGENT_SECRETS: "nonsense" })).toThrow(/JSON object/);
  });
});
