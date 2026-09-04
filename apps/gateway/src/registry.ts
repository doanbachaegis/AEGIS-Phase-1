import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The two public lookup tables the gateway needs, and the reason they have to be
 * files rather than code.
 *
 * `canonical_intent` hashes `agent_id` and `asset` as **strings** (SPEC.md §1),
 * while the contract compares `Address` to `Address`. Something has to translate,
 * and if that translation is not published a reviewer cannot line a recomputed
 * `intent_hash` up against the `Decision` the contract stored — the mapping would
 * be an AEGIS-controlled input hidden inside the gateway binary.
 *
 * `services.json` (repo root, owned by D3) is READ here and never written: it is
 * the binding from `service_id` to a destination account. The gateway does not
 * use it to filter — see `resolveService` below.
 */

const ServicesFile = z.object({
  network: z.object({ contract_id: z.string(), passphrase: z.string() }),
  services: z.array(
    z.object({
      service_id: z.string(),
      display_name: z.string(),
      destination: z.string(),
      destination_alias: z.string().optional(),
      active: z.boolean(),
    }),
  ),
});

const GatewayRegistryFile = z.object({
  registry_version: z.number(),
  network: z.object({ contract_id: z.string(), passphrase: z.string() }),
  agents: z.array(
    z.object({
      agent_id: z.string(),
      address: z.string(),
      alias: z.string().optional(),
      active: z.boolean(),
    }),
  ),
  assets: z.array(
    z.object({
      asset: z.string(),
      sac: z.string(),
      code: z.string(),
      issuer: z.string(),
      policy_asset: z.boolean(),
    }),
  ),
});

export interface ServiceRow {
  serviceId: string;
  displayName: string;
  destination: string;
  active: boolean;
}

export interface AgentRow {
  agentId: string;
  address: string;
  alias: string | undefined;
  active: boolean;
}

export interface AssetRow {
  /** the `"CODE:ISSUER"` string, hashed verbatim into canonical field 4 */
  asset: string;
  /** the SAC `Address` the contract actually compares */
  sac: string;
  code: string;
  issuer: string;
  /** true for the asset that matches `Policy.allowed_asset` */
  policyAsset: boolean;
}

export class Registry {
  private constructor(
    readonly registryVersion: number,
    private readonly agents: ReadonlyMap<string, AgentRow>,
    private readonly assets: ReadonlyMap<string, AssetRow>,
    private readonly services: ReadonlyMap<string, ServiceRow>,
  ) {}

  static load(registryPath: string, servicesPath: string, contractId: string): Registry {
    const registry = GatewayRegistryFile.parse(
      JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    );
    const services = ServicesFile.parse(JSON.parse(readFileSync(servicesPath, "utf8")) as unknown);

    // A registry pinned to a different contract than the one being called is a
    // configuration error that would otherwise surface as a puzzling
    // AgentNotRegistered at request time.
    for (const [name, file] of [
      ["registry.json", registry],
      ["services.json", services],
    ] as const) {
      if (file.network.contract_id !== contractId) {
        throw new Error(
          `${name} is pinned to contract ${file.network.contract_id} but CONTRACT_ID is ${contractId}`,
        );
      }
    }

    return new Registry(
      registry.registry_version,
      new Map(
        registry.agents.map((a) => [
          a.agent_id,
          { agentId: a.agent_id, address: a.address, alias: a.alias, active: a.active },
        ]),
      ),
      new Map(
        registry.assets.map((a) => [
          a.asset,
          {
            asset: a.asset,
            sac: a.sac,
            code: a.code,
            issuer: a.issuer,
            policyAsset: a.policy_asset,
          },
        ]),
      ),
      new Map(
        services.services.map((s) => [
          s.service_id,
          {
            serviceId: s.service_id,
            displayName: s.display_name,
            destination: s.destination,
            active: s.active,
          },
        ]),
      ),
    );
  }

  /**
   * `agent_id` -> `Address`. A miss is fatal for the request: without an address
   * there is no `authorize()` call to make and therefore no on-chain evidence to
   * produce, so the gateway answers 400 rather than inventing one.
   */
  agent(agentId: string): AgentRow | undefined {
    return this.agents.get(agentId);
  }

  /**
   * `"CODE:ISSUER"` -> SAC `Address`. Same reasoning as `agent`, with one
   * deliberate consequence: the table carries a second, non-policy asset so an
   * `AssetMismatch` intent resolves to a real SAC and is judged BY THE CONTRACT
   * (SOW §5.2 scenario 4) instead of being turned away here.
   */
  asset(asset: string): AssetRow | undefined {
    return this.assets.get(asset);
  }

  /**
   * Metadata only. The gateway deliberately does NOT reject an unknown
   * `service_id`: `Policy.allowed_services` is the authority, the contract
   * records `ServiceNotAllowed` on chain (§5.2 scenario 3), and a local
   * pre-filter would replace that evidence with gateway behaviour. `service_id`
   * crosses the ABI as a `String`, so nothing has to be resolved for the call to
   * be made.
   */
  service(serviceId: string): ServiceRow | undefined {
    return this.services.get(serviceId);
  }

  get assetList(): AssetRow[] {
    return [...this.assets.values()];
  }

  get agentList(): AgentRow[] {
    return [...this.agents.values()];
  }
}
