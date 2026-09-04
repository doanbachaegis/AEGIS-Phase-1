CREATE TABLE "approval_queue" (
	"decision_id" "bytea" PRIMARY KEY NOT NULL,
	"intent_hash" "bytea" NOT NULL,
	"rule" text NOT NULL,
	"threshold_snapshot" numeric(39, 0) NOT NULL,
	"amount" numeric(39, 0) NOT NULL,
	"policy_version_snapshot" integer NOT NULL,
	"escalated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"intent_hash" "bytea" PRIMARY KEY NOT NULL,
	"decision_id" "bytea" NOT NULL,
	"verdict" smallint NOT NULL,
	"reason_code" smallint NOT NULL,
	"original_reason_code" smallint NOT NULL,
	"policy_version" integer NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"ledger_seq" integer,
	"tx_hash" text,
	"verdict_ms" integer,
	"finality_ms" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"intent_hash" "bytea" PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"service_id" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(39, 0) NOT NULL,
	"purpose" text NOT NULL,
	"client_ref" text NOT NULL,
	"canonical_preimage" "bytea" NOT NULL,
	"agent_address" text NOT NULL,
	"asset_sac" text NOT NULL,
	"registry_version" integer NOT NULL,
	"request_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_failures" (
	"request_id" text PRIMARY KEY NOT NULL,
	"intent_hash" "bytea",
	"contract_error" text,
	"http_status" smallint NOT NULL,
	"raw_error" text NOT NULL,
	"context" jsonb,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_queue" ADD CONSTRAINT "approval_queue_intent_hash_intents_intent_hash_fk" FOREIGN KEY ("intent_hash") REFERENCES "public"."intents"("intent_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_intent_hash_intents_intent_hash_fk" FOREIGN KEY ("intent_hash") REFERENCES "public"."intents"("intent_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_queue_escalated_idx" ON "approval_queue" USING btree ("escalated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_decision_id_idx" ON "decisions" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "decisions_verdict_idx" ON "decisions" USING btree ("verdict");--> statement-breakpoint
CREATE INDEX "intents_agent_received_idx" ON "intents" USING btree ("agent_id","received_at");--> statement-breakpoint
CREATE INDEX "submission_failures_failed_idx" ON "submission_failures" USING btree ("failed_at");