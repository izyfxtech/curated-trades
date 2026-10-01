// The Journal's filter bar. Every field is a TanStack Form field; a debounced
// form-level listener writes the values into the route's URL search params
// (and resets to page 1), which is what actually drives the server query —
// the form is only the input surface, the URL is the source of truth, so a
// filtered view is linkable and survives refresh.
import { useStore } from "@tanstack/react-form";
import { Search, Tag as TagIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Database } from "@/integrations/supabase/types";
import { useAppForm } from "@/lib/form";
import { countActiveFilters, type TradeFilters } from "@/lib/trade-filters";

type TagRowData = Database["public"]["Tables"]["tags"]["Row"];

const ALL = "all" as const;

const STATUS_OPTIONS = [
  { value: ALL, label: "Any status" },
  { value: "closed", label: "Closed" },
  { value: "open", label: "Open" },
  { value: "incomplete", label: "Incomplete" },
  { value: "cancelled", label: "Cancelled" },
] as const;
const OUTCOME_OPTIONS = [
  { value: ALL, label: "Any outcome" },
  { value: "win", label: "Wins" },
  { value: "loss", label: "Losses" },
  { value: "breakeven", label: "Breakeven" },
] as const;
const LABEL_OPTIONS = [
  { value: ALL, label: "Curated + impulse" },
  { value: "curated", label: "Curated only" },
  { value: "impulse", label: "Impulse only" },
] as const;
const DIRECTION_OPTIONS = [
  { value: ALL, label: "Long + short" },
  { value: "long", label: "Long only" },
  { value: "short", label: "Short only" },
] as const;
const SESSION_OPTIONS = [
  { value: ALL, label: "Any session" },
  { value: "London", label: "London" },
  { value: "New York", label: "New York" },
  { value: "Asia", label: "Asia" },
] as const;
const MARKET_OPTIONS = [
  { value: ALL, label: "Any market" },
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Crypto" },
] as const;
const SCREENSHOT_OPTIONS = [
  { value: ALL, label: "Screenshots: any" },
  { value: "with", label: "Has screenshots" },
  { value: "without", label: "No screenshots" },
] as const;
const REVIEW_OPTIONS = [
  { value: ALL, label: "Reviews: any" },
  { value: "reviewed", label: "Reviewed" },
  { value: "unreviewed", label: "Not reviewed" },
] as const;

interface FilterFormValues {
  q: string;
  status: (typeof STATUS_OPTIONS)[number]["value"];
  outcome: (typeof OUTCOME_OPTIONS)[number]["value"];
  label: (typeof LABEL_OPTIONS)[number]["value"];
  direction: (typeof DIRECTION_OPTIONS)[number]["value"];
  session: (typeof SESSION_OPTIONS)[number]["value"];
  market: (typeof MARKET_OPTIONS)[number]["value"];
  playbookId: string;
  tagIds: string[];
  tagMode: "any" | "all";
  screenshots: (typeof SCREENSHOT_OPTIONS)[number]["value"];
  reviewState: (typeof REVIEW_OPTIONS)[number]["value"];
  from: string;
  to: string;
}

const BLANK: FilterFormValues = {
  q: "",
  status: ALL,
  outcome: ALL,
  label: ALL,
  direction: ALL,
  session: ALL,
  market: ALL,
  playbookId: ALL,
  tagIds: [],
  tagMode: "any",
  screenshots: ALL,
  reviewState: ALL,
  from: "",
  to: "",
};

const orUndefined = <T extends string>(value: T | typeof ALL): T | undefined => (value === ALL ? undefined : value);

/** Form values → URL/server filter params (blank/"all" means "no filter"). */
function toFilters(v: FilterFormValues): TradeFilters {
  return {
    q: v.q.trim() || undefined,
    status: orUndefined(v.status),
    outcome: orUndefined(v.outcome),
    label: orUndefined(v.label),
    direction: orUndefined(v.direction),
    session: orUndefined(v.session),
    market: orUndefined(v.market),
    playbookId: orUndefined(v.playbookId),
    tagIds: v.tagIds.length > 0 ? v.tagIds : undefined,
    // Only meaningful with 2+ tags; leaving it out keeps the URL clean.
    tagMode: v.tagIds.length > 1 && v.tagMode === "all" ? "all" : undefined,
    screenshots: orUndefined(v.screenshots),
    reviewState: orUndefined(v.reviewState),
    from: v.from || undefined,
    to: v.to || undefined,
  };
}

function fromFilters(f: TradeFilters): FilterFormValues {
  return {
    q: f.q ?? "",
    status: f.status ?? ALL,
    outcome: f.outcome ?? ALL,
    label: f.label ?? ALL,
    direction: f.direction ?? ALL,
    session: f.session ?? ALL,
    market: f.market ?? ALL,
    playbookId: f.playbookId ?? ALL,
    tagIds: f.tagIds ?? [],
    tagMode: f.tagMode ?? "any",
    screenshots: f.screenshots ?? ALL,
    reviewState: f.reviewState ?? ALL,
    from: f.from ?? "",
    to: f.to ?? "",
  };
}

