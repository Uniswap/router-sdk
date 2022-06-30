import { Interface } from '@ethersproject/abi'
import { Currency, CurrencyAmount, Percent, Token, TradeType, validateAndParseAddress, WETH9 } from '@uniswap/sdk-core'
import { abi } from '@uniswap/swap-router-contracts/artifacts/contracts/interfaces/ISwapRouter02.sol/ISwapRouter02.json'
import { Pair, Trade as V2Trade } from '@uniswap/v2-sdk'
import {
  encodeRouteToPath,
  FeeOptions,
  MethodParameters,
  Payments,
  PermitOptions,
  Pool,
  Position,
  SelfPermit,
  toHex,
  Trade as V3Trade,
} from '@uniswap/v3-sdk'
import invariant from 'tiny-invariant'
import JSBI from 'jsbi'
import { ADDRESS_THIS, MSG_SENDER } from './constants'
import { ApproveAndCall, ApprovalTypes, CondensedAddLiquidityOptions } from './approveAndCall'
import { Trade } from './entities/trade'
import { Protocol } from './entities/protocol'
import { MixedRoute, RouteV2, RouteV3 } from './entities/route'
import { MulticallExtended, Validation } from './multicallExtended'
import { PaymentsExtended } from './paymentsExtended'
import { MixedRouteTrade } from './entities/mixedRoute/trade'
import { encodeMixedRouteToPath } from './utils/encodeMixedRouteToPath'
import { MixedRouteSDK } from './entities/mixedRoute/route'

const ZERO = JSBI.BigInt(0)

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

/**
 * Represents the Uniswap V2 + V3 SwapRouter02, and has static methods for helping execute trades.
 */
export abstract class SwapRouter {
  public static INTERFACE: Interface = new Interface(abi)

  /**
   * Cannot be constructed.
   */
  private constructor() {}

