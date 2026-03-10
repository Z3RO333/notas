import styles from './login-logo.module.css'

export function LoginLogo() {
  return (
    <span className={styles.logo} aria-hidden="true">
      <span className={styles.shellShadow} />
      <span className={styles.baseShadow} />
      <span className={styles.brimShadow} />
      <span className={styles.shell} />
      <span className={styles.base} />
      <span className={styles.brim} />
    </span>
  )
}
