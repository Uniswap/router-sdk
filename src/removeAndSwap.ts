import { defaultAbiCoder } from '@ethersproject/abi'
import { BigintIsh, Currency, CurrencyAmount, Percent, TradeType, validateAndParseAddress } from '@uniswap/sdk-core'
import { Trade as V2Trade } from '@uniswap/v2-sdk'
import { FeeAmount, FeeOptions, Position, toHex, Trade as V3Trade } from '@uniswap/v3-sdk'
import invariant from 'tiny-invariant'
import { ADDRESS_THIS, ZERO } from './constants'
import { Trade } from './entities/trade'
import { PaymentsExtended } from './paymentsExtended'
import { isV3SwapSingle, SwapRouter, unbundleTrades } from './swapRouter'

const V2ExactInputType = 'tuple(uint256 amountInBips, uint256 amountOutMin, address[] path, address to)'
const V3ExactInputSingleType =
  'tuple(uint256 amountInBips, address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOutMinimum)'
const V3ExactInputType = 'tuple(uint256 amountInBips, bytes path, address recipient, uint256 amountOutMinimum)'

const Params = `tuple(uint256 deadline, address recipient, uint256 amount0Min, uint256 amount1Min, bool swapToken0, bool swapEntireAmount, ${V2ExactInputType}[] v2ExactInputs, ${V3ExactInputSingleType}[] v3ExactInputSingles, ${V3ExactInputType}[] v3ExactInputs, bytes[] otherCalls)`

interface V2ExactInput {
  amountInBips: string
  amountOutMin: string
  path: string[]
  to: string
}

interface V3ExactInputSingle {
  amountInBips: string
  tokenIn: string
  tokenOut: string
  fee: FeeAmount
  recipient: string
  amountOutMinimum: string
}

interface V3ExactInput {
  amountInBips: string
  path: string
  recipient: string
  amountOutMinimum: string
}

function isV3ExactInputSingle(
  input: Omit<V3ExactInputSingle, 'amountInBips'> | Omit<V3ExactInput, 'amountInBips'>
): input is Omit<V3ExactInputSingle, 'amountInBips'> {
  return !!(input as V3ExactInputSingle).tokenIn
}

const BIPS = '10000'
function getBips(numerator: CurrencyAmount<Currency>, denominator: CurrencyAmount<Currency>): string {
  return numerator.divide(denominator).multiply(BIPS).quotient.toString()
}

interface ExpandedSlippageTolerance {
  remove: Percent
  swap: Percent
}

function isExpandedSlippageTolerance(
  slippageTolerance: Percent | ExpandedSlippageTolerance
): slippageTolerance is ExpandedSlippageTolerance {
  return !!(slippageTolerance as ExpandedSlippageTolerance).remove
}

export interface RemoveAndSwapOptions<T = Percent | ExpandedSlippageTolerance> {
  /**
   * How much the execution price is allowed to move unfavorably from the trade execution price.
   */
  slippageTolerance: T

  /**
   * The account that should receive the output. If omitted, output is sent to msg.sender.
   */
  recipient: string
  /**
   * When the transaction expires, in epoch seconds.
   */
  deadline: BigintIsh
  /**
   * Optional information for taking a fee on output.
   */
  fee?: FeeOptions
}

export abstract class RemoveAndSwap extends SwapRouter {
  /**
   * Cannot be constructed.
   */
  private constructor() {
    super()
  }

  private static encodeV2ExactInput(
    trade: V2Trade<Currency, Currency, TradeType>,
    options: RemoveAndSwapOptions<ExpandedSlippageTolerance>,
    routerMustCustody: boolean
  ): Omit<V2ExactInput, 'amountInBips'> {
    const { amountOut, path } = SwapRouter.parseV2Swap(trade, options.slippageTolerance.swap)

    const recipient = routerMustCustody ? ADDRESS_THIS : validateAndParseAddress(options.recipient)

    return {
      amountOutMin: amountOut,
      path,
      to: recipient,
    }
  }

  private static encodeV3ExactInput(
    trade: V3Trade<Currency, Currency, TradeType>,
    options: RemoveAndSwapOptions<ExpandedSlippageTolerance>,
    routerMustCustody: boolean
  ): (Omit<V3ExactInputSingle, 'amountInBips'> | Omit<V3ExactInput, 'amountInBips'>)[] {
    const data: (Omit<V3ExactInputSingle, 'amountInBips'> | Omit<V3ExactInput, 'amountInBips'>)[] = []

    const parsedDatas = SwapRouter.parseV3Swap(trade, options.slippageTolerance.swap)

    const recipient = routerMustCustody ? ADDRESS_THIS : validateAndParseAddress(options.recipient)

    for (const parsedData of parsedDatas) {
      if (isV3SwapSingle(parsedData)) {
        const { tokenIn, tokenOut, fee, amountOut: amountOutMinimum } = parsedData
        data.push({
          tokenIn,
          tokenOut,
          fee,
          recipient,
          amountOutMinimum,
        })
      } else {
        const { path, amountOut: amountOutMinimum } = parsedData
        data.push({
          path,
          recipient,
          amountOutMinimum,
        })
      }
    }

    return data
  }

