import { clearMemletCache } from 'baselet'
import * as bs from 'biggystring'
import { Disklet, navigateDisklet } from 'disklet'
import { EdgeGetTransactionsOptions } from 'edge-core-js'

import { EngineEmitter, EngineEvent } from '../../plugin/makeEngineEmitter'
import { AddressPath } from '../../plugin/types'
import {
  AddressTables,
  makeBaselets,
  TransactionTables,
  UTXOTables
} from './makeBaselets'
import { makeMutex } from './makeMutex'
import {
  AddressByScriptPubkey,
  addressPathToPrefix,
  RANGE_ID_KEY,
  RANGE_KEY,
  ScriptPubkeyByPath,
  ScriptPubkeysByBalance,
  TxById,
  TxsByDate,
  TxsByScriptPubkey,
  UtxoById
} from './Models/baselet'
import { IAddress, IProcessorTransaction, IUTXO } from './types'

const BASELET_DIR = 'tables'

interface ProcessorConfig {
  disklet: Disklet
  emitter: EngineEmitter
}

interface UpdatePartialAddressByScriptPubkeyArgs {
  scriptPubkey: string
  data: Partial<IAddress>
}

interface FetchTxIdsByBlockHeightOrRangeArgs {
  blockHeightMin: number
  blockHeightMax?: number
}

interface InsertTxIdByBlockHeightArgs {
  blockHeight: number
  txid: string
}

interface RemoveTxIdByBlockHeightArgs {
  blockHeight: number
  txid: string
}

interface UpdateTransactionArgs {
  txid: string
  data: Pick<IProcessorTransaction, 'blockHeight'>
}

export interface Processor {
  dumpData: () => Promise<DumpDataReturn[]>

  clearAll: () => Promise<void>

  fetchScriptPubkeyByPath: (path: AddressPath) => Promise<ScriptPubkeyByPath>

  fetchAddressByScriptPubkey: (
    scriptPubkey: string
  ) => Promise<AddressByScriptPubkey>

  hasSPubKey: (scriptPubkey: string) => Promise<boolean>

  fetchAddressesByPath: (
    path: Omit<AddressPath, 'addressIndex'>
  ) => Promise<AddressByScriptPubkey[]>

  getNumAddressesFromPathPartition: (
    path: Omit<AddressPath, 'addressIndex'>
  ) => number

  fetchScriptPubkeysByBalance: () => Promise<ScriptPubkeysByBalance[]>

  saveAddress: (data: IAddress) => Promise<void>

  updateAddressByScriptPubkey: (
    args: UpdatePartialAddressByScriptPubkeyArgs
  ) => Promise<void>

  getNumTransactions: () => number

  fetchTxIdsByBlockHeight: (
    args: FetchTxIdsByBlockHeightOrRangeArgs
  ) => Promise<string[]>

  insertTxIdByBlockHeight: (args: InsertTxIdByBlockHeightArgs) => Promise<void>

  removeTxIdByBlockHeight: (args: RemoveTxIdByBlockHeightArgs) => Promise<void>

  fetchTransaction: (txId: string) => Promise<TxById>

  fetchTransactionsByScriptPubkey: (
    scriptHash: string
  ) => Promise<TxsByScriptPubkey>

  fetchTransactions: (
    opts: EdgeGetTransactionsOptions
  ) => Promise<IProcessorTransaction[]>

  saveTransaction: (args: IProcessorTransaction) => Promise<void>

  updateTransaction: (args: UpdateTransactionArgs) => Promise<void>

  dropTransaction: (txId: string) => Promise<void>

  fetchUtxo: (id: string) => Promise<UtxoById>

  fetchUtxosByScriptPubkey: (scriptPubkey: string) => Promise<IUTXO[]>

  fetchAllUtxos: () => Promise<IUTXO[]>

  saveUtxo: (utxo: IUTXO) => Promise<void>

  removeUtxo: (id: string) => Promise<IUTXO>

  saveSpentUtxo: (utxo: IUTXO) => Promise<void>

  removeSpentUtxo: (id: string) => Promise<void>

  fetchSpentUtxo: (id: string) => Promise<UtxoById>

  saveUsedAddress: (scriptPubkey: string) => Promise<void>

  getUsedAddress: (scriptPubkey: string) => Promise<boolean>
}

interface DumpDataReturn {
  databaseName: string
  data: never
}

