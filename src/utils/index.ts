import { Currency, Token } from '@uniswap/sdk-core'
import { Pair } from '@uniswap/v2-sdk'
import { Pool } from '@uniswap/v3-sdk'
import { MixedRouteSDK } from '../entities/mixedRoute/route'

/**
 * Utility function to return each consecutive section of Pools or Pairs in a MixedRoute
 * @param route
 * @returns a nested array of Pools or Pairs in the order of the route
 */
export const divideMixedRouteIntoConsecutiveSections = (
  route: MixedRouteSDK<Currency, Currency>
): (Pool | Pair)[][] => {
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
  return acc
}

/**
 * Simple utility function to get the output of an array of Pools or Pairs
 * @param pools
 * @param firstInputToken
 * @returns the output token of the last pool in the array
 */
export const getOutputOfPools = (pools: (Pool | Pair)[], firstInputToken: Token): Token => {
  const { inputToken: outputToken } = pools.reduce(
    ({ inputToken }, pool: Pool | Pair): { inputToken: Token } => {
      if (!pool.involvesToken(inputToken)) throw new Error('PATH')
      const outputToken: Token = pool.token0.equals(inputToken) ? pool.token1 : pool.token0
      return {
        inputToken: outputToken,
      }
    },
    { inputToken: firstInputToken }
  )
  return outputToken
}
