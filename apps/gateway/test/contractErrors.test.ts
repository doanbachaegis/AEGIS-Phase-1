import { describe, expect, it } from "vitest";
import { ReasonCode, Verdict } from "@aegis/bindings";
import {
  asContractFailure,
  httpForContractFailure,
  reasonName,
  verdictName,
} from "../src/contractErrors.js";

describe("asContractFailure", () => {
  it("reads the discriminant out of a real simulation message", () => {
    const message =
      'Transaction simulation failed: "HostError: Error(Contract, #4)\n\nEvent log (newest first):\n   0: [Diagnostic] ..."';
    const failure = asContractFailure(new Error(message));
    expect(failure).toMatchObject({ code: 4, name: "NotAuthorizedCaller" });
    // The raw text is kept verbatim — §6.1 D2 wants the unparsed error.
    expect(failure?.raw).toBe(message);
  });

  it("returns undefined for anything that is not a contract error", () => {
    expect(asContractFailure(new Error("fetch failed"))).toBeUndefined();
    expect(asContractFailure("connection reset")).toBeUndefined();
  });

  it("names an error the ABI grew after this table was written", () => {
    const failure = asContractFailure(new Error("Error(Contract, #99)"));
    expect(failure?.name).toBe("UnknownContractError(99)");
    expect(httpForContractFailure(failure!)).toMatchObject({
      status: 500,
      error: "unmapped_contract_error",
      alert: true,
    });
  });
});

describe("HTTP mapping", () => {
  /**
   * The load-bearing case. `NotAuthorizedCaller` means the gateway's OWN key is
   * not one the contract accepts. The client did nothing wrong and cannot fix
   * it, so a 4xx would misattribute the fault and hide an operational failure.
   */
  it("treats our own key being wrong as a 500 that alerts, not a 4xx", () => {
    for (const name of ["NotAuthorizedCaller", "NotOwner", "NotInitialized"]) {
      const failure = { code: 0, name, raw: name };
      const mapped = httpForContractFailure(failure);
      expect(mapped.status).toBe(500);
      expect(mapped.alert).toBe(true);
    }
  });

  it("treats a well-formed request against missing chain state as 422", () => {
    expect(httpForContractFailure({ code: 5, name: "AgentNotRegistered", raw: "" })).toMatchObject({
      status: 422,
      alert: false,
    });
  });

  it("treats state-machine conflicts as 409", () => {
    for (const name of ["NotPendingApproval", "AlreadyResolved", "AlreadySettled", "NotApproved", "AgentRevoked"]) {
      expect(httpForContractFailure({ code: 0, name, raw: "" }).status).toBe(409);
    }
  });

  it("maps a missing decision to 404", () => {
    expect(httpForContractFailure({ code: 6, name: "DecisionNotFound", raw: "" }).status).toBe(404);
  });
});

describe("enum naming", () => {
  it("renders both directions of the verdict and reason enums", () => {
    expect(verdictName(Verdict.RequiresApproval)).toBe("RequiresApproval");
    expect(Verdict.RequiresApproval).toBe(2);
    expect(reasonName(ReasonCode.AssetMismatch)).toBe("AssetMismatch");
    expect(ReasonCode.AssetMismatch).toBe(3);
    expect(reasonName(ReasonCode.PendingApproval)).toBe("PendingApproval");
  });
});
