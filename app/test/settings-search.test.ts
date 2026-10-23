import { describe, expect, it } from 'vitest'
import { findSettings, SETTING_IDS, SETTINGS, type SettingId } from '../src/renderer/src/components/settings-index'

const finds = (query: string, id: SettingId): void => {
  expect(findSettings(query), `"${query}" should find ${id}`).toContain(id)
}

describe('Settings search', () => {
  it('fails if a setting cannot be found by its label or by one of its synonyms', () => {
    for (const id of SETTING_IDS) {
      finds(SETTINGS[id].label, id)
      finds(SETTINGS[id].label.slice(0, 4), id)
      for (const word of SETTINGS[id].synonyms) finds(word, id)
    }
  })

  it('fails if the words people use for a setting miss it', () => {
    finds('telemetry', 'sharing')
    finds('captions', 'listening-model')
    finds('folder', 'library-folder')
    finds('Claude', 'editor')
    finds('30fps', 'faster-exports')
    finds('licence', 'licence')
    finds("what's new", 'whats-new')
    finds('ÉDITOR', 'editor')
  })

  it('fails if a search shows settings that do not match, or an empty search hides everything', () => {
    expect(findSettings('folder')).toEqual(new Set(['library-folder']))
    expect(findSettings('qwertyuiop')).toEqual(new Set())
    expect(findSettings('   ')).toBeNull()
  })

  it('fails if a found setting shows without the switch it needs to be usable', () => {
    expect(findSettings('quality scores')).toEqual(new Set(['sharing', 'sharing-quality']))
  })
})
