/**
 * Soroban RPC access — the CONTRACT side of the evidence.
 *
 * 🔑 INVARIANT: the ABI is fetched FROM THE CHAIN with
 * `contract.Client.from({ contractId, rpcUrl, networkPassphrase })`. This tool
 * deliberately does NOT import `@aegis/bindings`, so a reviewer can run it
 * against a contract ID alone, with no AEGIS workspace to build and no generated
 * artefact to trust. Together with "never call the AEGIS API", that is the
 * entire evidential value of the verifier.
 *
 * Every call simulates and never submits: these are read-only views.
 */
import { Address, contract, rpc, xdr } from "@stellar/stellar-sdk";
import { SourceUnavailableError } from "./horizon.js";

/** The `Decision` struct, decoded from the contract's own spec. */
export interface ChainDecision {
  decisionId: Uint8Array;
  intentHash: Uint8Array;
  agent: string;
  serviceId: string;
  /** SAC address, `C…`. */
  asset: string;
  /** Stroops. Kept as a bigint end to end — an i128 does not survive a JS number. */
  amount: bigint;
  policyVersion: number;
  /** Enum CASE NAME, resolved from the on-chain spec rather than hardcoded. */
  verdict: string;
  reasonCode: string;
  originalReasonCode: string;
  ledgerSeq: number;
  resolved: boolean;
  settled: boolean;
}

export interface ChainReader {
  getDecision(decisionId: Uint8Array): Promise<ChainDecision | "not-found">;
  /** The contract's OWN `sha256(intent_hash || policy_version || decision_id)`. */
  memoHash(decisionId: Uint8Array): Promise<Uint8Array | "not-found">;
  /**
   * The ledger at which the decision's storage entry was last written.
   *
   * For a settled decision that write is `mark_settled` — `authorize` is the only
   * other writer and it necessarily came first. TTL bumps live in a separate TTL
   * ledger entry and do not move this number.
   */
  decisionEntryLastModifiedLedger(decisionId: Uint8Array): Promise<number | "not-found">;
}

interface ContractViews {
  get_decision: (args: { decision_id: Buffer }) => Promise<contract.AssembledTransaction<contract.Result<unknown>>>;
  memo_hash: (args: { decision_id: Buffer }) => Promise<contract.AssembledTransaction<contract.Result<unknown>>>;
}

/** `Error::DecisionNotFound` — contracts/authorization/src/error.rs. */
const NOT_FOUND = "DecisionNotFound";

export async function connect(
  contractId: string,
  rpcUrl: string,
  networkPassphrase: string,
): Promise<ChainReader> {
  let client: contract.Client & ContractViews;
  try {
    client = await contract.Client.from<ContractViews>({ contractId, rpcUrl, networkPassphrase });
  } catch (e) {
    throw new SourceUnavailableError(
      `could not load the contract ABI for ${contractId} from ${rpcUrl}`,
      { cause: e },
    );
  }

  // Enum case names come from the spec the chain just handed us, so "Approved"
  // is never a number this tool made up: `Verdict` could be renumbered by a
  // redeploy and the output would follow the deployed contract, not our memory.
  const enums = readEnums(client.spec);
  const server = new rpc.Server(rpcUrl);

  const call = async (
    method: keyof ContractViews,
    decisionId: Uint8Array,
  ): Promise<unknown | "not-found"> => {
    let result: contract.Result<unknown>;
    try {
      const tx = await client[method]({ decision_id: Buffer.from(decisionId) });
      result = tx.result;
    } catch (e) {
      // A simulation that trapped on DecisionNotFound is an ANSWER, not an outage.
      if (String((e as Error)?.message ?? "").includes(NOT_FOUND)) return "not-found";
      throw new SourceUnavailableError(`Soroban RPC call ${method} failed`, { cause: e });
    }
    if (result.isErr()) {
      const message = result.unwrapErr().message;
      if (message.includes(NOT_FOUND)) return "not-found";
      throw new SourceUnavailableError(`the contract returned ${message} from ${method}`);
    }
    return result.unwrap();
  };

  return {
    async getDecision(decisionId) {
      const raw = await call("get_decision", decisionId);
      return raw === "not-found" ? "not-found" : decodeDecision(raw, enums);
    },

    async memoHash(decisionId) {
      const raw = await call("memo_hash", decisionId);
      if (raw === "not-found") return "not-found";
      if (!(raw instanceof Uint8Array)) {
        throw new SourceUnavailableError("memo_hash did not return bytes");
      }
      return Uint8Array.from(raw);
    },

    async decisionEntryLastModifiedLedger(decisionId) {
      // `DataKey::Decision(BytesN<32>)` — a Soroban enum variant with a payload is
      // an ScVec of [symbol, args...]. The key is built from the contract ID and
      // the decision id alone; nothing here is taken from the receipt.
      const key = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: Address.fromString(contractId).toScAddress(),
          key: xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol("Decision"),
            xdr.ScVal.scvBytes(Buffer.from(decisionId)),
          ]),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );
      let entries: Awaited<ReturnType<rpc.Server["getLedgerEntries"]>>;
      try {
        entries = await server.getLedgerEntries(key);
      } catch (e) {
        throw new SourceUnavailableError("Soroban RPC getLedgerEntries failed", { cause: e });
      }
      const entry = entries.entries[0];
      if (entry === undefined) return "not-found";
      const seq = entry.lastModifiedLedgerSeq;
      if (typeof seq !== "number") {
        throw new SourceUnavailableError("the decision entry carries no lastModifiedLedgerSeq");
      }
      return seq;
    },
  };
}

/** name -> (value -> case name), read out of the contract's published spec. */
type EnumTable = Map<string, Map<number, string>>;

function readEnums(spec: contract.Spec): EnumTable {
  const table: EnumTable = new Map();
  for (const entry of spec.entries) {
    if (entry.switch().name !== "scSpecEntryUdtEnumV0") continue;
    const e = entry.udtEnumV0();
    const cases = new Map<number, string>();
    for (const c of e.cases()) cases.set(c.value(), c.name().toString());
    table.set(e.name().toString(), cases);
  }
  return table;
}

const enumName = (enums: EnumTable, type: string, value: unknown): string => {
  if (typeof value !== "number") return String(value);
  return enums.get(type)?.get(value) ?? `${type}(${value})`;
};

function decodeDecision(raw: unknown, enums: EnumTable): ChainDecision {
  if (typeof raw !== "object" || raw === null) {
    throw new SourceUnavailableError("get_decision did not return a struct");
  }
  const d = raw as Record<string, unknown>;
  const bytes = (key: string): Uint8Array => {
    const v = d[key];
    if (!(v instanceof Uint8Array)) {
      throw new SourceUnavailableError(`decision.${key} is not bytes`);
    }
    return Uint8Array.from(v);
  };
  return {
    decisionId: bytes("decision_id"),
    intentHash: bytes("intent_hash"),
    agent: String(d["agent"]),
    serviceId: String(d["service_id"]),
    asset: String(d["asset"]),
    amount: BigInt(d["amount"] as bigint),
    policyVersion: Number(d["policy_version"]),
    verdict: enumName(enums, "Verdict", d["verdict"]),
    reasonCode: enumName(enums, "ReasonCode", d["reason_code"]),
    originalReasonCode: enumName(enums, "ReasonCode", d["original_reason_code"]),
    ledgerSeq: Number(d["ledger_seq"]),
    resolved: d["resolved"] === true,
    settled: d["settled"] === true,
  };
}
