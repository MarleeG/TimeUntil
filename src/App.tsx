import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import './App.css'

const TIMERS_STORAGE_KEY = 'timeUntilTimers'
const COMPLETED_TIMERS_STORAGE_KEY = 'timeUntilCompletedTimers'
const SETTINGS_STORAGE_KEY = 'timeUntilSettings'
const MAX_ALERTS_PER_TIMER = 5

const SOUND_OPTIONS = [
  { id: 'silent', label: 'Silent' },
  { id: 'ding', label: 'Ding' },
  { id: 'double-ding', label: 'Double Ding' },
  { id: 'soft-pop', label: 'Soft Pop' },
  { id: 'beep', label: 'Beep' },
  { id: 'chime', label: 'Chime' },
  { id: 'pluck', label: 'Pluck' },
  { id: 'short-bell', label: 'Short Bell' },
  { id: 'alarm-lite', label: 'Alarm Lite' },
] as const

type SoundId = (typeof SOUND_OPTIONS)[number]['id']

type AlertRule = {
  id: string
  minutesBeforeEnd: number
  hasFired: boolean
}

type Timer = {
  id: string
  label?: string
  targetAt: number
  createdAt: number
  startedAt?: number
  endedAt?: number
  isRunning: boolean
  pausedRemainingMs?: number
  alerts: AlertRule[]
  alertSoundId: SoundId
  endSoundId: SoundId
}

type CompletedTimer = {
  id: string
  label?: string
  createdAt: number
  startedAt?: number
  endedAt: number
  targetAt: number
  durationMs?: number
}

type TimerDraft = {
  label: string
  date: string
  time: string
}

type ToastMessage = {
  id: string
  message: string
}

type AppSettings = {
  notificationsEnabled: boolean
}

type ToneSegment = {
  at: number
  duration: number
  frequency: number
  gain: number
  type?: OscillatorType
}

const SOUND_IDS = new Set<SoundId>(SOUND_OPTIONS.map((option) => option.id))

function isSoundId(value: unknown): value is SoundId {
  return typeof value === 'string' && SOUND_IDS.has(value as SoundId)
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function scheduleTone(context: AudioContext, segment: ToneSegment): void {
  const startAt = context.currentTime + segment.at
  const oscillator = context.createOscillator()
  const gainNode = context.createGain()

  oscillator.type = segment.type ?? 'sine'
  oscillator.frequency.setValueAtTime(segment.frequency, startAt)

  gainNode.gain.setValueAtTime(0.0001, startAt)
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, segment.gain), startAt + 0.01)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + segment.duration)

  oscillator.connect(gainNode)
  gainNode.connect(context.destination)

  oscillator.start(startAt)
  oscillator.stop(startAt + segment.duration + 0.02)
}

