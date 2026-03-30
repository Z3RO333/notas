import type { PanelViewMode, UserRole } from '@/lib/types/database'

export interface OrdersWorkspacePresentation {
  isViewerMode: boolean
  defaultOwnerCardsViewMode: PanelViewMode
  showPriorityLanes: boolean
  showOwnerToolbar: boolean
  showWorkspaceToolbar: boolean
  showWorkspaceTable: boolean
}

export function resolveOrdersWorkspacePresentation(role: UserRole): OrdersWorkspacePresentation {
  if (role === 'viewer') {
    return {
      isViewerMode: true,
      defaultOwnerCardsViewMode: 'cards',
      showPriorityLanes: false,
      showOwnerToolbar: false,
      showWorkspaceToolbar: false,
      showWorkspaceTable: false,
    }
  }

  return {
    isViewerMode: false,
    defaultOwnerCardsViewMode: 'list',
    showPriorityLanes: true,
    showOwnerToolbar: true,
    showWorkspaceToolbar: true,
    showWorkspaceTable: true,
  }
}
