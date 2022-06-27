import { Ether, Token, WETH9, CurrencyAmount } from '@uniswap/sdk-core'
import { Route as V3RouteSDK, Pool, FeeAmount, TickMath, encodeSqrtRatioX96 } from '@uniswap/v3-sdk'
import { MixedRoute, RouteV3 } from '../route'
import { Protocol } from '../protocol'
import { Route as V2RouteSDK, Pair } from '@uniswap/v2-sdk'
import { MixedRouteSDK } from './route'

describe.only('MixedRoute', () => {
  const ETHER = Ether.onChain(1)
  const token0 = new Token(1, '0x0000000000000000000000000000000000000001', 18, 't0')
  const token1 = new Token(1, '0x0000000000000000000000000000000000000002', 18, 't1')
  const token2 = new Token(1, '0x0000000000000000000000000000000000000003', 18, 't2')
  const weth = WETH9[1]

  const pool_0_1 = new Pool(token0, token1, FeeAmount.MEDIUM, encodeSqrtRatioX96(1, 1), 0, 0, [])
  const pool_0_weth = new Pool(token0, weth, FeeAmount.MEDIUM, encodeSqrtRatioX96(1, 1), 0, 0, [])
  const pool_1_weth = new Pool(token1, weth, FeeAmount.MEDIUM, encodeSqrtRatioX96(1, 1), 0, 0, [])
  /// @dev copied from v2-sdk route.test.ts
  const pair_0_1 = new Pair(CurrencyAmount.fromRawAmount(token0, '100'), CurrencyAmount.fromRawAmount(token1, '200'))
  const pair_0_weth = new Pair(CurrencyAmount.fromRawAmount(token0, '100'), CurrencyAmount.fromRawAmount(weth, '100'))
  const pair_1_weth = new Pair(CurrencyAmount.fromRawAmount(token1, '175'), CurrencyAmount.fromRawAmount(weth, '100'))
  const pair_weth_2 = new Pair(CurrencyAmount.fromRawAmount(weth, '200'), CurrencyAmount.fromRawAmount(token2, '150'))

  describe('path', () => {
    it('wraps pure v3 route object and successfully constructs a path from the tokens', () => {
      /// @dev since the MixedRoute sdk object lives here in router-sdk we don't need to reconstruct it
      const routeOriginal = new MixedRouteSDK([pool_0_1], token0, token1)
      const route = new MixedRoute(routeOriginal)
      expect(route.parts).toEqual([pool_0_1])
      expect(route.tokenPath).toEqual([token0, token1])
      expect(route.input).toEqual(token0)
      expect(route.output).toEqual(token1)
      expect(route.chainId).toEqual(1)
    })

    it('wraps pure v2 route object and successfully constructs a path from the tokens', () => {
      const route = new MixedRouteSDK([pair_0_1], token0, token1)
      expect(route.parts).toEqual([pair_0_1])
      expect(route.tokenPath).toEqual([token0, token1])
      expect(route.input).toEqual(token0)
      expect(route.output).toEqual(token1)
      expect(route.chainId).toEqual(1)
    })

    it('wraps mixed route object and successfully constructs a path from the tokens', () => {
      const route = new MixedRouteSDK([pool_0_1, pair_1_weth], token0, weth)
      expect(route.parts).toEqual([pool_0_1, pair_1_weth])
      expect(route.tokenPath).toEqual([token0, token1, weth])
      expect(route.input).toEqual(token0)
      expect(route.output).toEqual(weth)
      expect(route.chainId).toEqual(1)
    })

    it('wraps complex mixed route object and successfully constructs a path from the tokens', () => {
      const route = new MixedRouteSDK([pool_0_1, pair_1_weth, pair_weth_2], token0, token2)
      expect(route.parts).toEqual([pool_0_1, pair_1_weth, pair_weth_2])
      expect(route.tokenPath).toEqual([token0, token1, weth, token2])
      expect(route.input).toEqual(token0)
      expect(route.output).toEqual(token2)
      expect(route.chainId).toEqual(1)
    })
  })

  it('can have a token as both input and output', () => {
    const route = new MixedRouteSDK([pair_0_weth, pair_0_1, pair_1_weth], weth, weth)
    expect(route.parts).toEqual([pair_0_weth, pair_0_1, pair_1_weth])
    expect(route.input).toEqual(weth)
    expect(route.output).toEqual(weth)
  })

  /// @dev TODO
  describe('is backwards compatible with a 100% V3 route', () => {
    it('successfully assigns the protocol', () => {
      const routeOriginal = new V3RouteSDK([pool_0_1], token0, token1)
      const route = new RouteV3(routeOriginal)
      expect(route.protocol).toEqual(Protocol.V3)
    })

    it('inherits parameters from extended route class', () => {
      const routeOriginal = new V3RouteSDK([pool_0_1], token0, token1)
      const route = new RouteV3(routeOriginal)
      expect(route.pools).toEqual(routeOriginal.pools)
      expect(route.path).toEqual(routeOriginal.tokenPath)
      expect(route.input).toEqual(routeOriginal.input)
      expect(route.output).toEqual(routeOriginal.output)
      expect(route.midPrice).toEqual(routeOriginal.midPrice)
      expect(route.chainId).toEqual(routeOriginal.chainId)
    })

    it('can have a token as both input and output', () => {
      const routeOriginal = new V3RouteSDK([pool_0_weth, pool_0_1, pool_1_weth], weth, weth)
      const route = new RouteV3(routeOriginal)
      expect(route.pools).toEqual([pool_0_weth, pool_0_1, pool_1_weth])
      expect(route.input).toEqual(weth)
      expect(route.output).toEqual(weth)
    })

    it('supports ether input', () => {
      const routeOriginal = new V3RouteSDK([pool_0_weth], ETHER, token0)
      const route = new RouteV3(routeOriginal)
      expect(route.pools).toEqual([pool_0_weth])
      expect(route.input).toEqual(ETHER)
      expect(route.output).toEqual(token0)
    })

    it('supports ether output', () => {
      const routeOriginal = new V3RouteSDK([pool_0_weth], token0, ETHER)
      const route = new RouteV3(routeOriginal)
      expect(route.pools).toEqual([pool_0_weth])
      expect(route.input).toEqual(token0)
      expect(route.output).toEqual(ETHER)
    })
  })

  describe('#midPrice', () => {
    const pool_0_1 = new Pool(
      token0,
      token1,
      FeeAmount.MEDIUM,
      encodeSqrtRatioX96(1, 5),
      0,
      TickMath.getTickAtSqrtRatio(encodeSqrtRatioX96(1, 5)),
      []
    )
    const pool_1_2 = new Pool(
      token1,
      token2,
      FeeAmount.MEDIUM,
      encodeSqrtRatioX96(15, 30),
      0,
      TickMath.getTickAtSqrtRatio(encodeSqrtRatioX96(15, 30)),
      []
    )
    const pool_0_weth = new Pool(
      token0,
      weth,
      FeeAmount.MEDIUM,
      encodeSqrtRatioX96(3, 1),
      0,
      TickMath.getTickAtSqrtRatio(encodeSqrtRatioX96(3, 1)),
      []
    )
    const pool_1_weth = new Pool(
      token1,
      weth,
      FeeAmount.MEDIUM,
      encodeSqrtRatioX96(1, 7),
      0,
      TickMath.getTickAtSqrtRatio(encodeSqrtRatioX96(1, 7)),
      []
    )

    const pair_0_1 = new Pair(CurrencyAmount.fromRawAmount(token0, '100'), CurrencyAmount.fromRawAmount(token1, '200'))
    const pair_1_2 = new Pair(CurrencyAmount.fromRawAmount(token1, '200'), CurrencyAmount.fromRawAmount(token2, '150'))
    const pair_0_weth = new Pair(CurrencyAmount.fromRawAmount(token0, '100'), CurrencyAmount.fromRawAmount(weth, '100'))
    const pair_1_weth = new Pair(CurrencyAmount.fromRawAmount(token1, '175'), CurrencyAmount.fromRawAmount(weth, '100'))

    describe('100% V3 pool route', () => {
      it('correct for 0 -> 1', () => {
        const price = new MixedRouteSDK([pool_0_1], token0, token1).midPrice
        expect(price.toFixed(4)).toEqual('0.2000')
        expect(price.baseCurrency.equals(token0)).toEqual(true)
        expect(price.quoteCurrency.equals(token1)).toEqual(true)
      })

      it('is cached', () => {
        const routeOriginal = new V3RouteSDK([pool_0_1], token0, token1)
        const route = new RouteV3(routeOriginal)
        expect(route.midPrice).toStrictEqual(route.midPrice)
      })

      it('correct for 1 -> 0', () => {
        const price = new MixedRouteSDK([pool_0_1], token1, token0).midPrice
        expect(price.toFixed(4)).toEqual('5.0000')
        expect(price.baseCurrency.equals(token1)).toEqual(true)
        expect(price.quoteCurrency.equals(token0)).toEqual(true)
      })

      it('correct for 0 -> 1 -> 2', () => {
        const price = new MixedRouteSDK([pool_0_1, pool_1_2], token0, token2).midPrice
        expect(price.toFixed(4)).toEqual('0.1000')
        expect(price.baseCurrency.equals(token0)).toEqual(true)
        expect(price.quoteCurrency.equals(token2)).toEqual(true)
      })

      it('correct for 2 -> 1 -> 0', () => {
        const price = new MixedRouteSDK([pool_1_2, pool_0_1], token2, token0).midPrice
        expect(price.toFixed(4)).toEqual('10.0000')
        expect(price.baseCurrency.equals(token2)).toEqual(true)
        expect(price.quoteCurrency.equals(token0)).toEqual(true)
      })

      it('correct for ether -> 0', () => {
        const price = new MixedRouteSDK([pool_0_weth], ETHER, token0).midPrice
        expect(price.toFixed(4)).toEqual('0.3333')
        expect(price.baseCurrency.equals(ETHER)).toEqual(true)
        expect(price.quoteCurrency.equals(token0)).toEqual(true)
      })

      it('correct for 1 -> weth', () => {
        const price = new MixedRouteSDK([pool_1_weth], token1, weth).midPrice
        expect(price.toFixed(4)).toEqual('0.1429')
        expect(price.baseCurrency.equals(token1)).toEqual(true)
        expect(price.quoteCurrency.equals(weth)).toEqual(true)
      })

      it('correct for ether -> 0 -> 1 -> weth', () => {
        const price = new MixedRouteSDK([pool_0_weth, pool_0_1, pool_1_weth], ETHER, weth).midPrice
        expect(price.toSignificant(4)).toEqual('0.009524')
        expect(price.baseCurrency.equals(ETHER)).toEqual(true)
        expect(price.quoteCurrency.equals(weth)).toEqual(true)
      })

      it('correct for weth -> 0 -> 1 -> ether', () => {
        const price = new MixedRouteSDK([pool_0_weth, pool_0_1, pool_1_weth], weth, ETHER).midPrice
        expect(price.toSignificant(4)).toEqual('0.009524')
        expect(price.baseCurrency.equals(weth)).toEqual(true)
        expect(price.quoteCurrency.equals(ETHER)).toEqual(true)
      })
    })

    describe('100% V2 pair route', () => {
      it('correct for 0 -> 1', () => {
        const routeV2SDK = new V2RouteSDK([pair_0_1], token0, token1)
        const route = new MixedRouteSDK([pair_0_1], token0, token1)
        expect(routeV2SDK.midPrice).toEqual(route.midPrice)
        expect(route.midPrice.toFixed(4)).toEqual('2.0000')
      })

      it('is cached', () => {
        const route = new MixedRouteSDK([pair_0_1], token0, token1)
        expect(route.midPrice).toStrictEqual(route.midPrice)
      })

      it('correct for 1 -> 0', () => {
        const routeV2SDK = new V2RouteSDK([pair_0_1], token1, token0)
        const route = new MixedRouteSDK([pair_0_1], token1, token0)
        expect(routeV2SDK.midPrice).toStrictEqual(route.midPrice)
        expect(route.midPrice.toFixed(4)).toEqual('0.5000')
        expect(route.midPrice.baseCurrency.equals(token1)).toEqual(true)
        expect(route.midPrice.quoteCurrency.equals(token0)).toEqual(true)
      })

      it('correct for 0 -> 1 -> 2', () => {
        const routeV2SDK = new V2RouteSDK([pair_0_1, pair_1_2], token0, token2)
        const route = new MixedRouteSDK([pair_0_1, pair_1_2], token0, token2)
        expect(routeV2SDK.midPrice).toEqual(route.midPrice)
        expect(route.midPrice.toFixed(4)).toEqual('1.5000')
        expect(route.midPrice.baseCurrency.equals(token0)).toEqual(true)
        expect(route.midPrice.quoteCurrency.equals(token2)).toEqual(true)
      })

      it('correct for 2 -> 1 -> 0', () => {
        const routeV2SDK = new V2RouteSDK([pair_1_2, pair_0_1], token2, token0)
        const route = new MixedRouteSDK([pair_1_2, pair_0_1], token2, token0)
        expect(routeV2SDK.midPrice).toEqual(route.midPrice)
        expect(route.midPrice.toFixed(4)).toEqual('0.6667')
        expect(route.midPrice.baseCurrency.equals(token2)).toEqual(true)
        expect(route.midPrice.quoteCurrency.equals(token0)).toEqual(true)
      })

      it('correct for ether -> 0', () => {
        const routeV2SDK = new V2RouteSDK([pair_0_weth], ETHER, token0)
        const route = new MixedRouteSDK([pair_0_weth], ETHER, token0)
        expect(routeV2SDK.midPrice).toEqual(route.midPrice)
        expect(route.midPrice.toFixed(4)).toEqual('1.0000')
        expect(route.midPrice.baseCurrency.equals(ETHER)).toEqual(true)
        expect(route.midPrice.quoteCurrency.equals(token0)).toEqual(true)
      })

      it('correct for 1 -> weth', () => {
        const routeV2SDK = new V2RouteSDK([pair_1_weth], token1, weth)
        const route = new MixedRouteSDK([pair_1_weth], token1, weth)
        expect(routeV2SDK.midPrice).toEqual(route.midPrice)
        expect(route.midPrice.toFixed(4)).toEqual('0.5714')
        expect(route.midPrice.baseCurrency.equals(token1)).toEqual(true)
        expect(route.midPrice.quoteCurrency.equals(weth)).toEqual(true)
      })

      it('correct for ether -> 0 -> 1 -> weth', () => {
        const routeV2SDK = new V2RouteSDK([pair_0_weth, pair_0_1, pair_1_weth], ETHER, weth)
        const route = new MixedRouteSDK([pair_0_weth, pair_0_1, pair_1_weth], ETHER, weth)
        expect(routeV2SDK.midPrice).toEqual(route.midPrice)
        expect(route.midPrice.toSignificant(4)).toEqual('1.143')
        expect(route.midPrice.baseCurrency.equals(ETHER)).toEqual(true)
        expect(route.midPrice.quoteCurrency.equals(weth)).toEqual(true)
      })

      it('correct for weth -> 0 -> 1 -> ether', () => {
        const routeV2SDK = new V2RouteSDK([pair_0_weth, pair_0_1, pair_1_weth], weth, ETHER)
        const route = new MixedRouteSDK([pair_0_weth, pair_0_1, pair_1_weth], weth, ETHER)
        expect(routeV2SDK.midPrice).toEqual(route.midPrice)
        expect(route.midPrice.toSignificant(4)).toEqual('1.143')
        expect(route.midPrice.baseCurrency.equals(weth)).toEqual(true)
        expect(route.midPrice.quoteCurrency.equals(ETHER)).toEqual(true)
      })
    })

    describe('mixed route', () => {
      it('correct for 0 -[V3]-> 1 -[V2]-> 2', () => {
        // pool_0_1 midPrice = 0.2
        // pair 1_2 midPrice = 1.3334
        // is it 0.2 / 1.3334, equals 0.15
        const route = new MixedRouteSDK([pool_0_1, pair_1_2], token0, token2)
        expect(route.midPrice.toFixed(4)).toEqual('0.1500')
      })
    })
  })
})
