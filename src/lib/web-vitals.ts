import { errorTracking } from '@/lib/services/error-tracker'
import { telemetry } from '@/lib/services/telemetry'
import type { TelemetryEvent } from '@/types'

/**
 * Web Vitals instrumentation using PerformanceObserver API
 * Reports LCP, INP, and CLS metrics to telemetry and error tracking
 */

interface WebVitalsMetric {
  name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
  value: number
  id: string
  navigationType: 'navigate' | 'reload' | 'back-forward' | 'back-forward-cache' | 'prerender' | 'restore'
}

class WebVitalsService {
  private initialized = false

  /**
   * Initialize Web Vitals monitoring
   */
  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    // Use PerformanceObserver for modern browsers
    if ('PerformanceObserver' in window) {
      this.observeLCP()
      this.observeINP()
      this.observeCLS()
      this.observeFCP()
      this.observeTTFB()
    } else {
      // Fallback for older browsers
      this.measureNavigationTiming()
    }
  }

  private observeLCP(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const lastEntry = entries[entries.length - 1] as PerformanceEntry & { element?: Element }
        
        if (lastEntry) {
          this.reportMetric({
            name: 'LCP',
            value: lastEntry.startTime,
            id: `lcp-${Date.now()}`,
            navigationType: this.getNavigationType()
          })
        }
      })
      
      observer.observe({ entryTypes: ['largest-contentful-paint'] as any })
    } catch (error) {
      this.reportError(error, 'LCP observation failed')
    }
  }

  private observeINP(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const lastEntry = entries[entries.length - 1] as PerformanceEntry & { 
          interactionId?: number
          processingStart?: number
          processingEnd?: number
        }
        
        if (lastEntry && 'duration' in lastEntry) {
          this.reportMetric({
            name: 'INP',
            value: (lastEntry as any).duration,
            id: `inp-${Date.now()}-${lastEntry.interactionId || 'unknown'}`,
            navigationType: this.getNavigationType()
          })
        }
      })
      
      observer.observe({ entryTypes: ['first-input', 'event'] as any })
    } catch (error) {
      this.reportError(error, 'INP observation failed')
    }
  }

  private observeCLS(): void {
    try {
      let clsValue = 0
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // layout-shift entries expose hadRecentInput in modern browsers; cast to any for TS compatibility
          const shift = entry as any
          if (!shift.hadRecentInput) {
            clsValue += shift.value || 0
          }
        }
        
        this.reportMetric({
          name: 'CLS',
          value: clsValue,
          id: `cls-${Date.now()}`,
          navigationType: this.getNavigationType()
        })
      })
      
      observer.observe({ entryTypes: ['layout-shift'] as any })
    } catch (error) {
      this.reportError(error, 'CLS observation failed')
    }
  }

  private observeFCP(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const fcpEntry = entries.find(entry => entry.name === 'first-contentful-paint')
        
        if (fcpEntry) {
          this.reportMetric({
            name: 'FCP',
            value: fcpEntry.startTime,
            id: `fcp-${Date.now()}`,
            navigationType: this.getNavigationType()
          })
        }
      })
      
      observer.observe({ entryTypes: ['paint'] as any })
    } catch (error) {
      this.reportError(error, 'FCP observation failed')
    }
  }

  private observeTTFB(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const navEntry = entries.find(entry => entry.entryType === 'navigation')
        
        if (navEntry && 'responseStart' in navEntry) {
          this.reportMetric({
            name: 'TTFB',
            value: (navEntry as any).responseStart,
            id: `ttfb-${Date.now()}`,
            navigationType: this.getNavigationType()
          })
        }
      })
      
      observer.observe({ entryTypes: ['navigation'] as any })
    } catch (error) {
      this.reportError(error, 'TTFB observation failed')
    }
  }

  private measureNavigationTiming(): void {
    try {
      window.addEventListener('load', () => {
        const timing = performance.timing
        const navigation = performance.navigation
        
        // Calculate TTFB
        const ttfb = timing.responseStart - timing.navigationStart
        this.reportMetric({
          name: 'TTFB',
          value: ttfb,
          id: `ttfb-fallback-${Date.now()}`,
          navigationType: this.getNavigationType()
        })
        
        // Calculate FCP approximation
        const fcp = timing.domContentLoadedEventStart - timing.navigationStart
        this.reportMetric({
          name: 'FCP',
          value: fcp,
          id: `fcp-fallback-${Date.now()}`,
          navigationType: this.getNavigationType()
        })
      })
    } catch (error) {
      this.reportError(error, 'Navigation timing measurement failed')
    }
  }

  private getNavigationType(): WebVitalsMetric['navigationType'] {
    const nav = performance.getEntriesByType('navigation')[0] as any
    if (nav && nav.type) {
      return nav.type
    }
    return 'navigate'
  }

  private reportMetric(metric: WebVitalsMetric): void {
    // Report to telemetry service
    const telemetryEvent: TelemetryEvent = {
      type: 'web_vitals',
      timestamp: new Date().toISOString(),
      data: {
        metric: metric.name,
        value: metric.value,
        id: metric.id,
        navigationType: metric.navigationType
      }
    }
    
    telemetry.trackAgentStep({
      type: 'agent_step_status',
      runId: `web-vitals-${Date.now()}`,
      query: 'web-vitals-monitoring',
      agent: 'WebVitalsService',
      action: `metric_${metric.name}`,
      status: 'completed',
      stepIndex: 0,
      timestamp: new Date().toISOString(),
      metadata: {
        source: 'web-vitals',
        metricName: metric.name,
        metricValue: metric.value,
        navigationType: metric.navigationType
      }
    })

    // Report to error tracking for threshold violations
    if (this.isPoorMetric(metric)) {
      const error = new Error(`Poor ${metric.name} metric: ${metric.value}`)
      errorTracking.record(error, {
        type: 'performance',
        agent: 'WebVitalsService',
        code: `poor_${metric.name.toLowerCase()}`,
        status: 500
      })
    }
  }

  private reportError(error: unknown, context: string): void {
    if (error instanceof Error) {
      errorTracking.record(error, {
        type: 'runtime',
        agent: 'WebVitalsService',
        code: 'web_vitals_error',
        status: 500
      })
    }
  }

  private isPoorMetric(metric: WebVitalsMetric): boolean {
    const thresholds = {
      LCP: 2500, // > 2.5s is poor
      INP: 200,  // > 200ms is poor
      CLS: 0.1,  // > 0.1 is poor
      FCP: 1800, // > 1.8s is poor
      TTFB: 800  // > 800ms is poor
    }
    
    return metric.value > thresholds[metric.name]
  }
}

export const webVitals = new WebVitalsService()