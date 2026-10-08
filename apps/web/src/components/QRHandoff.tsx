import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { isLocalOnly } from '../lib/walkLink';

interface QRHandoffProps {
  url: string;
  onClose: () => void;
}

export function QRHandoff({ url, onClose }: QRHandoffProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const localOnly = isLocalOnly(url);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (!canvas.current) return;
    void QRCode.toCanvas(canvas.current, url, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 320,
      color: { dark: '#1d2721', light: '#fffaf1' },
    });
  }, [url]);

  return (
    <dialog
      ref={dialog}
      className="qr-dialog"
      aria-labelledby="qr-title"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
    >
      <div className="qr-body">
        <h2 id="qr-title">Scan to walk</h2>
        <p className="muted">
          The route, the end time and the agenda are all inside this link. The phone needs no
          account, no app and no laptop.
        </p>
        <canvas ref={canvas} className="qr-canvas" aria-label="QR code of the walk link" />
        {localOnly && (
          <p className="note">
            This link points at <code>localhost</code>, which your phone can&rsquo;t open. Set{' '}
            <code>VITE_PUBLIC_WALK_URL</code> to the deployed walk page, or run{' '}
            <code>pnpm dev:phone</code> and open this app through your laptop&rsquo;s network
            address.
          </p>
        )}
        <div className="row center">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <a className="btn btn-ghost btn-small" href={url} target="_blank" rel="noreferrer">
            Open on this computer
          </a>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => dialog.current?.close()}
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
