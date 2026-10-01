// Screenshot uploader/gallery for a single trade. Uploads go straight to
// Supabase Storage from the browser (the "trade-screenshots" bucket), then a
// server function (attachments.functions.ts) records the metadata row —
// storage access itself is governed by that bucket's own RLS-equivalent
// storage policy, which scopes by the uploader's user ID in the object path.
//
// File picking / drag-and-drop / type + size limits come from react-dropzone
// (instead of a hidden <input> driven by a ref and hand-written checks), and
// upload progress + errors from a TanStack Query mutation (instead of
// `isUploading` / `error` state).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload, X } from "lucide-react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createAttachment, deleteAttachment } from "@/lib/attachments.functions";
import { attachmentsQueryOptions } from "@/lib/queries";

const BUCKET = "trade-screenshots";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Shared react-dropzone limits: images only, 10MB each. */
const DROPZONE_LIMITS = { accept: { "image/*": [] }, maxSize: MAX_FILE_BYTES } as const;

/** Turns react-dropzone's rejection codes into the app's own wording. */
export function reportRejections(rejections: FileRejection[]) {
  for (const { errors } of rejections) {
    const code = errors[0]?.code;
    toast.error(code === "file-too-large" ? "File is larger than the 10MB limit." : "Only image files are supported.");
  }
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

// One object URL per staged File, created on first render and revoked when
// the file is removed — a WeakMap keeps this stable across renders without an
// effect/memo pair to create and clean it up.
const previewUrls = new WeakMap<File, string>();
function previewUrl(file: File): string {
  let url = previewUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    previewUrls.set(file, url);
  }
  return url;
}
function releasePreview(file: File) {
  const url = previewUrls.get(file);
  if (url) URL.revokeObjectURL(url);
  previewUrls.delete(file);
}

/**
 * Screenshot picker for a trade that doesn't exist yet. Files are held in the
 * form's state and uploaded right after the trade is created (journal
 * route), so the screenshot area is present from the very first "Log a trade"
 * click instead of appearing only after re-opening the trade to edit it.
 * Pasting an image anywhere in the area also adds it — the usual chart-grab
 * workflow.
 */
export function PendingScreenshotsPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const { getRootProps, getInputProps, open } = useDropzone({
    ...DROPZONE_LIMITS,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: (accepted) => onChange([...files, ...accepted]),
    onDropRejected: reportRejections,
  });

  return (
    <div
      {...getRootProps({
        className: "rounded-md border border-border p-3",
        onPaste: (event) => {
          const pasted = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
          if (pasted.length > 0) {
            event.preventDefault();
            onChange([...files, ...pasted]);
          }
        },
      })}
    >
      <input {...getInputProps()} />
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Screenshots</span>
        <Button type="button" variant="ghost" size="sm" onClick={open}>
          <Upload className="size-3.5" /> Add
        </Button>
      </div>
      {files.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="relative aspect-square overflow-hidden rounded-md border border-border">
              <img src={previewUrl(file)} alt={file.name} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="absolute right-1 top-1 rounded bg-background/80 p-1"
                onClick={() => {
                  releasePreview(file);
                  onChange(files.filter((_, i) => i !== index));
                }}
              >
                <X className="size-3 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Add, drop or paste chart screenshots — they upload when you save.</p>
      )}
    </div>
  );
}

export function AttachmentsPanel({ tradeId, userId }: { tradeId: string; userId: string }) {
  const queryClient = useQueryClient();
  const { data: attachments = [] } = useQuery(attachmentsQueryOptions(tradeId));

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: attachmentsQueryOptions(tradeId).queryKey });
    // The Journal rows carry a screenshot count, so refresh those pages too.
    void queryClient.invalidateQueries({ queryKey: ["trades"] });
  }

  const upload = useMutation({
    mutationFn: (file: File) => uploadTradeScreenshot({ tradeId, userId, file }),
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message || "Upload failed."),
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment({ data: { attachmentId } }),
    onSuccess: invalidate,
  });

  const { getRootProps, getInputProps, open } = useDropzone({
    ...DROPZONE_LIMITS,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: (accepted) => accepted.forEach((file) => upload.mutate(file)),
    onDropRejected: reportRejections,
  });

  return (
    <div {...getRootProps({ className: "rounded-md border border-border p-3" })}>
      <input {...getInputProps()} />
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Screenshots</span>
        <Button type="button" variant="ghost" size="sm" onClick={open} disabled={upload.isPending}>
          <Upload className="size-3.5" /> {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
      </div>

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
                onClick={() => remove.mutate(attachment.id)}
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
