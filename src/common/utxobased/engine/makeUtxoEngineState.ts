import * as bs from 'biggystring'
import {
  EdgeFreshAddress,
  EdgeIo,
  EdgeLog,
  EdgeTransaction,
  EdgeWalletInfo
} from 'edge-core-js'

import { EngineEmitter, EngineEvent } from '../../plugin/makeEngineEmitter'
import {
  AddressPath,
  CurrencyFormat,
  EngineConfig,
  EngineCurrencyInfo,
  NetworkEnum
} from '../../plugin/types'
import { removeItem } from '../../plugin/utils'
import { Processor } from '../db/makeProcessor'
import { IAddress, IProcessorTransaction, IUTXO } from '../db/types'
import { BIP43PurposeTypeEnum, ScriptTypeEnum } from '../keymanager/keymanager'
import {
  IAccountDetailsBasic,
  IAccountUTXO,
  INewTransactionResponse,
  ITransaction,
  ITransactionDetailsPaginationResponse
} from '../network/BlockBook'
import {
  addressMessage,
  addressUtxosMessage,
  transactionMessage
} from '../network/BlockBookAPI'
import Deferred from '../network/Deferred'
import { WsTask } from '../network/Socket'
import AwaitLock from './await-lock'
import { BLOCKBOOK_TXS_PER_PAGE, CACHE_THROTTLE } from './constants'
import { makeServerStates, ServerStates } from './makeServerStates'
import { UTXOPluginWalletTools } from './makeUtxoWalletTools'
import {
  currencyFormatToPurposeType,
  getCurrencyFormatFromPurposeType,
  getFormatSupportedBranches,
  getPurposeTypeFromKeys,
  getWalletSupportedFormats,
  validScriptPubkeyFromAddress
} from './utils'

export interface UtxoEngineState {
  processedPercent: number

  start: () => Promise<void>

  stop: () => Promise<void>

  getFreshAddress: (branch?: number) => Promise<EdgeFreshAddress>

  addGapLimitAddresses: (addresses: string[]) => Promise<void>

  broadcastTx: (transaction: EdgeTransaction) => Promise<string>

  refillServers: () => void

  getServerList: () => string[]

  setServerList: (serverList: string[]) => void
}

export interface UtxoEngineStateConfig extends EngineConfig {
  walletTools: UTXOPluginWalletTools
  processor: Processor
}

