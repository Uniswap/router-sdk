import { sqrt, Token, CurrencyAmount, TradeType, WETH9, Ether, Percent, Price } from '@uniswap/sdk-core'
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
  const ETHER = Ether.onChain(1)
  const weth = WETH9[1]
  const token0 = new Token(1, '0x0000000000000000000000000000000000000001', 18, 't0', 'token0')
  const token1 = new Token(1, '0x0000000000000000000000000000000000000002', 18, 't1', 'token1')
  const token2 = new Token(1, '0x0000000000000000000000000000000000000003', 18, 't2', 'token2')

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

  const pool_0_2 = v2StylePool(
    CurrencyAmount.fromRawAmount(token0, 100000),
    CurrencyAmount.fromRawAmount(token2, 110000)
  )

  const pool_1_2 = v2StylePool(
    CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(12000)),
    CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(10000))
  )

  const pair_0_1 = new Pair(
    CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(12000)),
    CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(12000))
  )
  const pair_1_2 = new Pair(
    CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(12000)),
    CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(10000))
  )
  const pair_0_2 = new Pair(
    CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(10000)),
    CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(12000))
  )

  const pair_weth_0 = new Pair(
    CurrencyAmount.fromRawAmount(weth, JSBI.BigInt(10000)),
    CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(10000))
  )
  const pair_weth_1 = new Pair(
    CurrencyAmount.fromRawAmount(weth, JSBI.BigInt(10000)),
    CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(10000))
  )
  const pair_weth_2 = new Pair(
    CurrencyAmount.fromRawAmount(weth, JSBI.BigInt(10000)),
    CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(10000))
  )

  const pool_weth_0 = v2StylePool(
    CurrencyAmount.fromRawAmount(weth, JSBI.BigInt(100000)),
    CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100000))
  )

  const pool_weth_2 = v2StylePool(
    CurrencyAmount.fromRawAmount(weth, JSBI.BigInt(100000)),
    CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(100000))
  )

  const pool_weth_1 = v2StylePool(
    CurrencyAmount.fromRawAmount(weth, JSBI.BigInt(100000)),
    CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100000))
  )

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

      const amount = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(1000))
      const tradeType = TradeType.EXACT_OUTPUT

      const trade = await Trade.fromRoute(route, amount, tradeType)
      expect(trade.inputAmount.currency).toEqual(token0)
      expect(trade.outputAmount.currency).toEqual(token1)
      expect(trade.swaps.length).toEqual(1)
      expect(trade.routes.length).toEqual(1)
      expect(trade.tradeType).toEqual(TradeType.EXACT_OUTPUT)
    })

    it('can be constructed with ETHER as input for a V3 Route exact input swap', async () => {
      const routeOriginal = new V3RouteSDK([pool_weth_0], ETHER, token0)
      const route = new RouteV3(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(10))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_INPUT)
      expect(trade.inputAmount.currency).toEqual(ETHER)
      expect(trade.outputAmount.currency).toEqual(token0)
    })

    it('can be constructed with ETHER as input for a V3 Route exact output swap', async () => {
      const routeOriginal = new V3RouteSDK([pool_weth_0], ETHER, token0)
      const route = new RouteV3(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_OUTPUT)
      expect(trade.inputAmount.currency).toEqual(ETHER)
      expect(trade.outputAmount.currency).toEqual(token0)
    })

    it('can be constructed with ETHER as output for a V3 Route exact output swap', async () => {
      const routeOriginal = new V3RouteSDK([pool_weth_0], token0, ETHER)
      const route = new RouteV3(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_OUTPUT)
      expect(trade.inputAmount.currency).toEqual(token0)
      expect(trade.outputAmount.currency).toEqual(ETHER)
    })

    it('can be constructed with ETHER as output for a V3 Route exact input swap', async () => {
      const routeOriginal = new V3RouteSDK([pool_weth_0], token0, ETHER)
      const route = new RouteV3(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_INPUT)
      expect(trade.inputAmount.currency).toEqual(token0)
      expect(trade.outputAmount.currency).toEqual(ETHER)
    })

    it('can be constructed with ETHER as input for a V2 Route exact input swap', async () => {
      const routeOriginal = new V2RouteSDK([pair_weth_2], ETHER, token2)
      const route = new RouteV2(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(10))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_INPUT)
      expect(trade.inputAmount.currency).toEqual(ETHER)
      expect(trade.outputAmount.currency).toEqual(token2)
    })

    it('can be constructed with ETHER as input for a V2 Route exact output swap', async () => {
      const routeOriginal = new V2RouteSDK([pair_weth_2], ETHER, token2)
      const route = new RouteV2(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(100))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_OUTPUT)
      expect(trade.inputAmount.currency).toEqual(ETHER)
      expect(trade.outputAmount.currency).toEqual(token2)
    })

    it('can be constructed with ETHER as output for a V2 Route exact output swap', async () => {
      const routeOriginal = new V2RouteSDK([pair_weth_2], token2, ETHER)
      const route = new RouteV2(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_OUTPUT)
      expect(trade.inputAmount.currency).toEqual(token2)
      expect(trade.outputAmount.currency).toEqual(ETHER)
    })

    it('can be constructed with ETHER as output for a V2 Route exact input swap', async () => {
      const routeOriginal = new V2RouteSDK([pair_weth_2], token2, ETHER)
      const route = new RouteV2(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(100))

      const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_INPUT)
      expect(trade.inputAmount.currency).toEqual(token2)
      expect(trade.outputAmount.currency).toEqual(ETHER)
    })

    it('throws if input currency does not match for V2 Route', async () => {
      const routeOriginal = new V2RouteSDK([pair_weth_2], token2, ETHER)
      const route = new RouteV2(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      await expect(Trade.fromRoute(route, amount, TradeType.EXACT_INPUT)).rejects.toThrow('INPUT')
    })

    it('throws if output currency does not match for V2 Route', async () => {
      const routeOriginal = new V2RouteSDK([pair_0_1], token0, token1)
      const route = new RouteV2(routeOriginal)
      const amount = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      await expect(Trade.fromRoute(route, amount, TradeType.EXACT_OUTPUT)).rejects.toThrow('OUTPUT')
    })
    it('throws if input currency does not match for V3 route', async () => {
      const routeOriginal = new V3RouteSDK([pool_0_1], token0, token1)
      const route = new RouteV3(routeOriginal)

      const amount = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(1000))
      const tradeType = TradeType.EXACT_INPUT

      await expect(Trade.fromRoute(route, amount, tradeType)).rejects.toThrow('INPUT')
    })

    it('throws if output currency does not match for V3 route', async () => {
      const routeOriginal = new V3RouteSDK([pool_0_1], token0, token1)
      const route = new RouteV3(routeOriginal)

      const amount = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(1000))
      const tradeType = TradeType.EXACT_OUTPUT
      await expect(Trade.fromRoute(route, amount, tradeType)).rejects.toThrow('OUTPUT')
    })
  })

  describe('#fromRoutes', () => {
    it('can contain both a v2 and a v3 route', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_0_1, pair_1_2], token0, token2)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))

      const trade = await Trade.fromRoutes(
        [{ routev2, amount: amountv2 }],
        [{ routev3, amount: amountv3 }],
        TradeType.EXACT_INPUT
      )

      expect(trade.inputAmount.currency).toEqual(token0)
      expect(trade.outputAmount.currency).toEqual(token2)
      expect(trade.swaps.length).toEqual(2)
      expect(trade.routes.length).toEqual(2)
      expect(trade.tradeType).toEqual(TradeType.EXACT_INPUT)
    })

    it('can contain muliptle v2 and v3 routes', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_0_1, pair_1_2], token0, token2)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(100))

      const route2OriginalV2 = new V2RouteSDK([pair_weth_0, pair_weth_2], token0, token2)
      const route2v2 = new RouteV2(route2OriginalV2)
      const amount2v2 = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(1000))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(1000))

      const route2OriginalV3 = new V3RouteSDK([pool_weth_0, pool_weth_2], token0, token2)
      const route2v3 = new RouteV3(route2OriginalV3)
      const amount2v3 = CurrencyAmount.fromRawAmount(token2, JSBI.BigInt(1000))

      const trade = await Trade.fromRoutes(
        [
          { routev2, amount: amountv2 },
          { routev2: route2v2, amount: amount2v2 },
        ],
        [
          { routev3, amount: amountv3 },
          { routev3: route2v3, amount: amount2v3 },
        ],
        TradeType.EXACT_OUTPUT
      )

      expect(trade.inputAmount.currency).toEqual(token0)
      expect(trade.outputAmount.currency).toEqual(token2)
      expect(trade.swaps.length).toEqual(4)
      expect(trade.routes.length).toEqual(4)
      expect(trade.tradeType).toEqual(TradeType.EXACT_OUTPUT)
      expect(trade.routes[0].path).toEqual([token0, token1, token2])
      expect(trade.routes[1].path).toEqual([token0, weth, token2])
      expect(trade.routes[2].path).toEqual([token0, token1, token2])
      expect(trade.routes[3].path).toEqual([token0, weth, token2])
    })

    it('can be constructed with ETHER as input for exact input', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_weth_0, pair_0_1], ETHER, token1)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_weth_0, pool_0_1], ETHER, token1)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(1000))

      const trade = await Trade.fromRoutes(
        [{ routev2, amount: amountv2 }],
        [{ routev3, amount: amountv3 }],
        TradeType.EXACT_INPUT
      )

      expect(trade.inputAmount.currency).toEqual(ETHER)
      expect(trade.outputAmount.currency).toEqual(token1)
      expect(trade.swaps.length).toEqual(2)
      expect(trade.routes.length).toEqual(2)
      expect(trade.tradeType).toEqual(TradeType.EXACT_INPUT)
    })

    it('can be constructed with ETHER as input for exact output', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_weth_0, pair_0_1], ETHER, token1)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_weth_0, pool_0_1], ETHER, token1)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(1000))

      const trade = await Trade.fromRoutes(
        [{ routev2, amount: amountv2 }],
        [{ routev3, amount: amountv3 }],
        TradeType.EXACT_OUTPUT
      )

      expect(trade.inputAmount.currency).toEqual(ETHER)
      expect(trade.outputAmount.currency).toEqual(token1)
      expect(trade.swaps.length).toEqual(2)
      expect(trade.routes.length).toEqual(2)
      expect(trade.tradeType).toEqual(TradeType.EXACT_OUTPUT)
    })

    it('can be constructed with ETHER as ouput for exact output swap', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_0_1, pair_weth_0], token1, ETHER)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_weth_0], token1, ETHER)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(ETHER, JSBI.BigInt(1000))

      const trade = await Trade.fromRoutes(
        [{ routev2, amount: amountv2 }],
        [{ routev3, amount: amountv3 }],
        TradeType.EXACT_OUTPUT
      )

      expect(trade.inputAmount.currency).toEqual(token1)
      expect(trade.outputAmount.currency).toEqual(ETHER)
      expect(trade.swaps.length).toEqual(2)
      expect(trade.routes.length).toEqual(2)
      expect(trade.tradeType).toEqual(TradeType.EXACT_OUTPUT)
    })

    it('can be constructed with ETHER as ouput for exact input swap', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_0_1, pair_weth_0], token1, ETHER)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_weth_0], token1, ETHER)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(1000))

      const trade = await Trade.fromRoutes(
        [{ routev2, amount: amountv2 }],
        [{ routev3, amount: amountv3 }],
        TradeType.EXACT_INPUT
      )

      expect(trade.inputAmount.currency).toEqual(token1)
      expect(trade.outputAmount.currency).toEqual(ETHER)
      expect(trade.swaps.length).toEqual(2)
      expect(trade.routes.length).toEqual(2)
      expect(trade.tradeType).toEqual(TradeType.EXACT_INPUT)
    })

    it('throws if pools are re-used between V3 routes', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_0_1, pair_1_2], token0, token2)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))

      //duplicate pool
      const route2OriginalV3 = new V3RouteSDK([pool_0_1, pool_weth_1, pool_weth_2], token0, token2)
      const route2v3 = new RouteV3(route2OriginalV3)
      const amount2v3 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))

      await expect(
        Trade.fromRoutes(
          [{ routev2, amount: amountv2 }],
          [
            { routev3, amount: amountv3 },
            { routev3: route2v3, amount: amount2v3 },
          ],
          TradeType.EXACT_INPUT
        )
      ).rejects.toThrow('POOLS_DUPLICATED')
    })

    it('throws if pools are re-used between V2 routes', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_0_1, pair_1_2], token0, token2)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      const route2OriginalV2 = new V2RouteSDK([pair_0_1, pair_weth_1, pair_weth_2], token0, token2)
      const route2v2 = new RouteV2(route2OriginalV2)
      const amount2v2 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))

      await expect(
        Trade.fromRoutes(
          [
            { routev2, amount: amountv2 },
            { routev2: route2v2, amount: amount2v2 },
          ],
          [{ routev3, amount: amountv3 }],
          TradeType.EXACT_INPUT
        )
      ).rejects.toThrow('POOLS_DUPLICATED')
    })

    it('throws if routes have different inputs', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_1_2], token1, token2)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))

      await expect(
        Trade.fromRoutes([{ routev2, amount: amountv2 }], [{ routev3, amount: amountv3 }], TradeType.EXACT_INPUT)
      ).rejects.toThrow('INPUT_CURRENCY_MATCH')
    })

    it('throws if routes have different outputs', async () => {
      const routeOriginalV2 = new V2RouteSDK([pair_0_1], token0, token1)
      const routev2 = new RouteV2(routeOriginalV2)
      const amountv2 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(100))

      const routeOriginalV3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev3 = new RouteV3(routeOriginalV3)
      const amountv3 = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(1000))

      await expect(
        Trade.fromRoutes([{ routev2, amount: amountv2 }], [{ routev3, amount: amountv3 }], TradeType.EXACT_INPUT)
      ).rejects.toThrow('OUTPUT_CURRENCY_MATCH')
    })
  })
  describe('#worstExecutionPrice', () => {
    describe(' exact input swaps', () => {
      const routev3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const route2v3 = new V3RouteSDK([pool_0_2], token0, token2)

      const inputAmount = CurrencyAmount.fromRawAmount(token0, 100)
      const outputAmount = CurrencyAmount.fromRawAmount(token2, 69)
      const tradeType = TradeType.EXACT_INPUT

      const exactInV3 = new Trade({
        v2Routes: [],
        v3Routes: [{ routev3, inputAmount, outputAmount }],
        tradeType,
      })

      const exactInMultiRoute = new Trade({
        v2Routes: [],
        v3Routes: [
          {
            routev3,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 50),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 35),
          },
          {
            routev3: route2v3,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 50),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 34),
          },
        ],
        tradeType: TradeType.EXACT_INPUT,
      })

      it('throws if less than 0', () => {
        expect(() => exactInV3.minimumAmountOut(new Percent(-1, 100))).toThrow('SLIPPAGE_TOLERANCE')
      })
      it('returns exact if 0', () => {
        expect(exactInV3.worstExecutionPrice(new Percent(0, 100))).toEqual(exactInV3.executionPrice)
      })
      it('returns exact if nonzero', () => {
        expect(exactInV3.worstExecutionPrice(new Percent(0, 100))).toEqual(new Price(token0, token2, 100, 69))
        expect(exactInV3.worstExecutionPrice(new Percent(5, 100))).toEqual(new Price(token0, token2, 100, 65))
        expect(exactInV3.worstExecutionPrice(new Percent(200, 100))).toEqual(new Price(token0, token2, 100, 23))
      })
      it('returns exact if nonzero with multiple routes', () => {
        expect(exactInMultiRoute.worstExecutionPrice(new Percent(0, 100))).toEqual(new Price(token0, token2, 100, 69))
        expect(exactInMultiRoute.worstExecutionPrice(new Percent(5, 100))).toEqual(new Price(token0, token2, 100, 65))
        expect(exactInMultiRoute.worstExecutionPrice(new Percent(200, 100))).toEqual(new Price(token0, token2, 100, 23))
      })
    })
    describe('tradeType = EXACT_OUTPUT', () => {
      const routev3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const route2v3 = new V3RouteSDK([pool_0_2], token0, token2)

      const exactOut = new Trade({
        v2Routes: [],
        v3Routes: [
          {
            routev3,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 156),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 100),
          },
        ],
        tradeType: TradeType.EXACT_OUTPUT,
      })

      const exactOutMultiRoute = new Trade({
        v2Routes: [],
        v3Routes: [
          {
            routev3,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 78),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 50),
          },
          {
            routev3: route2v3,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 78),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 50),
          },
        ],
        tradeType: TradeType.EXACT_OUTPUT,
      })

      it('throws if less than 0', () => {
        expect(() => exactOut.worstExecutionPrice(new Percent(-1, 100))).toThrow('SLIPPAGE_TOLERANCE')
      })
      it('returns exact if 0', () => {
        expect(exactOut.worstExecutionPrice(new Percent(0, 100))).toEqual(exactOut.executionPrice)
      })
      it('returns slippage amount if nonzero', () => {
        expect(
          exactOut.worstExecutionPrice(new Percent(0, 100)).equalTo(new Price(token0, token2, 156, 100))
        ).toBeTruthy()
        expect(
          exactOut.worstExecutionPrice(new Percent(5, 100)).equalTo(new Price(token0, token2, 163, 100))
        ).toBeTruthy()
        expect(
          exactOut.worstExecutionPrice(new Percent(200, 100)).equalTo(new Price(token0, token2, 468, 100))
        ).toBeTruthy()
      })
      it('returns exact if nonzero with multiple routes', () => {
        expect(
          exactOutMultiRoute.worstExecutionPrice(new Percent(0, 100)).equalTo(new Price(token0, token2, 156, 100))
        ).toBeTruthy()
        expect(
          exactOutMultiRoute.worstExecutionPrice(new Percent(5, 100)).equalTo(new Price(token0, token2, 163, 100))
        ).toBeTruthy()
        expect(
          exactOutMultiRoute.worstExecutionPrice(new Percent(200, 100)).equalTo(new Price(token0, token2, 468, 100))
        ).toBeTruthy()
      })
    })
    describe('worst execution price across v2 and v3 trades exact input', () => {
      const routev3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev2 = new V2RouteSDK([pair_0_2], token0, token2)
      const exactIn = new Trade({
        v2Routes: [
          {
            routev2,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 100),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 100),
          },
        ],
        v3Routes: [
          {
            routev3,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 156),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 100),
          },
        ],
        tradeType: TradeType.EXACT_INPUT,
      })
      it('throws if less than 0', () => {
        expect(() => exactIn.minimumAmountOut(new Percent(-1, 100))).toThrow('SLIPPAGE_TOLERANCE')
      })
      it('returns exact if 0', () => {
        expect(exactIn.worstExecutionPrice(new Percent(0, 100))).toEqual(exactIn.executionPrice)
      })
      it('returns exact if nonzero', () => {
        expect(exactIn.worstExecutionPrice(new Percent(0, 100))).toEqual(new Price(token0, token2, 256, 200))
        expect(exactIn.worstExecutionPrice(new Percent(5, 100))).toEqual(new Price(token0, token2, 256, 190))
        expect(exactIn.worstExecutionPrice(new Percent(200, 100))).toEqual(new Price(token0, token2, 256, 66))
      })
    })

    describe('worst execution price across v2 and v3 trades exact output', () => {
      const routev3 = new V3RouteSDK([pool_0_1, pool_1_2], token0, token2)
      const routev2 = new V2RouteSDK([pair_0_2], token0, token2)
      const exactOut = new Trade({
        v2Routes: [
          {
            routev2,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 100),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 100),
          },
        ],
        v3Routes: [
          {
            routev3,
            inputAmount: CurrencyAmount.fromRawAmount(token0, 156),
            outputAmount: CurrencyAmount.fromRawAmount(token2, 100),
          },
        ],
        tradeType: TradeType.EXACT_OUTPUT,
      })
      it('throws if less than 0', () => {
        expect(() => exactOut.minimumAmountOut(new Percent(-1, 100))).toThrow('SLIPPAGE_TOLERANCE')
      })
      it('returns exact if 0', () => {
        expect(exactOut.worstExecutionPrice(new Percent(0, 100))).toEqual(exactOut.executionPrice)
      })
      it('returns exact if nonzero', () => {
        expect(exactOut.worstExecutionPrice(new Percent(0, 100))).toEqual(new Price(token0, token2, 256, 200))
        expect(exactOut.worstExecutionPrice(new Percent(5, 100))).toEqual(new Price(token0, token2, 268, 200))
        expect(exactOut.worstExecutionPrice(new Percent(200, 100))).toEqual(new Price(token0, token2, 768, 200))
      })
    })
  })
})