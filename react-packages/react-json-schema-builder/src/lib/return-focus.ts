import { useRef } from "react"

// radix returns focus only to a DialogTrigger; the builder's dialogs open from plain buttons (#95)
export function useReturnFocus(
  onOpenAutoFocus?: (e: Event) => void,
  onCloseAutoFocus?: (e: Event) => void
) {
  const opener = useRef<HTMLElement | null>(null)

  return {
    onOpenAutoFocus(e: Event) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      onOpenAutoFocus?.(e)
    },
    onCloseAutoFocus(e: Event) {
      onCloseAutoFocus?.(e)
      if (e.defaultPrevented || !opener.current?.isConnected) return
      // leave focus alone if the app moved it elsewhere during the exit
      if (document.activeElement !== document.body && !(e.target instanceof Node && e.target.contains(document.activeElement))) return
      e.preventDefault()
      opener.current.focus()
    },
  }
}
