import { useCallback, useState } from 'react'
import type { RetakeSubmissionSnapshot } from '../views/genspace/types'

export type RetakeMode = 'replace_audio_and_video' | 'replace_video' | 'replace_audio'

export interface RetakeSubmitParams {
  videoPath: string
  startTime: number
  duration: number
  prompt: string
  mode: RetakeMode
}

export function useRetake() {
  const [retakeError, setRetakeError] = useState<string | null>(null)
  const submitRetake = useCallback(async (_params: RetakeSubmitParams, _snapshot?: RetakeSubmissionSnapshot | null) => {
    setRetakeError('Retake is not supported by the current local runtime.')
  }, [])

  const resetRetake = useCallback(() => {
    setRetakeError(null)
  }, [])

  return {
    submitRetake,
    resetRetake,
    isRetaking: false,
    retakeStatus: '',
    retakeError,
  }
}