  private static encodeV2Swap(
    trade: V2Trade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean
  ): string {
    const amountIn: string = toHex(trade.maximumAmountIn(options.slippageTolerance).quotient)
    const amountOut: string = toHex(trade.minimumAmountOut(options.slippageTolerance).quotient)

    const path = trade.route.path.map((token) => token.address)
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

  private static encodeV3Swap(
    trade: V3Trade<Currency, Currency, TradeType>,
    options: SwapOptions,
    routerMustCustody: boolean,
    performAggregatedSlippageCheck: boolean
  ): string[] {
    const calldatas: string[] = []

    for (const { route, inputAmount, outputAmount } of trade.swaps) {
      const amountIn: string = toHex(trade.maximumAmountIn(options.slippageTolerance, inputAmount).quotient)
      const amountOut: string = toHex(trade.minimumAmountOut(options.slippageTolerance, outputAmount).quotient)

      // flag for whether the trade is single hop or not
      const singleHop = route.pools.length === 1

      const recipient = routerMustCustody
        ? ADDRESS_THIS
        : typeof options.recipient === 'undefined'
        ? MSG_SENDER
        : validateAndParseAddress(options.recipient)

      if (singleHop) {
        if (trade.tradeType === TradeType.EXACT_INPUT) {
          const exactInputSingleParams = {
            tokenIn: route.tokenPath[0].address,
            tokenOut: route.tokenPath[1].address,
            fee: route.pools[0].fee,
            recipient,
            amountIn,
            amountOutMinimum: performAggregatedSlippageCheck ? 0 : amountOut,
            sqrtPriceLimitX96: 0,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactInputSingle', [exactInputSingleParams]))
        } else {
          const exactOutputSingleParams = {
            tokenIn: route.tokenPath[0].address,
            tokenOut: route.tokenPath[1].address,
            fee: route.pools[0].fee,
            recipient,
            amountOut,
            amountInMaximum: amountIn,
            sqrtPriceLimitX96: 0,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactOutputSingle', [exactOutputSingleParams]))
        }
      } else {
        const path: string = encodeRouteToPath(route, trade.tradeType === TradeType.EXACT_OUTPUT)

        if (trade.tradeType === TradeType.EXACT_INPUT) {
          const exactInputParams = {
            path,
            recipient,
            amountIn,
            amountOutMinimum: performAggregatedSlippageCheck ? 0 : amountOut,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactInput', [exactInputParams]))
        } else {
          const exactOutputParams = {
            path,
            recipient,
            amountOut,
            amountInMaximum: amountIn,
          }

          calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactOutput', [exactOutputParams]))
        }
      }
    }

    return calldatas
  }

  private static encodeMixedRouteSwap(
    trade: MixedRouteTrade<Currency, Currency, TradeType>,
    options: SwapOptions
    /// @dev we might not need these two flags since that behavior is assumed to happen for mixed route
    // routerMustCustody: boolean,
    // performAggregatedSlippageCheck: boolean
  ): string[] {
    const calldatas: string[] = []

    if (trade.tradeType !== TradeType.EXACT_INPUT) {
      throw new Error('Mixed route trades must be exact input trades')
    }

    for (const { route, inputAmount, outputAmount } of trade.swaps) {
      const amountIn: string = toHex(trade.maximumAmountIn(options.slippageTolerance, inputAmount).quotient)
      const amountOut: string = toHex(trade.minimumAmountOut(options.slippageTolerance, outputAmount).quotient)

      // flag for whether the trade is single hop or not
      const singleHop = route.pools.length === 1

      const recipient =
        typeof options.recipient === 'undefined' ? MSG_SENDER : validateAndParseAddress(options.recipient)
      const mixedRouteIsAllV3 = (route: MixedRoute<Currency, Currency>) => {
        return route.pools.every((pool) => pool instanceof Pool)
      }

      if (singleHop) {
        invariant(!(route instanceof MixedRouteSDK), 'MixedRouteSDK does not support single hop swaps')
      } else {
        let acc = []
        let j = 0
        while (j < route.pools.length) {
          // seek forward until finding a pool of different type
          let section = []
          if (route.pools[j] instanceof Pool) {
            while (route.pools[j] instanceof Pool) {
              section.push(route.pools[j])
              j++
              if (j === route.pools.length) {
                // we've reached the end of the route
                break
              }
            }
            acc.push(section)
          } else {
            while (route.pools[j] instanceof Pair) {
              section.push(route.pools[j])
              j++
              if (j === route.pools.length) {
                // we've reached the end of the route
                break
              }
            }
            acc.push(section)
          }
        }

        const firstInputToken = route.input.wrapped
        let outputToken = firstInputToken

        const getOutputOfSection = (section: (Pool | Pair)[], firstInputToken: Token) => {
          const { inputToken } = section.reduce(
            ({ inputToken }, pool: Pool | Pair): { inputToken: Token } => {
              const outputToken: Token = pool.token0.equals(inputToken) ? pool.token1 : pool.token0
              return {
                inputToken: outputToken,
              }
            },
            { inputToken: firstInputToken }
          )
          console.log('output for section', section, 'is', inputToken)
          return inputToken
        }

        const isLastSectionInRoute = (i: number) => {
          return i === acc.length - 1
        }

        for (let i = 0; i < acc.length; i++) {
          const section = acc[i]

          outputToken = getOutputOfSection(section, outputToken)

          console.log('inputToken', section[0].token0.equals(outputToken) ? section[0].token1 : section[0].token0)
          console.log('outputToken', outputToken)

          const newRouteOriginal = new MixedRouteSDK(
            [...section],
            // complement of prev output
            section[0].token0.equals(outputToken) ? section[0].token1 : section[0].token0,
            outputToken
          )
          const newRoute = new MixedRoute(newRouteOriginal)
          const path: string = encodeMixedRouteToPath(newRoute, false)

          if (mixedRouteIsAllV3(newRoute)) {
            const exactInputParams = {
              path,
              recipient: isLastSectionInRoute(i) ? recipient : ADDRESS_THIS,
              amountIn: i == 0 ? amountIn : 0,
              amountOutMinimum: !isLastSectionInRoute(i) ? 0 : amountOut,
            }
            console.log('v3 exactInputParams: ', exactInputParams)

            calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('exactInput', [exactInputParams]))
          } else {
            // Pair
            const exactInputParams = [
              i == 0 ? amountIn : 0,
              !isLastSectionInRoute(i) ? 0 : amountOut,
              newRoute.path.map((token) => token.address), // this should be sorted via sdk
              isLastSectionInRoute(i) ? recipient : ADDRESS_THIS,
            ]

            console.log('v2 exactInputParams', exactInputParams)

            calldatas.push(SwapRouter.INTERFACE.encodeFunctionData('swapExactTokensForTokens', exactInputParams))
          }
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
      | MixedRouteTrade<Currency, Currency, TradeType>
      | (
          | V2Trade<Currency, Currency, TradeType>
          | V3Trade<Currency, Currency, TradeType>
          | MixedRouteTrade<Currency, Currency, TradeType>
        )[],
    options: SwapOptions,
    isSwapAndAdd?: boolean
  ): {
    calldatas: string[]
    sampleTrade:
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | MixedRouteTrade<Currency, Currency, TradeType>
    routerMustCustody: boolean
    inputIsNative: boolean
    outputIsNative: boolean
    totalAmountIn: CurrencyAmount<Currency>
    minimumAmountOut: CurrencyAmount<Currency>
    quoteAmountOut: CurrencyAmount<Currency>
  } {
    // If dealing with an instance of the aggregated Trade object, unbundle it to individual V2Trade and V3Trade objects.
    if (trades instanceof Trade) {
      invariant(
        trades.swaps.every(
          (swap) =>
            swap.route.protocol == Protocol.V3 ||
            swap.route.protocol == Protocol.V2 ||
            swap.route.protocol == Protocol.MIXED
        ),
        'UNSUPPORTED_PROTOCOL'
      )

      let v2Andv3Trades: (
        | V2Trade<Currency, Currency, TradeType>
        | V3Trade<Currency, Currency, TradeType>
        | MixedRouteTrade<Currency, Currency, TradeType>
      )[] = []

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
        } else if (route.protocol == Protocol.MIXED) {
          v2Andv3Trades.push(
            /// we can change the naming of this function on MixedRouteTrade if needed
            MixedRouteTrade.createUncheckedTrade({
              route: route as MixedRoute<Currency, Currency>,
              inputAmount,
              outputAmount,
              tradeType: trades.tradeType,
            })
          )
        } else {
          throw new Error('UNSUPPORTED_PROTOCOL')
        }
      }
      trades = v2Andv3Trades
    }

    if (!Array.isArray(trades)) {
      trades = [trades]
    }

    const numberOfTrades = trades.reduce(
      // TODO: is this math right for mixedRouteTrade?
      (numberOfTrades, trade) =>
        numberOfTrades + (trade instanceof V3Trade || trade instanceof MixedRouteTrade ? trade.swaps.length : 1),
      0
    )

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
      } else if (trade instanceof V3Trade) {
        for (const calldata of SwapRouter.encodeV3Swap(
          trade,
          options,
          routerMustCustody,
          performAggregatedSlippageCheck
        )) {
          calldatas.push(calldata)
        }
      } else if (trade instanceof MixedRouteTrade) {
        for (const calldata of SwapRouter.encodeMixedRouteSwap(trade, options)) {
          calldatas.push(calldata)
        }
      } else {
        throw new Error('Unsupported trade object')
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
   * @param trade to produce call parameters for
   * @param options options for the call parameters
   */
  public static swapCallParameters(
    trades:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | MixedRouteTrade<Currency, Currency, TradeType>
      | (
          | V2Trade<Currency, Currency, TradeType>
          | V3Trade<Currency, Currency, TradeType>
          | MixedRouteTrade<Currency, Currency, TradeType>
        )[],
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
   * @param trade to produce call parameters for
   * @param options options for the call parameters
   */
  public static swapAndAddCallParameters(
    trades:
      | Trade<Currency, Currency, TradeType>
      | V2Trade<Currency, Currency, TradeType>
      | V3Trade<Currency, Currency, TradeType>
      | MixedRouteTrade<Currency, Currency, TradeType>
      | (
          | V2Trade<Currency, Currency, TradeType>
          | V3Trade<Currency, Currency, TradeType>
          | MixedRouteTrade<Currency, Currency, TradeType>
        )[],
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
  ): {
    positionAmountIn: CurrencyAmount<Currency>
    positionAmountOut: CurrencyAmount<Currency>
  } {
    const { amount0, amount1 } = position.mintAmounts
    const currencyAmount0 = CurrencyAmount.fromRawAmount(position.pool.token0, amount0)
    const currencyAmount1 = CurrencyAmount.fromRawAmount(position.pool.token1, amount1)

    const [positionAmountIn, positionAmountOut] = zeroForOne
      ? [currencyAmount0, currencyAmount1]
      : [currencyAmount1, currencyAmount0]
    return { positionAmountIn, positionAmountOut }
  }
}
