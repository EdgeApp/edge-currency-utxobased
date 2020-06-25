// @flow

// import bcoin from 'bcoin'
import { Buffer } from 'buffer'

import { decode, encode } from './base32'
import BN from './bn'

export enum cashaddrPrefixEnum {
  mainnet = 'bitcoincash',
  testnet = 'bitcoincashtestnet'
}

export enum cashaddrTypeEnum {
  pubkeyhash = 'pubkeyhash',
  scripthash = 'scripthash'
}

export interface BitcoinCashScriptHash {
  scriptHash: Buffer
  type: cashaddrTypeEnum
}

const GENERATOR = [
  0x98f2bc8e61,
  0x79b76d99e2,
  0xf33e5fb3c4,
  0xae2eabe2a8,
  0x1e4f43e470
].map(x => new BN(x))

// returns a BN object, which is not typed yet. Logs as <BN: dc0f07f285>
const polymod = (data: number[]): any => {
  let checksum = new BN(1)
  const C = new BN(0x07ffffffff)
  for (let j = 0; j < data.length; j++) {
    const value = data[j]
    const topBits = checksum.shrn(35)
    checksum = checksum.and(C)
    checksum = checksum.shln(5).xor(new BN(value))
    for (let i = 0; i < GENERATOR.length; ++i) {
      const D = topBits.shrn(i).and(BN.One)
      if (D.eqn(1) === true) {
        checksum = checksum.xor(GENERATOR[i])
      }
    }
  }
  return checksum.xor(BN.One)
}

const convertBits = (
  data: any,
  from: number,
  to: number,
  strict?: boolean
): number[] => {
  if (typeof strict === 'undefined') {
    strict = false
  }
  let accumulator = 0
  let bits = 0
  const result = []
  const mask = (1 << to) - 1
  for (let i = 0; i < data.length; i++) {
    const value = data[i]
    if (value < 0 || value >> from !== 0) {
      throw new Error(`InvalidArgument in function convertBits: ${value}`)
    }

    accumulator = (accumulator << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      result.push((accumulator >> bits) & mask)
    }
  }
  if (
    isNaN(to) ||
    to === null ||
    isNaN(accumulator) ||
    isNaN(bits) ||
    isNaN(mask) ||
    mask === null
  ) {
    throw Error(`InvalidArgument in function convertBits: ${to}`)
  }
  if (!strict) {
    if (bits > 0) {
      result.push((accumulator << (to - bits)) & mask)
    }
  } else if (bits >= from || ((accumulator << (to - bits)) & mask) !== 0) {
    throw new Error(
      'InvalidState: Conversion requires padding but strict mode was used'
    )
  }
  return result
}

const prefixToArray = (prefix: any): number[] => {
  const result = []
  for (let i = 0; i < prefix.length; i++) {
    result.push(prefix.charCodeAt(i) & 31)
  }
  return result
}

export const hashToCashAddress = (
  scriptHash: string,
  type: cashaddrTypeEnum,
  prefix: cashaddrPrefixEnum
): string => {
  // Not any, but a BN object
  function checksumToArray(checksum: any): number[] {
    const result = []
    const N31 = new BN(31)
    for (let i = 0; i < 8; ++i) {
      result.push(checksum.and(N31).toNumber())
      checksum = checksum.shrn(5)
    }
    return result.reverse()
  }

  function getTypeBits(type: string): number {
    switch (type) {
      case cashaddrTypeEnum.pubkeyhash:
        return 0
      case cashaddrTypeEnum.scripthash:
        return 8
      default:
        throw new Error('Invalid type:' + type)
    }
  }

  function getHashSizeBits(hash: Buffer): number {
    switch (hash.length * 8) {
      case 160:
        return 0
      case 192:
        return 1
      case 224:
        return 2
      case 256:
        return 3
      case 320:
        return 4
      case 384:
        return 5
      case 448:
        return 6
      case 512:
        return 7
      default:
        throw new Error('Invalid hash size:' + hash.length.toString())
    }
  }

  const hashBuffer = Buffer.from(scriptHash, 'hex')
  const eight0 = [0, 0, 0, 0, 0, 0, 0, 0]
  const prefixData = prefixToArray(prefix).concat([0])
  const versionByte = getTypeBits(type) + getHashSizeBits(hashBuffer)
  const arr = Array.prototype.slice.call(hashBuffer, 0)
  const payloadData = convertBits([versionByte].concat(arr), 8, 5)
  const checksumData = prefixData.concat(payloadData).concat(eight0)
  const payload = payloadData.concat(checksumToArray(polymod(checksumData)))
  return prefix + ':' + encode(payload)
}

