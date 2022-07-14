import invariant from 'tiny-invariant'

import { Currency, Price, Token } from '@uniswap/sdk-core'
import { Pool } from '@uniswap/v3-sdk'
import { Pair } from '@uniswap/v2-sdk'

type TPool = Pair | Pool

/**
 * Represents a list of pools or pairs through which a swap can occur
 * @template TInput The input token
 * @template TOutput The output token
 */
export class MixedRouteSDK<TInput extends Currency, TOutput extends Currency> {
  public readonly pools: TPool[]
  public readonly path: Token[]
  public readonly input: TInput
  public readonly output: TOutput

  private _midPrice: Price<TInput, TOutput> | null = null

  /**
   * Creates an instance of route.
   * @param pools An array of `TPool` objects (pools or pairs), ordered by the route the swap will take
   * @param input The input token
   * @param output The output token
   */
  public constructor(pools: TPool[], input: TInput, output: TOutput) {
    invariant(pools.length > 0, 'POOLS')

    const chainId = pools[0].chainId
    const allOnSameChain = pools.every((pool) => pool.chainId === chainId)
    invariant(allOnSameChain, 'CHAIN_IDS')

    const wrappedInput = input.wrapped
    invariant(pools[0].involvesToken(wrappedInput), 'INPUT')

    invariant(pools[pools.length - 1].involvesToken(output.wrapped), 'OUTPUT')

    /**
     * Normalizes token0-token1 order and selects the next token/fee step to add to the path
     * */
    const tokenPath: Token[] = [wrappedInput]
    for (const [i, pool] of pools.entries()) {
      const currentInputToken = tokenPath[i]
      invariant(currentInputToken.equals(pool.token0) || currentInputToken.equals(pool.token1), 'PATH')
      const nextToken = currentInputToken.equals(pool.token0) ? pool.token1 : pool.token0
      tokenPath.push(nextToken)
    }

    this.pools = pools
    this.path = tokenPath
    this.input = input
    this.output = output ?? tokenPath[tokenPath.length - 1]
  }

  public get chainId(): number {
    return this.pools[0].chainId
  }

  /**
   * Returns the mid price of the route
   */
  public get midPrice(): Price<TInput, TOutput> {
    if (this._midPrice !== null) return this._midPrice

    const getPriceForPool = (pool: TPool, nextInputIsToken0: boolean) => {
      if (pool instanceof Pair) {
        return nextInputIsToken0
          ? new Price(pool.reserve0.currency, pool.reserve1.currency, pool.reserve0.quotient, pool.reserve1.quotient)
          : new Price(pool.reserve1.currency, pool.reserve0.currency, pool.reserve1.quotient, pool.reserve0.quotient)
      } else if (pool instanceof Pool) {
        return nextInputIsToken0 ? pool.token0Price : pool.token1Price
      } else {
        throw new Error('Invalid pool type in mixed route')
      }
    }

    const price = this.pools.slice(1).reduce(
      ({ nextInput, price }, pool) => {
        return nextInput.equals(pool.token0)
          ? {
              nextInput: pool.token1,
              price: price.multiply(getPriceForPool(pool, true)),
            }
          : {
              nextInput: pool.token0,
              price: price.multiply(getPriceForPool(pool, false)),
            }
      },
      this.pools[0].token0.equals(this.input.wrapped)
        ? {
            nextInput: this.pools[0].token1,
            price: getPriceForPool(this.pools[0], true),
          }
        : {
            nextInput: this.pools[0].token0,
            price: getPriceForPool(this.pools[0], false),
          }
    ).price

    return (this._midPrice = new Price(this.input, this.output, price.denominator, price.numerator))
  }
}
