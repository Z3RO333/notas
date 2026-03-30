import { describe, expect, it } from 'vitest'
import { resolveOrdersWorkspacePresentation } from './orders-workspace-presentation'

describe('resolveOrdersWorkspacePresentation', () => {
  it('returns broadcast-oriented flags for viewer', () => {
    expect(resolveOrdersWorkspacePresentation('viewer')).toEqual({
      isViewerMode: true,
      defaultOwnerCardsViewMode: 'list',
      showPriorityLanes: false,
      showOwnerToolbar: true,
      showWorkspaceToolbar: false,
      showWorkspaceTable: false,
    })
  })

  it('keeps the operational workspace intact for gestor', () => {
    expect(resolveOrdersWorkspacePresentation('gestor')).toEqual({
      isViewerMode: false,
      defaultOwnerCardsViewMode: 'list',
      showPriorityLanes: true,
      showOwnerToolbar: true,
      showWorkspaceToolbar: true,
      showWorkspaceTable: true,
    })
  })
})
