// Runs in every test file (vitest.config.mts setupFiles): temp folders made by helpers.ts go when the file is done.
import { afterAll } from 'vitest'
import { removeTempHomes } from './helpers'

afterAll(removeTempHomes)