export async function makeProcessor(
  config: ProcessorConfig
): Promise<Processor> {
  const { emitter } = config

  const disklet = navigateDisklet(config.disklet, BASELET_DIR)
  let baselets = await makeBaselets({ disklet })

  const mutex = makeMutex()

  const processor: Processor = {
    async dumpData(): Promise<DumpDataReturn[]> {
      const allBases = Object.values(baselets.all)
      return await Promise.all(
        allBases.map(async base => ({
          databaseName: base.databaseName,
          data: (await base.dumpData('')) as never
        }))
      )
    },

    async clearAll(): Promise<void> {
      await clearMemletCache()
      // why is this delay needed?
      await new Promise(resolve => setTimeout(resolve, 0))
      await disklet.delete('.')
      baselets = await makeBaselets({ disklet })
    },

    async saveUsedAddress(scriptPubkey: string): Promise<void> {
      await baselets.all.usedFlagByScriptPubkey.insert('', scriptPubkey, true)
      try {
        await updateAddressByScriptPubkey({
          tables: baselets.all,
          scriptPubkey,
          data: { used: true }
        })
      } catch (_err) {
        console.log('just')
      }
    },

    async getUsedAddress(scriptPubkey: string): Promise<boolean> {
      const [used] = await baselets.all.usedFlagByScriptPubkey.query('', [
        scriptPubkey
      ])
      return used
    },

    async fetchScriptPubkeyByPath(
      path: AddressPath
    ): Promise<ScriptPubkeyByPath> {
      const [scriptPubkey] = await baselets.all.scriptPubkeyByPath.query(
        addressPathToPrefix(path),
        path.addressIndex
      )
      return scriptPubkey
    },

    async fetchTxIdsByBlockHeight(
      args: FetchTxIdsByBlockHeightOrRangeArgs
    ): Promise<string[]> {
      const { blockHeightMin, blockHeightMax } = args
      return await fetchTxIdsByBlockHeight({
        tables: baselets.all,
        fromBlock: blockHeightMin,
        toBlock: blockHeightMax
      })
    },

    async insertTxIdByBlockHeight(
      args: InsertTxIdByBlockHeightArgs
    ): Promise<void> {
      const { blockHeight, txid } = args
      await baselets.tx(async tables => {
        await saveTxIdByBlockHeight({ tables, txid, blockHeight })
      })
    },

    async removeTxIdByBlockHeight(
      args: RemoveTxIdByBlockHeightArgs
    ): Promise<void> {
      const { blockHeight, txid } = args
      await baselets.tx(async tables => {
        await deleteTxIdByBlockHeight({ tables, txid, blockHeight })
      })
    },

    async fetchAddressByScriptPubkey(
      scriptPubkey: string
    ): Promise<AddressByScriptPubkey> {
      // Lock address tables
      return await baselets.address(async tables => {
        const [address] = await fetchAddressesByScriptPubkeys({
          tables,
          scriptPubkeys: [scriptPubkey]
        })

        // If the address exists, update the last query values
        if (address != null) {
          await updateAddressByScriptPubkey({
            tables,
            scriptPubkey,
            data: {
              lastQuery: Date.now()
            }
          })
        }

        return address
      })
    },

    async hasSPubKey(scriptPubkey: string): Promise<boolean> {
      return await hasScriptPubkey({ tables: baselets.all, scriptPubkey })
    },

    async fetchAddressesByPath(
      path: Omit<AddressPath, 'addressIndex'>
    ): Promise<AddressByScriptPubkey[]> {
      const { scriptPubkeyByPath } = baselets.all

      // Determine table partition to use
      const partition = addressPathToPrefix(path)
      // Fetch all script pubkeys for the given branch specified by the path
      const startIndex = 0
      const endIndex = scriptPubkeyByPath.length(partition) - 1
      const scriptPubkeys = await scriptPubkeyByPath.query(
        partition,
        startIndex,
        endIndex
      )

      // Return address data for the script pubkeys
      return await fetchAddressesByScriptPubkeys({
        tables: baselets.all,
        scriptPubkeys
      })
    },

    getNumAddressesFromPathPartition(
      path: Omit<AddressPath, 'addressIndex'>
    ): number {
      // Number of addresses is known by the scriptPubkeyByPath CountBase table
      return baselets.all.scriptPubkeyByPath.length(addressPathToPrefix(path))
    },

    // Returned in lowest first due to RangeBase
    async fetchScriptPubkeysByBalance(): Promise<ScriptPubkeysByBalance[]> {
      const { scriptPubkeysByBalance } = baselets.all

      // Fetches all script pubkeys by getting the range value
      const max = scriptPubkeysByBalance.max('') ?? 0
      return await scriptPubkeysByBalance.query('', 0, max)
    },

    async saveAddress(data: IAddress): Promise<void> {
      // Lock address tables
      await baselets.address(async tables => {
        // Process and save address data
        await saveAddress({ tables, data })
      })

      // Lock transaction tables
      const scriptPubkeyInfo = await baselets.tx(
        async tables =>
          // After address is saved, add to the queue processing any known transactions
          await processScriptPubkeyTxs({
            tables,
            scriptPubkey: data.scriptPubkey,
            emitter
          })
      )

      // If script pubkey is used, update values
      if (scriptPubkeyInfo.used) {
        // Lock address tables
        await baselets.address(async tables => {
          await updateAddressByScriptPubkey({
            tables,
            scriptPubkey: data.scriptPubkey,
            data: scriptPubkeyInfo
          })
        })
      }
    },

    async updateAddressByScriptPubkey(
      args: UpdatePartialAddressByScriptPubkeyArgs
    ): Promise<void> {
      const { scriptPubkey, data } = args
      // Lock address tables
      await baselets.address(async tables => {
        await updateAddressByScriptPubkey({ tables, scriptPubkey, data })
      })
    },

    getNumTransactions(): number {
      // Grab the current length of the transaction database
      return baselets.all.txsByDate.size('')
    },

    async fetchTransaction(txid: string): Promise<TxById> {
      // Lock transaction tables
      return await baselets.tx(
        async tables =>
          // Fetch and return transaction from database
          await fetchTx({ tables, txid })
      )
    },

    async fetchTransactionsByScriptPubkey(
      scriptPubkey: string
    ): Promise<TxsByScriptPubkey> {
      // Lock transaction tables
      return await baselets.tx(
        async tables =>
          // Fetch and return indices for transactions related to the script pubkey
          await fetchTxsByScriptPubkey({ tables, scriptPubkey })
      )
    },

    async fetchTransactions(
      opts: EdgeGetTransactionsOptions
    ): Promise<IProcessorTransaction[]> {
      // Lock transaction tables
      return await baselets.tx(async tables => {
        const {
          startEntries,
          startIndex,
          startDate = new Date(0),
          endDate = new Date()
        } = opts

        // Fetch transaction IDs ordered by date
        let txData: TxsByDate
        if (startEntries != null && startIndex != null) {
          txData = await tables.txsByDate.queryByCount(
            '',
            startEntries,
            startIndex
          )
        } else {
          txData = await tables.txsByDate.query(
            '',
            startDate.getTime(),
            endDate.getTime()
          )
        }

        // Fetch transaction data from the IDs
        const txs = await Promise.all(
          txData.map(
            async ({ [RANGE_ID_KEY]: txId }) =>
              await baselets.all.txById.query('', [txId]).then(([tx]) => tx)
          )
        )
        // Make sure only existing transactions are returned
        return txs.filter(tx => tx != null)
      })
    },

    async saveTransaction(tx: IProcessorTransaction): Promise<void> {
      // Lock transaction tables
      // Returns data about script pubkeys that were affected by adding the transaction
      const affectedScriptPubkeys = await baselets.tx(
        async tables =>
          await saveTx({
            tables,
            tx,
            emitter,
            // Pass helper function instead of address table to limit scope and prevent possibility of updating an address table
            hasScriptPubkey: async scriptPubkey =>
              await hasScriptPubkey({ tables: baselets.all, scriptPubkey })
          })
      )

      // Lock address tables
      await baselets.address(async tables => {
        // Update relevant address data
        for (const { scriptPubkey, ...data } of affectedScriptPubkeys) {
          await updateAddressByScriptPubkey({ tables, scriptPubkey, data })
        }
      })
    },

    async updateTransaction(args: UpdateTransactionArgs): Promise<void> {
      const { txid, data } = args
      // Lock transaction tables
      await baselets.tx(async tables => {
        // Update transaction data
        await updateTx({ tables, txid, data, emitter })
      })
    },

    async dropTransaction(txid: string): Promise<void> {
      // Lock transaction tables
      await baselets.tx(async tables => {
        await dropTx({ tables, txid })
      })
    },

    async fetchUtxo(id: string): Promise<IUTXO> {
      // Fetch UTXO data
      const [utxo] = await baselets.all.utxoById.query('', [id])
      return utxo
    },

    async fetchUtxosByScriptPubkey(scriptPubkey: string): Promise<IUTXO[]> {
      // Lock UTXO tables
      return await baselets.utxo(async tables => {
        const { utxoIdsByScriptPubkey, utxoById } = tables

        // Fetch all the UTXO IDs for the script pubkey
        const [ids = []] = await utxoIdsByScriptPubkey.query('', [scriptPubkey])

        // Short circuit querying database
        if (ids.length === 0) {
          return []
        }

        // Fetch all UTXOs from IDs
        return await utxoById.query('', ids)
      })
    },

    async fetchAllUtxos(): Promise<IUTXO[]> {
      const { utxoIdsBySize, utxoById } = baselets.all

      // Fetch all UTXO IDs
      const result = await utxoIdsBySize.query('', 0, utxoIdsBySize.max(''))
      // Short circuit querying database
      if (result.length === 0) return []

      // Just get the IDs
      const ids = result.map(({ [RANGE_ID_KEY]: id }) => id)

      // Return all UTXO data
      return utxoById.query('', ids)
    },

    async saveUtxo(utxo: IUTXO): Promise<void> {
      // Lock UTXO tables
      await baselets.utxo(async tables => {
        await saveUtxo({ tables, utxo })
      })
    },

    async removeUtxo(id: string): Promise<IUTXO> {
      // Lock UTXO tables
      return await baselets.utxo(
        async tables => await deleteUtxo({ tables, id })
      )
    },

    async removeSpentUtxo(id: string): Promise<void> {
      await baselets.all.spentUtxoById.delete('', [id])
    },

    async saveSpentUtxo(utxo: IUTXO): Promise<void> {
      await baselets.all.spentUtxoById.insert('', utxo.id, utxo)
    },

    async fetchSpentUtxo(id: string): Promise<IUTXO> {
      const [utxo] = await baselets.all.spentUtxoById.query('', [id])
      return utxo
    }
  }

  /* Decorate all processor methods with a mutexDecorator */
  /* If a new method is added to the processor, decorate  */
  /* it here as well                                      */

  async function mutexDecorator<T, V>(
    callback: (value: T) => Promise<V>
  ): Promise<(value: T) => Promise<V>> {
    return async (value: T) => await mutex(async () => await callback(value))
  }

  type Await<T> = T extends PromiseLike<infer U> ? U : T

  processor.dumpData = await mutexDecorator<
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    void,
    Await<ReturnType<typeof processor.dumpData>>
  >(processor.dumpData)
  processor.clearAll = await mutexDecorator<
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    void,
    Await<ReturnType<typeof processor.clearAll>>
  >(processor.clearAll)
  processor.fetchScriptPubkeyByPath = await mutexDecorator<
    Parameters<typeof processor.fetchScriptPubkeyByPath>[0],
    Await<ReturnType<typeof processor.fetchScriptPubkeyByPath>>
  >(processor.fetchScriptPubkeyByPath)
  processor.fetchAddressByScriptPubkey = await mutexDecorator<
    Parameters<typeof processor.fetchAddressByScriptPubkey>[0],
    Await<ReturnType<typeof processor.fetchAddressByScriptPubkey>>
  >(processor.fetchAddressByScriptPubkey)
  processor.hasSPubKey = await mutexDecorator<
    Parameters<typeof processor.hasSPubKey>[0],
    Await<ReturnType<typeof processor.hasSPubKey>>
  >(processor.hasSPubKey)
  processor.fetchAddressesByPath = await mutexDecorator<
    Parameters<typeof processor.fetchAddressesByPath>[0],
    Await<ReturnType<typeof processor.fetchAddressesByPath>>
  >(processor.fetchAddressesByPath)
  processor.fetchScriptPubkeysByBalance = await mutexDecorator<
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    void,
    Await<ReturnType<typeof processor.fetchScriptPubkeysByBalance>>
  >(processor.fetchScriptPubkeysByBalance)
  processor.saveAddress = await mutexDecorator<
    Parameters<typeof processor.saveAddress>[0],
    Await<ReturnType<typeof processor.saveAddress>>
  >(processor.saveAddress)
  processor.updateAddressByScriptPubkey = await mutexDecorator<
    Parameters<typeof processor.updateAddressByScriptPubkey>[0],
    Await<ReturnType<typeof processor.updateAddressByScriptPubkey>>
  >(processor.updateAddressByScriptPubkey)
  processor.fetchTxIdsByBlockHeight = await mutexDecorator<
    Parameters<typeof processor.fetchTxIdsByBlockHeight>[0],
    Await<ReturnType<typeof processor.fetchTxIdsByBlockHeight>>
  >(processor.fetchTxIdsByBlockHeight)
  processor.insertTxIdByBlockHeight = await mutexDecorator<
    Parameters<typeof processor.insertTxIdByBlockHeight>[0],
    Await<ReturnType<typeof processor.insertTxIdByBlockHeight>>
  >(processor.insertTxIdByBlockHeight)
  processor.removeTxIdByBlockHeight = await mutexDecorator<
    Parameters<typeof processor.removeTxIdByBlockHeight>[0],
    Await<ReturnType<typeof processor.removeTxIdByBlockHeight>>
  >(processor.removeTxIdByBlockHeight)
  processor.fetchTransaction = await mutexDecorator<
    Parameters<typeof processor.fetchTransaction>[0],
    Await<ReturnType<typeof processor.fetchTransaction>>
  >(processor.fetchTransaction)
  processor.fetchTransactionsByScriptPubkey = await mutexDecorator<
    Parameters<typeof processor.fetchTransactionsByScriptPubkey>[0],
    Await<ReturnType<typeof processor.fetchTransactionsByScriptPubkey>>
  >(processor.fetchTransactionsByScriptPubkey)
  processor.fetchTransactions = await mutexDecorator<
    Parameters<typeof processor.fetchTransactions>[0],
    Await<ReturnType<typeof processor.fetchTransactions>>
  >(processor.fetchTransactions)
  processor.saveTransaction = await mutexDecorator<
    Parameters<typeof processor.saveTransaction>[0],
    Await<ReturnType<typeof processor.saveTransaction>>
  >(processor.saveTransaction)
  processor.updateTransaction = await mutexDecorator<
    Parameters<typeof processor.updateTransaction>[0],
    Await<ReturnType<typeof processor.updateTransaction>>
  >(processor.updateTransaction)
  processor.dropTransaction = await mutexDecorator<
    Parameters<typeof processor.dropTransaction>[0],
    Await<ReturnType<typeof processor.dropTransaction>>
  >(processor.dropTransaction)
  processor.fetchUtxo = await mutexDecorator<
    Parameters<typeof processor.fetchUtxo>[0],
    Await<ReturnType<typeof processor.fetchUtxo>>
  >(processor.fetchUtxo)
  processor.fetchUtxosByScriptPubkey = await mutexDecorator<
    Parameters<typeof processor.fetchUtxosByScriptPubkey>[0],
    Await<ReturnType<typeof processor.fetchUtxosByScriptPubkey>>
  >(processor.fetchUtxosByScriptPubkey)
  processor.fetchAllUtxos = await mutexDecorator<
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    void,
    Await<ReturnType<typeof processor.fetchAllUtxos>>
  >(processor.fetchAllUtxos)
  processor.saveUtxo = await mutexDecorator<
    Parameters<typeof processor.saveUtxo>[0],
    Await<ReturnType<typeof processor.saveUtxo>>
  >(processor.saveUtxo)
  processor.removeUtxo = await mutexDecorator<
    Parameters<typeof processor.removeUtxo>[0],
    Await<ReturnType<typeof processor.removeUtxo>>
  >(processor.removeUtxo)
  processor.fetchSpentUtxo = await mutexDecorator<
    Parameters<typeof processor.fetchSpentUtxo>[0],
    Await<ReturnType<typeof processor.fetchSpentUtxo>>
  >(processor.fetchSpentUtxo)
  processor.saveSpentUtxo = await mutexDecorator<
    Parameters<typeof processor.saveSpentUtxo>[0],
    Await<ReturnType<typeof processor.saveSpentUtxo>>
  >(processor.saveSpentUtxo)
  processor.removeSpentUtxo = await mutexDecorator<
    Parameters<typeof processor.removeSpentUtxo>[0],
    Await<ReturnType<typeof processor.removeSpentUtxo>>
  >(processor.removeSpentUtxo)
  processor.getUsedAddress = await mutexDecorator<
    Parameters<typeof processor.getUsedAddress>[0],
    Await<ReturnType<typeof processor.getUsedAddress>>
  >(processor.getUsedAddress)
  processor.saveUsedAddress = await mutexDecorator<
    Parameters<typeof processor.saveUsedAddress>[0],
    Await<ReturnType<typeof processor.saveUsedAddress>>
  >(processor.saveUsedAddress)

  return processor
}

