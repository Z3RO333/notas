type LogLevel = 'info' | 'warn' | 'error'
type LogData = Record<string, unknown>

function log(level: LogLevel, message: string, data?: LogData | Error | unknown) {
  const timestamp = new Date().toISOString()
  const isDev = process.env.NODE_ENV !== 'production'

  if (isDev) {
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️'
    if (data instanceof Error) {
      console[level](`${prefix} [${timestamp}] ${message}`, data)
    } else {
      console[level](`${prefix} [${timestamp}] ${message}`, data ?? '')
    }
    return
  }

  // Produção: JSON estruturado
  const entry: Record<string, unknown> = { level, message, timestamp }
  if (data instanceof Error) {
    entry.error = { message: data.message, name: data.name }
  } else if (data && typeof data === 'object') {
    Object.assign(entry, data)
  }
  console[level](JSON.stringify(entry))
}

export const logger = {
  info: (message: string, data?: LogData) => log('info', message, data),
  warn: (message: string, data?: LogData | unknown) => log('warn', message, data),
  error: (message: string, data?: Error | LogData | unknown) => log('error', message, data),
}
