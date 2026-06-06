import { useState, useRef, useCallback } from 'react'
import { transcribeAudio } from '@/lib/api'

function getSupportedMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

interface UseAudioRecorderOptions {
  onTranscript: (text: string) => void
  onError: (msg: string) => void
}

export function useAudioRecorder({ onTranscript, onError }: UseAudioRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startRecording = useCallback(async () => {
    if (isRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = getSupportedMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        setIsRecording(false)
        if (blob.size < 1000) return
        setIsTranscribing(true)
        try {
          const result = await transcribeAudio(blob)
          if (result.text) onTranscript(result.text.trim())
        } catch {
          onError('Transcription failed. Please type instead.')
        } finally {
          setIsTranscribing(false)
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setIsRecording(true)
      timeoutRef.current = setTimeout(() => stopRecording(), 10000)
    } catch {
      onError('Microphone access denied.')
    }
  }, [isRecording, onTranscript, onError])

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }, [])

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording()
    else startRecording()
  }, [isRecording, startRecording, stopRecording])

  return { isRecording, isTranscribing, toggleRecording }
}