interface ProcessAndSaveAddressArgs {
  tables: AddressTables
  data: IAddress
}

/**
 * Saves a **new** address to the database and creates indices.
 *
 * Will throw an error if the address already exists. Instead, should update the
 * address by calling `processor.updateAddressByScriptPubkey`.
 * @param args {ProcessAndSaveAddressArgs}
 */
const saveAddress = async (args: ProcessAndSaveAddressArgs): Promise<void> => {
  const { tables, data } = args

  // Make sure that the address does not already exists
  const [addressData] = await tables.addressByScriptPubkey.query('', [
    data.scriptPubkey
  ])
  if (addressData != null) {
    throw new Error('Address already exists.')
  }

  try {
    // Only create an index by path if one was given
    if (data.path != null) {
      await saveScriptPubkeyByPath({
        tables,
        scriptPubkey: data.scriptPubkey,
        path: data.path
      })
    }

    // Create index for script pubkey by its balance
    await tables.scriptPubkeysByBalance.insert('', {
      [RANGE_ID_KEY]: data.scriptPubkey,
      [RANGE_KEY]: parseInt(data.balance)
    })

    // // TODO: change to rangebase
    // // Create index for most recently used
    // await tables.addressPathByMRU.insert('', index, data)

    // Save the address data by the script pubkey
    await tables.addressByScriptPubkey.insert('', data.scriptPubkey, data)
  } catch (err) {
    // TODO: rethrow?
  }
}

