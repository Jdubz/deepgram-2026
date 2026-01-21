import { useEffect, useRef, useState, useCallback } from 'react'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface UseWebSocketOptions<TMessage = unknown> {
  path: string
  enabled?: boolean
  autoReconnect?: boolean
  reconnectDelay?: number
  onOpen?: () => void
  onMessage?: (message: TMessage) => void
  onClose?: () => void
  onError?: (error: Event) => void
}

export interface UseWebSocketResult {
  connectionState: ConnectionState
  isConnected: boolean
  send: <T>(message: T) => boolean
  sendRaw: (data: ArrayBuffer) => boolean
  connect: () => void
  disconnect: () => void
}

export function useWebSocket<TMessage = unknown>(
  options: UseWebSocketOptions<TMessage>
): UseWebSocketResult {
  const {
    path,
    enabled = true,
    autoReconnect = true,
    reconnectDelay = 3000,
  } = options

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(autoReconnect)
  const isMountedRef = useRef(true)

  // Store callbacks in refs to avoid reconnection on callback changes
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${path}`
  }, [path])

  const connect = useCallback(() => {
    // Don't connect if already open or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    shouldReconnectRef.current = autoReconnect
    setConnectionState('connecting')

    const ws = new WebSocket(getWebSocketUrl())
    wsRef.current = ws

    ws.onopen = () => {
      if (isMountedRef.current) {
        setConnectionState('connected')
        callbacksRef.current.onOpen?.()
      }
    }

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return

      try {
        const data = JSON.parse(event.data) as TMessage
        callbacksRef.current.onMessage?.(data)
      } catch (err) {
        console.error('[useWebSocket] Error parsing message:', err)
      }
    }

    ws.onerror = (error) => {
      if (isMountedRef.current) {
        setConnectionState('error')
        callbacksRef.current.onError?.(error)
      }
    }

    ws.onclose = () => {
      if (!isMountedRef.current) return

      setConnectionState('disconnected')
      wsRef.current = null
      callbacksRef.current.onClose?.()

      // Auto-reconnect if enabled and not intentionally closed
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (isMountedRef.current && shouldReconnectRef.current) {
            connect()
          }
        }, reconnectDelay)
      }
    }
  }, [getWebSocketUrl, autoReconnect, reconnectDelay])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setConnectionState('disconnected')
  }, [])

  const send = useCallback(<T,>(message: T): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    return false
  }, [])

  const sendRaw = useCallback((data: ArrayBuffer): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data)
      return true
    }
    return false
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    if (enabled) {
      shouldReconnectRef.current = autoReconnect
      connect()
    } else {
      disconnect()
    }

    return () => {
      isMountedRef.current = false
      shouldReconnectRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [enabled, connect, disconnect, autoReconnect])

  return {
    connectionState,
    isConnected: connectionState === 'connected',
    send,
    sendRaw,
    connect,
    disconnect,
  }
}
