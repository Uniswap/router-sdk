import { Interface } from '@ethersproject/abi'
import invariant from 'tiny-invariant'
import { abi } from '@uniswap/swap-router-contracts/artifacts/contracts/interfaces/IApproveAndCall.sol/IApproveAndCall.json'
import { Token } from '@uniswap/sdk-core'
import { NonfungiblePositionManager } from '@uniswap/v3-sdk'

export abstract class ApproveAndCall {
  public static INTERFACE: Interface = new Interface(abi)

  /**
   * Cannot be constructed.
   */
  private constructor() {}

  public static encodeApproveMax(token: Token): string {
    return ApproveAndCall.INTERFACE.encodeFunctionData('approveMax', [token.address])
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
}
