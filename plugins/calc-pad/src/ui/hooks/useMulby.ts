// src/ui/hooks/useMulby.ts
import { useEffect, useState } from 'react'

export function useMulby() {
  const [mulby, setMulby] = useState<any>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).mulby) {
      setMulby((window as any).mulby)
    }
  }, [])

  return mulby
}