function playGeneratedSound(context: AudioContext, soundId: SoundId): void {
  const patterns: Record<Exclude<SoundId, 'silent'>, ToneSegment[]> = {
    ding: [{ at: 0, duration: 0.18, frequency: 880, gain: 0.08, type: 'sine' }],
    'double-ding': [
      { at: 0, duration: 0.14, frequency: 820, gain: 0.07, type: 'sine' },
      { at: 0.2, duration: 0.14, frequency: 980, gain: 0.07, type: 'sine' },
    ],
    'soft-pop': [{ at: 0, duration: 0.09, frequency: 420, gain: 0.045, type: 'triangle' }],
    beep: [{ at: 0, duration: 0.12, frequency: 740, gain: 0.055, type: 'square' }],
    chime: [
      { at: 0, duration: 0.2, frequency: 660, gain: 0.065, type: 'sine' },
      { at: 0.04, duration: 0.18, frequency: 990, gain: 0.04, type: 'sine' },
    ],
    pluck: [
      { at: 0, duration: 0.1, frequency: 520, gain: 0.05, type: 'sawtooth' },
      { at: 0.01, duration: 0.08, frequency: 260, gain: 0.032, type: 'triangle' },
    ],
    'short-bell': [
      { at: 0, duration: 0.24, frequency: 740, gain: 0.08, type: 'sine' },
      { at: 0.02, duration: 0.2, frequency: 1480, gain: 0.04, type: 'sine' },
    ],
    'alarm-lite': [
      { at: 0, duration: 0.08, frequency: 760, gain: 0.055, type: 'square' },
      { at: 0.14, duration: 0.08, frequency: 760, gain: 0.055, type: 'square' },
      { at: 0.28, duration: 0.08, frequency: 760, gain: 0.055, type: 'square' },
      { at: 0.42, duration: 0.08, frequency: 760, gain: 0.055, type: 'square' },
    ],
  }

  if (soundId === 'silent') {
    return
  }

  for (const segment of patterns[soundId]) {
    scheduleTone(context, segment)
  }
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function getDefaultCreateValues(now: Date): { dateStr: string; timeStr: string } {
  const rounded = new Date(now)
  rounded.setSeconds(0, 0)
  rounded.setMinutes(rounded.getMinutes() + (15 - (rounded.getMinutes() % 15)))

  return {
    dateStr: formatDateInputValue(now),
    timeStr: formatTimeInputValue(rounded),
  }
}

function parseLocalDateTime(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function computeTarget(dateStr: string, timeStr: string, now: Date): Date {
  const selected = parseLocalDateTime(dateStr, timeStr)
  if (selected.getTime() > now.getTime()) {
    return selected
  }

  const [hour, minute] = timeStr.split(':').map(Number)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(hour, minute, 0, 0)
  return tomorrow
}

function formatHMS(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = Math.floor(clamped / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatTarget(timestamp: number): string {
  return formatDateTime(timestamp)
}

function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = Math.floor(clamped / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatMinutesValue(minutes: number): string {
  if (Number.isInteger(minutes)) {
    return String(minutes)
  }

  return minutes.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function sortAlertsDescending(alerts: AlertRule[]): AlertRule[] {
  return [...alerts].sort((a, b) => b.minutesBeforeEnd - a.minutesBeforeEnd)
}

function getRemainingMs(timer: Timer, nowMs: number): number {
  if (timer.isRunning) {
    return Math.max(0, timer.targetAt - nowMs)
  }

  if (typeof timer.pausedRemainingMs === 'number') {
    return Math.max(0, timer.pausedRemainingMs)
  }

  return Math.max(0, timer.targetAt - nowMs)
}

function toCompletedTimer(timer: Timer, endedAt: number): CompletedTimer {
  const startBase = typeof timer.startedAt === 'number' ? timer.startedAt : timer.createdAt
  return {
    id: timer.id,
    label: timer.label,
    createdAt: timer.createdAt,
    startedAt: timer.startedAt,
    endedAt,
    targetAt: timer.targetAt,
    durationMs: Math.max(0, endedAt - startBase),
  }
}

function mergeCompletedTimers(
  incoming: CompletedTimer[],
  existing: CompletedTimer[],
): CompletedTimer[] {
  const seenIds = new Set<string>()
  const merged: CompletedTimer[] = []

  for (const item of [...incoming, ...existing]) {
    if (seenIds.has(item.id)) {
      continue
    }

    seenIds.add(item.id)
    merged.push(item)
  }

  merged.sort((a, b) => b.endedAt - a.endedAt)
  return merged
}

function toDraft(timer: Timer): TimerDraft {
  const date = new Date(timer.targetAt)
  return {
    label: timer.label ?? '',
    date: formatDateInputValue(date),
    time: formatTimeInputValue(date),
  }
}

function resetAlertsForNewDuration(alerts: AlertRule[], totalDurationMs: number): AlertRule[] {
  return sortAlertsDescending(
    alerts
      .filter((alert) => alert.minutesBeforeEnd > 0 && alert.minutesBeforeEnd * 60_000 < totalDurationMs)
      .map((alert) => ({
        ...alert,
        hasFired: false,
      })),
  )
}

function getAlertValidationError(timer: Timer, minutesBeforeEnd: number, nowMs: number): string | null {
  if (!Number.isFinite(minutesBeforeEnd) || minutesBeforeEnd <= 0) {
    return 'Alert must be greater than 0 minutes.'
  }

  if (timer.alerts.length >= MAX_ALERTS_PER_TIMER) {
    return `You can add up to ${MAX_ALERTS_PER_TIMER} alerts.`
  }

  const remainingMs = getRemainingMs(timer, nowMs)
  if (remainingMs <= 0) {
    return 'Timer has already ended.'
  }

  if (minutesBeforeEnd * 60_000 >= remainingMs) {
    return 'Alert must be less than the timer duration.'
  }

  return null
}

function normalizeRestoredTimer(timer: Timer): Timer {
  const normalizedAlerts = sortAlertsDescending(
    timer.alerts
      .filter((alert) => Number.isFinite(alert.minutesBeforeEnd) && alert.minutesBeforeEnd > 0)
      .slice(0, MAX_ALERTS_PER_TIMER),
  )

  if (timer.isRunning) {
    return {
      ...timer,
      pausedRemainingMs: undefined,
      alerts: normalizedAlerts,
    }
  }

  if (typeof timer.pausedRemainingMs === 'number') {
    return {
      ...timer,
      pausedRemainingMs: Math.max(0, timer.pausedRemainingMs),
      alerts: normalizedAlerts,
    }
  }

  return {
    ...timer,
    alerts: normalizedAlerts,
  }
}

function readPersistedTimers(): Timer[] {
  try {
    const raw = window.localStorage.getItem(TIMERS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    const restored: Timer[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const candidate = item as Partial<Timer>
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.targetAt !== 'number' ||
        !Number.isFinite(candidate.targetAt) ||
        typeof candidate.createdAt !== 'number' ||
        !Number.isFinite(candidate.createdAt) ||
        typeof candidate.isRunning !== 'boolean'
      ) {
        continue
      }

      const candidateAlerts = Array.isArray(candidate.alerts) ? candidate.alerts : []
      const alerts: AlertRule[] = []
      for (const alertItem of candidateAlerts) {
        if (!alertItem || typeof alertItem !== 'object') {
          continue
        }

        const candidateAlert = alertItem as Partial<AlertRule>
        if (
          typeof candidateAlert.id !== 'string' ||
          typeof candidateAlert.minutesBeforeEnd !== 'number' ||
          !Number.isFinite(candidateAlert.minutesBeforeEnd) ||
          typeof candidateAlert.hasFired !== 'boolean'
        ) {
          continue
        }

        alerts.push({
          id: candidateAlert.id,
          minutesBeforeEnd: candidateAlert.minutesBeforeEnd,
          hasFired: candidateAlert.hasFired,
        })
      }

      const timer: Timer = {
        id: candidate.id,
        label: typeof candidate.label === 'string' ? candidate.label : undefined,
        targetAt: candidate.targetAt,
        createdAt: candidate.createdAt,
        startedAt:
          typeof candidate.startedAt === 'number' && Number.isFinite(candidate.startedAt)
            ? candidate.startedAt
            : undefined,
        endedAt:
          typeof candidate.endedAt === 'number' && Number.isFinite(candidate.endedAt)
            ? candidate.endedAt
            : undefined,
        isRunning: candidate.isRunning,
        pausedRemainingMs:
          typeof candidate.pausedRemainingMs === 'number' && Number.isFinite(candidate.pausedRemainingMs)
            ? Math.max(0, candidate.pausedRemainingMs)
            : undefined,
        alerts,
        alertSoundId: isSoundId(candidate.alertSoundId) ? candidate.alertSoundId : 'ding',
        endSoundId: isSoundId(candidate.endSoundId) ? candidate.endSoundId : 'short-bell',
      }

      restored.push(normalizeRestoredTimer(timer))
    }

    return restored
  } catch {
    return []
  }
}

function readPersistedCompletedTimers(): CompletedTimer[] {
  try {
    const raw = window.localStorage.getItem(COMPLETED_TIMERS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    const restored: CompletedTimer[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const candidate = item as Partial<CompletedTimer>
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.createdAt !== 'number' ||
        !Number.isFinite(candidate.createdAt) ||
        typeof candidate.targetAt !== 'number' ||
        !Number.isFinite(candidate.targetAt) ||
        typeof candidate.endedAt !== 'number' ||
        !Number.isFinite(candidate.endedAt)
      ) {
        continue
      }

      restored.push({
        id: candidate.id,
        label: typeof candidate.label === 'string' ? candidate.label : undefined,
        createdAt: candidate.createdAt,
        startedAt:
          typeof candidate.startedAt === 'number' && Number.isFinite(candidate.startedAt)
            ? candidate.startedAt
            : undefined,
        endedAt: candidate.endedAt,
        targetAt: candidate.targetAt,
        durationMs:
          typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)
            ? Math.max(0, candidate.durationMs)
            : undefined,
      })
    }

    restored.sort((a, b) => b.endedAt - a.endedAt)
    return restored
  } catch {
    return []
  }
}

type InitialPersistedState = {
  timers: Timer[]
  completedTimers: CompletedTimer[]
}

let cachedInitialPersistedState: InitialPersistedState | null = null

function getInitialPersistedState(): InitialPersistedState {
  if (cachedInitialPersistedState) {
    return cachedInitialPersistedState
  }

  const nowMs = Date.now()
  const restoredTimers = readPersistedTimers()
  const restoredCompleted = readPersistedCompletedTimers()

  const carriedToCompleted = restoredTimers
    .filter(
      (timer) =>
        timer.targetAt <= nowMs &&
        (timer.isRunning || typeof timer.pausedRemainingMs !== 'number'),
    )
    .map((timer) => toCompletedTimer(timer, nowMs))

  cachedInitialPersistedState = {
    timers: restoredTimers.filter(
      (timer) =>
        !(
          timer.targetAt <= nowMs &&
          (timer.isRunning || typeof timer.pausedRemainingMs !== 'number')
        ),
    ),
    completedTimers: mergeCompletedTimers(carriedToCompleted, restoredCompleted),
  }

  return cachedInitialPersistedState
}

function readPersistedSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) {
      return { notificationsEnabled: false }
    }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { notificationsEnabled: false }
    }

    const candidate = parsed as Partial<AppSettings>
    return {
      notificationsEnabled: candidate.notificationsEnabled === true,
    }
  } catch {
    return { notificationsEnabled: false }
  }
}

function App() {
  const defaults = useMemo(() => getDefaultCreateValues(new Date()), [])
  const persistedSettings = useMemo(() => readPersistedSettings(), [])

  const [createLabel, setCreateLabel] = useState('')
  const [createDate, setCreateDate] = useState(defaults.dateStr)
  const [createTime, setCreateTime] = useState(defaults.timeStr)
  const [timers, setTimers] = useState<Timer[]>(() => getInitialPersistedState().timers)
  const [completedTimers, setCompletedTimers] = useState<CompletedTimer[]>(
    () => getInitialPersistedState().completedTimers,
  )
  const [editingById, setEditingById] = useState<Record<string, TimerDraft>>({})
  const [editingTimerId, setEditingTimerId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [settingsOpenById, setSettingsOpenById] = useState<Record<string, boolean>>({})
  const [isClearCompletedModalOpen, setIsClearCompletedModalOpen] = useState(false)
  const [alertInputById, setAlertInputById] = useState<Record<string, string>>({})
  const [alertErrorById, setAlertErrorById] = useState<Record<string, string>>({})
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [now, setNow] = useState<number>(() => Date.now())
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    persistedSettings.notificationsEnabled,
  )
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof Notification === 'undefined') {
      return 'unsupported'
    }

    return Notification.permission
  })
  const hasUserInteractedRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)

  const pushToast = (message: string) => {
    const toastId = createId()
    setToasts((previous) => [...previous, { id: toastId, message }])

    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== toastId))
    }, 5000)
  }

  const markUserInteracted = () => {
    hasUserInteractedRef.current = true

    const webkitWindow = window as Window & {
      webkitAudioContext?: typeof AudioContext
    }

    const AudioContextCtor = window.AudioContext ?? webkitWindow.webkitAudioContext
    if (!AudioContextCtor) {
      return
    }

    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContextCtor()
      } catch {
        return
      }
    }

    const context = audioContextRef.current
    if (context.state === 'suspended') {
      void context.resume().catch(() => {
        // iOS may still block resume; skip sound gracefully.
      })
    }
  }

  const playSound = (soundId: SoundId) => {
    if (soundId === 'silent' || !hasUserInteractedRef.current) {
      return
    }

    const context = audioContextRef.current
    if (!context || context.state !== 'running') {
      return
    }

    try {
      playGeneratedSound(context, soundId)
    } catch {
      // Ignore playback errors to avoid noisy console output.
    }
  }

  const showForegroundNotification = (title: string, body: string) => {
    if (!notificationsEnabled || notificationPermission !== 'granted') {
      return
    }

    if (typeof Notification === 'undefined') {
      return
    }

    if (document.visibilityState !== 'visible') {
      return
    }

    try {
      // Foreground-only notification to avoid implying background delivery.
      new Notification(title, { body })
    } catch {
      // Ignore notification failures.
    }
  }

  const clearAlertError = (timerId: string) => {
    setAlertErrorById((previous) => {
      if (!(timerId in previous)) {
        return previous
      }

      const next = { ...previous }
      delete next[timerId]
      return next
    })
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextNow = Date.now()
      setNow((previousNow) => (nextNow === previousNow ? previousNow + 1 : nextNow))
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const syncNow = () => {
      setNow(Date.now())
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncNow()
      }
    }

    window.addEventListener('focus', syncNow)
    window.addEventListener('pageshow', syncNow)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', syncNow)
      window.removeEventListener('pageshow', syncNow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const completedDueTimers = timers.filter((timer) => timer.isRunning && timer.targetAt - now <= 0)
    if (completedDueTimers.length === 0) {
      return
    }

    const endedAt = Date.now()
    const completedIds = new Set(completedDueTimers.map((timer) => timer.id))
    const completedRecords = completedDueTimers.map((timer) => toCompletedTimer(timer, endedAt))

    setTimers((previous) => previous.filter((timer) => !completedIds.has(timer.id)))
    setCompletedTimers((previous) => mergeCompletedTimers(completedRecords, previous))

    completedDueTimers.forEach((timer) => {
      pushToast(`Timer done! (${timer.label || 'Untitled'})`)
      playSound(timer.endSoundId)
      showForegroundNotification('Time Until Done', `${timer.label || 'Untitled'} reached 00:00:00.`)
    })
  }, [now, timers])

  useEffect(() => {
    if (timers.length === 0) {
      return
    }

    let changed = false
    const alertMessages: string[] = []
    const alertSounds: SoundId[] = []
    const alertNotifications: string[] = []

    const nextTimers = timers.map((timer) => {
      if (!timer.isRunning) {
        return timer
      }

      const remainingMs = Math.max(0, timer.targetAt - now)
      if (remainingMs <= 0) {
        return timer
      }

      let nextTimer = timer

      let alertsChanged = false
      const nextAlerts = timer.alerts.map((alert) => {
        if (!alert.hasFired && remainingMs <= alert.minutesBeforeEnd * 60_000) {
          alertsChanged = true
          alertMessages.push(
            `Alert: ${formatMinutesValue(alert.minutesBeforeEnd)} minutes left (${timer.label || 'Untitled'})`,
          )
          alertNotifications.push(
            `${formatMinutesValue(alert.minutesBeforeEnd)} minutes left (${timer.label || 'Untitled'})`,
          )
          alertSounds.push(timer.alertSoundId)

          return {
            ...alert,
            hasFired: true,
          }
        }

        return alert
      })

      if (alertsChanged) {
        changed = true
        nextTimer = {
          ...nextTimer,
          alerts: nextAlerts,
        }
      }

      return nextTimer
    })

    if (changed) {
      setTimers(nextTimers)
    }

    alertMessages.forEach((message) => pushToast(message))
    alertSounds.forEach((soundId) => playSound(soundId))
    alertNotifications.forEach((body) => showForegroundNotification('Time Until Alert', body))
  }, [now, timers])

  useEffect(() => {
    try {
      window.localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(timers))
    } catch {
      // Ignore storage write errors.
    }
  }, [timers])

  useEffect(() => {
    try {
      window.localStorage.setItem(COMPLETED_TIMERS_STORAGE_KEY, JSON.stringify(completedTimers))
    } catch {
      // Ignore storage write errors.
    }
  }, [completedTimers])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ notificationsEnabled }),
      )
    } catch {
      // Ignore storage write errors.
    }
  }, [notificationsEnabled])

  useEffect(() => {
    return () => {
      const context = audioContextRef.current
      if (context) {
        void context.close().catch(() => {
          // Ignore teardown failures.
        })
      }
    }
  }, [])

  useEffect(() => {
    if (!isClearCompletedModalOpen) {
      return
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsClearCompletedModalOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isClearCompletedModalOpen])

  const handleCreateTimer = (event: FormEvent) => {
    event.preventDefault()
    markUserInteracted()

    if (!createDate || !createTime) {
      return
    }

    const now = new Date()
    const target = computeTarget(createDate, createTime, now)
    const label = createLabel.trim()

    const timer: Timer = {
      id: createId(),
      label: label || undefined,
      targetAt: target.getTime(),
      createdAt: now.getTime(),
      startedAt: now.getTime(),
      endedAt: undefined,
      isRunning: true,
      pausedRemainingMs: undefined,
      alerts: [],
      alertSoundId: 'ding',
      endSoundId: 'short-bell',
    }

    setTimers((previous) => [timer, ...previous])
    setCreateLabel('')
  }

  const handleStartTimer = (timerId: string) => {
    markUserInteracted()
    const now = Date.now()
    setNow((previousNow) => (now === previousNow ? previousNow + 1 : now))

    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== timerId) {
          return timer
        }

        if (timer.isRunning || editingById[timer.id]) {
          return timer
        }

        const remaining =
          typeof timer.pausedRemainingMs === 'number'
            ? timer.pausedRemainingMs
            : Math.max(0, timer.targetAt - now)

        if (remaining <= 0) {
          return {
            ...timer,
            isRunning: false,
            pausedRemainingMs: 0,
          }
        }

        return {
          ...timer,
          startedAt: timer.startedAt ?? now,
          endedAt: undefined,
          isRunning: true,
          targetAt: now + remaining,
          pausedRemainingMs: undefined,
        }
      }),
    )
  }

  const handlePauseTimer = (timerId: string) => {
    const now = Date.now()
    setNow((previousNow) => (now === previousNow ? previousNow + 1 : now))

    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== timerId || !timer.isRunning) {
          return timer
        }

        return {
          ...timer,
          isRunning: false,
          pausedRemainingMs: Math.max(0, timer.targetAt - now),
        }
      }),
    )
  }

  const handleResetTimer = (timerId: string) => {
    const timer = timers.find((item) => item.id === timerId)
    if (!timer) {
      return
    }

    setTimers((previous) =>
      previous.map((item) =>
        item.id === timerId
          ? {
              ...item,
              startedAt: undefined,
              endedAt: undefined,
              isRunning: false,
              pausedRemainingMs: undefined,
            }
          : item,
      ),
    )

    setEditingById((previous) => ({
      ...previous,
      [timerId]: toDraft(timer),
    }))

    clearAlertError(timerId)
  }

  const handleDeleteTimer = (timerId: string) => {
    setTimers((previous) => previous.filter((timer) => timer.id !== timerId))

    setSettingsOpenById((previous) => {
      if (!(timerId in previous)) {
        return previous
      }

      const next = { ...previous }
      delete next[timerId]
      return next
    })

    setEditingById((previous) => {
      if (!previous[timerId]) {
        return previous
      }

      const next = { ...previous }
      delete next[timerId]
      return next
    })

    setAlertInputById((previous) => {
      if (!(timerId in previous)) {
        return previous
      }

      const next = { ...previous }
      delete next[timerId]
      return next
    })

    clearAlertError(timerId)

    if (editingTimerId === timerId) {
      setEditingTimerId(null)
      setDraftLabel('')
    }
  }

  const handleToggleTimerSettings = (timerId: string) => {
    setSettingsOpenById((previous) => ({
      ...previous,
      [timerId]: !previous[timerId],
    }))
  }

  const handleStartLabelEdit = (timer: Timer) => {
    setEditingTimerId(timer.id)
    setDraftLabel(timer.label ?? '')
  }

  const handleCancelLabelEdit = () => {
    setEditingTimerId(null)
    setDraftLabel('')
  }

  const handleSaveLabelEdit = () => {
    if (!editingTimerId) {
      return
    }

    const trimmedLabel = draftLabel.trim()
    setTimers((previous) =>
      previous.map((timer) =>
        timer.id === editingTimerId
          ? {
              ...timer,
              label: trimmedLabel || undefined,
            }
          : timer,
      ),
    )

    setEditingTimerId(null)
    setDraftLabel('')
  }

  const handleLabelInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSaveLabelEdit()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelLabelEdit()
    }
  }

  const handleDraftChange = (timerId: string, key: keyof TimerDraft, value: string) => {
    setEditingById((previous) => {
      const current = previous[timerId]
      if (!current) {
        return previous
      }

      return {
        ...previous,
        [timerId]: {
          ...current,
          [key]: value,
        },
      }
    })
  }

  const handleSaveDraft = (timerId: string) => {
    const draft = editingById[timerId]
    if (!draft || !draft.date || !draft.time) {
      return
    }

    const now = new Date()
    const target = computeTarget(draft.date, draft.time, now)
    const label = draft.label.trim()

    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== timerId) {
          return timer
        }

        const totalDurationMs = Math.max(0, target.getTime() - now.getTime())
        return {
          ...timer,
          label: label || undefined,
          startedAt: undefined,
          endedAt: undefined,
          targetAt: target.getTime(),
          isRunning: false,
          pausedRemainingMs: totalDurationMs,
          alerts: resetAlertsForNewDuration(timer.alerts, totalDurationMs),
        }
      }),
    )

    setEditingById((previous) => {
      const next = { ...previous }
      delete next[timerId]
      return next
    })

    clearAlertError(timerId)
  }

  const handleAddAlert = (timerId: string, minutesBeforeEnd: number) => {
    const timer = timers.find((item) => item.id === timerId)
    if (!timer) {
      return
    }

    const error = getAlertValidationError(timer, minutesBeforeEnd, now)
    if (error) {
      setAlertErrorById((previous) => ({
        ...previous,
        [timerId]: error,
      }))
      return
    }

    const nextAlert: AlertRule = {
      id: createId(),
      minutesBeforeEnd,
      hasFired: false,
    }

    setTimers((previous) =>
      previous.map((item) =>
        item.id === timerId
          ? {
              ...item,
              alerts: sortAlertsDescending([...item.alerts, nextAlert]),
            }
          : item,
      ),
    )

    setAlertInputById((previous) => ({
      ...previous,
      [timerId]: '',
    }))

    clearAlertError(timerId)
  }

  const handleRemoveAlert = (timerId: string, alertId: string) => {
    setTimers((previous) =>
      previous.map((timer) => {
        if (timer.id !== timerId) {
          return timer
        }

        return {
          ...timer,
          alerts: timer.alerts.filter((alert) => alert.id !== alertId),
        }
      }),
    )

    clearAlertError(timerId)
  }

  const handleCustomAlertAdd = (timerId: string) => {
    const inputValue = alertInputById[timerId] ?? ''
    const parsedMinutes = Number.parseFloat(inputValue)
    handleAddAlert(timerId, parsedMinutes)
  }

  const handleTimerSoundChange = (timerId: string, field: 'alertSoundId' | 'endSoundId', value: SoundId) => {
    setTimers((previous) =>
      previous.map((timer) =>
        timer.id === timerId
          ? {
              ...timer,
              [field]: value,
            }
          : timer,
      ),
    )
  }

  const handleTestSound = (soundId: SoundId) => {
    markUserInteracted()
    playSound(soundId)
  }

  const handleRequestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported')
      pushToast('Notifications are not supported on this browser.')
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)

      if (permission === 'granted') {
        pushToast('Notification permission granted.')
      } else if (permission === 'denied') {
        pushToast('Notification permission denied.')
      } else {
        pushToast('Notification permission request dismissed.')
      }
    } catch {
      pushToast('Could not request notification permission.')
    }
  }

  const handleDeleteCompletedTimer = (completedTimerId: string) => {
    setCompletedTimers((previous) => previous.filter((timer) => timer.id !== completedTimerId))
  }

  const handleOpenClearCompletedModal = () => {
    if (completedTimers.length === 0) {
      return
    }

    setIsClearCompletedModalOpen(true)
  }

  const handleConfirmClearCompletedTimers = () => {
    setCompletedTimers([])
    setIsClearCompletedModalOpen(false)
  }

  const handleCancelClearCompletedTimers = () => {
    setIsClearCompletedModalOpen(false)
  }

  return (
    <div className="app-shell">
      <main className="timers-panel">
        <h1 className="title">Time Until</h1>

        <form className="create-form" onSubmit={handleCreateTimer}>
          <label className="field" htmlFor="new-label">
            <span>Label (optional)</span>
            <input
              id="new-label"
              type="text"
              placeholder="Workout, call, meeting..."
              value={createLabel}
              onChange={(event) => setCreateLabel(event.target.value)}
            />
          </label>

          <div className="create-row">
            <label className="field" htmlFor="new-date">
              <span>Date</span>
              <input
                id="new-date"
                type="date"
                value={createDate}
                onChange={(event) => setCreateDate(event.target.value)}
                required
              />
            </label>

            <label className="field" htmlFor="new-time">
              <span>Time</span>
              <input
                id="new-time"
                type="time"
                value={createTime}
                onChange={(event) => setCreateTime(event.target.value)}
                required
              />
            </label>
          </div>

          <button className="primary-button" type="submit">
            Create Timer
          </button>
        </form>

        <section className="settings-card">
          <h2>Settings</h2>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(event) => setNotificationsEnabled(event.target.checked)}
            />
            <span>Enable notifications</span>
          </label>
          <div className="settings-actions">
            <button
              type="button"
              onClick={() => {
                void handleRequestNotificationPermission()
              }}
              disabled={notificationPermission === 'unsupported'}
            >
              Request notification permission
            </button>
            <p>
              Permission:{' '}
              <strong>
                {notificationPermission === 'unsupported' ? 'unsupported' : notificationPermission}
              </strong>
            </p>
          </div>
          <p className="settings-disclaimer">
            On iPhone PWAs, background notifications and sounds are not guaranteed. Keep the app
            open for reliable alerts.
          </p>
        </section>

        <section className="timers-group" aria-live="polite">
          <div className="list-header">
            <h2>Active Timers</h2>
          </div>
          <div className="timers-list">
          {timers.length === 0 ? (
            <p className="empty-state">No timers yet. Create one above.</p>
          ) : (
            timers.map((timer) => {
              const isTargetEditing = Boolean(editingById[timer.id])
              const isLabelEditing = editingTimerId === timer.id
              const isTimerSettingsOpen = settingsOpenById[timer.id] === true
              const draft = editingById[timer.id]
              const remainingMs = isTargetEditing ? 0 : getRemainingMs(timer, now)
              const alertInput = alertInputById[timer.id] ?? ''
              const alertError = alertErrorById[timer.id]

              return (
                <article className="timer-card" key={timer.id}>
                  <header className="timer-header">
                    <div className="timer-label-row">
                      {isLabelEditing ? (
                        <div className="label-edit-inline">
                          <input
                            type="text"
                            value={draftLabel}
                            onChange={(event) => setDraftLabel(event.target.value)}
                            onKeyDown={handleLabelInputKeyDown}
                            aria-label="Edit timer label"
                            autoFocus
                          />
                          <button
                            type="button"
                            className="icon-button"
                            onClick={handleSaveLabelEdit}
                            aria-label="Save label"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M20 6L9 17l-5-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={handleCancelLabelEdit}
                            aria-label="Cancel label edit"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M18 6L6 18M6 6l12 12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <>
                          <h2>{timer.label || 'Untitled'}</h2>
                          <div className="timer-header-actions">
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => handleStartLabelEdit(timer)}
                              aria-label="Edit label"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                  d="M3 17.25V21h3.75L18.8 8.95l-3.75-3.75L3 17.25z"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M14.9 5.2l3.75 3.75"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={`icon-button ${isTimerSettingsOpen ? 'icon-button-active' : ''}`}
                              onClick={() => handleToggleTimerSettings(timer.id)}
                              aria-label={isTimerSettingsOpen ? 'Hide timer settings' : 'Show timer settings'}
                              aria-expanded={isTimerSettingsOpen}
                              aria-controls={`timer-settings-${timer.id}`}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                  d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                />
                                <path
                                  d="M19.4 15a1.7 1.7 0 00.34 1.86l.02.02a2 2 0 11-2.83 2.83l-.02-.02A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 .6 1.7 1.7 0 01-2 0 1.7 1.7 0 00-1-.6 1.7 1.7 0 00-1.86.34l-.02.02a2 2 0 11-2.83-2.83l.02-.02A1.7 1.7 0 004.6 15a1.7 1.7 0 00-.6-1 1.7 1.7 0 010-2 1.7 1.7 0 00.6-1 1.7 1.7 0 00-.34-1.86l-.02-.02a2 2 0 112.83-2.83l.02.02A1.7 1.7 0 009 4.6a1.7 1.7 0 001-.6 1.7 1.7 0 012 0 1.7 1.7 0 001 .6 1.7 1.7 0 001.86-.34l.02-.02a2 2 0 112.83 2.83l-.02.02A1.7 1.7 0 0019.4 9c.24.3.45.64.6 1a1.7 1.7 0 011 1 1.7 1.7 0 010 2 1.7 1.7 0 01-1 1c-.15.36-.36.7-.6 1z"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <p>Created {formatTarget(timer.createdAt)}</p>
                  </header>

                  {isTargetEditing && draft ? (
                    <div className="edit-grid">
                      <label className="field" htmlFor={`edit-label-${timer.id}`}>
                        <span>Label</span>
                        <input
                          id={`edit-label-${timer.id}`}
                          type="text"
                          value={draft.label}
                          onChange={(event) =>
                            handleDraftChange(timer.id, 'label', event.target.value)
                          }
                        />
                      </label>

                      <div className="create-row">
                        <label className="field" htmlFor={`edit-date-${timer.id}`}>
                          <span>Date</span>
                          <input
                            id={`edit-date-${timer.id}`}
                            type="date"
                            value={draft.date}
                            onChange={(event) =>
                              handleDraftChange(timer.id, 'date', event.target.value)
                            }
                            required
                          />
                        </label>

                        <label className="field" htmlFor={`edit-time-${timer.id}`}>
                          <span>Time</span>
                          <input
                            id={`edit-time-${timer.id}`}
                            type="time"
                            value={draft.time}
                            onChange={(event) =>
                              handleDraftChange(timer.id, 'time', event.target.value)
                            }
                            required
                          />
                        </label>
                      </div>

                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => handleSaveDraft(timer.id)}
                      >
                        Save Target
                      </button>
                    </div>
                  ) : (
                    <p className="target-line">Target: {formatTarget(timer.targetAt)}</p>
                  )}

                  <p className="timer-display">{formatHMS(remainingMs)}</p>

                  {isTimerSettingsOpen ? (
                    <div className="timer-settings-panel" id={`timer-settings-${timer.id}`}>
                      <section className="alerts-section">
                        <h3>Alerts</h3>

                        <div className="preset-row">
                          {[1, 5, 10, 15].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => handleAddAlert(timer.id, preset)}
                              disabled={isTargetEditing}
                            >
                              {preset}m
                            </button>
                          ))}
                        </div>

                        <div className="custom-alert-row">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="Custom minutes"
                            value={alertInput}
                            onChange={(event) =>
                              setAlertInputById((previous) => ({
                                ...previous,
                                [timer.id]: event.target.value,
                              }))
                            }
                            disabled={isTargetEditing}
                          />
                          <button
                            type="button"
                            onClick={() => handleCustomAlertAdd(timer.id)}
                            disabled={isTargetEditing}
                          >
                            Add
                          </button>
                        </div>

                        {alertError ? <p className="inline-error">{alertError}</p> : null}

                        {timer.alerts.length === 0 ? (
                          <p className="alerts-empty">No alerts yet.</p>
                        ) : (
                          <ul className="alerts-list">
                            {timer.alerts.map((alert) => (
                              <li key={alert.id}>
                                <span>{formatMinutesValue(alert.minutesBeforeEnd)}m before</span>
                                <button type="button" onClick={() => handleRemoveAlert(timer.id, alert.id)}>
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>

                      <section className="sounds-section">
                        <h3>Sounds</h3>

                        <div className="sound-row">
                          <label htmlFor={`alert-sound-${timer.id}`}>Alert sound</label>
                          <div className="sound-controls">
                            <select
                              id={`alert-sound-${timer.id}`}
                              value={timer.alertSoundId}
                              onChange={(event) =>
                                handleTimerSoundChange(timer.id, 'alertSoundId', event.target.value as SoundId)
                              }
                            >
                              {SOUND_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <button type="button" onClick={() => handleTestSound(timer.alertSoundId)}>
                              Test sound
                            </button>
                          </div>
                        </div>

                        <div className="sound-row">
                          <label htmlFor={`end-sound-${timer.id}`}>End sound</label>
                          <div className="sound-controls">
                            <select
                              id={`end-sound-${timer.id}`}
                              value={timer.endSoundId}
                              onChange={(event) =>
                                handleTimerSoundChange(timer.id, 'endSoundId', event.target.value as SoundId)
                              }
                            >
                              {SOUND_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <button type="button" onClick={() => handleTestSound(timer.endSoundId)}>
                              Test sound
                            </button>
                          </div>
                        </div>
                      </section>
                    </div>
                  ) : null}

                  <div className="card-actions">
                    <button
                      type="button"
                      onClick={() => handleStartTimer(timer.id)}
                      disabled={isTargetEditing || remainingMs <= 0}
                    >
                      Start/Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePauseTimer(timer.id)}
                      disabled={!timer.isRunning || isTargetEditing}
                    >
                      Pause
                    </button>
                    <button type="button" onClick={() => handleResetTimer(timer.id)}>
                      Reset
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => handleDeleteTimer(timer.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              )
            })
          )}
          </div>
        </section>

        <section className="completed-section">
          <div className="list-header">
            <h2>Completed Timers</h2>
            <button
              type="button"
              className="secondary-button clear-completed-button"
              onClick={handleOpenClearCompletedModal}
              disabled={completedTimers.length === 0}
            >
              Clear completed
            </button>
          </div>

          {completedTimers.length === 0 ? (
            <p className="empty-state">No completed timers yet.</p>
          ) : (
            <div className="completed-list">
              {completedTimers.map((timer) => {
                const durationMs =
                  timer.durationMs ??
                  Math.max(0, timer.endedAt - (typeof timer.startedAt === 'number' ? timer.startedAt : timer.createdAt))

                return (
                  <article className="completed-card" key={timer.id}>
                    <header className="completed-header">
                      <h3>{timer.label || 'Untitled'}</h3>
                      <button
                        type="button"
                        className="icon-button danger-icon-button"
                        onClick={() => handleDeleteCompletedTimer(timer.id)}
                        aria-label="Delete completed timer"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V5h6v2"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </header>
                    <p>Target: {formatDateTime(timer.targetAt)}</p>
                    <p>Started: {typeof timer.startedAt === 'number' ? formatDateTime(timer.startedAt) : '—'}</p>
                    <p>Ended: {formatDateTime(timer.endedAt)}</p>
                    <p>Duration: {formatDuration(durationMs)}</p>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {isClearCompletedModalOpen ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={handleCancelClearCompletedTimers}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-completed-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="clear-completed-title">Clear completed timers?</h2>
            <p>This will permanently remove all completed timer history.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={handleCancelClearCompletedTimers}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button modal-danger-button"
                onClick={handleConfirmClearCompletedTimers}
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toasts.length > 0 ? (
        <aside className="toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              <p>{toast.message}</p>
              <button
                type="button"
                onClick={() =>
                  setToasts((previous) => previous.filter((item) => item.id !== toast.id))
                }
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          ))}
        </aside>
      ) : null}
    </div>
  )
}

export default App
