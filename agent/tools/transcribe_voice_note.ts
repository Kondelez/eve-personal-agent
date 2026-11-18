import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { defineTool } from "eve/tools";
import type { ToolContext } from "eve/tools";
import { z } from "zod";
import { getChatMedia } from "../../server/utils/chat-media";
import { CONNECT_USER_ISSUER } from "../../shared/connect";
import { CHAT_MEDIA_ID } from "../../shared/chat-media";

const OPENAI_FORMATS = new Set(["mp3", "m4a", "wav", "ogg", "webm", "flac"]);

async function normalizeAudio(bytes: Buffer, extension: string, ctx: ToolContext) {
  const sandbox = await ctx.getSandbox();
  const path = `/tmp/eve-voice-${randomUUID()}`;
  const input = `${path}.${extension}`;
  const output = `${path}.wav`;
  const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(50_000)]);
  try {
    await sandbox.writeBinaryFile({ path: input, content: bytes, signal });
    const { exitCode } = await sandbox.run({
      // Paths contain generated UUIDs and a validated extension. Restrict the
      // decoder to local files and pipes.
      command: `
        codec=$(command -v ffmpeg)
        if [ -z "$codec" ]; then
          codec=/tmp/eve-ffmpeg-5.3.0/node_modules/ffmpeg-static/ffmpeg
          if [ ! -x "$codec" ]; then
            npm install --prefix /tmp/eve-ffmpeg-5.3.0 --no-audit --no-fund ffmpeg-static@5.3.0 >/dev/null || exit 1
          fi
        fi
        "$codec" -nostdin -v error -protocol_whitelist file,pipe -i "${input}" -map 0:a:0 -vn -t 600 -ac 1 -ar 16000 -c:a pcm_s16le "${output}"
      `,
      signal,
    });
    if (exitCode !== 0) throw new Error("The recording could not be decoded.");

    const wav = await sandbox.readBinaryFile({ path: output, signal });
    if (!wav?.length) throw new Error("The recording could not be decoded.");
    return Buffer.from(wav);
  }
  finally {
    try {
      await sandbox.run({ command: `rm -f "${input}" "${output}"`, signal: AbortSignal.timeout(3_000) });
    }
    catch { /* The isolated sandbox may have already stopped. */ }
  }
}

async function transcriptFromOpenAI(bytes: Buffer, filename: string, signal: AbortSignal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Voice transcription is unavailable.");

  const body = new FormData();
  body.set("model", "gpt-transcribe");
  body.set("file", new Blob([new Uint8Array(bytes)]), filename);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body,
    signal,
  });
  if (!response.ok) throw new Error("The transcription service could not read the recording.");

  const result = await response.json() as { text?: string };
  return result.text?.trim() ?? "";
}

export default defineTool({
  description: "Transcribe a voice note attached to the current SMS/MMS message. Pass the ID from its voice-note-<id> filename.",
  inputSchema: z.object({ id: z.string().regex(CHAT_MEDIA_ID) }),
  outputSchema: z.object({ transcript: z.string() }),
  async execute({ id }, ctx) {
    const caller = ctx.session.auth.current;
    if (caller?.issuer !== CONNECT_USER_ISSUER || caller.principalType !== "user") {
      throw new Error("Voice note is unavailable.");
    }
    const file = await getChatMedia(caller.principalId, id);
    const extension = file?.filename.split(".").at(-1);
    if (!file?.mediaType.startsWith("audio/") || !extension || !/^[a-z0-9]{2,5}$/.test(extension)
      || file.filename !== `voice-note-${id}.${extension}`) {
      throw new Error("Voice note is unavailable.");
    }

    const normalize = !OPENAI_FORMATS.has(extension);
    const audio = normalize ? await normalizeAudio(file.bytes, extension, ctx) : file.bytes;
    const transcript = await transcriptFromOpenAI(audio, `voice-note.${normalize ? "wav" : extension}`, ctx.abortSignal);
    if (normalize) {
      await db.update(schema.chatMedia).set({ bytes: audio, mediaType: "audio/wav", filename: `voice-note-${id}.wav` })
        .where(and(eq(schema.chatMedia.userId, caller.principalId), eq(schema.chatMedia.id, id)));
    }
    return { transcript };
  },
});
