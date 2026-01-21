/**
 * Format file size in human-readable form
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format duration in human-readable form (e.g., "1m 30s")
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

/**
 * Format duration as clock time (e.g., "01:30")
 */
export function formatDurationClock(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Format timestamp to local time string
 * SQLite stores UTC times without timezone indicator, so we append 'Z' if needed
 */
export function formatTime(timestamp: string | null): string {
  if (!timestamp) return '-'
  // If timestamp lacks timezone info, treat it as UTC by appending 'Z'
  const utcTimestamp = timestamp.includes('Z') || timestamp.includes('+') || timestamp.includes('-', 10)
    ? timestamp
    : timestamp.replace(' ', 'T') + 'Z'
  return new Date(utcTimestamp).toLocaleTimeString()
}

/**
 * Get color for job/file status
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return '#4caf50'
    case 'processing':
      return '#2196f3'
    case 'pending':
      return '#ff9800'
    case 'failed':
      return '#f44336'
    default:
      return '#666'
  }
}
