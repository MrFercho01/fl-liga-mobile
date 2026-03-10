import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { API_BASE_URL } from '../config'
import type { LiveMatch } from '../types'

interface UseLiveSocketParams {
  onUpdate: (snapshot: LiveMatch) => void
}

export const useLiveSocket = ({ onUpdate }: UseLiveSocketParams) => {
  useEffect(() => {
    const socket = io(API_BASE_URL, {
      transports: ['websocket'],
    })

    socket.on('live:update', (snapshot: LiveMatch) => {
      onUpdate(snapshot)
    })

    return () => {
      socket.disconnect()
    }
  }, [onUpdate])
}
