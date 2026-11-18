import { defineAgent } from "eve";
import { openai } from "eve/models/openai";

export default defineAgent({
  model: openai("gpt-5.4-mini-2026-03-17"),
  modelContextWindowTokens: 400_000,
  experimental: {
    workflow: {
      // The web app stores only a session id per thread and reloads the
      // transcript from eve. Since eve 0.80, signed-in (private) sessions
      // delete their run data when the session ends, which would leave old
      // threads unreadable. Keep it for the World's default period instead.
      // Set to `0` to always delete on session end.
      retention: "default",
    },
  },
});
