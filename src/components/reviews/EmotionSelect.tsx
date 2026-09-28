// A controlled-vocabulary picker for a single emotional-state field (before/
// during/after a trade), with an "Other…" option that reveals free text.
// This is the "controlled taxonomy but still extensible" pattern the plan
// asks for — reused three times per review (see TradeReviewModal.tsx) rather
// than duplicated inline.
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMOTIONS = [
  "Calm",
  "Confident",
  "Excited",
  "Anxious",
  "Fearful",
  "Frustrated",
  "Bored",
  "Greedy",
  "Hesitant",
  "Angry",
  "Neutral",
];

export function EmotionSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const isCustom = value !== "" && !EMOTIONS.includes(value);
  const [showCustom, setShowCustom] = useState(isCustom);

  return (
    <div>
      <span className="field-label">{label}</span>
      <Select
        value={showCustom ? "other" : value}
        onValueChange={(next) => {
          if (next === "other") {
            setShowCustom(true);
            onChange("");
          } else {
            setShowCustom(false);
            onChange(next);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {EMOTIONS.map((emotion) => (
            <SelectItem key={emotion} value={emotion}>
              {emotion}
            </SelectItem>
          ))}
          <SelectItem value="other">Other…</SelectItem>
        </SelectContent>
      </Select>
      {showCustom && (
        <Input
          className="mt-1.5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe it"
        />
      )}
    </div>
  );
}
