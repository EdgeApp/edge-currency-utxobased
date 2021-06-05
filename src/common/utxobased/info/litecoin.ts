import { IMAGE_SERVER_URL } from '../../constants'
import { EngineCurrencyInfo, EngineCurrencyType } from '../../plugin/types'

export const info: EngineCurrencyInfo = {
  currencyType: EngineCurrencyType.UTXO,
  coinType: 2,
  formats: ['bip49', 'bip84', 'bip44', 'bip32'],
  network: 'litecoin',
  pluginId: 'litecoin',
  walletType: 'wallet:litecoin',
  currencyCode: 'LTC',
  displayName: 'Litecoin',
  gapLimit: 10,
  defaultFee: 50000,
  feeUpdateInterval: 60000,
  customFeeSettings: ['satPerByte'],
  simpleFeeSettings: {
    highFee: '300',
    lowFee: '100',
    standardFeeLow: '150',
    standardFeeHigh: '200',
    standardFeeLowAmount: '20000000',
    standardFeeHighAmount: '981000000'
  },
  denominations: [
    { name: 'LTC', multiplier: '100000000', symbol: 'Ł' },
    { name: 'mLTC', multiplier: '100000', symbol: 'mŁ' }
  ],

  // Configuration options:
  defaultSettings: {
    customFeeSettings: ['satPerByte'],
    blockBookServers: [
      'https://ltc1.trezor.io',
      'https://ltc2.trezor.io',
      'https://ltc3.trezor.io',
      'https://ltc4.trezor.io',
      'https://ltc5.trezor.io'
    ],
    disableFetchingServers: false
  },
  metaTokens: [],

  // Explorers:
  blockExplorer: 'https://blockchair.com/litecoin/block/%s',
  addressExplorer: 'https://blockchair.com/litecoin/address/%s',
  transactionExplorer: 'https://blockchair.com/litecoin/transaction/%s',

  // Images:
  symbolImage: `${IMAGE_SERVER_URL}/litecoin-logo-solo-64.png`,
  symbolImageDarkMono: `${IMAGE_SERVER_URL}/litecoin-logo-solo-64.png`
}
