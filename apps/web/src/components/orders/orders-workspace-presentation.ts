import type { PanelViewMode, UserRole } from '@/lib/types/database'

export interface OrdersWorkspacePresentation {
  isViewerMode: boolean
  defaultOwnerCardsViewMode: PanelViewMode
  showOwnerToolbar: boolean
  showWorkspaceToolbar: boolean
  showWorkspaceTable: boolean
}

export function resolveOrdersWorkspacePresentation(role: UserRole): OrdersWorkspacePresentation {
  if (role === 'viewer') {
    return {
      isViewerMode: true,
      defaultOwnerCardsViewMode: 'list',
      showOwnerToolbar: true,
      showWorkspaceToolbar: false,
      showWorkspaceTable: false,
    }
  }

  return {
    isViewerMode: false,
    defaultOwnerCardsViewMode: 'list',
    showOwnerToolbar: true,
    showWorkspaceToolbar: true,
    showWorkspaceTable: true,
  }
}