  public static encodeRemoveAndSwap(
    position: Position,
    trades:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | (V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>)[],
    options: RemoveAndSwapOptions
  ): string {
    if (!isExpandedSlippageTolerance(options.slippageTolerance)) {
      options.slippageTolerance = {
        remove: options.slippageTolerance,
        swap: options.slippageTolerance,
      }
    }

    trades = unbundleTrades(trades)

    const inputCurrency = trades[0].inputAmount.currency

    // ensure that our slippage tolerance isn't 0 - this is highly likely to cause a tx failure
    invariant(options.slippageTolerance.swap.greaterThan(ZERO), 'SWAP_SLIPPAGE_TOLERANCE_TOO_LOW')
    // ensure that all the inputs are the same currency
    invariant(
      trades.every((trade, _, array) => trade.inputAmount.currency.equals(array[0].inputAmount.currency)),
      'TOKEN_IN_DIFF'
    )
    // ensure that all the outputs are the same currency
    invariant(
      trades.every((trade, _, array) => trade.outputAmount.currency.equals(array[0].outputAmount.currency)),
      'TOKEN_OUT_DIFF'
    )
    // ensure all trades are exact input
    invariant(
      trades.every((trade) => trade.tradeType === TradeType.EXACT_INPUT),
      'TRADE_TYPE_INVALID'
    )
    // ensure that the input is one of the pool tokens
    invariant(inputCurrency.equals(position.pool.token0) || inputCurrency.equals(position.pool.token1), 'INPUT_INVALID')

    // the invariants above ensure that it is safe to use inputCurrency like this
    const swapToken0 = inputCurrency === position.pool.token0

    const totalPositionAmount = swapToken0 ? position.amount0 : position.amount1
    const totalSwapAmount = trades.reduce(
      (sum, trade) => sum.add(trade.inputAmount),
      CurrencyAmount.fromRawAmount(inputCurrency, 0)
    )

    // ensure that we're only swapping <= the position amount
    invariant(!totalSwapAmount.greaterThan(totalPositionAmount), 'EXCESSIVE_SWAP')

    const swapEntireAmount = totalPositionAmount.equalTo(totalSwapAmount)

    const outputIsNative = trades[0].outputAmount.currency.isNative
    const routerMustCustody = outputIsNative || !!options.fee

    const v2ExactInputs: V2ExactInput[] = []
    const v3ExactInputSingles: V3ExactInputSingle[] = []
    const v3ExactInputs: V3ExactInput[] = []

    for (const trade of trades) {
      if (trade instanceof V2Trade) {
        const amountInBips = getBips(trade.inputAmount, totalSwapAmount)
        v2ExactInputs.push({
          ...RemoveAndSwap.encodeV2ExactInput(
            trade,
            options as RemoveAndSwapOptions<ExpandedSlippageTolerance>,
            routerMustCustody
          ),
          amountInBips,
        })
      } else {
        const encodedTrades = RemoveAndSwap.encodeV3ExactInput(
          trade,
          options as RemoveAndSwapOptions<ExpandedSlippageTolerance>,
          routerMustCustody
        )

        for (let i = 0; i < encodedTrades.length; i++) {
          const amountInBips = getBips(trade.swaps[i].inputAmount, totalSwapAmount)

          const encodedTrade: V3ExactInputSingle | V3ExactInput = {
            ...encodedTrades[i],
            amountInBips,
          }

          if (isV3ExactInputSingle(encodedTrade)) {
            v3ExactInputSingles.push(encodedTrade)
          } else {
            v3ExactInputs.push(encodedTrade)
          }
        }
      }
    }

    const otherCalls: string[] = []

    if (routerMustCustody) {
      if (outputIsNative) {
        otherCalls.push(
          PaymentsExtended.encodeUnwrapWETH9(ZERO, validateAndParseAddress(options.recipient), options.fee)
        )
      } else {
        otherCalls.push(
          PaymentsExtended.encodeSweepToken(
            trades[0].outputAmount.currency.wrapped,
            ZERO,
            validateAndParseAddress(options.recipient),
            options.fee
          )
        )
      }
    }

    return defaultAbiCoder.encode(
      [Params],
      [
        {
          deadline: toHex(options.deadline),
          recipient: validateAndParseAddress(options.recipient),
          amount0Min: toHex(position.burnAmountsWithSlippage(options.slippageTolerance.remove).amount0),
          amount1Min: toHex(position.burnAmountsWithSlippage(options.slippageTolerance.remove).amount1),
          swapToken0,
          swapEntireAmount,
          v2ExactInputs,
          v3ExactInputSingles,
          v3ExactInputs,
          otherCalls,
        },
      ]
    )
  }
}
