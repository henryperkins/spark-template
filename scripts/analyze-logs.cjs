#!/usr/bin/env node
/**
 * Log Analysis Utility for Cloudflare Worker Logs
 *
 * This script provides tools to query, filter, and analyze logs using:
 * 1. Worker API endpoint (/api/logs) - Recommended, easiest
 * 2. Wrangler tail - Real-time streaming
 *
 * Usage:
 *   npm run logs [command] [options]
 *
 * Commands:
 *   recent            - Get recent logs from worker API
 *   analyze           - Analyze logs with filtering and statistics
 *   errors            - Show only error-level logs
 *   performance       - Show performance metrics
 *   watch             - Watch logs in real-time (uses wrangler tail)
 *
 * Environment Variables:
 *   LOGS_API_KEY      - Bearer token for /api/logs endpoint
 */

const { execSync, spawn } = require('child_process')
const https = require('https')

// Configuration
const WORKER_URL = process.env.WORKER_URL || 'https://paradigmfind.com'
const LOGS_API_KEY = process.env.LOGS_API_KEY || ''

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
}

function colorize(text, color) {
  return `${colors[color] || ''}${text}${colors.reset}`
}

// HTTP helpers
function fetchLogs(action = 'recent', params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ action, ...params }).toString()
    const url = `${WORKER_URL}/api/logs?${query}`

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${LOGS_API_KEY}`
      }
    }

    https.get(url, options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        } else {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`))
          }
        }
      })
    }).on('error', reject)
  })
}

// Command handlers
async function getRecentLogs(limit = 100) {
  if (!LOGS_API_KEY) {
    console.log(colorize('\n⚠️  LOGS_API_KEY environment variable not set', 'yellow'))
    console.log(colorize('    Using wrangler tail instead...\n', 'dim'))
    return watchLogs(limit)
  }

  console.log(colorize(`\n📥 Fetching ${limit} most recent log entries from worker API...`, 'cyan'))

  try {
    const response = await fetchLogs('recent', { limit })

    if (!response.logs || response.logs.length === 0) {
      console.log(colorize('\n⚠️  No logs found', 'yellow'))
      return []
    }

    console.log(colorize(`\n📊 Displaying ${response.logs.length} recent logs:\n`, 'green'))

    response.logs.forEach(log => {
      displayLog(log)
    })

    return response.logs
  } catch (error) {
    console.error(colorize('\n❌ Error fetching logs:', 'red'), error.message)
    console.log(colorize('\n💡 Make sure LOGS_API_KEY environment variable is set correctly', 'yellow'))
    console.log(colorize('   Or use: npm run logs:watch for real-time tail', 'dim'))
    return []
  }
}

function displayLog(log) {
  if (log.timestamp && log.event) {
    // Structured log from worker
    displayStructuredLog(log)
  } else if (log.raw) {
    // Raw log line
    console.log(colorize(log.raw, 'dim'))
  } else {
    // Unknown format
    console.log(JSON.stringify(log, null, 2))
  }
}

function displayStructuredLog(log) {
  const levelColors = {
    info: 'blue',
    warn: 'yellow',
    error: 'red',
    debug: 'dim'
  }

  const level = log.level || 'info'
  const color = levelColors[level] || 'white'
  const timestamp = new Date(log.timestamp).toLocaleTimeString()

  const prefix = `${colorize(timestamp, 'dim')} ${colorize(level.toUpperCase().padEnd(5), color)}`
  const event = colorize(log.event || 'unknown', 'cyan')

  let details = ''
  if (log.method && log.path) {
    details = ` ${colorize(log.method, 'magenta')} ${log.path}`
  }
  if (log.duration !== undefined) {
    details += ` ${colorize(`(${log.duration}ms)`, 'yellow')}`
  }
  if (log.statusCode) {
    const statusColor = log.statusCode >= 400 ? 'red' : 'green'
    details += ` ${colorize(log.statusCode, statusColor)}`
  }
  if (log.error) {
    details += ` ${colorize(`ERROR: ${log.error}`, 'red')}`
  }

  console.log(`${prefix} ${event}${details}`)

  if (log.metadata) {
    console.log(colorize(`  ${JSON.stringify(log.metadata)}`, 'dim'))
  }
}

