import 'server-only'

import { auth } from '@/lib/auth'
import { normalizeEmail } from '@/lib/auth/shared'

export async function getSessionEmail(): Promise<string | null> {
  const session = await auth()
  const email = session?.user?.email
  return email ? normalizeEmail(email) : null
}
