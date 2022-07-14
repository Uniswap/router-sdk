import { Interface } from '@ethersproject/abi'
import { Currency, CurrencyAmount, Percent, TradeType, validateAndParseAddress, WETH9 } from '@uniswap/sdk-core'
import { abi } from '@uniswap/swap-router-contracts/artifacts/contracts/interfaces/ISwapRouter02.sol/ISwapRouter02.json'
import { Trade as V2Trade } from '@uniswap/v2-sdk'
import {
  encodeRouteToPath,
  FeeAmount,
  FeeOptions,
  MethodParameters,
  Payments,
  PermitOptions,
  Position,
  SelfPermit,
  toHex,
  Trade as V3Trade,
} from '@uniswap/v3-sdk'
import JSBI from 'jsbi'
import invariant from 'tiny-invariant'
import { ApprovalTypes, ApproveAndCall, CondensedAddLiquidityOptions } from './approveAndCall'
import { ADDRESS_THIS, MSG_SENDER } from './constants'
import { Protocol } from './entities/protocol'
import { RouteV2, RouteV3 } from './entities/route'
import { Trade } from './entities/trade'
import { MulticallExtended, Validation } from './multicallExtended'
import { PaymentsExtended } from './paymentsExtended'

const ZERO = JSBI.BigInt(0)

export function unbundleTrades(
  trades:
    | Trade<Currency, Currency, TradeType>
    | V2Trade<Currency, Currency, TradeType>
    | V3Trade<Currency, Currency, TradeType>
    | (V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>)[]
): (V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>)[] {
  if (trades instanceof Trade) {
    invariant(
      trades.swaps.every((swap) => swap.route.protocol == Protocol.V3 || swap.route.protocol == Protocol.V2),
      'UNSUPPORTED_PROTOCOL'
    )

    let v2Andv3Trades: (V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>)[] = []

    for (const { route, inputAmount, outputAmount } of trades.swaps) {
      if (route.protocol == Protocol.V2) {
        v2Andv3Trades.push(
          new V2Trade(
            route as RouteV2<Currency, Currency>,
            trades.tradeType == TradeType.EXACT_INPUT ? inputAmount : outputAmount,
            trades.tradeType
          )
        )
      } else if (route.protocol == Protocol.V3) {
        v2Andv3Trades.push(
          V3Trade.createUncheckedTrade({
            route: route as RouteV3<Currency, Currency>,
            inputAmount,
            outputAmount,
            tradeType: trades.tradeType,
          })
        )
      }
    }

    return v2Andv3Trades
  }

  if (!Array.isArray(trades)) {
    return [trades]
  }

  return trades
}

/**
 * Options for producing the arguments to send calls to the router.
 */
export interface SwapOptions {
  /**
   * How much the execution price is allowed to move unfavorably from the trade execution price.
   */
  slippageTolerance: Percent

  /**
   * The account that should receive the output. If omitted, output is sent to msg.sender.
   */
  recipient?: string

  /**
   * Either deadline (when the transaction expires, in epoch seconds), or previousBlockhash.
   */
  deadlineOrPreviousBlockhash?: Validation

  /**
   * The optional permit parameters for spending the input.
   */
  inputTokenPermit?: PermitOptions

  /**
   * Optional information for taking a fee on output.
   */
  fee?: FeeOptions
}

export interface SwapAndAddOptions extends SwapOptions {
  /**
   * The optional permit parameters for pulling in remaining output token.
   */
  outputTokenPermit?: PermitOptions
}

interface V3SwapSingleData {
  tokenIn: string
  tokenOut: string
  fee: FeeAmount
  amountIn: string
  amountOut: string
}

interface V3SwapData {
  path: string
  amountIn: string
  amountOut: string
}

export function isV3SwapSingle(input: V3SwapSingleData | V3SwapData): input is V3SwapSingleData {
  return !!(input as V3SwapSingleData).tokenIn
}

