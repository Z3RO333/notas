import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/orders/pmpl-routing', () => ({
  applyAutomaticOrdersRouting: vi.fn(),
}))

vi.mock('@/lib/auth/shared', () => ({
  MAINTAINER_EMAILS: new Set<string>(),
}))

describe('revalidateCockpitPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('revalida raízes do cockpit usando scope layout', async () => {
    const { revalidatePath } = await import('next/cache')
    const { revalidateCockpitPaths } = await import('@/lib/actions/admin-action-support')

    revalidateCockpitPaths()

    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
    expect(revalidatePath).toHaveBeenCalledWith('/ordens', 'layout')
    expect(revalidatePath).toHaveBeenCalledWith('/notas', 'layout')
  })

  it('chama revalidatePath exatamente 4 vezes (uma por raiz)', async () => {
    const { revalidatePath } = await import('next/cache')
    const { revalidateCockpitPaths } = await import('@/lib/actions/admin-action-support')

    revalidateCockpitPaths()

    expect(revalidatePath).toHaveBeenCalledTimes(4)
  })
})
