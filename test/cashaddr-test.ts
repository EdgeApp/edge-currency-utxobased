import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  cashAddressToHash,
  cashaddrPrefixEnum,
  cashaddrTypeEnum,
  hashToCashAddress
} from '../src/utxobased/keymanager/bitcoincashUtils/cashAddress'
import {
  addressToScriptHash,
  AddressTypeEnum,
  NetworkEnum
} from '../src/utxobased/keymanager/keymanager'

describe('bitcoin cash address tests', () => {
  const pubkeyHash = addressToScriptHash({
    address: '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA',
    network: NetworkEnum.Mainnet,
    addressType: AddressTypeEnum.p2pkh,
    coin: 'bitcoin'
  })
  it('pubkey hash to cashaddr', () => {
    const address = hashToCashAddress(
      pubkeyHash,
      cashaddrTypeEnum.pubkeyhash,
      cashaddrPrefixEnum.mainnet
    )
    expect(address).to.equal(
      'bitcoincash:qrvcdmgpk73zyfd8pmdl9wnuld36zh9n4gms8s0u59'
    )
  })

  it('cash address to pubkey hash', () => {
    const info = cashAddressToHash(
      'bitcoincash:qrvcdmgpk73zyfd8pmdl9wnuld36zh9n4gms8s0u59'
    )
    expect(info.scriptHash.toString('hex')).to.equal(
      'd986ed01b7a22225a70edbf2ba7cfb63a15cb3aa'
    )
  })

  const scriptHash = addressToScriptHash({
    address: '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
    network: NetworkEnum.Mainnet,
    addressType: AddressTypeEnum.p2sh,
    coin: 'bitcoin'
  })
  it('script hash to cashaddr', () => {
    const address = hashToCashAddress(
      scriptHash,
      cashaddrTypeEnum.scripthash,
      cashaddrPrefixEnum.mainnet
    )
    expect(address).to.equal(
      'bitcoincash:pqlmd62cztjhhdrfr7dy5c5gv2np5nmknvhfvqp85n'
    )
  })

  it('cash address to script hash', () => {
    const info = cashAddressToHash(
      'bitcoincash:pqlmd62cztjhhdrfr7dy5c5gv2np5nmknvhfvqp85n'
    )
    expect(info.scriptHash.toString('hex')).to.equal(
      '3fb6e95812e57bb4691f9a4a628862a61a4f769b'
    )
  })
})
