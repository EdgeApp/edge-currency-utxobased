import { IMAGE_SERVER_URL } from '../../constants'
import { EngineCurrencyInfo, EngineCurrencyType } from '../../plugin/types'

export const info: EngineCurrencyInfo = {
  currencyType: EngineCurrencyType.UTXO,
  coinType: 236,
  formats: ['bip44', 'bip32'],
  network: 'bitcoinsv',
  uriPrefix: 'bitcoin',
  pluginId: 'bitcoinsv',
  walletType: 'wallet:bitcoinsv',
  currencyCode: 'BSV',
  displayName: 'Bitcoin SV',
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
    { name: 'BSV', multiplier: '100000000', symbol: '₿' },
    { name: 'mBSV', multiplier: '100000', symbol: 'm₿' },
    { name: 'cash', multiplier: '100', symbol: 'ƀ' }
  ],

  // Configuration options:
  defaultSettings: {
    customFeeSettings: ['satPerByte'],
    blockBookServers: [],
    disableFetchingServers: false
  },
  metaTokens: [],

  // Explorers:
  blockExplorer: 'https://blockchair.com/bitcoin-sv/block/%s',
  addressExplorer: 'https://blockchair.com/bitcoin-sv/address/%s',
  transactionExplorer: 'https://blockchair.com/bitcoin-sv/transaction/%s',

  // Images:
  symbolImage: `${IMAGE_SERVER_URL}/bitcoinsv-logo-solo-64.png`,
  symbolImageDarkMono: `${IMAGE_SERVER_URL}/bitcoinsv-logo-solo-64.png`
}
