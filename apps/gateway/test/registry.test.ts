import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalIntent, intentHash, parseAmount, toHex } from "@aegis/canonical";
import { Registry } from "../src/registry.js";

const root = resolve(import.meta.dirname, "../../..");
// Read from the registry under test rather than pinning a literal: this suite
// exercises the real registry.json, and a redeploy must not turn it red.
const CONTRACT_ID: string = JSON.parse(
  readFileSync(new URL("../registry.json", import.meta.url), "utf8"),
).network.contract_id;

const load = () =>
  Registry.load(
    resolve(root, "apps/gateway/registry.json"),
    resolve(root, "services.json"),
    CONTRACT_ID,
  );

describe("Registry", () => {
  it("resolves agent_id to the address the contract require_auth()s", () => {
    const agent = load().agent("agent-1");
    expect(agent?.address).toBe("GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH");
  });

  it("resolves the policy asset string to its SAC", () => {
    const asset = load().asset("USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(asset?.sac).toBe("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
    expect(asset?.policyAsset).toBe(true);
  });

  /**
   * SOW §5.2 scenario 4 (`AssetMismatch`) has to produce evidence ON CHAIN. With
   * a single asset in the table the gateway would answer `unknown_asset` locally
   * and the contract would never rule, so the scenario would be demonstrated by
   * gateway code instead of by the contract. A second, non-policy asset is what
   * makes the intent reachable.
   */
  it("carries a second, non-policy asset so AssetMismatch reaches the chain", () => {
    const registry = load();
    expect(registry.assetList.length).toBeGreaterThanOrEqual(2);
    const nonPolicy = registry.assetList.filter((a) => !a.policyAsset);
    expect(nonPolicy.length).toBeGreaterThanOrEqual(1);
    expect(nonPolicy[0]?.sac).not.toBe(
      registry.assetList.find((a) => a.policyAsset)?.sac,
    );
  });

  it("reads services.json without owning it", () => {
    const service = load().service("openai-api");
    expect(service?.destination).toBe("GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY");
  });

  /**
   * `service_id` is deliberately NOT pre-filtered — `Policy.allowed_services` is
   * the authority and `ServiceNotAllowed` must be recorded by the contract.
   * A miss here is metadata being absent, not a rejection.
   */
  it("returns undefined rather than throwing for an unlisted service", () => {
    expect(load().service("stripe-api")).toBeUndefined();
  });

  it("refuses a registry pinned to a different contract than CONTRACT_ID", () => {
    expect(() =>
      Registry.load(
        resolve(root, "apps/gateway/registry.json"),
        resolve(root, "services.json"),
        "CNOTTHEDEPLOYEDCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).toThrow(/pinned to contract/);
  });
});

/**
 * The reviewer's own check, executed as a test: take the canonical preimage,
 * pipe it through sha256, and land on `intent_hash`. No AEGIS code in the loop
 * beyond producing the bytes.
 */
describe("canonical preimage", () => {
  it("sha256 of the preimage is the intent hash", () => {
    const registry = load();
    const asset = registry.assetList[0]!;
    const intent = {
      agentId: "agent-1",
      serviceId: "openai-api",
      asset: asset.asset,
      amount: parseAmount("12.5"),
      purpose: "unit test",
      clientRef: "ref-1",
    };
    const preimageHex = toHex(canonicalIntent(intent));
    const recomputed = createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex");
    expect(recomputed).toBe(toHex(intentHash(intent)));
  });
});