async function analyzeLogs(limit = 1000) {
  console.log(colorize('\n🔍 Analyzing logs...', 'cyan'))

  const logs = await getRecentLogs(limit)
  if (!logs || logs.length === 0) return

  console.log(colorize(`\n📊 Statistics from ${logs.length} log entries:\n`, 'green'))

  // Event distribution
  const events = {}
  const levels = { info: 0, warn: 0, error: 0, debug: 0 }
  const durations = []
  const statusCodes = {}

  logs.forEach(log => {
    if (log.event) {
      events[log.event] = (events[log.event] || 0) + 1
    }
    if (log.level) {
      levels[log.level] = (levels[log.level] || 0) + 1
    }
    if (log.duration !== undefined) {
      durations.push(log.duration)
    }
    if (log.statusCode) {
      statusCodes[log.statusCode] = (statusCodes[log.statusCode] || 0) + 1
    }
  })

  // Display statistics
  console.log(colorize('📌 Event Distribution:', 'bright'))
  Object.entries(events)
    .sort((a, b) => b[1] - a[1])
    .forEach(([event, count]) => {
      const maxCount = Math.max(...Object.values(events))
      const bar = '█'.repeat(Math.min(50, Math.floor(count / maxCount * 50)))
      console.log(`  ${event.padEnd(30)} ${bar} ${colorize(count, 'cyan')}`)
    })

  console.log(colorize('\n📊 Log Levels:', 'bright'))
  Object.entries(levels).forEach(([level, count]) => {
    if (count > 0) {
      const color = level === 'error' ? 'red' : level === 'warn' ? 'yellow' : 'blue'
      console.log(`  ${level.toUpperCase().padEnd(10)} ${colorize(count, color)}`)
    }
  })

  if (durations.length > 0) {
    console.log(colorize('\n⏱️  Performance Metrics:', 'bright'))
    const sorted = durations.sort((a, b) => a - b)
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length
    const max = Math.max(...durations)
    const min = Math.min(...durations)
    const p50 = sorted[Math.floor(sorted.length * 0.50)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]

    console.log(`  Min:     ${colorize(min.toFixed(2) + 'ms', 'green')}`)
    console.log(`  P50:     ${colorize(p50.toFixed(2) + 'ms', 'cyan')}`)
    console.log(`  Average: ${colorize(avg.toFixed(2) + 'ms', 'cyan')}`)
    console.log(`  P95:     ${colorize(p95.toFixed(2) + 'ms', 'yellow')}`)
    console.log(`  P99:     ${colorize(p99.toFixed(2) + 'ms', 'yellow')}`)
    console.log(`  Max:     ${colorize(max.toFixed(2) + 'ms', 'red')}`)
  }

  if (Object.keys(statusCodes).length > 0) {
    console.log(colorize('\n📈 Status Codes:', 'bright'))
    Object.entries(statusCodes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([code, count]) => {
        const color = code >= 400 ? 'red' : code >= 300 ? 'yellow' : 'green'
        console.log(`  ${code.padEnd(10)} ${colorize(count, color)}`)
      })
  }
}

async function showErrors(limit = 1000) {
  console.log(colorize('\n🚨 Fetching error logs...', 'red'))

  const logs = await getRecentLogs(limit)
  if (!logs || logs.length === 0) return

  const errors = logs.filter(log => log.level === 'error' || log.statusCode >= 400)

  if (errors.length === 0) {
    console.log(colorize('\n✅ No errors found in recent logs!', 'green'))
    return
  }

  console.log(colorize(`\n❌ Found ${errors.length} errors:\n`, 'red'))
  errors.forEach(error => {
    displayLog(error)
  })
}

