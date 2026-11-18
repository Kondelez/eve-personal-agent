import { createAuthClient } from "better-auth/vue";
import { magicLinkClient } from "better-auth/client/plugins";

// Same-origin, browser only. Anything that needs a session during SSR goes
// through `useRequestFetch()`, which reaches Nitro without leaving the process.
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
