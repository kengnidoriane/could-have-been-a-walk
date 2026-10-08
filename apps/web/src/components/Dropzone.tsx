import { useRef, useState, type DragEvent } from 'react';

interface DropzoneProps {
  onFile: (file: File) => void;
  onSample: () => void;
  error?: string | null;
}

export function Dropzone({ onFile, onSample, error }: DropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <section className="dropzone-wrap" aria-labelledby="drop-title">
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone-icon" aria-hidden="true">
          📅
        </p>
        <h2 id="drop-title">Drop your calendar here</h2>
        <p className="muted">
          An <code>.ics</code> export from Google Calendar, Outlook or Apple Calendar.
        </p>
        <div className="row center">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
            Choose a .ics file
          </button>
          <button type="button" className="btn btn-ghost" onClick={onSample}>
            Try a sample week
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".ics,text/calendar"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <p className="privacy-note">
        🔒 Read in your browser and scored by a model on this computer. Your calendar is never
        uploaded.
      </p>
    </section>
  );
}
