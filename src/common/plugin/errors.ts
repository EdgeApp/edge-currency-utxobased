export class AddressDataUnknownError extends Error {
  constructor(scriptPubkey: string) {
    super(`Address data unknown for script pubkey: ${scriptPubkey}`)
    this.name = 'AddressDataUnknownError'
  }
}
