import { LoginStarfield } from './login-starfield'

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <LoginStarfield>{children}</LoginStarfield>
  )
}
