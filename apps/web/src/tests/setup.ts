import '@testing-library/jest-dom'
import { server } from './mocks/server'
import { beforeAll, afterEach, afterAll } from 'vitest'

// Inicia o MSW server antes de todos os testes
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Reseta handlers após cada teste (evita vazamento entre testes)
afterEach(() => server.resetHandlers())

// Encerra o server após todos os testes
afterAll(() => server.close())
