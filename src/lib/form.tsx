// The app's TanStack Form kit. `createFormHook` binds a set of reusable field
// components (TextField, TextareaField, SelectField, CheckboxField) and form
// components (SubmitButton) to one `useAppForm` hook, so a form is just
//
//   const form = useAppForm({ defaultValues, validators: { onSubmit: schema }, onSubmit })
//   <form.AppField name="email">{(field) => <field.TextField label="Email" />}</form.AppField>
//   <form.AppForm><form.SubmitButton>Save</form.SubmitButton></form.AppForm>
//
// with zod schemas plugged straight in as validators (TanStack Form speaks
// Standard Schema, which zod 4 implements) — no per-field useState, no manual
// preventDefault, no hand-written isSubmitting guard: `form.handleSubmit()`
// ignores re-entry while a submit is in flight, and SubmitButton subscribes to
// `isSubmitting` itself. Label/input/error markup lives here once instead of
// being repeated in every form.
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

/** Standard Schema issues arrive as `{ message }` objects; plain validators
 * return strings. Normalise both so a field can just print them. */
function errorMessages(errors: unknown[]): string[] {
  return errors
    .map((error) => (typeof error === "string" ? error : ((error as { message?: string } | null)?.message ?? "")))
    .filter(Boolean);
}

function FieldShell({
  label,
  labelAction,
  hint,
  htmlFor,
  layout = "stacked",
  children,
}: {
  label?: ReactNode;
  labelAction?: ReactNode;
  hint?: ReactNode;
  htmlFor: string;
  layout?: FieldLayout | undefined;
  children: ReactNode;
}) {
  const field = useFieldContext<unknown>();
  const messages = field.state.meta.isTouched ? errorMessages(field.state.meta.errors) : [];
  if (layout === "row") {
    // Label + hint on the left, control (and any error) on the right — the
    // layout of the Settings screens.
    return (
      <div className="form-row">
        <div>
          <label htmlFor={htmlFor} className="form-row-label">
            {label}
          </label>
          {hint && <p className="form-row-hint">{hint}</p>}
        </div>
        <div className="max-w-md">
          {children}
          {messages.length > 0 && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {messages[0]}
            </p>
          )}
        </div>
      </div>
    );
  }
  return (
    <div>
      {label && (
        <div className={labelAction ? "flex items-center justify-between" : undefined}>
          <label htmlFor={htmlFor} className={labelAction ? "field-label mb-0" : "field-label"}>
            {label}
          </label>
          {labelAction}
        </div>
      )}
      {children}
      {hint && messages.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {messages.length > 0 && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {messages[0]}
        </p>
      )}
    </div>
  );
}

type FieldLayout = "stacked" | "row";
type FieldChrome = {
  label?: ReactNode;
  labelAction?: ReactNode;
  hint?: ReactNode;
  id?: string;
  /** "row" = label on the left, control on the right (Settings screens). */
  layout?: FieldLayout | undefined;
};

function TextField({
  label,
  labelAction,
  hint,
  id,
  layout,
  ...inputProps
}: FieldChrome & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "name" | "id">) {
  const field = useFieldContext<string>();
  const inputId = id ?? field.name;
  return (
    <FieldShell label={label} labelAction={labelAction} hint={hint} htmlFor={inputId} layout={layout}>
      <Input
        {...inputProps}
        id={inputId}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
    </FieldShell>
  );
}

function TextareaField({
  label,
  labelAction,
  hint,
  id,
  layout,
  ...textareaProps
}: FieldChrome & Omit<ComponentProps<typeof Textarea>, "value" | "onChange" | "onBlur" | "name" | "id">) {
  const field = useFieldContext<string>();
  const inputId = id ?? field.name;
  return (
    <FieldShell label={label} labelAction={labelAction} hint={hint} htmlFor={inputId} layout={layout}>
      <Textarea
        {...textareaProps}
        id={inputId}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
    </FieldShell>
  );
}

