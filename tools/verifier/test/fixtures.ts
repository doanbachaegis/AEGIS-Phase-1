/**
 * Fixtures modelled on the LIVE testnet decision
 * `2fecca84…b8bf761e` (contract CAAD6727…5YTNTRPP, policy version 1,
 * 125000000 stroops, memo 44bdf40b…d1e0b3de).
 *
 * Using the real values rather than invented ones means the fixtures stay
 * anchored to something a reviewer can look up, and the arithmetic in the tests
 * is the arithmetic the tool will do in production.
 *
 * The settlement side is synthetic — Phase 1 has no settlement on the ledger yet
 * — so the Horizon shapes here are what these tests exercise until one exists.
 */
import { fromHex } from "@aegis/canonical";
import type { Receipt } from "@aegis/receipt";
import type { ChainDecision } from "../src/chain.js";
import type { HorizonOperation, HorizonTransaction } from "../src/horizon.js";

export const PASSPHRASE = "Test SDF Network ; September 2015";
export const CONTRACT_ID = "CAAD6727VZDKH77IVZJ526B3YENMMU26DGHUEU3B4D6KK3JS5YTNTRPP";
export const DECISION_ID = "2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e";
export const INTENT_HASH = "c51c74d5c445350d848e85fe3bb9cb1949fb73675893a09e654126bfb93b7a10";
export const MEMO_HEX = "44bdf40bed60f3b99b98d3cf298497b63dece3d9056d260a6544136cd1e0b3de";
export const PREIMAGE_HEX = `${INTENT_HASH}00000001${DECISION_ID}`;
export const SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const AGENT = "GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH";
export const EXECUTOR = "GBZZPQQHAAABQEHRYIF7GQ4ZL2ULZVRHJNZDOR5SS3XP23DIPX5JWNY3";
export const MERCHANT = "GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY";
export const TX_HASH = "11".repeat(32);
export const AMOUNT_STROOPS = 125000000n;

export const MEMO = fromHex(MEMO_HEX);
export const MEMO_BASE64 = Buffer.from(MEMO).toString("base64");

export const receipt = (over: Partial<{
  chain: Partial<Receipt["chain"]>;
  settlement: Partial<Receipt["settlement"]>;
}> = {}): Receipt => ({
  version: "aegis-receipt/1",
  network: {
    passphrase: PASSPHRASE,
    contract_id: CONTRACT_ID,
    horizon: "https://horizon-testnet.stellar.org",
    rpc: "https://soroban-testnet.stellar.org",
  },
  chain: {
    decision_id: DECISION_ID,
    intent_hash: INTENT_HASH,
    policy_version: 1,
    agent: AGENT,
    service_id: "openai-api",
    asset: SAC,
    amount: "125000000",
    ...over.chain,
  },
  settlement: {
    tx_hash: TX_HASH,
    memo_hash: MEMO_HEX,
    memo_preimage: PREIMAGE_HEX,
    source: EXECUTOR,
    destination: MERCHANT,
    asset: `USDC:${USDC_ISSUER}`,
    ...over.settlement,
  },
});

export const decision = (over: Partial<ChainDecision> = {}): ChainDecision => ({
  decisionId: fromHex(DECISION_ID),
  intentHash: fromHex(INTENT_HASH),
  agent: AGENT,
  serviceId: "openai-api",
  asset: SAC,
  amount: AMOUNT_STROOPS,
  policyVersion: 1,
  verdict: "Approved",
  reasonCode: "Ok",
  originalReasonCode: "Ok",
  ledgerSeq: 4494345,
  resolved: false,
  settled: true,
  ...over,
});

export const transaction = (over: Partial<HorizonTransaction> = {}): HorizonTransaction => ({
  hash: TX_HASH,
  successful: true,
  ledger: 4494400,
  created_at: "2026-09-04T10:00:00Z",
  source_account: EXECUTOR,
  operation_count: 1,
  memo_type: "hash",
  memo: MEMO_BASE64,
  ...over,
});

export const payment = (over: Partial<HorizonOperation> = {}): HorizonOperation => ({
  type: "payment",
  from: EXECUTOR,
  to: MERCHANT,
  amount: "12.5000000",
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: USDC_ISSUER,
  ...over,
});