/**
 * Represents the Uniswap V2 + V3 SwapRouter02, and has static methods for helping execute trades.
 */
export abstract class SwapRouter {
  public static INTERFACE: Interface = new Interface(abi)

  /**
   * Cannot be constructed.
   */
  protected constructor() {}

  protected static parseV2Swap(
    trade: V2Trade<Currency, Currency, TradeType>,
    slippageTolerance: Percent
  ): { amountIn: string; amountOut: string; path: string[] } {
    const amountIn = toHex(trade.maximumAmountIn(slippageTolerance).quotient)
    const amountOut = toHex(trade.minimumAmountOut(slippageTolerance).quotient)
    const path = trade.route.path.map((token) => token.address)

    return {
      amountIn,
      amountOut,
      path,
    }
  }

  private static encodeV2Swap(
    trade: V2Trade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean
  ): string {
    const { amountIn, amountOut, path } = SwapRouter.parseV2Swap(trade, options.slippageTolerance)

    const recipient = routerMustCustody
      ? ADDRESS_THIS
      : typeof options.recipient === 'undefined'
      ? MSG_SENDER
      : validateAndParseAddress(options.recipient)

    if (trade.tradeType === TradeType.EXACT_INPUT) {
      const exactInputParams = [amountIn, performAggregatedSlippageCheck ? 0 : amountOut, path, recipient]

      return SwapRouter.INTERFACE.encodeFunctionData('swapExactTokensForTokens', exactInputParams)
    } else {
      const exactOutputParams = [amountOut, amountIn, path, recipient]

      return SwapRouter.INTERFACE.encodeFunctionData('swapTokensForExactTokens', exactOutputParams)
    }
  }

  protected static parseV3Swap(
    trade: V3Trade<Currency, Currency, TradeType>,
    slippageTolerance: Percent
  ): (V3SwapSingleData | V3SwapData)[] {
    const data: (V3SwapSingleData | V3SwapData)[] = []

    for (const { route, inputAmount, outputAmount } of trade.swaps) {
      const amountIn: string = toHex(trade.maximumAmountIn(slippageTolerance, inputAmount).quotient)
      const amountOut: string = toHex(trade.minimumAmountOut(slippageTolerance, outputAmount).quotient)

      // expose different data according to whether the trade is single hop or not
      if (route.pools.length === 1) {
        data.push({
          tokenIn: route.tokenPath[0].address,
          tokenOut: route.tokenPath[1].address,
          fee: route.pools[0].fee,
          amountIn,
          amountOut,
        })
      } else {
        data.push({
          path: encodeRouteToPath(route, trade.tradeType === TradeType.EXACT_OUTPUT),
          amountIn,
          amountOut,
        })
      }
    }

    return data
  }

