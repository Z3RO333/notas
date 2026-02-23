import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Server MSW para uso em testes (Node.js)
export const server = setupServer(...handlers)
