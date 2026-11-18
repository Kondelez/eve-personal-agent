export async function transcribeAudio(audio: Blob, filename: string, signal: AbortSignal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Voice transcription is unavailable.");

  const body = new FormData();
  body.set("model", "gpt-transcribe");
  body.set("file", audio, filename);
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
