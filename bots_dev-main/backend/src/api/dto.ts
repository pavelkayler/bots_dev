import { z } from "zod";

/**
 * DTO types + zod schemas (minimal stub).
 * TODO: align with docs/06_contracts.md + docs/10_json_schemas.md
 */

export const SessionStateSchema = z.enum(["STOPPED", "RUNNING", "COOLDOWN", "STOPPING"]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const WsHelloSchema = z.object({
  type: z.literal("hello"),
  serverTime: z.number()
});
export type WsHello = z.infer<typeof WsHelloSchema>;

// Placeholder for other message schemas:
// snapshot, tick, events_append, session_state, error
