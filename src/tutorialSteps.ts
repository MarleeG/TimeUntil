export type TutorialTargetId =
  | 'createButton'
  | 'createModeToggle'
  | 'durationPreview'
  | 'timerActions'
  | 'settingsButton'
  | 'completedSection'

export type TutorialStep = {
  id: string
  title: string
  description: string
  target?: TutorialTargetId
  requiresCreateModal?: boolean
  requiresDurationMode?: boolean
}

export const tutorialSteps: TutorialStep[] = [
  {
    id: 'create-button',
    title: 'Tap + to create a timer',
    target: 'createButton',
    description:
      'Create timers that count down to a specific moment or duration. Your timers remain after you close the app.',
  },
  {
    id: 'create-modes',
    title: 'Choose End-at vs Duration',
    target: 'createModeToggle',
    requiresCreateModal: true,
    description:
      'End-at mode lets you pick a date/time. If you choose a past time, it automatically rolls to the next day.',
  },
  {
    id: 'duration-preview',
    title: 'Check the end-time preview',
    target: 'durationPreview',
    requiresCreateModal: true,
    requiresDurationMode: true,
    description:
      'Duration mode sets days/hours/minutes/seconds, and the preview shows the exact time the timer will end.',
  },
  {
    id: 'timer-actions',
    title: 'Control running timers',
    target: 'timerActions',
    description:
      'Pause, resume, and reset timers from each card. You can also add up to 5 alerts like "5 min left".',
  },
  {
    id: 'notifications',
    title: 'Use the gear for notifications',
    target: 'settingsButton',
    description:
      'Open notification settings here. On iPhone, background alerts and sounds are not guaranteed, so keeping the app open is most reliable.',
  },
  {
    id: 'history',
    title: 'Review completed timers',
    target: 'completedSection',
    description:
      'Completed timers are saved as history so you can review what finished and when.',
  },
]