interface ProcessScriptPubkeyTxsArgs {
  tables: TransactionTables
  scriptPubkey: string
  emitter: EngineEmitter
}

interface ProcessScriptPubkeyTxsReturn {
  used: boolean
  lastTouched: number
}

// Find transactions associated with this scriptPubkey, process the balances and save it
/**
 * Searches the database for transactions that are related to the given script pubkey and
 * calculates the value (supplied or received) and the associated ourIns and ourOuts indices.
 * @param args {ProcessScriptPubkeyTxsArgs}
 * @returns Info on the given script pubkey after processing whether its been used or not
 * and last timestamp it was used.
 */
const processScriptPubkeyTxs = async (
  args: ProcessScriptPubkeyTxsArgs
): Promise<ProcessScriptPubkeyTxsReturn> => {
  const { tables, scriptPubkey, emitter } = args

  let used = false
  let lastTouched = 0

  // Fetch the transaction hashes and known ins and outs related to the given script pubkey
  const byScriptPubkey = await fetchTxsByScriptPubkey({ tables, scriptPubkey })
  for (const txid in byScriptPubkey) {
    // Mark script pubkey as used if there are any transactions found
    used = true
    // Fetch the transaction object from the database
    const txData = await fetchTx({ tables, txid })
    // Make sure transaction exists
    if (txData != null) {
      if (lastTouched < txData.date) {
        lastTouched = txData.date
      }

      // Update the tx balance and ourIns and ourOuts
      const tx = byScriptPubkey[txid]
      const ourAmount = await calculateTxAmount(txData)
      const ourIns = [...txData.ourIns, ...Object.keys(tx.ins)]
      const ourOuts = [...txData.ourOuts, ...Object.keys(tx.outs)]
      await updateTx({
        tables,
        txid,
        data: {
          ourAmount,
          ourIns,
          ourOuts
        },
        emitter
      })
    }
  }

  return {
    used,
    lastTouched
  }
}

