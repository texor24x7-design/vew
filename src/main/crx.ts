import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import { net } from 'electron'
import yauzl from 'yauzl'

/** Limits for what one extension package may unpack to. */
export const MAX_DOWNLOAD = 200 * 1024 * 1024
export const MAX_UNPACKED = 400 * 1024 * 1024
export const MAX_ENTRIES = 20_000

/** Minimal protobuf reader (CRX3 headers are protobufs): yields [field number, bytes | varint]. */
function* fields(buf: Buffer): Generator<[number, Buffer | number]> {
  let i = 0
  const varint = (): number => {
    let result = 0
    for (let shift = 0; ; shift += 7) {
      if (i >= buf.length || shift > 49) throw new Error('Malformed package header')
      const b = buf[i++]
      result += (b & 0x7f) * 2 ** shift
      if (!(b & 0x80)) return result
    }
  }
  while (i < buf.length) {
    const key = varint()
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (wire === 0) yield [field, varint()]
    else if (wire === 2) {
      const len = varint()
      if (i + len > buf.length) throw new Error('Malformed package header')
      yield [field, buf.subarray(i, i + len)]
      i += len
    } else if (wire === 5) i += 4
    else if (wire === 1) i += 8
    else throw new Error('Malformed package header')
  }
}

/** Chrome's extension id alphabet: the first 16 bytes of a hash, hex digits mapped to a–p. */
export const idFromHash = (bytes: Buffer): string =>
  [...bytes.subarray(0, 16).toString('hex')]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('')

/**
 * Parse a CRX3 package and verify it: every signature must check out over the exact contents, and the
 * extension id must be the hash of a key that signed it. Returns the id, the developer key and the zip.
 */
export function verifyCrx(crx: Buffer): { id: string; publicKey: Buffer; zip: Buffer } {
  if (crx.length < 12 || crx.toString('latin1', 0, 4) !== 'Cr24' || crx.readUInt32LE(4) !== 3) {
    throw new Error('Not a CRX3 extension package')
  }
  const headerSize = crx.readUInt32LE(8)
  if (12 + headerSize > crx.length) throw new Error('Malformed package header')
  const header = crx.subarray(12, 12 + headerSize)
  const zip = crx.subarray(12 + headerSize)

  const proofs: { key: Buffer; signature: Buffer; rsa: boolean }[] = []
  let signed: Buffer | undefined
  for (const [field, value] of fields(header)) {
    if ((field === 2 || field === 3) && Buffer.isBuffer(value)) {
      let key: Buffer | undefined
      let signature: Buffer | undefined
      for (const [f, v] of fields(value)) {
        if (f === 1 && Buffer.isBuffer(v)) key = v
        if (f === 2 && Buffer.isBuffer(v)) signature = v
      }
      if (key && signature) proofs.push({ key, signature, rsa: field === 2 })
    }
    if (field === 10000 && Buffer.isBuffer(value)) signed = value
  }
  if (!signed || !proofs.length) throw new Error('Package is not signed')
  let crxId: Buffer | undefined
  for (const [f, v] of fields(signed)) if (f === 1 && Buffer.isBuffer(v)) crxId = v
  if (!crxId || crxId.length !== 16) throw new Error('Package has no id')

  const length = Buffer.alloc(4)
  length.writeUInt32LE(signed.length)
  const message = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), length, signed, zip])
  for (const p of proofs) {
    const key = createPublicKey({ key: p.key, format: 'der', type: 'spki' })
    if (!verify('sha256', message, key, p.signature))
      throw new Error('Package signature is invalid')
  }
  const developer = proofs.find(
    (p) => p.rsa && createHash('sha256').update(p.key).digest().subarray(0, 16).equals(crxId)
  )
  if (!developer) throw new Error('Package id doesn’t match its signing key')
  return { id: idFromHash(crxId), publicKey: developer.key, zip }
}

/**
 * Unzip into a new, empty folder. Refuses symlinks, absolute or escaping paths, and archives that expand
 * beyond MAX_UNPACKED or MAX_ENTRIES (zip bombs).
 */
export async function unzipSafely(zip: Buffer, dest: string): Promise<void> {
  const root = normalize(dest)
  const zipfile = await promisify<Buffer, yauzl.Options, yauzl.ZipFile>(yauzl.fromBuffer)(zip, {
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true
  })
  const open = promisify<yauzl.Entry, NodeJS.ReadableStream>(zipfile.openReadStream.bind(zipfile))
  let total = 0
  let count = 0
  await mkdir(root, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    zipfile.on('error', reject)
    zipfile.on('end', resolve)
    zipfile.on('entry', (entry: yauzl.Entry) => {
      const extract = async (): Promise<void> => {
        if (++count > MAX_ENTRIES) throw new Error('Package has too many files')
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
          throw new Error('Package contains a symbolic link')
        }
        const target = normalize(join(root, entry.fileName))
        if (!target.startsWith(root + sep)) throw new Error('Package contains an unsafe path')
        if (entry.fileName.endsWith('/')) return void (await mkdir(target, { recursive: true }))
        total += entry.uncompressedSize
        if (total > MAX_UNPACKED) throw new Error('Package is too large')
        await mkdir(dirname(target), { recursive: true })
        const chunks: Buffer[] = []
        for await (const chunk of await open(entry)) chunks.push(chunk as Buffer)
        await writeFile(target, Buffer.concat(chunks), { flag: 'wx' }) // never overwrite
      }
      extract().then(() => zipfile.readEntry(), reject)
    })
    zipfile.readEntry()
  }).finally(() => zipfile.close())
}

/** Download an extension from the Chrome Web Store, verify it, and unpack it to `<dir>/<id>/<version>_0`. */
export async function installFromWebStore(id: string, dir: string): Promise<string> {
  const url =
    'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3' +
    `&prodversion=${process.versions.chrome}&x=id%3D${id}%26installsource%3Dondemand%26uc`
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`The Chrome Web Store didn’t return that extension (${res.status})`)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_DOWNLOAD)
    throw new Error('Package is too large')
  const crx = Buffer.from(await res.arrayBuffer())
  if (crx.length > MAX_DOWNLOAD) throw new Error('Package is too large')
  const { id: actual, publicKey, zip } = verifyCrx(crx)
  if (actual !== id) throw new Error('Downloaded package is a different extension')

  const staging = join(dir, id, `.installing-${randomUUID()}`)
  try {
    await unzipSafely(zip, staging)
    const manifestPath = join(staging, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const version = String(manifest.version ?? '')
    if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('Package has an invalid version')
    // Like Chrome: the key pins the id, so Electron doesn't derive a different one from the folder path.
    manifest.key = publicKey.toString('base64')
    await writeFile(manifestPath, JSON.stringify(manifest))
    const final = join(dir, id, `${version}_0`)
    await rm(final, { recursive: true, force: true })
    await rename(staging, final)
    return final
  } catch (err) {
    await rm(staging, { recursive: true, force: true })
    throw err
  }
}
