import NextAuth from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import { isBemolEmail, normalizeEmail } from '@/lib/auth/shared'
import { createAdminClient } from '@/lib/supabase/admin'

function profileEmail(
  user?: { email?: string | null } | null,
  profile?: Record<string, unknown> | null
): string {
  const preferredUsername =
    typeof profile?.preferred_username === 'string' ? profile.preferred_username : null
  const email = user?.email ?? (typeof profile?.email === 'string' ? profile.email : null) ?? preferredUsername
  return email ? normalizeEmail(email) : ''
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT}/v2.0`,
    }),
  ],
  pages: { signIn: '/login' },
  callbacks: {
    async signIn({ user, profile }) {
      const email = profileEmail(user, profile)
      if (!isBemolEmail(email)) return false

      const supabase = createAdminClient()
      const { data: admin } = await supabase
        .from('administradores')
        .select('ativo')
        .eq('email', email)
        .maybeSingle()

      if (!admin || !admin.ativo) return false

      return true
    },
    async jwt({ token, user, profile }) {
      const email = profileEmail(user, profile)
      if (email) token.email = email
      return token
    },
    async session({ session, token }) {
      if (session.user && token.email) {
        session.user.email = token.email as string
      }
      return session
    },
  },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
})
