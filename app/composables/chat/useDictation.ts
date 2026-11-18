import {
  createGateway,
  experimental_encodeRealtimeAudio as encodeAudio,
  experimental_resampleAudio as resampleAudio,
  experimental_streamTranscribe as streamTranscribe,
} from "ai";
import type { StreamTranscriptionResult } from "ai";
import { DICTATION_MODEL } from "#shared/chat-dictation";

const SAMPLE_RATE = 24_000;

interface Recording {
  abort: AbortController;
  context: AudioContext;
  microphone?: MediaStream;
  result?: StreamTranscriptionResult;
  audio?: ReadableStreamDefaultController<string>;
  processor?: ScriptProcessorNode;
  timer?: ReturnType<typeof setTimeout>;
  released?: boolean;
}

export function useDictation() {
  const supported = ref(false);
  const stage = ref<"idle" | "starting" | "recording" | "finishing">("idle");
  const preview = ref("");
  const volume = ref(0);
  let active: Recording | undefined;

  onMounted(() => {
    supported.value = typeof AudioContext !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  });

  function release(recording: Recording) {
    if (recording.released) return;
    recording.released = true;
    clearTimeout(recording.timer);
    if (recording.processor) recording.processor.onaudioprocess = null;
    recording.microphone?.getTracks().forEach(track => track.stop());
    void recording.context.close().catch(() => {});
    try { recording.audio?.close(); }
    catch { /* The transport may have already cancelled the audio stream. */ }
  }

  function reset(recording: Recording) {
    if (active !== recording) return;
    active = undefined;
    stage.value = "idle";
    preview.value = "";
    volume.value = 0;
  }

  function cancel() {
    if (!active) return;
    const recording = active;
    recording.abort.abort();
    release(recording);
    reset(recording);
  }

  async function trackTranscript(recording: Recording, result: StreamTranscriptionResult, fail: (error: unknown) => void) {
    const completed: string[] = [];
    let partial = "";
    try {
      for await (const part of result.fullStream) {
        if (part.type === "transcript-delta") partial += part.delta;
        if (part.type === "transcript-partial") partial = part.text;
        if (part.type === "transcript-final") {
          completed.push(part.text);
          partial = "";
        }
        if (part.type === "error") throw part.error;
        if (active === recording) preview.value = [...completed, partial].join(" ").trim();
      }
      if (active === recording && stage.value === "recording") {
        throw new Error("The transcription connection ended. Try again.");
      }
    }
    catch (error) {
      if (active !== recording || stage.value !== "recording") return;
      cancel();
      fail(error);
    }
  }

  async function begin(onLimit: () => void, fail: (error: unknown) => void) {
    if (active || !supported.value) return;

    const recording: Recording = { abort: new AbortController(), context: new AudioContext() };
    active = recording;
    stage.value = "starting";
    const signal = recording.abort.signal;
    try {
      // Resume inside the microphone button's click so mobile Safari can unlock audio.
      const resumed = recording.context.resume();
      const permission = navigator.mediaDevices.getUserMedia({ audio: true }).then((microphone) => {
        if (signal.aborted) microphone.getTracks().forEach(track => track.stop());
        else recording.microphone = microphone;
        return microphone;
      });
      const [, microphone] = await Promise.all([resumed, permission]);
      if (signal.aborted) return;
      const { token } = await $fetch<{ token: string }>("/api/transcription/token", {
        method: "POST", body: {}, signal, timeout: 15_000,
      });
      if (signal.aborted) return;

      const audio = new ReadableStream<string>({
        start(controller) { recording.audio = controller; },
      });
      const context = recording.context;
      const source = context.createMediaStreamSource(microphone);
      const processor = context.createScriptProcessor(4096, 1, 1);
      recording.processor = processor;
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (signal.aborted || recording.released) return;
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        const power = samples.reduce((sum, sample) => sum + sample * sample, 0);
        volume.value = Math.min(1, Math.sqrt(power / samples.length) * 5);

        const mono = context.sampleRate === SAMPLE_RATE
          ? samples
          : resampleAudio(samples, context.sampleRate, SAMPLE_RATE);
        try { recording.audio?.enqueue(encodeAudio(mono)); }
        catch { cancel(); fail(new Error("The transcription connection ended. Try again.")); }
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);

      const model = createGateway({ apiKey: token }).experimental_transcription(DICTATION_MODEL);
      const result = streamTranscribe({ model, audio, inputAudioFormat: { type: "audio/pcm", rate: SAMPLE_RATE }, abortSignal: signal });
      recording.result = result;
      recording.timer = setTimeout(onLimit, 120_000);
      stage.value = "recording";
      void trackTranscript(recording, result, fail);
    }
    catch (error) {
      if (signal.aborted) return;
      cancel();
      throw error;
    }
  }

  async function finish() {
    const recording = active;
    if (!recording?.result || stage.value !== "recording") return "";

    stage.value = "finishing";
    release(recording);
    const deadline = setTimeout(() => recording.abort.abort(new Error("Transcription timed out.")), 15_000);
    try {
      const text = await recording.result.text;
      return active === recording ? text.trim() : "";
    }
    catch (error) {
      if (active === recording) throw recording.abort.signal.reason ?? error;
      return "";
    }
    finally {
      clearTimeout(deadline);
      reset(recording);
    }
  }

  onScopeDispose(cancel);
  return { supported, stage, preview, volume, begin, cancel, finish };
}
