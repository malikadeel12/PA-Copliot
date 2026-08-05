// --- Change Summary ---
// What: Session-based speech append that rebuilds from recognition results.
// Why: Avoid overwriting typed text while the mic is open.

import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";

export default function VoiceMicButton({
  value = "",
  onTranscript,
  className = "",
  disabled = false,
  maxLength = 250,
}) {
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);
  const prefixRef = useRef(value);

  useEffect(() => () => {
    try { recogRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const toggle = () => {
    if (disabled) return;
    const SR = typeof window !== "undefined"
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
    if (!SR) {
      toast.error("Voice dictation is not supported in this browser. Type instead.");
      return;
    }

    if (listening && recogRef.current) {
      try { recogRef.current.stop(); } catch { /* ignore */ }
      setListening(false);
      return;
    }

    prefixRef.current = value || "";
    const recog = new SR();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = "en-US";

    recog.onresult = (event) => {
      let sessionText = "";
      for (let i = 0; i < event.results.length; i += 1) {
        sessionText += event.results[i][0]?.transcript || "";
      }
      const next = `${prefixRef.current}${prefixRef.current && sessionText ? " " : ""}${sessionText}`
        .replace(/\s+/g, " ")
        .trim();
      if (onTranscript) onTranscript(next.slice(0, maxLength));
    };
    recog.onerror = () => {
      setListening(false);
      toast.error("Microphone error — check browser permissions.");
    };
    recog.onend = () => setListening(false);

    recogRef.current = recog;
    try {
      recog.start();
      setListening(true);
    } catch {
      toast.error("Could not start the microphone.");
    }
  };

  return (
    <button
      type="button"
      data-testid="voice-mic-btn"
      onClick={toggle}
      disabled={disabled}
      title={listening ? "Stop dictation" : "Dictate with microphone"}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-md border transition-colors ${
        listening
          ? "border-rose-300 bg-rose-50 text-rose-700"
          : "border-stone-200 bg-white text-stone-600 hover:border-emerald-300 hover:text-emerald-800"
      } ${className}`}
    >
      {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      <span className="sr-only">{listening ? "Stop" : "Start"} voice dictation</span>
    </button>
  );
}