interface HasScriptPubkeyArgs {
  tables: AddressTables
  scriptPubkey: string
}

/**
 * Checks the database if the wallet owns a script pubkey.
 * @param args {HasScriptPubkeyArgs}
 * @returns A boolean indicating if the wallet owns the script pubkey.
 */
const hasScriptPubkey = async (args: HasScriptPubkeyArgs): Promise<boolean> => {
  const { tables, scriptPubkey } = args

  // Fetches the address data by script pubkey
  const [address] = await fetchAddressesByScriptPubkeys({
    tables,
    scriptPubkeys: [scriptPubkey]
  })

  // Return a boolean indicating if data for the script pubkey exists
  return address != null
}

interface FetchAddressesByScriptPubkeysArgs {
  tables: AddressTables
  scriptPubkeys: string[]
}

/**
 * Fetches address data for a given array of script pubkeys.
 * @param args {FetchAddressesByScriptPubkeysArgs}
 */
const fetchAddressesByScriptPubkeys = async (
  args: FetchAddressesByScriptPubkeysArgs
): Promise<AddressByScriptPubkey[]> => {
  const { tables, scriptPubkeys } = args

  // Short circuit query to the database
  if (scriptPubkeys.length === 0) return []
  return await tables.addressByScriptPubkey.query('', scriptPubkeys)
}

interface SaveTxByScriptPubkeyArgs {
  tables: TransactionTables
  scriptPubkey: string
  txid: string
  isInput: boolean
  index: number
  save?: boolean
}

