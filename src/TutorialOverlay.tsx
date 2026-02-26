import type { CSSProperties } from 'react'
import type { TutorialStep } from './tutorialSteps'

type TutorialOverlayProps = {
  isOpen: boolean
  step: TutorialStep
  stepIndex: number
  totalSteps: number
  targetRect: DOMRect | null
  showOpenTargetButton: boolean
  onOpenTarget: () => void
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  onDone: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export default function TutorialOverlay({
  isOpen,
  step,
  stepIndex,
  totalSteps,
  targetRect,
  showOpenTargetButton,
  onOpenTarget,
  onBack,
  onNext,
  onSkip,
  onDone,
}: TutorialOverlayProps) {
  if (!isOpen) {
    return null
  }

  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === totalSteps - 1

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 390
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 844

  let tooltipStyle: CSSProperties = {}
  if (targetRect) {
    const cardWidth = Math.min(340, viewportWidth - 24)
    const estimatedCardHeight = 230
    const spaceAbove = targetRect.top
    const spaceBelow = viewportHeight - targetRect.bottom
    const placeBelow = spaceBelow > estimatedCardHeight || spaceBelow >= spaceAbove

    const left = clamp(
      targetRect.left + targetRect.width / 2 - cardWidth / 2,
      12,
      Math.max(12, viewportWidth - cardWidth - 12),
    )

    const top = placeBelow
      ? clamp(targetRect.bottom + 12, 12, Math.max(12, viewportHeight - estimatedCardHeight - 12))
      : clamp(targetRect.top - estimatedCardHeight - 12, 12, Math.max(12, viewportHeight - estimatedCardHeight - 12))

    tooltipStyle = {
      left,
      top,
      width: cardWidth,
    }
  }

  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="App tutorial">
      {targetRect ? (
        <div
          className="tutorial-spotlight"
          style={{
            left: targetRect.left - 6,
            top: targetRect.top - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
          aria-hidden="true"
        />
      ) : (
        <div className="tutorial-backdrop" aria-hidden="true" />
      )}

      <section
        className={`tutorial-card ${targetRect ? 'tutorial-card-positioned' : 'tutorial-card-centered'}`}
        style={targetRect ? tooltipStyle : undefined}
      >
        <p className="tutorial-progress">
          {stepIndex + 1} of {totalSteps}
        </p>
        <h2>{step.title}</h2>
        <p>{step.description}</p>

        {showOpenTargetButton ? (
          <button type="button" className="secondary-button tutorial-open-target" onClick={onOpenTarget}>
            Open it for me
          </button>
        ) : null}

        <div className="tutorial-actions">
          <button type="button" className="secondary-button" onClick={onSkip}>
            Skip
          </button>
          <div className="tutorial-step-buttons">
            <button type="button" className="secondary-button" onClick={onBack} disabled={isFirstStep}>
              Back
            </button>
            {isLastStep ? (
              <button type="button" className="primary-button" onClick={onDone}>
                Done
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={onNext}>
                Next
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
