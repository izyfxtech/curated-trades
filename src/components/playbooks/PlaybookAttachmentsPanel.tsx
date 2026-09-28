// Reference-screenshot uploader for a playbook. Deliberately reuses the same
// "trade-screenshots" storage bucket as trade attachments (under a
// "<user_id>/playbooks/<playbook_id>/..." path) rather than a dedicated
// bucket — that bucket's storage policy already scopes access by the first
// path segment being the caller's own user ID, so no new bucket or policy
// was needed for this.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createPlaybookAttachment, deletePlaybookAttachment, listPlaybookAttachments } from "@/lib/playbooks.functions";

const BUCKET = "trade-screenshots";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function PlaybookAttachmentsPanel({ playbookId, userId }: { playbookId: string; userId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const attachmentsQuery = useQuery({
    queryKey: ["playbook-attachments", playbookId],
    queryFn: () => listPlaybookAttachments({ data: { playbookId } }),
  });
  const attachments = attachmentsQuery.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["playbook-attachments", playbookId] });
  }

  const createMutation = useMutation({
    mutationFn: createPlaybookAttachment,
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deletePlaybookAttachment({ data: { attachmentId } }),
    onSuccess: invalidate,
  });

  async function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");

    if (!file.type.startsWith("image/")) {
      setError("Only image files are supported.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("File is larger than the 10MB limit.");
      return;
    }

    const path = `${userId}/playbooks/${playbookId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      return;
    }

    createMutation.mutate({
      data: { playbookId, storagePath: path, contentType: file.type, fileName: file.name },
    });
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Reference screenshots</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={createMutation.isPending}
        >
          <Upload className="size-3.5" /> {createMutation.isPending ? "Uploading…" : "Upload"}
        </Button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />
      </div>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

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
                onClick={() => deleteMutation.mutate(attachment.id)}
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
