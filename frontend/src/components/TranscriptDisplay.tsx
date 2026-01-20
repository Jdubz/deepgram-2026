import { useRef, useEffect } from 'react'

export interface TranscriptEntry {
  id: string
  speaker: number | null
  text: string
  confidence: number
  isFinal: boolean
  timestamp: number
}

// Speaker colors for visual distinction
const SPEAKER_COLORS = [
  { bg: '#e3f2fd', border: '#1976d2', text: '#0d47a1' }, // Blue - Speaker 0
  { bg: '#f3e5f5', border: '#7b1fa2', text: '#4a148c' }, // Purple - Speaker 1
  { bg: '#e8f5e9', border: '#388e3c', text: '#1b5e20' }, // Green - Speaker 2
  { bg: '#fff3e0', border: '#f57c00', text: '#e65100' }, // Orange - Speaker 3
  { bg: '#fce4ec', border: '#c2185b', text: '#880e4f' }, // Pink - Speaker 4
]

function getSpeakerColor(speaker: number | null) {
  if (speaker === null) {
    return { bg: '#f5f5f5', border: '#9e9e9e', text: '#616161' }
  }
  return SPEAKER_COLORS[speaker % SPEAKER_COLORS.length]
}

function getSpeakerLabel(speaker: number | null): string {
  if (speaker === null) return 'Unknown'
  return `Speaker ${speaker + 1}`
}

interface TranscriptDisplayProps {
  entries: TranscriptEntry[]
  autoScroll?: boolean
  showInterim?: boolean
  maxHeight?: string
}

export function TranscriptDisplay({
  entries,
  autoScroll = true,
  showInterim = true,
  maxHeight = '400px',
}: TranscriptDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [entries, autoScroll])

  // Filter entries based on showInterim setting
  const visibleEntries = showInterim
    ? entries
    : entries.filter((e) => e.isFinal)

  // Group consecutive entries by speaker for better readability
  const groupedEntries: { speaker: number | null; entries: TranscriptEntry[] }[] = []
  for (const entry of visibleEntries) {
    const lastGroup = groupedEntries[groupedEntries.length - 1]
    if (lastGroup && lastGroup.speaker === entry.speaker) {
      lastGroup.entries.push(entry)
    } else {
      groupedEntries.push({ speaker: entry.speaker, entries: [entry] })
    }
  }

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: '24px',
          textAlign: 'center',
          color: '#666',
          background: '#fafafa',
          borderRadius: '8px',
          border: '1px dashed #ddd',
        }}
      >
        Waiting for transcription...
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        maxHeight,
        overflowY: 'auto',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '16px',
        background: '#fafafa',
      }}
    >
      {groupedEntries.map((group, groupIndex) => {
        const colors = getSpeakerColor(group.speaker)
        const label = getSpeakerLabel(group.speaker)

        return (
          <div
            key={groupIndex}
            style={{
              marginBottom: '12px',
              padding: '12px',
              background: colors.bg,
              borderLeft: `3px solid ${colors.border}`,
              borderRadius: '4px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: colors.text,
                marginBottom: '4px',
              }}
            >
              {label}
            </div>
            <div style={{ color: '#333', lineHeight: 1.5 }}>
              {group.entries.map((entry, entryIndex) => (
                <span
                  key={entry.id}
                  style={{
                    opacity: entry.isFinal ? 1 : 0.6,
                    fontStyle: entry.isFinal ? 'normal' : 'italic',
                  }}
                >
                  {entry.text}
                  {entryIndex < group.entries.length - 1 ? ' ' : ''}
                </span>
              ))}
              {/* Show typing indicator for interim results */}
              {group.entries.some((e) => !e.isFinal) && (
                <span
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '16px',
                    background: colors.border,
                    marginLeft: '2px',
                    animation: 'blink 1s infinite',
                  }}
                />
              )}
            </div>
          </div>
        )
      })}

      {/* CSS for blinking cursor */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
