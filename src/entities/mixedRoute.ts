import invariant from 'tiny-invariant'

import { Currency, Price, Token } from '@uniswap/sdk-core'
import { Pool } from '@uniswap/v3-sdk'
import { Pair } from '@uniswap/v2-sdk'

type TPool = Pair | Pool

/**
 * Represents a list of pools through which a swap can occur
 * @template TInput The input token
 * @template TOutput The output token
 */
export class MixedRoute<TInput extends Currency, TOutput extends Currency> {
  public readonly parts: TPool[]
  public readonly tokenPath: Token[]
  public readonly input: TInput
  public readonly output: TOutput

  private _midPrice: Price<TInput, TOutput> | null = null

  /**
   * Creates an instance of route.
   * @param pools An array of `Pool` objects, ordered by the route the swap will take
   * @param input The input token
   * @param output The output token
   */
  public constructor(parts: TPool[], input: TInput, output: TOutput) {
    invariant(parts.length > 0, 'PARTS')

    const chainId = parts[0].chainId
    const allOnSameChain = parts.every((part) => part.chainId === chainId)
    invariant(allOnSameChain, 'CHAIN_IDS')

    const wrappedInput = input.wrapped
    invariant(parts[0].involvesToken(wrappedInput), 'INPUT')

    invariant(parts[parts.length - 1].involvesToken(output.wrapped), 'OUTPUT')

    /**
     * Normalizes token0-token1 order and selects the next token/fee step to add to the path
     * */
    const tokenPath: Token[] = [wrappedInput]
    for (const [i, part] of parts.entries()) {
      const currentInputToken = tokenPath[i]
      invariant(currentInputToken.equals(part.token0) || currentInputToken.equals(part.token1), 'PATH')
      const nextToken = currentInputToken.equals(part.token0) ? part.token1 : part.token0
      tokenPath.push(nextToken)
    }

    this.parts = parts
    this.tokenPath = tokenPath
    this.input = input
    this.output = output ?? tokenPath[tokenPath.length - 1]
  }

  public get chainId(): number {
    return this.parts[0].chainId
  }

  /**
   * Returns the mid price of the route
   */
  public get midPrice(): Price<TInput, TOutput> {
    if (this._midPrice !== null) return this._midPrice

    const getPriceForPart = (part: TPool, nextInputIsToken0: boolean) => {
      if (part instanceof Pair) {
        return nextInputIsToken0
          ? new Price(part.reserve0.currency, part.reserve1.currency, part.reserve0.quotient, part.reserve1.quotient)
          : new Price(part.reserve1.currency, part.reserve0.currency, part.reserve1.quotient, part.reserve0.quotient)
      } else if (part instanceof Pool) {
        return nextInputIsToken0 ? part.token0Price : part.token1Price
      } else {
        throw new Error('Invalid part type in mixed route')
      }
    }

    const price = this.parts.slice(1).reduce(
      ({ nextInput, price }, pool) => {
        return nextInput.equals(pool.token0)
          ? {
              nextInput: pool.token1,
              price: price.multiply(getPriceForPart(pool, true)),
            }
          : {
              nextInput: pool.token0,
              price: price.multiply(getPriceForPart(pool, false)),
            }
      },
      this.parts[0].token0.equals(this.input.wrapped)
        ? {
            nextInput: this.parts[0].token1,
            price: getPriceForPart(this.parts[0], true),
          }
        : {
            nextInput: this.parts[0].token0,
            price: getPriceForPart(this.parts[0], false),
          }
    ).price

    return (this._midPrice = new Price(this.input, this.output, price.denominator, price.numerator))
  }
}
