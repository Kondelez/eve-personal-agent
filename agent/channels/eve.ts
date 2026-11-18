import { ForbiddenError, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { getAccountChatSessionId } from "../../server/utils/account-chat";
import { authenticateAccount } from "../lib/account-auth";

export default eveChannel({
  turnPolicy: "queue",
  auth: [
    async (request) => {
      const account = await authenticateAccount(request);
      if (!account) return null;

      // The browser can read and control only its own conversation. Session
      // creation happens at the shared continuation address in sms.ts.
      const path = new URL(request.url).pathname;
      const sessionId = /^\/eve\/v1\/session\/([^/]+)(?:\/|$)/.exec(path)?.[1];
      if (!sessionId || sessionId !== await getAccountChatSessionId(account.principalId)) {
        throw new ForbiddenError({ message: "Open your Eve conversation first." });
      }
      return account;
    },
    vercelOidc(),
  ],
});