export const cashAddressToHash = (address: string): BitcoinCashScriptHash => {
  function getHashSize(versionByte: number): number {
    switch (versionByte & 7) {
      case 0:
        return 160
      case 1:
        return 192
      case 2:
        return 224
      case 3:
        return 256
      case 4:
        return 320
      case 5:
        return 384
      case 6:
        return 448
      case 7:
        return 512
      default:
        return 0
    }
  }

  function hasSingleCase(string: string): Boolean {
    const lowerCase = string.toLowerCase()
    const upperCase = string.toUpperCase()
    const hasSingleCase = string === lowerCase || string === upperCase
    return hasSingleCase
  }

  function validChecksum(prefix: string, payload: any): boolean {
    function prefixToArray(prefix: string): number[] {
      const result = []
      for (let i = 0; i < prefix.length; i++) {
        result.push(prefix.charCodeAt(i) & 31)
      }
      return result
    }

    const prefixData = prefixToArray(prefix).concat([0])
    return polymod(prefixData.concat(payload)).eqn(0)
  }

  if (hasSingleCase(address) === false) {
    throw new Error(`InvalidArgument: ${address} has Mixed case`)
  }
  address = address.toLowerCase()

  const pieces = address.split(':')
  if (pieces.length > 2) {
    throw new Error(`InvalidArgument: ${address} has invalid format`)
  }

  let prefix, encodedPayload

  if (pieces.length === 2) {
    prefix = pieces[0]
    encodedPayload = pieces[1]
  } else {
    prefix = null
    encodedPayload = pieces[0]
  }
  const payload = decode(encodedPayload.toLowerCase())
  if (prefix !== null) {
    if (!validChecksum(prefix, payload)) {
      throw new Error(`InvalidArgument: ${address} has invalid checksum`)
    }
  } else {
    const netNames = Object.values(cashaddrPrefixEnum)
    let i = netNames.shift()
    while (prefix === null && typeof i !== 'undefined') {
      const p = i
      if (validChecksum(p, payload)) {
        prefix = p
      }
      i = netNames.shift()
    }
    if (prefix === null) {
      throw new Error(`InvalidArgument: ${address} has invalid checksum`)
    }
  }

  const convertedBits = convertBits(payload.slice(0, -8), 5, 8, true)
  const versionByte = convertedBits.shift()
  const hash = convertedBits

  if (typeof versionByte === 'undefined') {
    throw new Error('cashaddress converter produced bad version byte')
  }

  if (getHashSize(versionByte) !== hash.length * 8) {
    throw new Error(`InvalidArgument: ${address} has invalid hash size`)
  }

  function getType(versionByte: number): cashaddrTypeEnum {
    switch (versionByte & 120) {
      case 0:
        return cashaddrTypeEnum.pubkeyhash
      case 8:
        return cashaddrTypeEnum.scripthash
      default:
        throw new Error(
          'Invalid address type in version byte: ' + versionByte.toString()
        )
    }
  }

  const type = getType(versionByte)
  const info: BitcoinCashScriptHash = {
    scriptHash: Buffer.from(hash),
    type: type
  }
  return info
}
