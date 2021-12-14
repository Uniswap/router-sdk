import { Interface } from '@ethersproject/abi'
import invariant from 'tiny-invariant'
import { abi } from '@uniswap/swap-router-contracts/artifacts/contracts/interfaces/IApproveAndCall.sol/IApproveAndCall.json'
import { Currency, Token } from '@uniswap/sdk-core'
import { AddLiquidityOptions, MintOptions, NonfungiblePositionManager, Position, toHex } from '@uniswap/v3-sdk'

export enum ApprovalTypes {
  NOT_REQUIRED = 0,
  MAX = 1,
  MAX_MINUS_ONE = 2,
  ZERO_THEN_MAX = 3,
  ZERO_THEN_MAX_MINUS_ONE = 4,
}

export abstract class ApproveAndCall {
  public static INTERFACE: Interface = new Interface(abi)

  /**
   * Cannot be constructed.
   */
  private constructor() {}

  public static encodeApproveMax(token: Token): string {
    return ApproveAndCall.INTERFACE.encodeFunctionData('approveMax', [token.address])
  }

  public static encodeApproveMaxMinusOne(token: Token): string {
    return ApproveAndCall.INTERFACE.encodeFunctionData('approveMaxMinusOne', [token.address])
  }

  public static encodeApproveZeroThenMax(token: Token): string {
    return ApproveAndCall.INTERFACE.encodeFunctionData('approveZeroThenMax', [token.address])
  }

  public static encodeApproveZeroThenMaxMinusOne(token: Token): string {
    return ApproveAndCall.INTERFACE.encodeFunctionData('approveZeroThenMaxMinusOne', [token.address])
  }

  public static encodeCallPositionManager(calldatas: string[]): string {
    invariant(calldatas.length > 0, 'NULL_CALLDATA')

    if (calldatas.length == 1) {
      return ApproveAndCall.INTERFACE.encodeFunctionData('callPositionManager', calldatas)
    } else {
      const encodedMulticall = NonfungiblePositionManager.INTERFACE.encodeFunctionData('multicall', [calldatas])
      return ApproveAndCall.INTERFACE.encodeFunctionData('callPositionManager', [encodedMulticall])
    }
  }

  public static encodeAddLiquidity(position: Position, addLiquidityOptions: AddLiquidityOptions): string {
    const { amount0: amount0Min, amount1: amount1Min } = position.mintAmountsWithSlippage(addLiquidityOptions.slippageTolerance)

    // type guard
    function isMint(options: AddLiquidityOptions): options is MintOptions {
      return Object.keys(options).some(k => k === 'recipient')
    }

    if (isMint(addLiquidityOptions)) {
      return ApproveAndCall.INTERFACE.encodeFunctionData('mint', [{
        token0: position.pool.token0.address,
        token1: position.pool.token1.address,
        fee: position.pool.fee,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        amount0Min: toHex(amount0Min),
        amount1Min: toHex(amount1Min),
        recipient: addLiquidityOptions.recipient,
      }])
    } else {
      return ApproveAndCall.INTERFACE.encodeFunctionData('increaseLiquidity', [{
        token0: position.pool.token0.address,
        token1: position.pool.token1.address,
        amount0Min: toHex(amount0Min),
        amount1Min: toHex(amount1Min),
        tokenId: toHex(addLiquidityOptions.tokenId)
      }])
    }
  }

  public static encodeApprove(token: Currency, approvalType: ApprovalTypes): string {
    switch (approvalType) {
      case ApprovalTypes.MAX:
        return ApproveAndCall.encodeApproveMax(token.wrapped)
      case ApprovalTypes.MAX_MINUS_ONE:
        return ApproveAndCall.encodeApproveMaxMinusOne(token.wrapped)
      case ApprovalTypes.ZERO_THEN_MAX:
        return ApproveAndCall.encodeApproveZeroThenMax(token.wrapped)
      case ApprovalTypes.ZERO_THEN_MAX_MINUS_ONE:
        return ApproveAndCall.encodeApproveZeroThenMaxMinusOne(token.wrapped)
      default:
        throw 'Error: invalid ApprovalType'
    }
  }
}