export function makeUtxoEngineState(
  config: UtxoEngineStateConfig
): UtxoEngineState {
  const {
    network,
    currencyInfo,
    walletInfo,
    walletTools,
    options: { emitter, log },
    processor,
    pluginState
  } = config

  const taskCache: TaskCache = {
    addressWatching: false,
    blockWatching: false,
    addressSubscribeCache: {},
    transactionsCache: {},
    utxosCache: {},
    rawUtxosCache: {},
    processedUtxosCache: {},
    updateTransactionsCache: {}
  }

  const clearTaskCache = (): void => {
    taskCache.addressWatching = false
    taskCache.blockWatching = false
    taskCache.addressSubscribeCache = {}
    taskCache.transactionsCache = {}
    taskCache.utxosCache = {}
    taskCache.rawUtxosCache = {}
    taskCache.processedUtxosCache = {}
    taskCache.updateTransactionsCache = {}
  }

  let processedCount = 0
  let processedPercent = 0
  const onAddressChecked = async (): Promise<void> => {
    processedCount = processedCount + 1
    const totalCount = await getTotalAddressCount({
      walletInfo,
      currencyInfo,
      processor
    })
    const percent = processedCount / totalCount
    if (percent - processedPercent > CACHE_THROTTLE || percent === 1) {
      processedPercent = percent
      emitter.emit(EngineEvent.ADDRESSES_CHECKED, percent)
    }
  }

  const engineStarted = false
  const lock = new AwaitLock()

  const serverStates = makeServerStates({
    engineStarted,
    walletInfo,
    pluginState,
    engineEmitter: emitter,
    log
  })
  const commonArgs: CommonArgs = {
    engineStarted,
    network,
    currencyInfo,
    walletInfo,
    walletTools,
    processor,
    emitter,
    taskCache,
    onAddressChecked,
    io: config.io,
    log,
    serverStates,
    lock
  }

  const pickNextTaskCB = async (
    uri: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<boolean | WsTask<any> | undefined> => {
    return await pickNextTask({ ...commonArgs, uri })
  }

  serverStates.setPickNextTaskCB(pickNextTaskCB)

  let running = false
  const run = async (): Promise<void> => {
    if (running) return
    running = true

    const formatsToProcess = getWalletSupportedFormats(walletInfo)
    for (const format of formatsToProcess) {
      const branches = getFormatSupportedBranches(format)
      for (const branch of branches) {
        const args: SetLookAheadArgs = {
          ...commonArgs,
          format,
          branch
        }
        await setLookAhead(args)
      }
    }
  }

  emitter.on(
    EngineEvent.BLOCK_HEIGHT_CHANGED,
    async (_uri: string, _blockHeight: number): Promise<void> => {
      const txIds = await processor.fetchTxIdsByBlockHeight({
        blockHeightMin: 0
      })
      for (const txId of txIds) {
        taskCache.updateTransactionsCache[txId] = { processing: false }
      }
    }
  )

  emitter.on(
    EngineEvent.NEW_ADDRESS_TRANSACTION,
    async (_uri: string, response: INewTransactionResponse): Promise<void> => {
      const state = taskCache.addressSubscribeCache[response.address]
      if (state != null) {
        const { path } = state
        taskCache.utxosCache[response.address] = {
          processing: false,
          path
        }
        addToTransactionCache(
          commonArgs,
          response.address,
          path.format,
          path.branch,
          taskCache.transactionsCache
        ).catch(() => {
          throw new Error('failed to add to transaction cache')
        })
        setLookAhead({ ...commonArgs, ...path }).catch(e => {
          log(e)
        })
      }
    }
  )

  return {
    processedPercent,
    async start(): Promise<void> {
      processedCount = 0
      processedPercent = 0

      await run()
      serverStates.refillServers()
    },

    async stop(): Promise<void> {
      serverStates.stop()
      clearTaskCache()
      running = false
    },

    async getFreshAddress(branch = 0): Promise<EdgeFreshAddress> {
      const walletPurpose = getPurposeTypeFromKeys(walletInfo)
      if (walletPurpose === BIP43PurposeTypeEnum.Segwit) {
        const { address: publicAddress } = await internalGetFreshAddress({
          ...commonArgs,
          format: getCurrencyFormatFromPurposeType(
            BIP43PurposeTypeEnum.WrappedSegwit
          ),
          branch: branch
        })

        const { address: segwitAddress } = await internalGetFreshAddress({
          ...commonArgs,
          format: getCurrencyFormatFromPurposeType(BIP43PurposeTypeEnum.Segwit),
          branch: branch
        })

        return {
          publicAddress,
          segwitAddress
        }
      } else {
        // Airbitz wallets only use branch 0
        if (walletPurpose !== BIP43PurposeTypeEnum.Airbitz) {
          branch = 0
        }

        const {
          address: publicAddress,
          legacyAddress
        } = await internalGetFreshAddress({
          ...commonArgs,
          format: getCurrencyFormatFromPurposeType(walletPurpose),
          branch: branch
        })

        return {
          publicAddress,
          legacyAddress:
            legacyAddress !== publicAddress ? legacyAddress : undefined
        }
      }
    },

    async addGapLimitAddresses(addresses: string[]): Promise<void> {
      const promises = addresses.map(
        async address =>
          await markUsed({
            ...commonArgs,
            scriptPubkey: walletTools.addressToScriptPubkey(address)
          })
      )
      await Promise.all(promises)
      await run()
    },

    async broadcastTx(transaction: EdgeTransaction): Promise<string> {
      // put spent utxos into an interim data structure (saveSpentUtxo)
      // these utxos are removed once the transaction confirms
      const tx = await processor.fetchTransaction(transaction.txid)
      if (tx != null) {
        for (const inputs of tx.inputs) {
          const utxo = await processor.fetchUtxo(
            `${inputs.txId}_${inputs.outputIndex}`
          )
          if (utxo != null) {
            utxo.spent = true
            await processor.updateUtxo(utxo)
          }
        }
      }
      const txId = await serverStates.broadcastTx(transaction)
      return txId
    },
    refillServers(): void {
      serverStates.refillServers()
    },
    getServerList(): string[] {
      return serverStates.getServerList()
    },
    setServerList(serverList: string[]) {
      serverStates.setServerList(serverList)
    }
  }
}

interface CommonArgs {
  engineStarted: boolean
  network: NetworkEnum
  currencyInfo: EngineCurrencyInfo
  walletInfo: EdgeWalletInfo
  walletTools: UTXOPluginWalletTools
  processor: Processor
  emitter: EngineEmitter
  taskCache: TaskCache
  onAddressChecked: () => void
  io: EdgeIo
  log: EdgeLog
  serverStates: ServerStates
  lock: AwaitLock
}

interface ShortPath {
  format: CurrencyFormat
  branch: number
}
interface TaskCache {
  addressWatching: boolean
  blockWatching: boolean
  addressSubscribeCache: AddressSubscribeCache
  utxosCache: UtxosCache
  rawUtxosCache: RawUtxoCache
  processedUtxosCache: ProcessedUtxoCache
  transactionsCache: AddressTransactionCache
  updateTransactionsCache: UpdateTransactionCache
}

interface UpdateTransactionCache {
  [key: string]: { processing: boolean }
}
interface AddressSubscribeCache {
  [key: string]: { processing: boolean; path: ShortPath }
}
interface UtxosCache {
  [key: string]: { processing: boolean; path: ShortPath }
}
interface ProcessedUtxoCache {
  [key: string]: {
    processing: boolean
    full: boolean
    utxos: IUTXO[]
    path: ShortPath
  }
}
interface RawUtxoCache {
  [key: string]: {
    processing: boolean
    path: ShortPath
    address: Required<IAddress>
    requiredCount: number
  }
}
interface AddressTransactionCache {
  [key: string]: {
    processing: boolean
    path: ShortPath
    page: number
    networkQueryVal: number
  }
}

interface FormatArgs extends CommonArgs, ShortPath {}

interface SetLookAheadArgs extends FormatArgs {}

const markUsed = async (args: SaveAddressArgs): Promise<void> => {
  const { scriptPubkey, processor } = args

  await processor.saveUsedAddress(scriptPubkey)
}

const setLookAhead = async (args: SetLookAheadArgs): Promise<void> => {
  const { lock, format, branch, currencyInfo, walletTools, processor } = args
  await lock.acquireAsync()
  try {
    const partialPath: Omit<AddressPath, 'addressIndex'> = {
      format,
      changeIndex: branch
    }

    const getLastUsed = async (): Promise<number> =>
      await findLastUsedIndex({ ...args, ...partialPath })
    const getAddressCount = (): number =>
      processor.getNumAddressesFromPathPartition(partialPath)

    let lastUsed = await getLastUsed()
    let addressCount = getAddressCount()
    const addresses: string[] = []

    if (Object.keys(args.taskCache.addressSubscribeCache).length === 0) {
      for (let addressIndex = 0; addressIndex <= addressCount; addressIndex++) {
        addresses.push(
          walletTools.getAddress({ ...partialPath, addressIndex }).address
        )
      }
    }

    while (lastUsed + currencyInfo.gapLimit > addressCount) {
      const path: AddressPath = {
        ...partialPath,
        addressIndex: addressCount
      }
      const { address } = walletTools.getAddress(path)
      const scriptPubkey = walletTools.addressToScriptPubkey(address)

      let used = false
      try {
        used = (await processor.getUsedAddress(scriptPubkey)) ?? false
      } catch (err) {}

      await saveAddress({
        ...args,
        scriptPubkey,
        used,
        path
      })
      const found = addresses.some(
        subscribedAddress => subscribedAddress === address
      )
      if (!found) addresses.push(address)

      lastUsed = await getLastUsed()
      addressCount = getAddressCount()
    }
    addToAddressSubscribeCache(args, addresses, { format, branch })
  } finally {
    lock.release()
  }
}

const addToAddressSubscribeCache = (
  args: CommonArgs,
  addresses: string[],
  path: ShortPath
): void => {
  addresses.forEach(address => {
    args.taskCache.addressSubscribeCache[address] = {
      path,
      processing: false
    }
    args.taskCache.addressWatching = false
  })
}

const addToTransactionCache = async (
  args: CommonArgs,
  address: string,
  format: CurrencyFormat,
  branch: number,
  transactions: AddressTransactionCache
): Promise<void> => {
  const { walletTools, processor } = args
  // Fetch the networkQueryVal from the database
  const scriptPubkey = walletTools.addressToScriptPubkey(address)
  const { networkQueryVal = 0 } =
    (await processor.fetchAddressByScriptPubkey(scriptPubkey)) ?? {}
  transactions[address] = {
    processing: false,
    path: {
      format,
      branch
    },
    page: 1, // Page starts on 1
    networkQueryVal
  }
}

interface NextTaskArgs extends CommonArgs {
  uri: string
}

export const pickNextTask = async (
  args: NextTaskArgs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<WsTask<any> | undefined | boolean> => {
  const { taskCache, uri, serverStates } = args

  const {
    addressSubscribeCache,
    utxosCache,
    rawUtxosCache,
    processedUtxosCache,
    transactionsCache,
    updateTransactionsCache
  } = taskCache

  const serverState = serverStates.getServerState(uri)
  if (serverState == null) return

  // Loop processed utxos, these are just database ops, triggers setLookAhead if new utxos are added
  if (Object.keys(processedUtxosCache).length > 0) {
    for (const scriptPubkey of Object.keys(processedUtxosCache)) {
      // Only process when all utxos for a specific address have been gathered
      const state = processedUtxosCache[scriptPubkey]
      if (state == null) return true
      if (!state.processing && state.full) {
        state.processing = true
        await processUtxoTransactions({
          ...args,
          scriptPubkey,
          utxos: state.utxos,
          path: state.path
        })
        taskCache.processedUtxosCache = removeItem(
          processedUtxosCache,
          scriptPubkey
        )
        return true
      }
    }
  }

  // Loop unparsed utxos, some require a network call to get the full tx data
  for (const utxoString of Object.keys(rawUtxosCache)) {
    const state = rawUtxosCache[utxoString]
    const utxo: IAccountUTXO = JSON.parse(utxoString)
    if (utxo == null) continue
    if (!state.processing) {
      // check if we need to fetch additional network content for legacy purpose type
      const purposeType = currencyFormatToPurposeType(state.path.format)
      if (
        purposeType === BIP43PurposeTypeEnum.Airbitz ||
        purposeType === BIP43PurposeTypeEnum.Legacy
      ) {
        // if we do need to make a network call, check with the serverState
        if (!serverStates.serverCanGetTx(uri, utxo.txid)) return
      }
      state.processing = true
      taskCache.rawUtxosCache = removeItem(rawUtxosCache, utxoString)
      const wsTask = await processRawUtxo({
        ...args,
        ...state,
        ...state.path,
        address: state.address,
        utxo,
        id: `${utxo.txid}_${utxo.vout}`
      })
      return wsTask ?? true
    }
  }

  // Loop to process addresses to utxos
  for (const address of Object.keys(utxosCache)) {
    const state = utxosCache[address]
    // Check if we need to fetch address UTXOs
    if (!state.processing && serverStates.serverCanGetAddress(uri, address)) {
      state.processing = true

      taskCache.utxosCache = removeItem(utxosCache, address)

      // Fetch and process address UTXOs
      const wsTask = await processAddressUtxos({
        ...args,
        ...state,
        address
      })
      wsTask.deferred.promise
        .then(() => {
          serverState.addresses.add(address)
        })
        .catch(e => {
          throw e
        })
      return wsTask
    }
  }

  // Check if there are any addresses pending to be subscribed
  if (
    Object.keys(addressSubscribeCache).length > 0 &&
    !taskCache.addressWatching
  ) {
    // Loop each address that needs to be subscribed
    for (const address of Object.keys(addressSubscribeCache)) {
      const state = addressSubscribeCache[address]
      // Add address in the cache to the set of addresses to watch
      const { path, processing: subscribed } = state
      // only process newly watched addresses
      if (subscribed) continue
      if (path != null) {
        // Add the newly watched addresses to the UTXO cache
        utxosCache[address] = {
          processing: false,
          path
        }
        await addToTransactionCache(
          args,
          address,
          path.format,
          path.branch,
          transactionsCache
        )
      }
      state.processing = true
    }

    taskCache.addressWatching = true

    const queryTime = Date.now()
    const deferredAddressSub = new Deferred<unknown>()
    deferredAddressSub.promise
      .then(() => {
        serverStates.serverScoreUp(uri, Date.now() - queryTime)
      })
      .catch(() => {
        taskCache.addressWatching = false
      })
    deferredAddressSub.promise.catch(() => {
      taskCache.addressWatching = false
    })
    serverStates.watchAddresses(
      uri,
      Array.from(Object.keys(addressSubscribeCache)),
      deferredAddressSub
    )
    return true
  }

  // subscribe all servers to new blocks
  if (!serverState.subscribedBlocks) {
    serverState.subscribedBlocks = true
    const queryTime = Date.now()
    const deferredBlockSub = new Deferred<unknown>()
    deferredBlockSub.promise
      .then(() => {
        serverStates.serverScoreUp(uri, Date.now() - queryTime)
      })
      .catch(() => {
        serverState.subscribedBlocks = false
      })
    serverStates.watchBlocks(uri, deferredBlockSub)
    return true
  }

  // filled when transactions potentially changed (e.g. through new block notification)
  if (Object.keys(updateTransactionsCache).length > 0) {
    for (const txId of Object.keys(updateTransactionsCache)) {
      if (
        !updateTransactionsCache[txId].processing &&
        serverStates.serverCanGetTx(uri, txId)
      ) {
        updateTransactionsCache[txId].processing = true
        taskCache.updateTransactionsCache = removeItem(
          updateTransactionsCache,
          txId
        )
        const updateTransactionTask = updateTransactions({ ...args, txId })
        // once resolved, add the txid to the server cache
        updateTransactionTask.deferred.promise
          .then(() => {
            serverState.txids.add(txId)
          })
          .catch(e => {
            throw e
          })
        return updateTransactionTask
      }
    }
    return true
  }

  // loop to get and process transaction history of single addresses, triggers setLookAhead
  for (const address of Object.keys(transactionsCache)) {
    const state = transactionsCache[address]
    if (!state.processing && serverStates.serverCanGetAddress(uri, address)) {
      state.processing = true

      taskCache.transactionsCache = removeItem(transactionsCache, address)

      // Fetch and process address UTXOs
      const wsTask = await processAddressTransactions({
        ...args,
        ...state,
        address
      })
      wsTask.deferred.promise
        .then(() => {
          serverState.addresses.add(address)
        })
        .catch(e => {
          throw e
        })
      return wsTask
    }
  }
}

interface UpdateTransactionsArgs extends CommonArgs {
  txId: string
}

const updateTransactions = (
  args: UpdateTransactionsArgs
): WsTask<ITransaction> => {
  const { txId, processor, taskCache } = args
  const deferredITransaction = new Deferred<ITransaction>()
  deferredITransaction.promise
    .then(async (rawTx: ITransaction) => {
      const tx = processRawTx({ ...args, tx: rawTx })
      // check if tx is still not confirmed, if so, don't change anything
      if (tx.blockHeight < 1) {
        return
      }
      for (const input of tx.inputs) {
        await processor.removeUtxo(`${input.txId}_${input.outputIndex}`)
      }
      await processor.removeTxIdByBlockHeight({ blockHeight: 0, txid: txId })
      await processor.insertTxIdByBlockHeight({
        blockHeight: tx.blockHeight,
        txid: txId
      })
      await processor.updateTransaction({ txid: txId, data: tx })
    })
    .catch(() => {
      taskCache.updateTransactionsCache[txId] = { processing: false }
    })
  return {
    ...transactionMessage(txId),
    deferred: deferredITransaction
  }
}

interface SaveAddressArgs extends CommonArgs {
  scriptPubkey: string
  path?: AddressPath
  used?: boolean
}

const saveAddress = async (args: SaveAddressArgs): Promise<void> => {
  const { scriptPubkey, path, used = false, processor } = args

  try {
    await processor.saveAddress({
      scriptPubkey,
      path,
      used,
      networkQueryVal: 0,
      lastQuery: 0,
      lastTouched: 0,
      balance: '0'
    })
  } catch (err) {
    if (err.message === 'Address already exists.') {
      await processor.updateAddressByScriptPubkey({
        scriptPubkey,
        data: {
          path,
          used
        }
      })
    } else {
      throw err
    }
  }
}

interface GetTotalAddressCountArgs {
  currencyInfo: EngineCurrencyInfo
  walletInfo: EdgeWalletInfo
  processor: Processor
}

const getTotalAddressCount = async (
  args: GetTotalAddressCountArgs
): Promise<number> => {
  const { walletInfo } = args

  const walletFormats = getWalletSupportedFormats(walletInfo)

  let count = 0
  for (const format of walletFormats) {
    count += await getFormatAddressCount({ ...args, format })
  }
  return count
}

interface GetFormatAddressCountArgs extends GetTotalAddressCountArgs {
  format: CurrencyFormat
}

const getFormatAddressCount = async (
  args: GetFormatAddressCountArgs
): Promise<number> => {
  const { format, currencyInfo, processor } = args

  let count = 0

  const branches = getFormatSupportedBranches(format)
  for (const branch of branches) {
    let branchCount = processor.getNumAddressesFromPathPartition({
      format,
      changeIndex: branch
    })
    if (branchCount < currencyInfo.gapLimit) branchCount = currencyInfo.gapLimit
    count += branchCount
  }

  return count
}

interface FindLastUsedIndexArgs extends FormatArgs {}

/**
 * Assumes the last used index is:
 *    addressCount - gapLimit - 1
 * Verified by checking the ~used~ flag on the address and then checking newer ones.
 * @param args - FindLastUsedIndexArgs
 */
const findLastUsedIndex = async (
  args: FindLastUsedIndexArgs
): Promise<number> => {
  const { format, branch, currencyInfo, processor } = args

  const partialPath: Omit<AddressPath, 'addressIndex'> = {
    format,
    changeIndex: branch
  }
  const addressCount = processor.getNumAddressesFromPathPartition(partialPath)
  // Start 1 index behind the assumed last used index
  let lastUsedIndex = Math.max(addressCount - currencyInfo.gapLimit - 1, 0)

  for (let i = lastUsedIndex; i < addressCount; i++) {
    const { used } = await fetchAddressDataByPath({
      ...args,
      path: {
        ...partialPath,
        addressIndex: i
      }
    })

    if (used) {
      lastUsedIndex = i
    }
  }

  return lastUsedIndex
}

interface FetchAddressDataByPath extends CommonArgs {
  path: AddressPath
}

const fetchAddressDataByPath = async (
  args: FetchAddressDataByPath
): Promise<IAddress> => {
  const { path, processor, walletTools } = args

  const scriptPubkey =
    (await processor.fetchScriptPubkeyByPath(path)) ??
    walletTools.getScriptPubkey(path).scriptPubkey

  const addressData = await processor.fetchAddressByScriptPubkey(scriptPubkey)
  if (addressData == null) {
    throw new Error('Address data unknown')
  }
  return addressData
}

interface GetFreshAddressArgs extends FormatArgs {}

interface GetFreshAddressReturn {
  address: string
  legacyAddress: string
}

const internalGetFreshAddress = async (
  args: GetFreshAddressArgs
): Promise<GetFreshAddressReturn> => {
  const { format, branch, walletTools, processor } = args

  const path: AddressPath = {
    format,
    changeIndex: branch,
    addressIndex: (await findLastUsedIndex(args)) + 1
  }
  const scriptPubkey =
    (await processor.fetchScriptPubkeyByPath(path)) ??
    (await walletTools.getScriptPubkey(path)).scriptPubkey
  if (scriptPubkey == null) {
    throw new Error('Unknown address path')
  }
  return walletTools.scriptPubkeyToAddress({
    scriptPubkey,
    format
  })
}

interface ProcessAddressTxsArgs extends CommonArgs {
  processing: boolean
  page: number
  networkQueryVal: number
  path: ShortPath
  address: string
  uri: string
}

type addressResponse = IAccountDetailsBasic &
  ITransactionDetailsPaginationResponse

const processAddressTransactions = async (
  args: ProcessAddressTxsArgs
): Promise<WsTask<addressResponse>> => {
  const {
    address,
    page = 1,
    networkQueryVal,
    processor,
    walletTools,
    path,
    taskCache,
    serverStates,
    uri
  } = args
  const transactionsCache = taskCache.transactionsCache

  const scriptPubkey = walletTools.addressToScriptPubkey(address)
  const addressData = await processor.fetchAddressByScriptPubkey(scriptPubkey)
  if (addressData == null) {
    throw new Error(`could not find address with script pubkey ${scriptPubkey}`)
  }

  const queryTime = Date.now()
  const deferredAddressResponse = new Deferred<addressResponse>()
  deferredAddressResponse.promise
    .then(async (value: addressResponse) => {
      serverStates.serverScoreUp(uri, Date.now() - queryTime)
      const { transactions = [], txs, unconfirmedTxs, totalPages } = value

      // If address is used and previously not marked as used, mark as used.
      const used = txs > 0 || unconfirmedTxs > 0

      if (used && !(addressData.used ?? false) && page === 1) {
        await processor.updateAddressByScriptPubkey({
          scriptPubkey,
          data: {
            used
          }
        })
        await setLookAhead({ ...args, ...path })
      }

      for (const rawTx of transactions) {
        const tx = processRawTx({ ...args, tx: rawTx })
        await processor.saveTransaction(tx)
      }

      if (page < totalPages) {
        // Add the address back to the cache, incrementing the page
        transactionsCache[address] = {
          path,
          networkQueryVal,
          processing: false,
          page: page + 1
        }
      } else {
        await processor.updateAddressByScriptPubkey({
          scriptPubkey,
          data: {
            networkQueryVal: serverStates.getBlockHeight(uri)
          }
        })

        // Callback for when an address has been fully processed
        args.onAddressChecked()

        await setLookAhead({ ...args, ...path })
      }
    })
    .catch(() => {
      args.processing = false
      transactionsCache[address] = {
        path,
        networkQueryVal,
        processing: args.processing,
        page
      }
    })
  return {
    ...addressMessage(address, {
      details: 'txs',
      from: networkQueryVal,
      perPage: BLOCKBOOK_TXS_PER_PAGE,
      page
    }),
    deferred: deferredAddressResponse
  }
}

interface ProcessRawTxArgs extends CommonArgs {
  tx: ITransaction
}

const processRawTx = (args: ProcessRawTxArgs): IProcessorTransaction => {
  const { tx, currencyInfo } = args
  return {
    txid: tx.txid,
    hex: tx.hex,
    // Blockbook can return a blockHeight of -1 when the tx is pending in the mempool
    blockHeight: tx.blockHeight > 0 ? tx.blockHeight : 0,
    date: tx.blockTime,
    fees: tx.fees,
    inputs: tx.vin.map(input => ({
      txId: input.txid,
      outputIndex: input.vout, // case for tx `fefac8c22ba1178df5d7c90b78cc1c203d1a9f5f5506f7b8f6f469fa821c2674` no `vout` for input
      scriptPubkey: validScriptPubkeyFromAddress({
        address: input.addresses[0],
        coin: currencyInfo.network,
        network: args.network
      }),
      amount: input.value
    })),
    outputs: tx.vout.map(output => ({
      index: output.n,
      scriptPubkey:
        output.hex ??
        validScriptPubkeyFromAddress({
          address: output.addresses[0],
          coin: currencyInfo.network,
          network: args.network
        }),
      amount: output.value
    })),
    ourIns: [],
    ourOuts: [],
    ourAmount: '0'
  }
}

interface ProcessAddressUtxosArgs extends CommonArgs {
  processing: boolean
  path: ShortPath
  address: string
  uri: string
}

const processAddressUtxos = async (
  args: ProcessAddressUtxosArgs
): Promise<WsTask<IAccountUTXO[]>> => {
  const {
    address,
    walletTools,
    processor,
    taskCache,
    path,
    serverStates,
    uri
  } = args
  const { utxosCache, rawUtxosCache } = taskCache
  const queryTime = Date.now()
  const deferredIAccountUTXOs = new Deferred<IAccountUTXO[]>()
  deferredIAccountUTXOs.promise
    .then(async (utxos: IAccountUTXO[]) => {
      serverStates.serverScoreUp(uri, Date.now() - queryTime)
      const scriptPubkey = walletTools.addressToScriptPubkey(address)
      const addressData = await processor.fetchAddressByScriptPubkey(
        scriptPubkey
      )
      if (addressData == null || addressData.path == null) {
        return
      }
      for (const utxo of utxos) {
        rawUtxosCache[JSON.stringify(utxo)] = {
          processing: false,
          requiredCount: utxos.length,
          path,
          // TypeScript yells otherwise
          address: { ...addressData, path: addressData.path }
        }
      }
    })
    .catch(() => {
      args.processing = false
      utxosCache[address] = {
        processing: args.processing,
        path
      }
    })
  return {
    ...addressUtxosMessage(address),
    deferred: deferredIAccountUTXOs
  }
}

interface ProcessUtxoTransactionArgs extends CommonArgs {
  scriptPubkey: string
  utxos: IUTXO[]
  path: ShortPath
}

const processUtxoTransactions = async (
  args: ProcessUtxoTransactionArgs
): Promise<void> => {
  const { scriptPubkey, utxos, currencyInfo, processor, emitter, log } = args

  const currentUtxos = await processor.fetchUtxosByScriptPubkey(scriptPubkey)
  let oldBalance = '0'
  for (const utxo of currentUtxos) {
    oldBalance = bs.add(utxo.value, oldBalance)
    await processor.removeUtxo(utxo.id)
  }

  let newBalance = '0'
  for (const utxo of utxos) {
    newBalance = bs.add(utxo.value, newBalance)
    await processor.saveUtxo(utxo)
  }

  const diff = bs.sub(newBalance, oldBalance)
  if (diff !== '0') {
    log('balance changed:', { scriptPubkey, diff })
    emitter.emit(
      EngineEvent.ADDRESS_BALANCE_CHANGED,
      currencyInfo.currencyCode,
      diff
    )

    await processor.updateAddressByScriptPubkey({
      scriptPubkey,
      data: {
        balance: newBalance,
        used: true
      }
    })
  }
  setLookAhead({ ...args, ...args.path }).catch(err => {
    log.error(err)
    throw err
  })
}

interface ProcessRawUtxoArgs extends FormatArgs {
  path: ShortPath
  requiredCount: number
  utxo: IAccountUTXO
  id: string
  address: Required<IAddress>
  uri: string
}

const processRawUtxo = async (
  args: ProcessRawUtxoArgs
): Promise<WsTask<ITransaction> | undefined> => {
  const {
    utxo,
    id,
    address,
    format,
    walletTools,
    processor,
    path,
    taskCache,
    requiredCount,
    serverStates,
    uri,
    log
  } = args
  const { rawUtxosCache, processedUtxosCache } = taskCache
  let scriptType: ScriptTypeEnum
  let script: string
  let redeemScript: string | undefined

  // Function to call once we are finished
  const done = (): void =>
    addToProcessedUtxosCache(
      processedUtxosCache,
      path,
      address.scriptPubkey,
      requiredCount,
      {
        id,
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        scriptPubkey: address.scriptPubkey,
        script,
        redeemScript,
        scriptType,
        blockHeight: utxo.height ?? -1,
        spent: false
      }
    )

  let tx: IProcessorTransaction | undefined
  switch (currencyFormatToPurposeType(format)) {
    case BIP43PurposeTypeEnum.Airbitz:
    case BIP43PurposeTypeEnum.Legacy:
      scriptType = ScriptTypeEnum.p2pkh

      // Legacy UTXOs need the previous transaction hex as the script
      // If we do not currently have it, add it to the queue to fetch it
      tx = await processor.fetchTransaction(utxo.txid)
      if (tx == null) {
        const queryTime = Date.now()
        const deferredITransaction = new Deferred<ITransaction>()
        deferredITransaction.promise
          .then((rawTx: ITransaction) => {
            serverStates.serverScoreUp(uri, Date.now() - queryTime)
            const processedTx = processRawTx({ ...args, tx: rawTx })
            script = processedTx.hex
            // Only after we have successfully fetched the tx, set our script and call done
            done()
          })
          .catch(e => {
            // If something went wrong, add the UTXO back to the queue
            log('error in processed utxos cache, re-adding utxo to cache:', e)
            rawUtxosCache[JSON.stringify(utxo)] = {
              processing: false,
              path,
              address,
              requiredCount
            }
          })
        return {
          ...transactionMessage(utxo.txid),
          deferred: deferredITransaction
        }
      } else {
        script = tx.hex
      }

      break
    case BIP43PurposeTypeEnum.WrappedSegwit:
      scriptType = ScriptTypeEnum.p2wpkhp2sh
      script = address.scriptPubkey
      redeemScript = walletTools.getScriptPubkey(address.path).redeemScript

      break
    case BIP43PurposeTypeEnum.Segwit:
      scriptType = ScriptTypeEnum.p2wpkh
      script = address.scriptPubkey

      break
  }

  // Since we have everything, call done
  done()
}

const addToProcessedUtxosCache = (
  processedUtxosCache: ProcessedUtxoCache,
  path: ShortPath,
  scriptPubkey: string,
  requiredCount: number,
  utxo: IUTXO
): void => {
  const processedUtxos = processedUtxosCache[scriptPubkey] ?? {
    utxos: [],
    processing: true,
    path,
    full: false
  }
  const found = processedUtxos.utxos.some(
    processedUtxo => processedUtxo.id === utxo.id
  )

  if (found) return

  // ensure that no object inconsistencies are introduced if another task is already processing
  processedUtxos.processing = true
  processedUtxos.utxos.push(utxo)
  processedUtxos.full = processedUtxos.utxos.length >= requiredCount
  processedUtxos.processing = false
  processedUtxosCache[scriptPubkey] = processedUtxos
}
