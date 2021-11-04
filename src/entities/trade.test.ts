import { sqrt, Token, CurrencyAmount, TradeType } from '@uniswap/sdk-core'
import JSBI from 'jsbi'
import { RouteV2, RouteV3 } from './route'
import { Trade } from './trade'
import {
  Route as V3RouteSDK,
  FeeAmount,
  TICK_SPACINGS,
  Pool,
  TickMath,
  nearestUsableTick,
  encodeSqrtRatioX96,
} from '@uniswap/v3-sdk'
import { Pair, Route as V2RouteSDK } from '@uniswap/v2-sdk'

describe('Trade', () => {
  const token0 = new Token(1, '0x0000000000000000000000000000000000000001', 18, 't0', 'token0')
  const token1 = new Token(1, '0x0000000000000000000000000000000000000002', 18, 't1', 'token1')

  function v2StylePool(
    reserve0: CurrencyAmount<Token>,
    reserve1: CurrencyAmount<Token>,
    feeAmount: FeeAmount = FeeAmount.MEDIUM
  ) {
    const sqrtRatioX96 = encodeSqrtRatioX96(reserve1.quotient, reserve0.quotient)
    const liquidity = sqrt(JSBI.multiply(reserve0.quotient, reserve1.quotient))
    return new Pool(
      reserve0.currency,
      reserve1.currency,
      feeAmount,
      sqrtRatioX96,
      liquidity,
      TickMath.getTickAtSqrtRatio(sqrtRatioX96),
      [
        {
          index: nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[feeAmount]),
          liquidityNet: liquidity,
          liquidityGross: liquidity,
        },
        {
          index: nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[feeAmount]),
          liquidityNet: JSBI.multiply(liquidity, JSBI.BigInt(-1)),
          liquidityGross: liquidity,
        },
      ]
    )
  }

  const pool_0_1 = v2StylePool(
    CurrencyAmount.fromRawAmount(token0, 100000),
    CurrencyAmount.fromRawAmount(token1, 100000)
  )

  const pair_0_1 = new Pair(CurrencyAmount.fromRawAmount(token0, '100'), CurrencyAmount.fromRawAmount(token1, '200'))

  //from Route test

  describe('#fromRoute', () => {
    it('can contain only a v3 route', async () => {
      const routeOriginal = new V3RouteSDK([pool_0_1], token0, token1)
      const route = new RouteV3(routeOriginal)

      const amount = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))
      const tradeType = TradeType.EXACT_INPUT

      const trade = await Trade.fromRoute(route, amount, tradeType)
      expect(trade.inputAmount.currency).toEqual(token0)
      expect(trade.outputAmount.currency).toEqual(token1)
      expect(trade.swaps.length).toEqual(1)
      expect(trade.routes.length).toEqual(1)
      expect(trade.tradeType).toEqual(TradeType.EXACT_INPUT)
    })

    it('can contain only a v2 route', async () => {
      const routeOriginal = new V2RouteSDK([pair_0_1], token0, token1)
      const route = new RouteV2(routeOriginal)

      const amount = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))
      const tradeType = TradeType.EXACT_OUTPUT

      const trade = await Trade.fromRoute(route, amount, tradeType)
      expect(trade.inputAmount.currency).toEqual(token0)
      expect(trade.outputAmount.currency).toEqual(token1)
      expect(trade.swaps.length).toEqual(1)
      expect(trade.routes.length).toEqual(1)
      expect(trade.tradeType).toEqual(TradeType.EXACT_OUTPUT)
    })
  })
})
