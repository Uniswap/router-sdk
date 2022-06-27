import { pack } from '@ethersproject/solidity'
import { Currency, Token } from '@uniswap/sdk-core'
import { Pool } from '@uniswap/v3-sdk'
import { Pair } from '@uniswap/v2-sdk'
import { MixedRouteSDK } from '../entities/mixedRoute/route'

/// @dev We should import this from somewhere
const V2_FEE = 8388608

/**
 * Converts a route to a hex encoded path
 * @param route the mixed path to convert to an encoded path
 * @param exactOutput whether the route should be encoded in reverse, for making exact output swaps
 */
export function encodeMixedRouteToPath(route: MixedRouteSDK<Currency, Currency>, exactOutput: boolean): string {
  const firstInputToken: Token = route.input.wrapped

  const { path, types } = route.parts.reduce(
    (
      { inputToken, path, types }: { inputToken: Token; path: (string | number)[]; types: string[] },
      part: Pool | Pair,
      index
    ): { inputToken: Token; path: (string | number)[]; types: string[] } => {
      const outputToken: Token = part.token0.equals(inputToken) ? part.token1 : part.token0
      if (index === 0) {
        return {
          inputToken: outputToken,
          types: ['address', 'uint24', 'address'],
          path: [inputToken.address, part instanceof Pool ? part.fee : V2_FEE, outputToken.address],
        }
      } else {
        return {
          inputToken: outputToken,
          types: [...types, 'uint24', 'address'],
          path: [...path, part instanceof Pool ? part.fee : V2_FEE, outputToken.address],
        }
      }
    },
    { inputToken: firstInputToken, path: [], types: [] }
  )

  return exactOutput ? pack(types.reverse(), path.reverse()) : pack(types, path)
}
