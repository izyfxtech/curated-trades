// A plain textarea with an optional dictation button — the mic button only
// renders when the browser actually exposes the Web Speech API
// (SpeechRecognition), which today means Chromium-based browsers, not
// Safari or Firefox. Feature-detected at runtime rather than guessed from
// user-agent, and the field is a fully normal textarea with no behavior
// change when dictation isn't available.
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

// Web Speech API's SpeechRecognition isn't in the standard lib.dom types and
// is only reliably available in Chromium-based browsers today (not Safari or
// Firefox) — feature-detect rather than assume, and always fall back to a
// plain textarea.
interface MinimalSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => MinimalSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => MinimalSpeechRecognition;
    webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

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
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const SpeechRecognitionCtor = getSpeechRecognitionCtor();

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function toggleListening() {
    if (!SpeechRecognitionCtor) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: unknown) => {
      const results = (event as { results: ArrayLike<{ 0: { transcript: string } }> }).results;
      const transcript = Array.from(results)
        .map((r) => r[0].transcript)
        .join(" ");
      onChange(value ? `${value} ${transcript}` : transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  return (
    <div className="relative">
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={SpeechRecognitionCtor ? "pr-10" : undefined}
      />
      {SpeechRecognitionCtor && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 size-7"
          aria-label={isListening ? "Stop dictation" : "Start dictation"}
          onClick={toggleListening}
        >
          {isListening ? <Square className="size-3.5 text-destructive" /> : <Mic className="size-3.5" />}
        </Button>
      )}
    </div>
  );
}
