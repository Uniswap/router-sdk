import { pack } from '@ethersproject/solidity'
import { Currency, Token } from '@uniswap/sdk-core'
import { Pool } from '@uniswap/v3-sdk'
import { Pair } from '@uniswap/v2-sdk'
import { MixedRouteSDK } from '../entities/mixedRoute/route'
import { V2_FEE_PATH_PLACEHOLDER } from '../constants'

/**
 * Converts a route to a hex encoded path
 * @param route the mixed path to convert to an encoded path
 * @param exactOutput whether the route should be encoded in reverse, for making exact output swaps
 */
export function encodeMixedRouteToPath(route: MixedRouteSDK<Currency, Currency>, exactOutput: boolean): string {
  const firstInputToken: Token = route.input.wrapped

  const { path, types } = route.pools.reduce(
    (
      { inputToken, path, types }: { inputToken: Token; path: (string | number)[]; types: string[] },
      pool: Pool | Pair,
      index
    ): { inputToken: Token; path: (string | number)[]; types: string[] } => {
      const outputToken: Token = pool.token0.equals(inputToken) ? pool.token1 : pool.token0
      if (index === 0) {
        return {
          inputToken: outputToken,
          types: ['address', 'uint24', 'address'],
          path: [inputToken.address, pool instanceof Pool ? pool.fee : V2_FEE_PATH_PLACEHOLDER, outputToken.address],
        }
      } else {
        return {
          inputToken: outputToken,
          types: [...types, 'uint24', 'address'],
          path: [...path, pool instanceof Pool ? pool.fee : V2_FEE_PATH_PLACEHOLDER, outputToken.address],
        }
      }
    },
    { inputToken: firstInputToken, path: [], types: [] }
  )

  return exactOutput ? pack(types.reverse(), path.reverse()) : pack(types, path)
}