  private static encodeV3Swap(
    trade: V3Trade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean
  ): string[] {
    const calldatas: string[] = []

    const parsedDatas = SwapRouter.parseV3Swap(trade, options.slippageTolerance)

    for (const parsedData of parsedDatas) {
      const recipient = routerMustCustody
        ? ADDRESS_THIS
        : typeof options.recipient === 'undefined'
        ? MSG_SENDER
        : validateAndParseAddress(options.recipient)

      if (isV3SwapSingle(parsedData)) {
        if (trade.tradeType === TradeType.EXACT_INPUT) {
          const exactInputSingleParams = {
            tokenIn: parsedData.tokenIn,
            tokenOut: parsedData.tokenOut,
            fee: parsedData.fee,
            recipient,
            amountIn: parsedData.amountIn,
            amountOutMinimum: performAggregatedSlippageCheck ? 0 : parsedData.amountOut,
            sqrtPriceLimitX96: 0,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactInputSingle', [exactInputSingleParams]))
        } else {
          const exactOutputSingleParams = {
            tokenIn: parsedData.tokenIn,
            tokenOut: parsedData.tokenOut,
            fee: parsedData.fee,
            recipient,
            amountOut: parsedData.amountOut,
            amountInMaximum: parsedData.amountIn,
            sqrtPriceLimitX96: 0,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactOutputSingle', [exactOutputSingleParams]))
        }
      } else {
        if (trade.tradeType === TradeType.EXACT_INPUT) {
          const exactInputParams = {
            path: parsedData.path,
            recipient,
            amountIn: parsedData.amountIn,
            amountOutMinimum: performAggregatedSlippageCheck ? 0 : parsedData.amountOut,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactInput', [exactInputParams]))
        } else {
          const exactOutputParams = {
            path: parsedData.path,
            recipient,
            amountOut: parsedData.amountOut,
            amountInMaximum: parsedData.amountIn,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactOutput', [exactOutputParams]))
        }
      }
    }

    return calldatas
  }

  private static encodeSwaps(
    trades:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | (V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>)[],
    options: SwapOptions,
    isSwapAndAdd?: boolean
  ): {
    calldatas: string[]
    sampleTrade: V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>
    routerMustCustody: boolean
    inputIsNative: boolean
    outputIsNative: boolean
    totalAmountIn: CurrencyAmount<Currency>
    minimumAmountOut: CurrencyAmount<Currency>
    quoteAmountOut: CurrencyAmount<Currency>
  } {
    trades = unbundleTrades(trades)

    const numberOfTrades = trades.reduce(
      (numberOfTrades, trade) => numberOfTrades + (trade instanceof V3Trade ? trade.swaps.length : 1),
      0
    )

    trades

    const sampleTrade = trades[0]

    // All trades should have the same starting/ending currency and trade type
    invariant(
      trades.every((trade) => trade.inputAmount.currency.equals(sampleTrade.inputAmount.currency)),
      'TOKEN_IN_DIFF'
    )
    invariant(
      trades.every((trade) => trade.outputAmount.currency.equals(sampleTrade.outputAmount.currency)),
      'TOKEN_OUT_DIFF'
    )
    invariant(
      trades.every((trade) => trade.tradeType === sampleTrade.tradeType),
      'TRADE_TYPE_DIFF'
    )

    const calldatas: string[] = []

    const inputIsNative = sampleTrade.inputAmount.currency.isNative
    const outputIsNative = sampleTrade.outputAmount.currency.isNative

    // flag for whether we want to perform an aggregated slippage check
    //   1. when there are >2 exact input trades. this is only a heuristic,
    //      as it's still more gas-expensive even in this case, but has benefits
    //      in that the reversion probability is lower
    const performAggregatedSlippageCheck = sampleTrade.tradeType === TradeType.EXACT_INPUT && numberOfTrades > 2
    // flag for whether funds should be send first to the router
    //   1. when receiving ETH (which much be unwrapped from WETH)
    //   2. when a fee on the output is being taken
    //   3. when performing swap and add
    //   4. when performing an aggregated slippage check
    const routerMustCustody = outputIsNative || !!options.fee || !!isSwapAndAdd || performAggregatedSlippageCheck

    // encode permit if necessary
    if (options.inputTokenPermit) {
      invariant(sampleTrade.inputAmount.currency.isToken, 'NON_TOKEN_PERMIT')
      calldatas.push(SelfPermit.encodePermit(sampleTrade.inputAmount.currency, options.inputTokenPermit))
    }

    for (const trade of trades) {
      if (trade instanceof V2Trade) {
        calldatas.push(SwapRouter.encodeV2Swap(trade, options, routerMustCustody, performAggregatedSlippageCheck))
      } else {
        for (const calldata of SwapRouter.encodeV3Swap(
          trade,
          options,
          routerMustCustody,
          performAggregatedSlippageCheck
        )) {
          calldatas.push(calldata)
        }
      }
    }

    const ZERO_IN: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(sampleTrade.inputAmount.currency, 0)
    const ZERO_OUT: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(sampleTrade.outputAmount.currency, 0)

    const minimumAmountOut: CurrencyAmount<Currency> = trades.reduce(
      (sum, trade) => sum.add(trade.minimumAmountOut(options.slippageTolerance)),
      ZERO_OUT
    )

    const quoteAmountOut: CurrencyAmount<Currency> = trades.reduce(
      (sum, trade) => sum.add(trade.outputAmount),
      ZERO_OUT
    )

    const totalAmountIn: CurrencyAmount<Currency> = trades.reduce(
      (sum, trade) => sum.add(trade.maximumAmountIn(options.slippageTolerance)),
      ZERO_IN
    )

    return {
      calldatas,
      sampleTrade,
      routerMustCustody,
      inputIsNative,
      outputIsNative,
      totalAmountIn,
      minimumAmountOut,
      quoteAmountOut,
    }
  }

  /**
   * Produces the on-chain method name to call and the hex encoded parameters to pass as arguments for a given trade.
   * @param trades to produce call parameters for
   * @param options options for the call parameters
   */
  public static swapCallParameters(
    trades:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | (V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>)[],
    options: SwapOptions
  ): MethodParameters {
    const {
      calldatas,
      sampleTrade,
      routerMustCustody,
      inputIsNative,
      outputIsNative,
      totalAmountIn,
      minimumAmountOut,
    } = SwapRouter.encodeSwaps(trades, options)

    // unwrap or sweep
    if (routerMustCustody) {
      if (outputIsNative) {
        calldatas.push(PaymentsExtended.encodeUnwrapWETH9(minimumAmountOut.quotient, options.recipient, options.fee))
      } else {
        calldatas.push(
          PaymentsExtended.encodeSweepToken(
            sampleTrade.outputAmount.currency.wrapped,
            minimumAmountOut.quotient,
            options.recipient,
            options.fee
          )
        )
      }
    }

    // must refund when paying in ETH, but with an uncertain input amount
    if (inputIsNative && sampleTrade.tradeType === TradeType.EXACT_OUTPUT) {
      calldatas.push(Payments.encodeRefundETH())
    }

    return {
      calldata: MulticallExtended.encodeMulticall(calldatas, options.deadlineOrPreviousBlockhash),
      value: toHex(inputIsNative ? totalAmountIn.quotient : ZERO),
    }
  }

  /**
   * Produces the on-chain method name to call and the hex encoded parameters to pass as arguments for a given trade.
   * @param trades to produce call parameters for
   * @param options options for the call parameters
   */
  public static swapAndAddCallParameters(
    trades:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | (V2Trade<Currency, Currency, TradeType> | V3Trade<Currency, Currency, TradeType>)[],
    options: SwapAndAddOptions,
    position: Position,
    addLiquidityOptions: CondensedAddLiquidityOptions,
    tokenInApprovalType: ApprovalTypes,
    tokenOutApprovalType: ApprovalTypes
  ): MethodParameters {
    const {
      calldatas,
      inputIsNative,
      outputIsNative,
      sampleTrade,
      totalAmountIn: totalAmountSwapped,
      quoteAmountOut,
      minimumAmountOut,
    } = SwapRouter.encodeSwaps(trades, options, true)

    // encode output token permit if necessary
    if (options.outputTokenPermit) {
      invariant(quoteAmountOut.currency.isToken, 'NON_TOKEN_PERMIT_OUTPUT')
      calldatas.push(SelfPermit.encodePermit(quoteAmountOut.currency, options.outputTokenPermit))
    }

    const chainId = sampleTrade.route.chainId
    const zeroForOne = position.pool.token0.wrapped.address === totalAmountSwapped.currency.wrapped.address
    const { positionAmountIn, positionAmountOut } = SwapRouter.getPositionAmounts(position, zeroForOne)

    // if tokens are native they will be converted to WETH9
    const tokenIn = inputIsNative ? WETH9[chainId] : positionAmountIn.currency.wrapped
    const tokenOut = outputIsNative ? WETH9[chainId] : positionAmountOut.currency.wrapped

    // if swap output does not make up whole outputTokenBalanceDesired, pull in remaining tokens for adding liquidity
    const amountOutRemaining = positionAmountOut.subtract(quoteAmountOut.wrapped)
    if (amountOutRemaining.greaterThan(CurrencyAmount.fromRawAmount(positionAmountOut.currency, 0))) {
      // if output is native, this means the remaining portion is included as native value in the transaction
      // and must be wrapped. Otherwise, pull in remaining ERC20 token.
      outputIsNative
        ? calldatas.push(PaymentsExtended.encodeWrapETH(amountOutRemaining.quotient))
        : calldatas.push(PaymentsExtended.encodePull(tokenOut, amountOutRemaining.quotient))
    }

    // if input is native, convert to WETH9, else pull ERC20 token
    inputIsNative
      ? calldatas.push(PaymentsExtended.encodeWrapETH(positionAmountIn.quotient))
      : calldatas.push(PaymentsExtended.encodePull(tokenIn, positionAmountIn.quotient))

    // approve token balances to NFTManager
    if (tokenInApprovalType !== ApprovalTypes.NOT_REQUIRED)
      calldatas.push(ApproveAndCall.encodeApprove(tokenIn, tokenInApprovalType))
    if (tokenOutApprovalType !== ApprovalTypes.NOT_REQUIRED)
      calldatas.push(ApproveAndCall.encodeApprove(tokenOut, tokenOutApprovalType))

    // represents a position with token amounts resulting from a swap with maximum slippage
    // hence the minimal amount out possible.
    const minimalPosition = Position.fromAmounts({
      pool: position.pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amount0: zeroForOne ? position.amount0.quotient.toString() : minimumAmountOut.quotient.toString(),
      amount1: zeroForOne ? minimumAmountOut.quotient.toString() : position.amount1.quotient.toString(),
      useFullPrecision: false,
    })

    // encode NFTManager add liquidity
    calldatas.push(
      ApproveAndCall.encodeAddLiquidity(position, minimalPosition, addLiquidityOptions, options.slippageTolerance)
    )

    // sweep remaining tokens
    inputIsNative
      ? calldatas.push(PaymentsExtended.encodeUnwrapWETH9(ZERO))
      : calldatas.push(PaymentsExtended.encodeSweepToken(tokenIn, ZERO))
    outputIsNative
      ? calldatas.push(PaymentsExtended.encodeUnwrapWETH9(ZERO))
      : calldatas.push(PaymentsExtended.encodeSweepToken(tokenOut, ZERO))

    let value: JSBI
    if (inputIsNative) {
      value = totalAmountSwapped.wrapped.add(positionAmountIn.wrapped).quotient
    } else if (outputIsNative) {
      value = amountOutRemaining.quotient
    } else {
      value = ZERO
    }

    return {
      calldata: MulticallExtended.encodeMulticall(calldatas, options.deadlineOrPreviousBlockhash),
      value: value.toString(),
    }
  }

  private static getPositionAmounts(
    position: Position,
    zeroForOne: boolean
  ): { positionAmountIn: CurrencyAmount<Currency>; positionAmountOut: CurrencyAmount<Currency> } {
    const { amount0, amount1 } = position.mintAmounts
    const currencyAmount0 = CurrencyAmount.fromRawAmount(position.pool.token0, amount0)
    const currencyAmount1 = CurrencyAmount.fromRawAmount(position.pool.token1, amount1)

    const [positionAmountIn, positionAmountOut] = zeroForOne
      ? [currencyAmount0, currencyAmount1]
      : [currencyAmount1, currencyAmount0]
    return { positionAmountIn, positionAmountOut }
  }
}
