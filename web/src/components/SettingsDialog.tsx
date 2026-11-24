import { useRef, type ReactNode } from 'react';
import { Dialog } from '@animate-ui/react/primitives/radix-ui/dialog';
import { X } from 'lucide-react';

export function SettingsDialog({
  title,
  onClose,
  children,
  size = 'default',
  closeLabel = '关闭设置',
  returnFocusTarget,
}: {
  size?: 'default' | 'compact' | 'wide';
  closeLabel?: string;
  returnFocusTarget?: HTMLElement | null;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const returnFocus = useRef(returnFocusTarget ?? (document.activeElement as HTMLElement | null));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay" />
        <Dialog.Content
          className={`settings-dialog${size === 'default' ? '' : ` ${size}`}`}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="settings-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label={closeLabel}>
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
