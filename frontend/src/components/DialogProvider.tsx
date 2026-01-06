import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type DialogTone = 'default' | 'danger'

type DialogRequest =
  | { type: 'alert'; title: string; message: string; tone?: DialogTone; confirmLabel?: string }
  | { type: 'confirm'; title: string; message: string; tone?: DialogTone; confirmLabel?: string; cancelLabel?: string }

type DialogContextValue = {
  alert: (opts: { title: string; message: string; tone?: DialogTone; confirmLabel?: string }) => Promise<void>
  confirm: (opts: { title: string; message: string; tone?: DialogTone; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined)

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const alertResolverRef = useRef<((value: void | PromiseLike<void>) => void) | null>(null)
  const confirmResolverRef = useRef<((value: boolean | PromiseLike<boolean>) => void) | null>(null)

  const close = useCallback(() => {
    setRequest(null)
    alertResolverRef.current = null
    confirmResolverRef.current = null
  }, [])

  const alert = useCallback((opts: { title: string; message: string; tone?: DialogTone; confirmLabel?: string }) => {
    return new Promise<void>((resolve) => {
      alertResolverRef.current = resolve
      setRequest({ type: 'alert', ...opts })
    })
  }, [])

  const confirm = useCallback((opts: { title: string; message: string; tone?: DialogTone; confirmLabel?: string; cancelLabel?: string }) => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve
      setRequest({ type: 'confirm', ...opts })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    if (alertResolverRef.current) {
      alertResolverRef.current()
    } else if (confirmResolverRef.current) {
      confirmResolverRef.current(true)
    }
    close()
  }, [close])

  const handleCancel = useCallback(() => {
    confirmResolverRef.current?.(false)
    close()
  }, [close])

  const value = useMemo(() => ({ alert, confirm }), [alert, confirm])

  return (
    <DialogContext.Provider value={value}>
      {children}
      {request && (
        <DialogOverlay onClose={request.type === 'confirm' ? handleCancel : handleConfirm}>
          {request.type === 'alert' ? (
            <AlertDialog
              title={request.title}
              message={request.message}
              tone={request.tone}
              confirmLabel={request.confirmLabel}
              onConfirm={handleConfirm}
            />
          ) : (
            <ConfirmDialog
              title={request.title}
              message={request.message}
              tone={request.tone}
              confirmLabel={request.confirmLabel}
              cancelLabel={request.cancelLabel}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          )}
        </DialogOverlay>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogProvider')
  return ctx
}

function DialogOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <div ref={contentRef} className="dialog-card">
        {children}
      </div>
    </div>,
    document.body,
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="dialog-title">{children}</h2>
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="dialog-body">{children}</p>
}

export function ConfirmDialog({ title, message, tone = 'default', confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }: { title: string; message: string; tone?: DialogTone; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="dialog-content">
      <Title>{title}</Title>
      <Body>{message}</Body>
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
        <button className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  )
}

export function AlertDialog({ title, message, tone = 'default', confirmLabel = 'OK', onConfirm }: { title: string; message: string; tone?: DialogTone; confirmLabel?: string; onConfirm: () => void }) {
  return (
    <div className="dialog-content">
      <Title>{title}</Title>
      <Body>{message}</Body>
      <div className="dialog-actions" style={{ justifyContent: 'flex-end' }}>
        <button className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  )
}
