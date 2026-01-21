// Speaker colors for visual distinction across transcript displays

export interface SpeakerColors {
  bg: string
  border: string
  text: string
}

export const SPEAKER_COLORS: SpeakerColors[] = [
  { bg: '#e3f2fd', border: '#1976d2', text: '#0d47a1' }, // Blue - Speaker 0
  { bg: '#f3e5f5', border: '#7b1fa2', text: '#4a148c' }, // Purple - Speaker 1
  { bg: '#e8f5e9', border: '#388e3c', text: '#1b5e20' }, // Green - Speaker 2
  { bg: '#fff3e0', border: '#f57c00', text: '#e65100' }, // Orange - Speaker 3
  { bg: '#fce4ec', border: '#c2185b', text: '#880e4f' }, // Pink - Speaker 4
]

const UNKNOWN_SPEAKER_COLORS: SpeakerColors = {
  bg: '#f5f5f5',
  border: '#9e9e9e',
  text: '#616161',
}

export function getSpeakerColor(speaker: number | null): SpeakerColors {
  if (speaker === null) {
    return UNKNOWN_SPEAKER_COLORS
  }
  return SPEAKER_COLORS[speaker % SPEAKER_COLORS.length]
}

export function getSpeakerLabel(speaker: number | null): string {
  if (speaker === null) return 'Unknown'
  return `Speaker ${speaker + 1}`
}
