import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import yazl from 'yazl'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
const { MAX_UNPACKED, idFromHash, unzipSafely, verifyCrx } = await import('../src/main/crx')

/** Tiny protobuf writer for building test packages. */
const varint = (n: number): Buffer => {
  const out: number[] = []
  do {
    out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0))
    n = Math.floor(n / 128)
  } while (n > 0)
  return Buffer.from(out)
}
const field = (num: number, bytes: Buffer): Buffer =>
  Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes])

const zipOf = (
  files: { name: string; data?: string; mode?: number; size?: number }[]
): Promise<Buffer> =>
  new Promise((resolve) => {
    const z = new yazl.ZipFile()
    for (const f of files)
      z.addBuffer(Buffer.from(f.data ?? 'x'.repeat(f.size ?? 1)), f.name, { mode: f.mode })
    z.end()
    const chunks: Buffer[] = []
    z.outputStream
      .on('data', (c: Buffer) => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks)))
  })

function crxOf(
  zip: Buffer,
  opts: { tamper?: boolean; wrongId?: boolean } = {}
): { crx: Buffer; id: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const idBytes = createHash('sha256')
    .update(opts.wrongId ? Buffer.from('someone else') : spki)
    .digest()
    .subarray(0, 16)
  const signed = field(1, idBytes)
  const len = Buffer.alloc(4)
  len.writeUInt32LE(signed.length)
  const signature = sign(
    'sha256',
    Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), len, signed, zip]),
    privateKey
  )
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, spki), field(2, signature)])),
    field(10000, signed)
  ])
  const prefix = Buffer.alloc(12)
  prefix.write('Cr24', 0, 'latin1')
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(header.length, 8)
  const body = opts.tamper
    ? Buffer.concat([zip.subarray(0, -1), Buffer.from([zip.at(-1)! ^ 1])])
    : zip
  return { crx: Buffer.concat([prefix, header, body]), id: idFromHash(idBytes) }
}

test('a properly signed CRX3 verifies, with its id derived from the signing key', async () => {
  const zip = await zipOf([{ name: 'manifest.json', data: '{"name":"x","version":"1.0"}' }])
  const { crx, id } = crxOf(zip)
  const out = verifyCrx(crx)
  expect(out.id).toBe(id)
  expect(out.id).toMatch(/^[a-p]{32}$/)
  expect(out.zip.equals(zip)).toBe(true)
})

test('tampered contents, an id that isn’t the key’s, or junk are rejected', async () => {
  const zip = await zipOf([{ name: 'manifest.json', data: '{}' }])
  expect(() => verifyCrx(crxOf(zip, { tamper: true }).crx)).toThrow(/signature/)
  expect(() => verifyCrx(crxOf(zip, { wrongId: true }).crx)).toThrow(/id/)
  expect(() => verifyCrx(Buffer.from('PK\x03\x04 not a crx'))).toThrow(/CRX3/)
  expect(() =>
    verifyCrx(Buffer.concat([Buffer.from('Cr24'), Buffer.from([3, 0, 0, 0, 255, 255, 0, 0])]))
  ).toThrow()
})

test('unzip writes files inside the destination only', async () => {
  const dest = join(mkdtempSync(join(tmpdir(), 'vew-crx-')), 'ext')
  await unzipSafely(
    await zipOf([
      { name: 'manifest.json', data: '{}' },
      { name: 'js/a.js', data: 'a' }
    ]),
    dest
  )
  expect(readFileSync(join(dest, 'js/a.js'), 'utf8')).toBe('a')
})

test('unzip refuses symlinks and zip bombs', async () => {
  const dest = (): string => join(mkdtempSync(join(tmpdir(), 'vew-crx-')), 'ext')
  const link = await zipOf([{ name: 'evil', data: '/etc/passwd', mode: 0o120777 }])
  await expect(unzipSafely(link, dest())).rejects.toThrow(/symbolic link/)
  const bomb = await zipOf([{ name: 'big.bin', size: MAX_UNPACKED + 1 }])
  const d = dest()
  await expect(unzipSafely(bomb, d)).rejects.toThrow(/too large/)
  expect(existsSync(join(d, 'big.bin'))).toBe(false)
})
