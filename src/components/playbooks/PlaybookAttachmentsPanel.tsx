// Reference-screenshot uploader for a playbook. Deliberately reuses the same
// "trade-screenshots" storage bucket as trade attachments (under a
// "<user_id>/playbooks/<playbook_id>/..." path) rather than a dedicated
// bucket — that bucket's storage policy already scopes access by the first
// path segment being the caller's own user ID, so no new bucket or policy
// was needed for this.
//
// Like the trade panel: react-dropzone for picking/limits, a Query mutation
// for the upload's pending/error state.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { reportRejections } from "@/components/journal/AttachmentsPanel";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createPlaybookAttachment, deletePlaybookAttachment } from "@/lib/playbooks.functions";
import { playbookAttachmentsQueryOptions } from "@/lib/queries";

const BUCKET = "trade-screenshots";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function PlaybookAttachmentsPanel({ playbookId, userId }: { playbookId: string; userId: string }) {
  const queryClient = useQueryClient();
  const queryOptions = playbookAttachmentsQueryOptions(playbookId);
  const { data: attachments = [] } = useQuery(queryOptions);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const path = `${userId}/playbooks/${playbookId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file);
      if (error) throw new Error(error.message);
      await createPlaybookAttachment({
        data: { playbookId, storagePath: path, contentType: file.type, fileName: file.name },
      });
    },
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) => deletePlaybookAttachment({ data: { attachmentId } }),
    onSuccess: invalidate,
  });

  const { getRootProps, getInputProps, open } = useDropzone({
    accept: { "image/*": [] },
    maxSize: MAX_FILE_BYTES,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: (accepted) => accepted.forEach((file) => upload.mutate(file)),
    onDropRejected: reportRejections,
  });

  return (
    <div {...getRootProps({ className: "rounded-md border border-border p-3" })}>
      <input {...getInputProps()} />
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Reference screenshots</span>
        <Button type="button" variant="ghost" size="sm" onClick={open} disabled={upload.isPending}>
          <Upload className="size-3.5" /> {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
      </div>

      {attachments.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="group relative aspect-square overflow-hidden rounded-md border border-border">
              {attachment.signedUrl ? (
                <img src={attachment.signedUrl} alt={attachment.file_name ?? "Playbook reference"} className="h-full w-full object-cover" />
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
        <p className="text-xs text-muted-foreground">No reference screenshots yet.</p>
      )}
    </div>
  );
}
