// Symbol picker used on every trade form (log/edit trade, risk calculator,
// trade ideas): a grouped dropdown of the major and minor forex pairs plus
// gold/silver, with a "Custom symbol" fallback that reveals a plain text
// field for anything else — crypto, stocks, indices — so nothing that used
// to work with free typing stops working.
import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCY_PAIR_GROUPS, CUSTOM_SYMBOL_VALUE, isListedSymbol } from "@/lib/instruments";

export function InstrumentSelect({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  /** Current symbol, in whatever case the user left it (normalized on save elsewhere). */
  value: string;
  onChange: (symbol: string) => void;
  autoFocus?: boolean;
}) {
  const normalized = value.trim().toUpperCase();
  const isKnown = normalized !== "" && isListedSymbol(normalized);
  // "Custom symbol…" was picked but nothing typed yet. Without remembering
  // that, clearing the custom text field back to "" would flip the dropdown
  // to its unselected state instead of staying on "Custom symbol" while the
  // person is still typing. Everything else (a listed pair, or custom text
  // that isn't listed) is derived from the value itself.
  const [pickedCustom, setPickedCustom] = useState(false);
  const customMode = !isKnown && (normalized !== "" || pickedCustom);

  return (
    <div className="space-y-2">
      <Select
        value={customMode ? CUSTOM_SYMBOL_VALUE : normalized}
        onValueChange={(next) => {
          if (next === CUSTOM_SYMBOL_VALUE) {
            setPickedCustom(true);
            onChange("");
          } else {
            setPickedCustom(false);
            onChange(next);
          }
        }}
      >
        <SelectTrigger id={customMode ? undefined : id}>
          <SelectValue placeholder="Choose a pair…" />
        </SelectTrigger>
        <SelectContent>
          {CURRENCY_PAIR_GROUPS.map((group) => (
            <SelectGroup key={group.group}>
              <SelectLabel>{group.group}</SelectLabel>
              {group.options.map((option) => (
                <SelectItem key={option.symbol} value={option.symbol}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          <SelectGroup>
            <SelectLabel>Other</SelectLabel>
            <SelectItem value={CUSTOM_SYMBOL_VALUE}>Custom symbol…</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {customMode && (
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="BTCUSD, AAPL, NAS100…"
          autoFocus={autoFocus}
        />
      )}
    </div>
  );
}
