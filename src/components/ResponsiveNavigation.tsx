import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { cn } from '@/lib/utils'

interface NavTab {
  value: string
  label: string
  icon: ReactNode
  render: () => ReactNode
  preload?: () => void
}

interface ResponsiveNavigationProps {
  tabs: NavTab[]
  defaultValue: string
  className?: string
}

export function ResponsiveNavigation({
  tabs,
  defaultValue,
  className
}: ResponsiveNavigationProps) {
  const [activeTab, setActiveTab] = useState(defaultValue)
  const [mountedTabs, setMountedTabs] = useState<Record<string, ReactNode>>(() => {
    const initialTab = tabs.find((tab) => tab.value === defaultValue)
    return initialTab ? { [defaultValue]: initialTab.render() } : {}
  })

  // Keep activeTab in sync if defaultValue changes (e.g. on hot reload or config change)
  useEffect(() => {
    setActiveTab((current) => {
      // If the current active tab is no longer present, or was never initialized, fall back
      const stillExists = tabs.some((tab) => tab.value === current)
      if (!stillExists) {
        return defaultValue
      }
      return current
    })
  }, [defaultValue, tabs])

  // Lazily mount tab content and cache it so switching tabs feels snappy
  useEffect(() => {
    const next = tabs.find((tab) => tab.value === activeTab)
    if (!next) return

    setMountedTabs((prev) => {
      if (prev[activeTab]) {
        return prev
      }
      return {
        ...prev,
        [activeTab]: next.render()
      }
    })
  }, [activeTab, tabs])

  const getContent = useMemo(() => {
    return (value: string) => mountedTabs[value] ?? null
  }, [mountedTabs])

  // Desktop: Horizontal Tabs
  const DesktopTabs = (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className={cn("hidden md:block", className)}
    >
      <TabsList
        className="grid h-auto w-full gap-2 rounded-xl bg-muted/60 p-1 shadow-sm ring-1 ring-border/40 backdrop-blur-sm"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium transition-all duration-200 sm:gap-2 sm:px-3 sm:text-sm"
            aria-label={tab.label}
            onMouseEnter={tab.preload}
            onFocus={tab.preload}
          >
            {tab.icon}
            <span className="hidden md:inline">{tab.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="animate-in fade-in-50 slide-in-from-bottom-2 duration-300"
        >
          {getContent(tab.value)}
        </TabsContent>
      ))}
    </Tabs>
  )

  // Mobile: Vertical Accordion
  const MobileAccordion = (
    <div className={cn("md:hidden", className)}>
      <Accordion
        type="single"
        value={activeTab}
        onValueChange={(value) => value && setActiveTab(value)}
        collapsible
        className="w-full space-y-2"
      >
        {tabs.map((tab) => (
          <AccordionItem
            key={tab.value}
            value={tab.value}
            className="group bg-muted/50 rounded-lg border border-border overflow-hidden transition-all duration-200 hover:border-accent-9/50 data-[state=open]:border-accent-9 data-[state=open]:bg-accent-2/50"
          >
            <AccordionTrigger
              className="px-4 hover:no-underline hover:bg-accent-3/30 transition-colors"
              onMouseEnter={tab.preload}
              onFocus={tab.preload}
            >
              <div className="flex items-center gap-3 font-semibold text-foreground">
                <span className="text-accent-11 transition-transform duration-200 group-data-[state=open]:scale-110">
                  {tab.icon}
                </span>
                {tab.label}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="animate-in fade-in-50 duration-200">
                {getContent(tab.value)}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )

  return (
    <>
      {DesktopTabs}
      {MobileAccordion}
    </>
  )
}
