// Screenshot uploader/gallery for a single trade. Uploads go straight to
// Supabase Storage from the browser (the "trade-screenshots" bucket), then a
// server function (attachments.functions.ts) records the metadata row —
// storage access itself is governed by that bucket's own RLS-equivalent
// storage policy, which scopes by the uploader's user ID in the object path.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createAttachment, deleteAttachment, listAttachments } from "@/lib/attachments.functions";

const BUCKET = "trade-screenshots";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Returns an error message if the file can't be attached, else null. */
export function validateScreenshot(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Only image files are supported.";
  if (file.size > MAX_FILE_BYTES) return "File is larger than the 10MB limit.";
  return null;
}

/**
 * Upload one image to storage and record its metadata row. Shared by the
 * existing-trade panel below and by the "log a trade" flow, which has no
 * trade id yet and so stages files locally until the trade is saved.
 */
export async function uploadTradeScreenshot({ tradeId, userId, file }: { tradeId: string; userId: string; file: File }) {
  const path = `${userId}/${tradeId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
  if (uploadError) throw new Error(uploadError.message);
  await createAttachment({ data: { tradeId, storagePath: path, contentType: file.type, fileName: file.name } });
}

/**
 * Screenshot picker for a trade that doesn't exist yet. Files are held in the
 * parent's state and uploaded right after the trade is created (journal.tsx),
 * so the screenshot area is present from the very first "Log a trade" click
 * instead of appearing only after re-opening the trade to edit it. Pasting an
 * image anywhere in the form also adds it — the usual chart-grab workflow.
 */
export function PendingScreenshotsPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  function addFiles(incoming: File[]) {
    setError("");
    const accepted: File[] = [];
    for (const file of incoming) {
      const problem = validateScreenshot(file);
      if (problem) setError(problem);
      else accepted.push(file);
    }
    if (accepted.length > 0) onChange([...files, ...accepted]);
  }

  return (
    <div
      className="rounded-md border border-border p-3"
      onPaste={(event) => {
        const pasted = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (pasted.length > 0) {
          event.preventDefault();
          addFiles(pasted);
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Screenshots</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="size-3.5" /> Add
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {files.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="relative aspect-square overflow-hidden rounded-md border border-border">
              <img src={previews[index]} alt={file.name} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="absolute right-1 top-1 rounded bg-background/80 p-1"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <X className="size-3 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Add or paste chart screenshots — they upload when you save.</p>
      )}
    </div>
  );
}

export function AttachmentsPanel({ tradeId, userId }: { tradeId: string; userId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const attachmentsQuery = useQuery({
    queryKey: ["attachments", tradeId],
    queryFn: () => listAttachments({ data: { tradeId } }),
  });
  const attachments = attachmentsQuery.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["attachments", tradeId] });
    void queryClient.invalidateQueries({ queryKey: ["attachment-counts"] });
  }

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment({ data: { attachmentId } }),
    onSuccess: invalidate,
  });

  async function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");

    const problem = validateScreenshot(file);
    if (problem) {
      setError(problem);
      return;
    }

    setIsUploading(true);
    try {
      await uploadTradeScreenshot({ tradeId, userId, file });
      invalidate();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Screenshots</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          <Upload className="size-3.5" /> {isUploading ? "Uploading…" : "Upload"}
        </Button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />
      </div>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      {attachments.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="group relative aspect-square overflow-hidden rounded-md border border-border">
              {attachment.signedUrl ? (
                <img src={attachment.signedUrl} alt={attachment.file_name ?? "Trade screenshot"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">Unavailable</div>
              )}
              <button
                type="button"
                aria-label="Delete screenshot"
                className="absolute right-1 top-1 hidden rounded bg-background/80 p-1 group-hover:block"
                onClick={() => deleteMutation.mutate(attachment.id)}
              >
                <Trash2 className="size-3 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No screenshots yet.</p>
      )}
    </div>
  );
}
