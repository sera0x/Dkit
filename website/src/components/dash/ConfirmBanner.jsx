import React, { useEffect, useRef, useState } from 'react';
import { TerminalSquare, X } from 'lucide-react';

export default function ConfirmBanner({ prompt, hint, onConfirm, onCancel }) {
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    if (value.trim() === prompt) { onConfirm(); return; }
    setWrong(false);
    void inputRef.current?.offsetWidth;
    setWrong(true);
    setValue('');
    inputRef.current?.focus();
  };

  return (
    <div className="confirm-banner" role="alertdialog" aria-label="Confirm deletion">
      <div className="confirm-banner-head">
        <span className="confirm-banner-icon"><TerminalSquare width="13" height="13" /></span>
        <span className="confirm-banner-label">confirm with a command</span>
        <button type="button" className="confirm-banner-close" aria-label="Cancel" onClick={onCancel}>
          <X width="14" height="14" />
        </button>
      </div>
      <p className="confirm-banner-hint">{hint}</p>
      <div className="confirm-banner-prompt">
        <span className="confirm-banner-ps1">$</span>
        <input
          ref={inputRef}
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          placeholder={prompt}
          value={value}
          onChange={(e) => { setValue(e.target.value); setWrong(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
        />
        <button type="button" className="confirm-banner-run" onClick={submit}>delete</button>
      </div>
    </div>
  );
}
