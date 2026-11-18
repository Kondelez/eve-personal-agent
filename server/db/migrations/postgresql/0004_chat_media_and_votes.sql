CREATE TABLE "chat_media" (
	"user_id" text NOT NULL,
	"id" uuid NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_media_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "chat_votes" (
	"user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"vote" smallint NOT NULL,
	CONSTRAINT "chat_votes_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "chat_media" ADD CONSTRAINT "chat_media_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_votes" ADD CONSTRAINT "chat_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;