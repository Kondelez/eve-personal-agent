import type { H3Event } from "h3";
import { getRequestOrigin } from "./h3-node";

export function requireChatJson(event: H3Event) {
  if (getRequestHeader(event, "content-type")?.split(";", 1)[0] !== "application/json") {
    throw createError({ statusCode: 415, statusMessage: "Expected JSON" });
  }
  const origin = getRequestHeader(event, "origin");
  if (getRequestHeader(event, "sec-fetch-site") === "cross-site"
    || (origin && origin !== getRequestOrigin(event))) {
    throw createError({ statusCode: 403, statusMessage: "Invalid request origin" });
  }
}
