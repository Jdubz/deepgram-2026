/**
 * Format file size in human-readable form
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

/**
 * Format ISO timestamp to local time string
 */
export function formatTime(isoString: string | null): string {
  if (!isoString) return '-'
  return new Date(isoString).toLocaleTimeString()
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
