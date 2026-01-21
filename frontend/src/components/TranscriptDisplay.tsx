import { useRef, useEffect } from 'react'
import { getSpeakerColor, getSpeakerLabel } from '../utils/speaker'

export interface TranscriptEntry {
  id: string
  speaker: number | null
  text: string
  confidence: number
  isFinal: boolean
  timestamp: number
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
