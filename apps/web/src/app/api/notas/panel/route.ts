import { NextResponse } from 'next/server'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { getNotesPanelData, type NotesPageSearchParams } from '@/lib/notes/get-notes-panel-data'

function toNotesSearchParams(searchParams: URLSearchParams): NotesPageSearchParams {
  const params: NotesPageSearchParams = {}

  for (const key of ['q', 'status', 'responsavel', 'unidade', 'kpi'] as const) {
    const value = searchParams.get(key)
    if (value !== null) {
      params[key] = value
    }
  }

  return params
}

export async function GET(request: Request) {
  const currentAdminContext = await getCurrentAdminContext()

  if (!currentAdminContext.isAuthenticated) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  if (!currentAdminContext.adminId || !currentAdminContext.role) {
    return NextResponse.json({ error: 'Administrador nao encontrado' }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const data = await getNotesPanelData({
      searchParams: toNotesSearchParams(url.searchParams),
      currentAdminContext: {
        adminId: currentAdminContext.adminId,
        role: currentAdminContext.role,
        canViewGlobal: currentAdminContext.canViewGlobal,
      },
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error('[api/notas/panel] failed to load notes panel', error)
    return NextResponse.json({ error: 'Falha ao carregar painel de notas' }, { status: 500 })
  }
}