async function showPerformance(limit = 1000) {
  console.log(colorize('\n⚡ Performance Analysis...', 'cyan'))

  const logs = await getRecentLogs(limit)
  if (!logs || logs.length === 0) return

  const slowRequests = logs
    .filter(log => log.duration && log.duration > 1000) // > 1 second
    .map(log => ({
      event: log.event,
      method: log.method,
      path: log.path,
      duration: log.duration,
      statusCode: log.statusCode,
      timestamp: log.timestamp
    }))

  if (slowRequests.length === 0) {
    console.log(colorize('\n✅ No slow requests detected (all < 1s)', 'green'))

    // Show top 5 slowest even if under 1s
    const sorted = logs
      .filter(log => log.duration !== undefined)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)

    if (sorted.length > 0) {
      console.log(colorize('\n📊 Top 5 slowest requests:', 'blue'))
      sorted.forEach((log, i) => {
        console.log(`  ${i + 1}. ${colorize(log.duration + 'ms', 'yellow')} - ${log.event} ${log.path || ''}`)
      })
    }
    return
  }

  console.log(colorize(`\n⚠️  Found ${slowRequests.length} slow requests (>1s):\n`, 'yellow'))

  slowRequests
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10)
    .forEach((req, i) => {
      console.log(`  ${i + 1}. ${colorize((req.duration / 1000).toFixed(2) + 's', 'red')} - ${req.event}`)
      console.log(`     ${req.method || ''} ${req.path || ''} ${req.statusCode ? colorize(req.statusCode, 'yellow') : ''}`)
      console.log(`     ${colorize(new Date(req.timestamp).toLocaleString(), 'dim')}`)
    })
}

function watchLogs() {
  console.log(colorize('\n👀 Watching logs in real-time (Ctrl+C to stop)...\n', 'cyan'))

  const tail = spawn('wrangler', ['tail', '--format', 'pretty'], {
    stdio: 'inherit',
    cwd: process.cwd()
  })

  tail.on('error', (error) => {
    console.error(colorize('❌ Error starting wrangler tail:', 'red'), error.message)
  })

  tail.on('close', (code) => {
    console.log(colorize(`\n✋ Stopped watching logs (exit code: ${code})`, 'dim'))
  })
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'help'

  console.log(colorize('╔════════════════════════════════════════╗', 'cyan'))
  console.log(colorize('║   Cloudflare Worker Log Analyzer      ║', 'cyan'))
  console.log(colorize('╚════════════════════════════════════════╝', 'cyan'))

  switch (command) {
    case 'recent':
      const limit = parseInt(args[1]) || 100
      await getRecentLogs(limit)
      break
    case 'analyze':
      const analyzeLimit = parseInt(args[1]) || 1000
      await analyzeLogs(analyzeLimit)
      break
    case 'errors':
      const errorLimit = parseInt(args[1]) || 1000
      await showErrors(errorLimit)
      break
    case 'performance':
    case 'perf':
      const perfLimit = parseInt(args[1]) || 1000
      await showPerformance(perfLimit)
      break
    case 'watch':
      watchLogs()
      break
    case 'help':
    default:
      console.log(`
${colorize('Available Commands:', 'bright')}

  ${colorize('recent [n]', 'green')}        - Get n most recent log entries (default: 100)
  ${colorize('analyze [n]', 'green')}       - Analyze n logs with statistics (default: 1000)
  ${colorize('errors [n]', 'green')}        - Show error logs from n recent entries (default: 1000)
  ${colorize('performance [n]', 'green')}   - Show performance metrics from n logs (default: 1000)
  ${colorize('watch', 'green')}             - Watch logs in real-time (uses wrangler tail)

${colorize('Examples:', 'bright')}

  npm run logs:recent        # Show 100 recent logs
  npm run logs:analyze       # Analyze 1000 recent logs with stats
  npm run logs:errors        # Show only errors
  npm run logs:perf          # Show performance analysis
  npm run logs:watch         # Real-time log streaming

${colorize('Environment Variables:', 'bright')}

  ${colorize('LOGS_API_KEY', 'yellow')}     - Required for API access (get from wrangler secret)
  ${colorize('WORKER_URL', 'yellow')}       - Worker URL (default: https://paradigmfind.com)

${colorize('Setup:', 'bright')}

  1. Set LOGS_API_KEY in your environment:
     ${colorize('export LOGS_API_KEY="your-logs-api-key-here"', 'dim')}

  2. Or use wrangler tail (no API key required):
     ${colorize('npm run logs:watch', 'dim')}
`)
      break
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error(colorize('\n❌ Fatal error:', 'red'), error)
    process.exit(1)
  })
}

module.exports = { analyzeLogs, getRecentLogs, showErrors, showPerformance }