/**
 * Creates an index reference for addresses linked to an input or output of transactions.
 * @param args {SaveTxByScriptPubkeyArgs}
 */
const saveTxByScriptPubkey = async (
  args: SaveTxByScriptPubkeyArgs
): Promise<void> => {
  const { tables, scriptPubkey, txid, isInput, index, save = true } = args

  const txs = await fetchTxsByScriptPubkey({ tables, scriptPubkey })
  if (txs[txid] == null) {
    txs[txid] = {
      ins: {},
      outs: {}
    }
  }
  if (save) {
    if (isInput) {
      txs[txid].ins[index] = true
    } else {
      txs[txid].outs[index] = true
    }
  } else {
    if (isInput) {
      const { [index]: _, ...stripped } = txs[txid].ins
      txs[txid].ins = stripped
    } else {
      const { [index]: _, ...stripped } = txs[txid].outs
      txs[txid].outs = stripped
    }
  }

  await tables.txsByScriptPubkey.insert('', scriptPubkey, txs)
}

/**
 * Calculates the transaction value supplied (negative) or received (positive). In order to calculate
 * a value, the `ourIns` and `ourOuts` of the object must be populated with indices.
 * @param tx {IProcessorTransaction} A transaction object with `ourIns` and `ourOuts` populated
 */
const calculateTxAmount = (tx: IProcessorTransaction): string => {
  let ourAmount = '0'
  for (const i of tx.ourIns) {
    const { amount } = tx.inputs[parseInt(i)]
    ourAmount = bs.sub(ourAmount, amount)
  }
  for (const i of tx.ourOuts) {
    const { amount } = tx.outputs[parseInt(i)]
    ourAmount = bs.add(ourAmount, amount)
  }

  return ourAmount
}

interface SaveScriptPubkeyByPathArgs {
  tables: AddressTables
  scriptPubkey: string
  path: AddressPath
}

/**
 * Saves an index record of a script pubkey for a specific account path.
 * @param args {SaveScriptPubkeyByPathArgs}
 */
const saveScriptPubkeyByPath = async (
  args: SaveScriptPubkeyByPathArgs
): Promise<void> => {
  await args.tables.scriptPubkeyByPath.insert(
    addressPathToPrefix(args.path),
    args.path.addressIndex,
    args.scriptPubkey
  )
}

interface UpdateAddressByScriptPubkeyArgs {
  tables: AddressTables
  scriptPubkey: string
  data: Partial<IAddress>
}

/**
 * Updates address data given a script pubkey.
 * @param args {UpdateAddressByScriptPubkeyArgs}
 * @returns The fully updated address data.
 */
const updateAddressByScriptPubkey = async (
  args: UpdateAddressByScriptPubkeyArgs
): Promise<IAddress> => {
  const { tables, scriptPubkey, data } = args

  // Make sure there is an address already saved for the given script pubkey
  const [address]: Array<
    IAddress | undefined
  > = await tables.addressByScriptPubkey.query('', [scriptPubkey])
  if (address == null) {
    throw new Error('Cannot update address that does not exist')
  }

  // Holds array of promises that will be passed to a Promise.all
  const promises: Array<Promise<unknown>> = []

  // Only update the networkQueryVal if one was given and is greater than the existing value
  if (
    data.networkQueryVal != null &&
    data.networkQueryVal > address.networkQueryVal
  ) {
    address.networkQueryVal = data.networkQueryVal
  }

  // Only update the lastQuery value if one was given and is greater than the existing value
  if (data.lastQuery != null && data.lastQuery > address.lastQuery) {
    address.lastQuery = data.lastQuery
  }

  // Only update the lastTouched value if one was given and is greater than the existing value
  if (data.lastTouched != null && data.lastTouched > address.lastTouched) {
    address.lastTouched = data.lastTouched
  }

  // Only update the used field if the given one is true and the existing one is false
  if (data.used != null && data.used && !address.used) {
    address.used = data.used
  }

  // Only update the balance field if one was given and does not equal the existing value
  if (data.balance != null && data.balance !== address.balance) {
    // Also update the index of the address by balance
    const oldRange = parseInt(address.balance)
    address.balance = data.balance
    promises.push(
      tables.scriptPubkeysByBalance.update('', oldRange, {
        [RANGE_ID_KEY]: address.scriptPubkey,
        [RANGE_KEY]: parseInt(data.balance)
      })
    )
  }

  // Only update the path field if one was given and currently does not have one
  // NOTE: Addresses can be stored in the db without a path due to the `EdgeCurrencyEngine.addGapLimitAddresses` function
  //  Once an address path is known, it should never be updated
  if (data.path != null && address.path == null) {
    address.path = data.path
    promises.push(
      saveScriptPubkeyByPath({ tables, scriptPubkey, path: data.path })
    )
  }

  // Await the promises to update the address database
  await Promise.all([
    ...promises,
    tables.addressByScriptPubkey.insert('', address.scriptPubkey, address)
  ])

  // Return the updated address data
  return address
}

interface FetchTxByScriptPubkeyArgs {
  tables: TransactionTables
  scriptPubkey: string
}

/**
 * Fetches the ins and outs for transactions that are related to the specified script pubkey.
 * @param args {FetchTxByScriptPubkeyArgs}
 * @returns An object with the keys as the transaction hashes and the values as the ins and out indices.
 *  Example:
 *      {
 *        "fd174c5f3f...": {
 *          "ins": {},
 *          "outs": {
 *            "0": true
 *          }
 *        }
 *      }
 */
