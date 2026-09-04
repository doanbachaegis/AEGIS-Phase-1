import { z } from "zod";

/**
 * POST /v1/intents — SOW §4.1 D2.
 * `amount` is taken as a STRING and then parsed into bigint stroops. It must
 * never travel as a JSON number: silent float rounding is exactly the "Budget
 * drift" failure mode.
 */
export const IntentRequest = z.object({
  agent_id: z.string().min(1).max(255),
  service_id: z.string().min(1).max(255),
  /** in the form "CODE:ISSUER" */
  asset: z.string().min(1).max(255),
  /** decimal string, at most 7 decimal places, e.g. "12.5" */
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/, "at most 7 decimal places"),
  purpose: z.string().max(65535),
  client_ref: z.string().max(255),
});

export type IntentRequest = z.infer<typeof IntentRequest>;