function SelectField({
  label,
  labelAction,
  hint,
  id,
  layout,
  options,
  placeholder,
  disabled,
}: FieldChrome & {
  options: readonly { value: string; label: ReactNode }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const field = useFieldContext<string>();
  const inputId = id ?? field.name;
  return (
    <FieldShell label={label} labelAction={labelAction} hint={hint} htmlFor={inputId} layout={layout}>
      <Select
        value={field.state.value ?? ""}
        onValueChange={field.handleChange}
        {...(disabled !== undefined ? { disabled } : {})}
      >
        <SelectTrigger id={inputId} onBlur={field.handleBlur}>
          <SelectValue {...(placeholder !== undefined ? { placeholder } : {})} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function CheckboxField({ label, id }: { label: ReactNode; id?: string }) {
  const field = useFieldContext<boolean>();
  const inputId = id ?? field.name;
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={inputId}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked === true)}
      />
      <label htmlFor={inputId} className="text-sm">
        {label}
      </label>
    </div>
  );
}

/** A row of mutually exclusive toggle buttons (long/short, curated/impulse,
 * personal/prop…) — the `direction-toggle` pattern used across the app. */
function SegmentedField<V extends string | boolean>({
  label,
  hint,
  options,
  id,
  layout,
  size,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  options: readonly { value: V; label: ReactNode; icon?: ReactNode }[];
  id?: string;
  layout?: FieldLayout | undefined;
  size?: ComponentProps<typeof Button>["size"];
}) {
  const field = useFieldContext<V>();
  const inputId = id ?? field.name;
  return (
    <FieldShell label={label} hint={hint} htmlFor={inputId} layout={layout}>
      <div className="direction-toggle" role="group" id={inputId}>
        {options.map((option) => (
          <Button
            type="button"
            key={String(option.value)}
            variant={field.state.value === option.value ? "secondary" : "ghost"}
            className="flex-1"
            {...(size ? { size } : {})}
            onClick={() => field.handleChange(option.value)}
            aria-pressed={field.state.value === option.value}
          >
            {option.icon}
            {option.label}
          </Button>
        ))}
      </div>
    </FieldShell>
  );
}

/** A 1–N slider that shows its current value in the label. */
function RangeField({ label, min = 1, max = 5, id }: { label: ReactNode; min?: number; max?: number; id?: string }) {
  const field = useFieldContext<number>();
  const inputId = id ?? field.name;
  return (
    <div>
      <label htmlFor={inputId} className="field-label">
        {label} — {field.state.value}/{max}
      </label>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={1}
        value={field.state.value}
        onChange={(event) => field.handleChange(Number(event.target.value))}
        className="w-full accent-current"
      />
    </div>
  );
}

/** Validation message for a field whose input is a custom control rather than
 * one of the components above. */
export function FieldMessage() {
  const field = useFieldContext<unknown>();
  const messages = field.state.meta.isTouched ? errorMessages(field.state.meta.errors) : [];
  return messages.length > 0 ? (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {messages[0]}
    </p>
  ) : null;
}

/** Subscribes to the form's submitting state on its own, so the parent form
 * component doesn't re-render on every keystroke just to disable a button. */
function SubmitButton({
  children,
  pendingLabel = "Please wait…",
  pending = false,
  ...buttonProps
}: {
  pendingLabel?: string;
  /** For forms whose submit fires a TanStack Query mutation instead of
   * awaiting it: pass `mutation.isPending` so the button reflects that too. */
  pending?: boolean;
} & Omit<ComponentProps<typeof Button>, "type">) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...buttonProps} type="submit" disabled={isSubmitting || pending || buttonProps.disabled}>
          {isSubmitting || pending ? pendingLabel : children}
        </Button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, TextareaField, SelectField, CheckboxField, SegmentedField, RangeField },
  formComponents: { SubmitButton },
});

/** Wire-up for a native <form>: stops the browser submit and hands off to
 * TanStack Form. Spread it: `<form {...formProps(form)}>`. */
export function formProps(form: { handleSubmit: () => Promise<void> | void }) {
  return {
    noValidate: true,
    onSubmit: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault();
      event.stopPropagation();
      void form.handleSubmit();
    },
  };
}
