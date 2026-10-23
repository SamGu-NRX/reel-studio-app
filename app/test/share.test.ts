import { expect, it } from 'vitest'
import { shareOrder } from '../src/shared/share'

const ids = ['instagram', 'phone', 'drive:icloud', 'finder', 'platforms'] as const

it('fails if the last-used destination is not first or the others lose their order', () => {
  expect(shareOrder(ids, 'finder')).toEqual(['finder', 'instagram', 'phone', 'drive:icloud', 'platforms'])
  expect(shareOrder(ids, 'instagram')).toEqual([...ids])
})

it('fails if a destination that is gone (a drive signed out) reorders the list', () => {
  expect(shareOrder(ids, 'drive:gdrive')).toEqual([...ids])
  expect(shareOrder(ids, null)).toEqual([...ids])
})
