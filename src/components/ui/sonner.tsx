import { useTheme } from "@/hooks/use-theme"
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { Toaster as Sonner, ToasterProps, ToastT, useSonner } from "sonner"

type LiveRole = "status" | "alert"
type LiveMode = "polite" | "assertive"

const getRoleForToast = (type?: ToastT["type"]): LiveRole => {
  if (type === "error" || type === "warning") {
    return "alert"
  }
  return "status"
}

const getMessageForToast = (toast: ToastT): string | null => {
  const extract = (value: ToastT["title"] | ToastT["description"]): string | null => {
    if (typeof value === "string" || typeof value === "number") {
      return String(value)
    }

    if (Array.isArray(value)) {
      const parts = value
        .map(part => (typeof part === "string" || typeof part === "number" ? String(part) : ""))
        .filter(Boolean)
      return parts.length ? parts.join(" ") : null
    }

    if (typeof value === "function") {
      try {
        const result = value()
        return typeof result === "string" || typeof result === "number" ? String(result) : null
      } catch {
        return null
      }
    }

    return null
  }

  const fallback = toast.type ? `Notification ${toast.type}` : null
  return extract(toast.title) ?? extract(toast.description) ?? fallback
}

const ToastAnnouncements = () => {
  const { toasts } = useSonner()
  const lastAnnouncedId = useRef<ToastT["id"] | null>(null)
  const [announcement, setAnnouncement] = useState<{
    id: ToastT["id"]
    message: string
    role: LiveRole
    live: LiveMode
  } | null>(null)

  useEffect(() => {
    if (!toasts.length) {
      return
    }

    const latest = toasts[toasts.length - 1]
    if (!latest || latest.id === undefined || latest.id === lastAnnouncedId.current) {
      return
    }

    const message = getMessageForToast(latest)
    if (!message) {
      lastAnnouncedId.current = latest.id
      setAnnouncement(null)
      return
    }

    const role = getRoleForToast(latest.type)
    const live: LiveMode = role === "alert" ? "assertive" : "polite"

    lastAnnouncedId.current = latest.id
    setAnnouncement({
      id: latest.id,
      message,
      role,
      live,
    })
  }, [toasts])

  const ariaLive = announcement?.live ?? "polite"
  const ariaRole = announcement?.role ?? "status"

  return (
    <div
      aria-live={ariaLive}
      role={ariaRole}
      className="sr-only"
    >
      {announcement?.message ?? ""}
    </div>
  )
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const theme = useMemo<NonNullable<ToasterProps["theme"]>>(() => {
    if (resolvedTheme === "light" || resolvedTheme === "dark") {
      return resolvedTheme
    }
    if (resolvedTheme === "system") {
      return "system"
    }
    return "system"
  }, [resolvedTheme])

  return (
    <>
      <Sonner
        theme={theme}
        className="toaster group"
        containerAriaLabel="Notifications"
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
          } as CSSProperties
        }
        {...props}
      />
      <ToastAnnouncements />
    </>
  )
}

export { Toaster }
