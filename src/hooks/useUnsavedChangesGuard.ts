import { useCallback, useState } from 'react'

interface UnsavedChangesGuardOptions {
  hasUnsavedChanges: boolean
  isBusy?: boolean
  onClose: () => void
  onSaveDraft?: () => void
  onDiscard?: () => void
}

/** Reusable close guard for operational forms that must protect in-progress edits. */
export function useUnsavedChangesGuard({
  hasUnsavedChanges,
  isBusy = false,
  onClose,
  onSaveDraft,
  onDiscard,
}: UnsavedChangesGuardOptions) {
  const [isPromptOpen, setPromptOpen] = useState(false)

  const requestClose = useCallback(() => {
    if (isBusy) return
    if (hasUnsavedChanges) {
      onSaveDraft?.()
      setPromptOpen(true)
      return
    }
    onClose()
  }, [hasUnsavedChanges, isBusy, onClose, onSaveDraft])

  const continueEditing = useCallback(() => setPromptOpen(false), [])
  const saveDraftAndClose = useCallback(() => {
    onSaveDraft?.()
    setPromptOpen(false)
    onClose()
  }, [onClose, onSaveDraft])
  const discardAndClose = useCallback(() => {
    onDiscard?.()
    setPromptOpen(false)
    onClose()
  }, [onClose, onDiscard])

  return { isPromptOpen, requestClose, continueEditing, saveDraftAndClose, discardAndClose }
}