const fetchTxsByScriptPubkey = async (
  args: FetchTxByScriptPubkeyArgs
): Promise<TxsByScriptPubkey> => {
  const { tables, scriptPubkey } = args

  const [txs] = await tables.txsByScriptPubkey.query('', [scriptPubkey])
  return txs ?? {}
}

interface FetchTxArgs {
  tables: TransactionTables
  txid: string
}

/**
 * Fetches a transaction object from the database. Returns `undefined` if no transaction
 * was found for the given `txid`.
 * @param args {FetchTxArgs}
 * @returns A `ProcessorTransaction` object or `undefined`
 */
const fetchTx = async (args: FetchTxArgs): Promise<TxById> => {
  const { tables, txid } = args

  const [data] = await tables.txById.query('', [txid])
  return data
}

interface SaveTxArgs {
  tables: TransactionTables
  tx: IProcessorTransaction
  emitter: EngineEmitter
  hasScriptPubkey: (scriptPubkey: string) => Promise<boolean>
}

type SaveTxReturn = Array<{
  scriptPubkey: string
  used: boolean
  lastTouched: number
}>

/**
 * Saves a transaction to the database. Can call `saveTx` for transactions already
 * in the database as several addresses will likely reference the same transaction.
 * @param args {SaveTxArgs}
 * @returns An array of script pubkeys and data to update it with
 */
const saveTx = async (args: SaveTxArgs): Promise<SaveTxReturn> => {
  const { tables, tx, emitter, hasScriptPubkey } = args

  // Update the date index
  const existingTx = await fetchTx({ tables, txid: tx.txid })
  // If the transaction does not already exists, add an index for the date
  // NOTE: Multiple address can try to save the same transaction
  if (existingTx == null) {
    // Add an index for the date
    await tables.txsByDate.insert('', {
      [RANGE_ID_KEY]: tx.txid,
      [RANGE_KEY]: tx.date
    })
  }

  // Check every input and output of the transaction to create indices
  // Keep reference of any script pubkeys in the tx that are in the wallet to update
  const affectedScriptPubkeys: SaveTxReturn = []
  for (const isInput of [true, false]) {
    const arr = isInput ? tx.inputs : tx.outputs
    for (let i = 0; i < arr.length; i++) {
      const { scriptPubkey } = arr[i]

      // Create index for this tx and script pubkey
      await saveTxByScriptPubkey({
        tables,
        scriptPubkey,
        txid: tx.txid,
        isInput,
        index: i
      })

      // If the script pubkey is in wallet, update ourIns and ourOuts
      const own = await hasScriptPubkey(scriptPubkey)
      if (own) {
        if (isInput) {
          tx.ourIns.push(i.toString())
        } else {
          tx.ourOuts.push(i.toString())
        }

        // Keep reference of script pubkeys that should be updated
        affectedScriptPubkeys.push({
          scriptPubkey,
          used: true,
          lastTouched: tx.date
        })
      }
    }
  }
  // After ourIns and ourOuts have been determined, calculate tx amount
  tx.ourAmount = await calculateTxAmount(tx)

  // Create index by block height
  await saveTxIdByBlockHeight({
    tables,
    txid: tx.txid,
    blockHeight: tx.blockHeight
  })

  // Save transaction to database
  await tables.txById.insert('', tx.txid, tx)

  // Emit event that the transaction was saved
  emitter.emit(EngineEvent.PROCESSOR_TRANSACTION_CHANGED, tx)

  // Return script pubkeys to update
  return affectedScriptPubkeys
}

interface UpdateTxArgs {
  tables: TransactionTables
  txid: string
  data: Partial<IProcessorTransaction>
  emitter: EngineEmitter
}

/**
 * Updates a transaction data and indices.
 * @param args {UpdateTxArgs}
 * @returns The updated transaction data
 */
const updateTx = async (args: UpdateTxArgs): Promise<IProcessorTransaction> => {
  const { tables, txid, data, emitter } = args

  const tx = await fetchTx({ tables, txid })
  if (tx == null) {
    throw new Error('Cannot update transaction that does not exists')
  }

  // Only update blockHeight if one was given and is grater than the existing one
  if (data.blockHeight != null && data.blockHeight > tx.blockHeight) {
    // Update the index by block height
    await deleteTxIdByBlockHeight({ tables, txid, blockHeight: tx.blockHeight })
    await saveTxIdByBlockHeight({ tables, txid, blockHeight: data.blockHeight })

    tx.blockHeight = data.blockHeight
  }

  // Only update the date index if the existing tx date does not match the one given
  if (data.date != null && data.date !== tx.date) {
    await tables.txsByDate.delete('', tx.date, tx.txid)
    await tables.txsByDate.insert('', {
      [RANGE_ID_KEY]: tx.txid,
      [RANGE_KEY]: data.date
    })
  }

  // Only update ourIns if one was given
  if (data.ourIns != null) {
    tx.ourIns = data.ourIns
  }

  // Only update ourOuts if one was given
  if (data.ourOuts != null) {
    tx.ourOuts = data.ourOuts
  }

  // Only update ourAmount if one was given
  if (data.ourAmount != null) {
    tx.ourAmount = data.ourAmount
  }

  // Update the transaction record
  await tables.txById.insert('', txid, tx)

  // Emit event that the transaction was updated
  emitter.emit(EngineEvent.PROCESSOR_TRANSACTION_CHANGED, tx)

  // return the updated data
  return tx
}

