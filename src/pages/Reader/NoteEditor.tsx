import { useState } from 'preact/hooks';
import { Modal } from '@/components/Modal';
import type { NoteTarget } from '@/reader/useAnnotations';

export function NoteEditor({
  target,
  busy,
  onSave,
  onClose,
}: {
  target: NoteTarget;
  busy: boolean;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(
    'highlight' in target ? (target.highlight.note ?? '') : '',
  );
  const text =
    'highlight' in target ? target.highlight.text : target.selection.text;
  return (
    <Modal
      title="编辑笔记"
      onDismiss={() => {
        if (!busy) onClose();
      }}
      className="note-editor"
    >
      <h2>笔记</h2>
      <blockquote>{text}</blockquote>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(note);
        }}
      >
        <label>
          写下此刻的想法
          <textarea
            value={note}
            rows={6}
            autoFocus
            onInput={(event) => setNote(event.currentTarget.value)}
          />
        </label>
        <p class="muted">清空笔记并保存会保留划线。</p>
        <div class="note-editor-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
