// A plain textarea with an optional dictation button — the mic button only
// renders when the browser actually exposes the Web Speech API
// (SpeechRecognition), which today means Chromium-based browsers, not
// Safari or Firefox. Feature detection, the recognizer's lifecycle and its
// cleanup are handled by react-speech-recognition (this file used to wrap the
// raw browser API by hand, with a ref, an effect and its own listening flag);
// the field is a fully normal textarea with no behavior change when
// dictation isn't available.
import { Mic, Square } from "lucide-react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function VoiceTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
}) {
  const { listening, browserSupportsSpeechRecognition } = useSpeechRecognition({
    // A "*" command matches every finished phrase, so this is simply "append
    // what was just said" — no transcript state to mirror into the field.
    commands: [
      {
        command: "*",
        callback: (phrase: string) => onChange(value ? `${value} ${phrase}` : phrase),
      },
    ],
  });

  return (
    <div className="relative">
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={browserSupportsSpeechRecognition ? "pr-10" : undefined}
      />
      {browserSupportsSpeechRecognition && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 size-7"
          aria-label={listening ? "Stop dictation" : "Start dictation"}
          onClick={() =>
            void (listening
              ? SpeechRecognition.stopListening()
              : SpeechRecognition.startListening({ continuous: true, language: "en-US" }))
          }
        >
          {listening ? <Square className="size-3.5 text-destructive" /> : <Mic className="size-3.5" />}
        </Button>
      )}
    </div>
  );
}
