import { IMAGE_SERVER_URL } from '../../constants'
import { EngineCurrencyInfo, EngineCurrencyType } from '../../plugin/types'

export const info: EngineCurrencyInfo = {
  currencyType: EngineCurrencyType.UTXO,
  coinType: 145,
  formats: ['bip44', 'bip32'],
  forks: ['bitcoincashsv'],
  network: 'bitcoincash',
  pluginId: 'bitcoincash',
  walletType: 'wallet:bitcoincash',
  currencyCode: 'BCH',
  displayName: 'Bitcoin Cash',
  gapLimit: 10,
  defaultFee: 10000,
  feeUpdateInterval: 60000,
  customFeeSettings: ['satPerByte'],
  simpleFeeSettings: {
    highFee: '20',
    lowFee: '3',
    standardFeeLow: '5',
    standardFeeHigh: '10',
    standardFeeLowAmount: '1000000',
    standardFeeHighAmount: '65000000'
  },
  denominations: [
    { name: 'BCH', multiplier: '100000000', symbol: '₿' },
    { name: 'mBCH', multiplier: '100000', symbol: 'm₿' },
    { name: 'cash', multiplier: '100', symbol: 'ƀ' }
  ],

  // Configuration options:
  defaultSettings: {
    customFeeSettings: ['satPerByte'],
    blockBookServers: [
      'https://bch1.trezor.io',
      'https://bch2.trezor.io',
      'https://bch3.trezor.io',
      'https://bch4.trezor.io',
      'https://bch5.trezor.io'
    ],
    disableFetchingServers: false
  },
  metaTokens: [],

  // Explorers:
  blockExplorer: 'https://blockchair.com/bitcoin-cash/block/%s',
  addressExplorer: 'https://blockchair.com/bitcoin-cash/address/%s',
  transactionExplorer: 'https://blockchair.com/bitcoin-cash/transaction/%s',
  xpubExplorer: 'https://blockchair.com/bitcoin-cash/xpub/%s',

  // Images:
  symbolImage: `${IMAGE_SERVER_URL}/bitcoincash-logo-solo-64.png`,
  symbolImageDarkMono: `${IMAGE_SERVER_URL}/bitcoincash-logo-solo-64.png`
}