interface DropTxArgs {
  tables: TransactionTables
  txid: string
}

/**
 * Deletes indices from the transaction database and sets the `blockHeight` to -1.
 * @param args {DropTxArgs}
 */
const dropTx = async (args: DropTxArgs): Promise<void> => {
  const { tables, txid } = args

  // Make sure the transaction exists
  const tx = await fetchTx({ tables, txid })
  if (tx == null) return

  // Delete indices for script pubkeys
  for (const isInput of [true, false]) {
    const arr = isInput ? tx.inputs : tx.outputs
    for (let i = 0; i < arr.length; i++) {
      const { scriptPubkey } = arr[i]
      await saveTxByScriptPubkey({
        tables,
        scriptPubkey,
        txid,
        isInput,
        index: i,
        save: false
      })
    }
  }

  // Delete index for transaction by block height
  await deleteTxIdByBlockHeight({
    tables,
    txid: tx.txid,
    blockHeight: tx.blockHeight
  })

  // Update the block height
  tx.blockHeight = -1

  // Save transaction data
  await tables.txById.insert('', tx.txid, tx)
}

interface FetchTxIdsByBlockHeightArgs {
  tables: TransactionTables
  fromBlock: number
  toBlock?: number
}

/**
 * Fetches transaction IDs from given block height range. If no `toBlock` field is
 * given, it will only return IDs for transactions in the `fromBlock`.
 * Newest transactions will be first.
 * @param args {FetchTxIdsByBlockHeightArgs}
 */
const fetchTxIdsByBlockHeight = async (
  args: FetchTxIdsByBlockHeightArgs
): Promise<string[]> => {
  const { tables, fromBlock, toBlock } = args

  // Fetch transaction IDs
  const result = await tables.txIdsByBlockHeight.query('', fromBlock, toBlock)

  return (
    result
      // RangeBase returns values with lowest value first
      .reverse()
      // Return array of just the IDs
      .map(({ [RANGE_ID_KEY]: id }) => id)
  )
}

interface SaveTxIdByBlockHeightArgs {
  tables: TransactionTables
  txid: string
  blockHeight: number
}

/**
 * Add an index for a transaction by block height.
 * @param args {SaveTxIdByBlockHeightArgs}
 */
const saveTxIdByBlockHeight = async (
  args: SaveTxIdByBlockHeightArgs
): Promise<void> => {
  const { tables, txid, blockHeight } = args

  // Short circuit adding index if already exists
  const data = await fetchTxIdsByBlockHeight({ tables, fromBlock: blockHeight })
  if (data.includes(txid)) return

  // Save index by block height
  await tables.txIdsByBlockHeight.insert('', {
    [RANGE_ID_KEY]: txid,
    [RANGE_KEY]: blockHeight
  })
}

interface DeleteTxIdByBlockHeightArgs {
  tables: TransactionTables
  txid: string
  blockHeight: number
}

/**
 * Remove the index for a transaction by block height.
 * @param args {DeleteTxIdByBlockHeightArgs}
 */
const deleteTxIdByBlockHeight = async (
  args: DeleteTxIdByBlockHeightArgs
): Promise<void> => {
  const { tables, txid, blockHeight } = args

  // Short circuit deleting index if one does not exists
  const data = await fetchTxIdsByBlockHeight({ tables, fromBlock: blockHeight })
  if (data.length === 0) return

  // Delete index by block height
  await tables.txIdsByBlockHeight.delete('', blockHeight, txid)
}

interface SaveUtxoArgs {
  tables: UTXOTables
  utxo: IUTXO
}

/**
 * Saves a UTXO to the database and creates indices.
 * @param args {SaveUtxoArgs}
 */
const saveUtxo = async (args: SaveUtxoArgs): Promise<void> => {
  const { tables, utxo } = args

  // Save the UTXO data
  await tables.utxoById.insert('', utxo.id, utxo)

  try {
    // Create index for size of value
    await tables.utxoIdsBySize.insert('', {
      [RANGE_ID_KEY]: utxo.id,
      [RANGE_KEY]: parseInt(utxo.value)
    })
  } catch (err) {
    if (err.message !== 'Cannot insert data because id already exists') {
      throw err
    }
  }

  // Create index for script pubkey
  const [utxoIds] = await tables.utxoIdsByScriptPubkey.query('', [
    utxo.scriptPubkey
  ])
  const set = new Set(utxoIds)
  set.add(utxo.id)
  await tables.utxoIdsByScriptPubkey.insert(
    '',
    utxo.scriptPubkey,
    Array.from(set)
  )
}

interface DeleteUtxoArgs {
  tables: UTXOTables
  id: string
}

/**
 * Deletes a UTXO and its indices.
 * @param args {DeleteUtxoArgs}
 * @returns The deleted UTXO data
 */
const deleteUtxo = async (args: DeleteUtxoArgs): Promise<IUTXO> => {
  const { tables, id } = args

  // Fetch the UTXO data
  const [utxo] = await tables.utxoById.query('', [id])
  const { scriptPubkey, value } = utxo

  // Delete UTXO data
  await tables.utxoById.delete('', [id])

  // Delete index for size of value
  await tables.utxoIdsBySize.delete('', parseInt(value), id)

  // Delete index for script pubkey
  await tables.utxoIdsByScriptPubkey.delete('', [scriptPubkey])

  // Return the deleted UTXO
  return utxo
}