export function JournalFilters({
  filters,
  tags,
  playbooks,
  /** In gallery view the list is, by definition, trades with screenshots. */
  screenshotsLocked,
  onChange,
}: {
  /** The filters currently in the URL. */
  filters: TradeFilters;
  tags: TagRowData[];
  playbooks: { id: string; name: string }[];
  screenshotsLocked: boolean;
  onChange: (filters: TradeFilters) => void;
}) {
  const form = useAppForm({
    defaultValues: fromFilters(filters),
    listeners: {
      onChange: ({ formApi }) => onChange(toFilters(formApi.state.values)),
      onChangeDebounceMs: 250,
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const activeCount = countActiveFilters(toFilters(values));

  function clearAll() {
    form.reset(BLANK);
    onChange(toFilters(BLANK));
  }

  return (
    <section className="surface-panel mb-4 space-y-3 p-4" aria-label="Filter trades">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <form.AppField name="q">
            {(field) => (
              <>
                <label className="field-label" htmlFor="journal-search">
                  Symbol
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="journal-search"
                    placeholder="Search e.g. GBPUSD"
                    className="pl-9"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </div>
              </>
            )}
          </form.AppField>
        </div>
        <div className="w-[150px]">
          <form.AppField name="outcome">{(field) => <field.SelectField label="Outcome" options={OUTCOME_OPTIONS} />}</form.AppField>
        </div>
        <div className="w-[170px]">
          <form.AppField name="label">{(field) => <field.SelectField label="Curated / impulse" options={LABEL_OPTIONS} />}</form.AppField>
        </div>
        <div className="w-[150px]">
          <form.AppField name="status">{(field) => <field.SelectField label="Status" options={STATUS_OPTIONS} />}</form.AppField>
        </div>
        <div className="w-[250px]">
          <span className="field-label">Opened</span>
          <DateRangePicker
            from={values.from}
            to={values.to}
            onChange={({ from, to }) => {
              form.setFieldValue("from", from);
              form.setFieldValue("to", to);
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[150px]">
          <form.AppField name="direction">{(field) => <field.SelectField label="Direction" options={DIRECTION_OPTIONS} />}</form.AppField>
        </div>
        <div className="w-[150px]">
          <form.AppField name="session">{(field) => <field.SelectField label="Session" options={SESSION_OPTIONS} />}</form.AppField>
        </div>
        <div className="w-[140px]">
          <form.AppField name="market">{(field) => <field.SelectField label="Market" options={MARKET_OPTIONS} />}</form.AppField>
        </div>
        {playbooks.length > 0 && (
          <div className="w-[190px]">
            <form.AppField name="playbookId">
              {(field) => (
                <field.SelectField
                  label="Playbook"
                  options={[{ value: ALL, label: "Any playbook" }, ...playbooks.map((p) => ({ value: p.id, label: p.name }))]}
                />
              )}
            </form.AppField>
          </div>
        )}
        <div className="w-[170px]">
          <form.AppField name="screenshots">
            {(field) =>
              screenshotsLocked ? (
                <field.SelectField label="Screenshots" disabled options={[{ value: "with", label: "Has screenshots" }]} />
              ) : (
                <field.SelectField label="Screenshots" options={SCREENSHOT_OPTIONS} />
              )
            }
          </form.AppField>
        </div>
        <div className="w-[160px]">
          <form.AppField name="reviewState">{(field) => <field.SelectField label="Review" options={REVIEW_OPTIONS} />}</form.AppField>
        </div>

        <form.AppField name="tagIds">
          {(field) => (
            <div>
              <span className="field-label">Tags</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-[170px] justify-start">
                    <TagIcon className="size-3.5" />
                    {field.state.value.length === 0 ? "Any tag" : `${field.state.value.length} selected`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3">
                  {tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tags yet — add some when logging a trade.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="max-h-56 space-y-2 overflow-y-auto">
                        {tags.map((tag) => (
                          <label key={tag.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={field.state.value.includes(tag.id)}
                              onCheckedChange={(checked) =>
                                field.handleChange(
                                  checked === true ? [...field.state.value, tag.id] : field.state.value.filter((id) => id !== tag.id),
                                )
                              }
                            />
                            {tag.name}
                          </label>
                        ))}
                      </div>
                      {field.state.value.length > 1 && (
                        <form.AppField name="tagMode">
                          {(modeField) => (
                            <modeField.SegmentedField
                              size="sm"
                              options={[
                                { value: "any", label: "Any of" },
                                { value: "all", label: "All of" },
                              ]}
                            />
                          )}
                        </form.AppField>
                      )}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          )}
        </form.AppField>

        {activeCount > 0 && (
          <Button type="button" variant="ghost" onClick={clearAll} className="mb-0.5">
            <X /> Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </section>
  );
}
