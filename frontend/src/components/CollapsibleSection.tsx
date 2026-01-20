import { ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  count?: number
  expanded: boolean
  onToggle: () => void
  headerRight?: ReactNode
  children: ReactNode
}

export function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  headerRight,
  children,
}: CollapsibleSectionProps) {
  return (
    <section style={{ marginBottom: '20px' }}>
      <div
        onClick={onToggle}
        style={{
          background: '#f5f5f5',
          padding: '12px 16px',
          borderRadius: expanded ? '8px 8px 0 0' : '8px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-block',
              fontSize: '12px',
              color: '#666',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ▶
          </span>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{title}</h3>
          {count !== undefined && (
            <span style={{ color: '#666', fontSize: '14px' }}>({count})</span>
          )}
        </div>
        {headerRight && (
          <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>
        )}
      </div>

      {expanded && (
        <div
          style={{
            background: '#fafafa',
            border: '1px solid #e0e0e0',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            padding: '16px',
          }}
        >
          {children}
        </div>
      )}
    </section>
  )
}
