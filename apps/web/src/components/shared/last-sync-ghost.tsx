import styles from './last-sync-ghost.module.css'

type PixelSpec = {
  x: number
  y: number
  flash?: 'a' | 'b'
}

const BODY_PIXELS: PixelSpec[] = [
  { x: 50, y: 0 }, { x: 60, y: 0 }, { x: 70, y: 0 }, { x: 80, y: 0 },
  { x: 30, y: 10 }, { x: 40, y: 10 }, { x: 50, y: 10 }, { x: 60, y: 10 }, { x: 70, y: 10 }, { x: 80, y: 10 }, { x: 90, y: 10 }, { x: 100, y: 10 },
  { x: 20, y: 20 }, { x: 30, y: 20 }, { x: 40, y: 20 }, { x: 50, y: 20 }, { x: 60, y: 20 }, { x: 70, y: 20 }, { x: 80, y: 20 }, { x: 90, y: 20 }, { x: 100, y: 20 }, { x: 110, y: 20 },
  { x: 10, y: 30 }, { x: 20, y: 30 }, { x: 30, y: 30 }, { x: 40, y: 30 }, { x: 50, y: 30 }, { x: 60, y: 30 }, { x: 70, y: 30 }, { x: 80, y: 30 }, { x: 90, y: 30 }, { x: 100, y: 30 }, { x: 110, y: 30 }, { x: 120, y: 30 },
  { x: 10, y: 40 }, { x: 20, y: 40 }, { x: 30, y: 40 }, { x: 40, y: 40 }, { x: 50, y: 40 }, { x: 60, y: 40 }, { x: 70, y: 40 }, { x: 80, y: 40 }, { x: 90, y: 40 }, { x: 100, y: 40 }, { x: 110, y: 40 }, { x: 120, y: 40 },
  { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 50 }, { x: 40, y: 50 }, { x: 50, y: 50 }, { x: 60, y: 50 }, { x: 70, y: 50 }, { x: 80, y: 50 }, { x: 90, y: 50 }, { x: 100, y: 50 }, { x: 110, y: 50 }, { x: 120, y: 50 },
  { x: 0, y: 60 }, { x: 10, y: 60 }, { x: 20, y: 60 }, { x: 30, y: 60 }, { x: 40, y: 60 }, { x: 50, y: 60 }, { x: 60, y: 60 }, { x: 70, y: 60 }, { x: 80, y: 60 }, { x: 90, y: 60 }, { x: 100, y: 60 }, { x: 110, y: 60 }, { x: 120, y: 60 }, { x: 130, y: 60 },
  { x: 0, y: 70 }, { x: 10, y: 70 }, { x: 20, y: 70 }, { x: 30, y: 70 }, { x: 40, y: 70 }, { x: 50, y: 70 }, { x: 60, y: 70 }, { x: 70, y: 70 }, { x: 80, y: 70 }, { x: 90, y: 70 }, { x: 100, y: 70 }, { x: 110, y: 70 }, { x: 120, y: 70 }, { x: 130, y: 70 },
  { x: 0, y: 80 }, { x: 10, y: 80 }, { x: 20, y: 80 }, { x: 30, y: 80 }, { x: 40, y: 80 }, { x: 50, y: 80 }, { x: 60, y: 80 }, { x: 70, y: 80 }, { x: 80, y: 80 }, { x: 90, y: 80 }, { x: 100, y: 80 }, { x: 110, y: 80 }, { x: 120, y: 80 }, { x: 130, y: 80 },
  { x: 0, y: 90 }, { x: 10, y: 90 }, { x: 20, y: 90 }, { x: 30, y: 90 }, { x: 40, y: 90 }, { x: 50, y: 90 }, { x: 60, y: 90 }, { x: 70, y: 90 }, { x: 80, y: 90 }, { x: 90, y: 90 }, { x: 100, y: 90 }, { x: 110, y: 90 }, { x: 120, y: 90 }, { x: 130, y: 90 },
  { x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 100 }, { x: 30, y: 100 }, { x: 40, y: 100 }, { x: 50, y: 100 }, { x: 60, y: 100 }, { x: 70, y: 100 }, { x: 80, y: 100 }, { x: 90, y: 100 }, { x: 100, y: 100 }, { x: 110, y: 100 }, { x: 120, y: 100 }, { x: 130, y: 100 },
  { x: 0, y: 110 }, { x: 10, y: 110 }, { x: 20, y: 110 }, { x: 30, y: 110 }, { x: 40, y: 110 }, { x: 50, y: 110 }, { x: 60, y: 110 }, { x: 70, y: 110 }, { x: 80, y: 110 }, { x: 90, y: 110 }, { x: 100, y: 110 }, { x: 110, y: 110 }, { x: 120, y: 110 }, { x: 130, y: 110 },
  { x: 0, y: 120 }, { x: 10, y: 120, flash: 'a' }, { x: 20, y: 120, flash: 'b' }, { x: 30, y: 120 }, { x: 40, y: 120, flash: 'a' }, { x: 50, y: 120 }, { x: 60, y: 120, flash: 'b' }, { x: 70, y: 120, flash: 'b' }, { x: 80, y: 120 }, { x: 90, y: 120, flash: 'a' }, { x: 100, y: 120 }, { x: 110, y: 120, flash: 'b' }, { x: 120, y: 120 }, { x: 130, y: 120 },
  { x: 0, y: 130, flash: 'a' }, { x: 10, y: 130, flash: 'b' }, { x: 20, y: 130, flash: 'b' }, { x: 30, y: 130, flash: 'a' }, { x: 40, y: 130 }, { x: 50, y: 130, flash: 'b' }, { x: 60, y: 130 }, { x: 70, y: 130 }, { x: 80, y: 130, flash: 'a' }, { x: 90, y: 130 }, { x: 100, y: 130, flash: 'b' }, { x: 110, y: 130, flash: 'b' }, { x: 120, y: 130, flash: 'a' }, { x: 130, y: 130, flash: 'b' },
]

export function LastSyncGhost() {
  return (
    <span className={styles.wrap} aria-hidden="true">
      <span className={styles.ghost}>
        <span className={styles.body}>
          {BODY_PIXELS.map((pixel, index) => {
            const className = pixel.flash === 'a'
              ? `${styles.pixel} ${styles.flashA}`
              : pixel.flash === 'b'
                ? `${styles.pixel} ${styles.flashB}`
                : styles.pixel

            return (
              <span
                key={index}
                className={className}
                style={{ left: `${pixel.x}px`, top: `${pixel.y}px` }}
              />
            )
          })}
          <span className={`${styles.eye} ${styles.eyeLeft}`} />
          <span className={`${styles.eye} ${styles.eyeRight}`} />
          <span className={`${styles.pupil} ${styles.pupilLeft}`} />
          <span className={`${styles.pupil} ${styles.pupilRight}`} />
          <span className={styles.shadow} />
        </span>
      </span>
    </span>
  )
}
