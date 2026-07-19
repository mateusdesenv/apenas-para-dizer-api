import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidAvatarDataUrl, normalizeColor } from '../src/validation.js'

test('aceita avatar vazio e imagens suportadas', () => {
  assert.equal(isValidAvatarDataUrl(''), true)
  assert.equal(isValidAvatarDataUrl('data:image/png;base64,aGVsbG8='), true)
})

test('recusa formato de avatar não suportado', () => {
  assert.equal(isValidAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false)
})

test('normaliza cores fora da paleta', () => {
  assert.equal(normalizeColor('#FFC6A4'), '#FFC6A4')
  assert.equal(normalizeColor('#000000'), '#FFD7D2')
})
