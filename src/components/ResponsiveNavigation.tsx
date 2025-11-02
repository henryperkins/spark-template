import React, { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { cn } from '@/lib/utils'

interface NavTab {
  value: string
  label: string
  icon: React.ReactNode
  content: React.ReactNode
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

  // Desktop: Horizontal Tabs
  const DesktopTabs = (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className={cn("hidden md:block", className)}
    >
      <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="flex items-center gap-2 transition-all duration-200"
          >
            {tab.icon}
            <span className="hidden lg:inline">{tab.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="animate-in fade-in-50 slide-in-from-bottom-2 duration-300"
        >
          {tab.content}
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
            className="bg-muted/50 rounded-lg border border-border overflow-hidden transition-all duration-200 hover:border-accent-9/50 data-[state=open]:border-accent-9 data-[state=open]:bg-accent-2/50"
          >
            <AccordionTrigger className="px-4 hover:no-underline hover:bg-accent-3/30 transition-colors">
              <div className="flex items-center gap-3 font-semibold text-foreground">
                <span className="text-accent-11 transition-transform duration-200 group-data-[state=open]:scale-110">
                  {tab.icon}
                </span>
                {tab.label}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4">
              <div className="animate-in fade-in-50 duration-200">
                {tab.content}
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
