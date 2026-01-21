/**
 * ChunkAnnotation Component
 *
 * Displays analysis results for a stream chunk:
 * - Topics as colored tags
 * - Intents as icon labels
 * - Summary on hover
 */

interface Topic {
  topic: string
  confidence: number
}

interface Intent {
  intent: string
  confidence: number
}

export interface ChunkSentiment {
  sentiment: 'positive' | 'negative' | 'neutral'
  sentimentScore: number
  average: {
    sentiment: 'positive' | 'negative' | 'neutral'
    sentimentScore: number
  }
}

export interface ChunkAnnotationData {
  id: number
  topics: Topic[]
  intents: Intent[]
  summary: string
  sentiment: ChunkSentiment | null
}

interface ChunkAnnotationProps {
  annotation: ChunkAnnotationData | null
  isLoading?: boolean
}

// Topic tag colors (cycle through these)
const TOPIC_COLORS = [
  { bg: '#e3f2fd', text: '#1565c0' },
  { bg: '#f3e5f5', text: '#7b1fa2' },
  { bg: '#e8f5e9', text: '#2e7d32' },
  { bg: '#fff3e0', text: '#ef6c00' },
  { bg: '#fce4ec', text: '#c2185b' },
]

// Intent icons mapped to common intents
const INTENT_ICONS: Record<string, string> = {
  question: '?',
  statement: '-',
  request: '->',
  greeting: 'Hi',
  introduction: 'i',
  opinion: '*',
  explanation: 'E',
  clarification: '!',
  agreement: '+',
  disagreement: 'x',
  suggestion: 'S',
  command: '>',
}

function getIntentIcon(intent: string): string {
  // Check for partial matches in common intents
  const normalizedIntent = intent.toLowerCase()
  for (const [key, icon] of Object.entries(INTENT_ICONS)) {
    if (normalizedIntent.includes(key)) {
      return icon
    }
  }
  // Default: first letter
  return intent.charAt(0).toUpperCase()
}

export function ChunkAnnotation({ annotation, isLoading }: ChunkAnnotationProps) {
  if (isLoading) {
    return (
      <div
        style={{
          padding: '8px',
          color: '#999',
          fontSize: '12px',
          fontStyle: 'italic',
        }}
      >
        Analyzing...
      </div>
    )
  }

  if (!annotation) {
    return null
  }

  const { topics, intents, summary } = annotation

  // Filter to top items by confidence
  const topTopics = topics.slice(0, 3)
  const topIntents = intents.slice(0, 2)

  return (
    <div
      style={{
        padding: '8px',
        fontSize: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
      title={summary || 'No summary available'}
    >
      {/* Topics */}
      {topTopics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {topTopics.map((topic, index) => {
            const colors = TOPIC_COLORS[index % TOPIC_COLORS.length]
            return (
              <span
                key={`${index}-${topic.topic}`}
                style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  background: colors.bg,
                  color: colors.text,
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 500,
                  maxWidth: '100px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${topic.topic} (${Math.round(topic.confidence * 100)}%)`}
              >
                {topic.topic}
              </span>
            )
          })}
        </div>
      )}

      {/* Intents */}
      {topIntents.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {topIntents.map((intent, index) => (
            <span
              key={`${index}-${intent.intent}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2px 6px',
                background: '#f5f5f5',
                color: '#666',
                borderRadius: '4px',
                fontSize: '10px',
              }}
              title={`Intent: ${intent.intent} (${Math.round(intent.confidence * 100)}%)`}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '14px',
                  height: '14px',
                  background: '#e0e0e0',
                  borderRadius: '50%',
                  fontSize: '9px',
                  fontWeight: 600,
                }}
              >
                {getIntentIcon(intent.intent)}
              </span>
              {intent.intent}
            </span>
          ))}
        </div>
      )}

      {/* Sentiment indicator */}
      {annotation.sentiment && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              padding: '2px 6px',
              background:
                annotation.sentiment.sentiment === 'positive'
                  ? '#e8f5e9'
                  : annotation.sentiment.sentiment === 'negative'
                  ? '#ffebee'
                  : '#f5f5f5',
              color:
                annotation.sentiment.sentiment === 'positive'
                  ? '#2e7d32'
                  : annotation.sentiment.sentiment === 'negative'
                  ? '#c62828'
                  : '#666',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 500,
            }}
            title={`Sentiment: ${annotation.sentiment.sentiment} (score: ${annotation.sentiment.sentimentScore.toFixed(2)})`}
          >
            {annotation.sentiment.sentiment === 'positive'
              ? '+'
              : annotation.sentiment.sentiment === 'negative'
              ? '-'
              : '~'}
            {' '}
            {annotation.sentiment.sentiment}
          </span>
        </div>
      )}

      {/* Summary indicator (full summary on hover) */}
      {summary && (
        <div
          style={{
            color: '#888',
            fontSize: '10px',
            fontStyle: 'italic',
            cursor: 'help',
          }}
          title={summary}
        >
          Hover for summary
        </div>
      )}
    </div>
  )
}

// Loading skeleton for annotations
export function ChunkAnnotationSkeleton() {
  return (
    <div
      style={{
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', gap: '4px' }}>
        <div
          style={{
            width: '50px',
            height: '18px',
            background: '#e0e0e0',
            borderRadius: '12px',
            animation: 'skeleton-pulse 1.5s infinite',
          }}
        />
        <div
          style={{
            width: '40px',
            height: '18px',
            background: '#e0e0e0',
            borderRadius: '12px',
            animation: 'skeleton-pulse 1.5s infinite',
            animationDelay: '0.2s',
          }}
        />
      </div>
      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}
