import { customType, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const chatMedia = pgTable("chat_media", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  id: uuid("id").notNull(),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.userId, table.id] })]);

export const chatVotes = pgTable("chat_votes", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  vote: smallint("vote").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.messageId] })]);
