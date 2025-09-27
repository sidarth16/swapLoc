import * as Sdk from '@1inch/cross-chain-sdk'
import {
  JsonRpcProvider,
  MaxUint256,
  parseEther,
  parseUnits,
  randomBytes,
  ethers,
} from 'ethers'
import { RpcProvider, Contract, Account, ec, Call,  hash } from 'starknet'
import { uint8ArrayToHex } from '@1inch/byte-utils'

import escrowSrcAbi from "./abi/EscrowSrc.contract_class.json" assert { type: "json" };
import erc20Abi from "./abi/ERC20.contract_class.json" assert { type: "json" };
import escrowFactoryAbi from './abi/EscrowFactory.json'


import { Wallet } from "./wallet"
import { Resolver } from "./resolver"
import { stark, OrderStrk } from "./stark";


const { Address } = Sdk

// ----------------- CONFIG -----------------
const EVM_CONFIG = {
  chainId: 1,
  url: 'http://127.0.0.1:8545',
  limitOrderProtocol: '0x111111125421cA6dc452d289314280a0f8842A65',
  wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  escrowFactory: '0xE38aF3FDa379401445FFD7b9cD57D0D33d03790E',
  resolver: '0xbd99b8e3c580bFa9376c42062CD86535911bE0a2',
  resolverPk: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  userPk : '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',//process.env.PRIVATE_KEY_EVM_USER,
  resolverOwner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
//   userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
}

const STARKNET_CONFIG = {
    chainId: 99999, 
    url: 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
    escrowSrc : '0x012b00359d5d3f0c8da7b80ea54a3df753f7c0dc8c2019f01091f911af889032',
    user: '0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453',
    userPk : '0x06165f0032ab3b175d88f7f57ad86bef6a9e2ecacf3fe0fa7988a9384c6fe529',
    resolver : '0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453',
    resolverPk:  '0x06165f0032ab3b175d88f7f57ad86bef6a9e2ecacf3fe0fa7988a9384c6fe529'//process.env.PRIVATE_KEY_STRK_RESOLVER    
}


// ----------------- CLASS -----------------
export class swapStarknetToEVM {
  private evmProvider: JsonRpcProvider
  private starknetProvider: RpcProvider

  private strkUser: Account
  private strkResolver: Account
  private evmResolverOwner: Wallet

  constructor() {
    this.evmProvider = new JsonRpcProvider(EVM_CONFIG.url, EVM_CONFIG.chainId)
    this.starknetProvider = new RpcProvider({ nodeUrl: STARKNET_CONFIG.url })
    
    this.strkUser = new Account(
        this.starknetProvider,
        STARKNET_CONFIG.user,
        STARKNET_CONFIG.userPk
    )

    this.strkResolver = new Account(
        this.starknetProvider,
        STARKNET_CONFIG.resolver,
        STARKNET_CONFIG.resolverPk
    )
    this.evmResolverOwner = new Wallet(EVM_CONFIG.resolverPk as string, this.evmProvider)
  }

  private async checkBalAllowanceAndApproveSTRK(erc20Address:string, amount:bigint){
    const erc20 = new Contract(erc20Abi.abi, erc20Address, this.starknetProvider);

    // Check balance
    const userBalance = await erc20.balance_of(STARKNET_CONFIG.user);
    console.log(`\nMaker token balance : ${userBalance}`)
    if (amount>userBalance){
        throw new Error(`ERR: Insufficient token Balance (${userBalance} < amount: ${amount})` )
    }

    const allowance = await erc20.allowance(STARKNET_CONFIG.user, STARKNET_CONFIG.escrowSrc);
    if (allowance < amount){
        const approveCall: Call = erc20.populate("approve", {
            spender: STARKNET_CONFIG.escrowSrc,
            amount: amount,
        });
        const { transaction_hash } = await this.strkUser.execute(approveCall);
        await this.starknetProvider.waitForTransaction(transaction_hash);
    }
  }

  private async checkBalAllowanceAndApproveEVM(tokenAddress: string, evmUserAddress: string, amount: bigint) {
        const userWallet = new Wallet(EVM_CONFIG.userPk as string, this.evmProvider);
        let tokenContract = new ethers.Contract(
            tokenAddress,
            [
                'function balanceOf(address) view returns (uint256)',
                'function approve(address,uint256) returns (bool)',
                'function allowance(address,address) view returns (uint256)',
                'function transfer(address,uint256) returns (bool)',
            ],
            userWallet.signer
        )

        // const userAddress = 
        // // console.log("Checking balance of \n\tuser: ",userAddress)
        // // console.log("\ttoken: ",tokenAddress)
        const userBalance = await tokenContract.balanceOf(evmUserAddress)
        console.log(`User token balance: ${userBalance}`)

        if (userBalance < amount) {
            throw new Error(`Insufficient token balance! (${userBalance} < ${amount}`)
        }

        let tx = await tokenContract.approve(EVM_CONFIG.resolverOwner, amount);
        await tx.wait()
        console.log('token Approved to resolver');
        
        // const resolverBalance = await tokenContract.balanceOf(EVM_CONFIG.resolverOwner);
        // console.log("Resolver balance:", resolverBalance.toString());
        // let feeTokenContract = new ethers.Contract(
        //     "0xca42323f20E7FcEc3aE61AF72B97D4B8DFecda9f",
        //     ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)','function transfer(address,uint256) returns (bool)'],
        //     this.evmResolverOwner.signer
        // )
        // let tx = await feeTokenContract.transfer(EVM_CONFIG.resolver, amount);
        // await tx.wait()
        // tx = await feeTokenContract.transfer(EVM_CONFIG.escrowFactory, amount);
        // await tx.wait()

        
        tokenContract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)','function transfer(address,uint256) returns (bool)','function transferFrom(address,address,uint256) returns (bool)'],
            this.evmResolverOwner.signer
        )
        console.log(`resolver token balance: ${await tokenContract.balanceOf(EVM_CONFIG.resolver)}`)

        tx = await tokenContract.transferFrom(evmUserAddress, EVM_CONFIG.resolver, amount);
        await tx.wait()
        // tx = await tokenContract.transfer(EVM_CONFIG.escrowFactory, amount);
        // await tx.wait()

        // console.log(`resolverOwner token balance: ${await tokenContract.balanceOf(EVM_CONFIG.resolverOwner)}`)
        // console.log(`resolverOwner Feetoken balance: ${await feeTokenContract.balanceOf(EVM_CONFIG.resolverOwner)}`)

        console.log(`resolver token balance: ${await tokenContract.balanceOf(EVM_CONFIG.resolver)}`)
        // console.log(`resolver Feetoken balance: ${await feeTokenContract.balanceOf(EVM_CONFIG.resolver)}`)

        // console.log(`allowance(resolver,factory): ${await tokenContract.allowance(EVM_CONFIG.resolver, EVM_CONFIG.escrowFactory)}`)
        // console.log(`allowance(resolverOwner,factory): ${await tokenContract.allowance(EVM_CONFIG.resolverOwner, EVM_CONFIG.escrowFactory)}`)
        // console.log(`allowance(resolverOwner,resolver): ${await tokenContract.allowance(EVM_CONFIG.resolverOwner, EVM_CONFIG.resolver)}`)

        // let approveTx = await tokenContract.approve(EVM_CONFIG.resolver, MaxUint256);
        // await approveTx.wait();

        // approveTx = await feeTokenContract.approve(EVM_CONFIG.resolver, MaxUint256);
        // await approveTx.wait();

        // approveTx = await tokenContract.approve(EVM_CONFIG.escrowFactory, MaxUint256);
        // await approveTx.wait();

        // approveTx = await feeTokenContract.approve(EVM_CONFIG.escrowFactory, MaxUint256);
        // await approveTx.wait();

        // if (resolverBalance < amount) {
        //     throw new Error(`Insufficient token balance! (${resolverBalance} < ${amount}`)
        // }

        // let approveTo = EVM_CONFIG.escrowFactory;
        // let allowance = await tokenContract.allowance(EVM_CONFIG.resolverOwner, approveTo);

        // if (allowance < amount) {
        //     console.log('🔓 Approving token')
        //     const approveTx = await tokenContract.approve(approveTo, MaxUint256);
        //     const receipt = await approveTx.wait();
        //     console.log('✅ token Approved')
        // }
        // allowance = await tokenContract.allowance(EVM_CONFIG.resolverOwner, approveTo)
        // console.log("Resolver allowance:", allowance.toString())
    }

  private async createCrossChainOrderSTRK(
    srcTokenAddress: string,
    dstTokenAddress: string,
    makingAmount: bigint,
    takingAmount: bigint,
    evmUserAddress: string
    ) {
        let salt = uint8ArrayToHex(randomBytes(8));
        let now = await stark.getBlockTimestamp(this.starknetProvider);
        let withdrawalTimeLock =  now+10;
        let publicWithdrawalTimeLock =  now+12;
        let cancellationTimeLock =  now+400;
        let publicCancellationTimeLock =  now+500;
        const order = {
            salt: salt,
            maker: STARKNET_CONFIG.user,
            receiver: evmUserAddress,
            maker_asset: srcTokenAddress,
            taker_asset: dstTokenAddress,
            making_amount: makingAmount,
            taking_amount: takingAmount,
            withdrawal_timelock: withdrawalTimeLock,
            public_withdrawal_timelock: publicWithdrawalTimeLock,
            cancellation_timelock: cancellationTimeLock,
            public_cancellation_timelock: publicCancellationTimeLock,
        }

        const orderArray = [
            salt,
            STARKNET_CONFIG.user,   //maker
            evmUserAddress, //receiver
            srcTokenAddress, 
            dstTokenAddress,
            makingAmount,
            takingAmount,
            withdrawalTimeLock,
            publicWithdrawalTimeLock,
            cancellationTimeLock,
            publicCancellationTimeLock
        ]
        return { order, orderArray }
    }


 async swapCrossChain(
    srcTokenAddress: string,   // STRK token
    dstTokenAddress: string,   // EVM token
    makingAmount: bigint,
    takingAmount: bigint,
    evmUserAddress: string
  ) {
    console.log('🚀 Swapping Tokens from STRK -> EVM [cross-chain] ')
    console.log(`Amounts: ${makingAmount} -> ${takingAmount}`)

    // 1.  Check + Approve src tokens
    console.log("\nSTRK: Check + Approve SRC tokens")
    await this.checkBalAllowanceAndApproveSTRK(srcTokenAddress, makingAmount)

    // 2. Generate secret
    // const secret = uint8ArrayToHex(randomBytes(32))
    // Generate 32 random bytes
    const raw = randomBytes(32);

    // Convert to BigInt and mask to 252 bits
    
    // Use hex string when SDK expects string
    const secretHex = "0x" + Buffer.from(raw).toString("hex"); // 66 chars, always valid
    const secret = BigInt(secretHex) & ((1n << 252n) - 1n);

    const hashlockSTRK = BigInt(hash.computePoseidonHashOnElements([secret]))
    console.log('Secret + Hashlock generated')

    // 3. Create Order
    console.log("\nSTRK: Creating HTLC CrossChainOrder ");

    
    const { order, orderArray } = await this.createCrossChainOrderSTRK(
        srcTokenAddress,
        dstTokenAddress,
        makingAmount,
        takingAmount,
        evmUserAddress
    )
    const orderHashStrk = hash.computeHashOnElements(orderArray)
    console.log('📋 Order Created:', {
        orderHash: orderHashStrk,
        makingAmount: makingAmount.toString(),
        takingAmount: takingAmount.toString(),
        srcToken: srcTokenAddress,
        dstToken: dstTokenAddress,
        srcChain: 'STRK',
        dstChain: 'EVM'
    })


    // 4. Sign order
    console.log("\[STRK]: Sign Order and Propagate to all Relayers")
    const signature = ec.starkCurve.sign(orderHashStrk, STARKNET_CONFIG.userPk);
    console.log('📝 Signature:', signature)

    // // Wait 5s for resolvers to acceprt the order
    // await new Promise(resolve => setTimeout(resolve, 5000))

    console.log('\n< A Relayer has accepted your Order > \n');


    // 5. STRK user Funds locked in EscrowSrc
    console.log(`\n[STRK] Resolver init EscrowSrc Order`)
    const escrowSrc = new Contract(escrowSrcAbi.abi, STARKNET_CONFIG.escrowSrc, this.starknetProvider);
    escrowSrc.connect(this.strkResolver);     
    const starknetSwapId = BigInt(orderHashStrk);
    let now = await stark.getBlockTimestamp(this.starknetProvider);
    let srcSwapOrder: OrderStrk = {
        swap_id: starknetSwapId,
        maker: STARKNET_CONFIG.resolver,
        taker: STARKNET_CONFIG.resolver,
        token: srcTokenAddress,
        amount: makingAmount,
        hashlock: hashlockSTRK,
        withdrawalTimeLock: now+10,
        publicWithdrawalTimeLock: now+12,
        cancellationTimeLock: now+400,
        publicCancellationTimeLock: now+500
    }
    let srcLockTxHash = await stark.lock(
        this.starknetProvider,
        srcSwapOrder,
        'src',
        escrowSrc,
        this.strkResolver
    );
    console.log(`[STRK]: Order ${starknetSwapId} filled for ${makingAmount} in tx ${srcLockTxHash}\n`)
            

    // -------EVM CHAIN-------------
    
    await this.checkBalAllowanceAndApproveEVM(dstTokenAddress, evmUserAddress, takingAmount) 

    // build SDK Immutables instance
    const orderHash32 = '0x' + orderHashStrk.replace(/^0x/, '').padStart(64, '0');
    let deployedAt = BigInt((await this.evmProvider.getBlock('latest'))!.timestamp);

    const sdkImmutables = Sdk.Immutables.new({
        orderHash: orderHash32,                  // bytes32 hex
        hashLock: Sdk.HashLock.forSingleFill(secretHex), // HashLock
        maker: new Sdk.Address(evmUserAddress),   // SDK Address wrapper
        taker: new Sdk.Address(EVM_CONFIG.resolver), 
        token: new Sdk.Address(dstTokenAddress), 
        amount: takingAmount,
        safetyDeposit: BigInt(0),
        timeLocks: Sdk.TimeLocks.new({
            srcWithdrawal: 5n,
            srcPublicWithdrawal: 440n,
            srcCancellation: 642n,
            srcPublicCancellation: 644n,
            dstWithdrawal: 5n,
            dstPublicWithdrawal: 400n,
            dstCancellation: 402n,
        })
    });


    // 6. Deploy EscrowDst in EVM
    const resolverDst = new Resolver(EVM_CONFIG.resolver, EVM_CONFIG.resolver);
    const { txHash: txHash, blockTimestamp: deployBlockTimestamp } = await this.evmResolverOwner.send(
        resolverDst.deployDst(sdkImmutables.withDeployedAt(deployedAt))
    )
    console.log("✅ EscrowDst deployed in tx:", txHash);
    console.log(`[EVM]`, `Created dst deposit for order ${orderHash32} in tx ${txHash}`)

    // 7. Get src escrow address from event Logs
    console.log(`\n< . . . Querying srcEscrow address from Deployment logs . . . >`);

    const receipt = (await this.evmProvider.waitForTransaction(txHash))!;
    if (receipt.status === 0) {
        throw new Error(`Tx ${txHash} failed`);
    }
    const iface = new ethers.Interface(escrowFactoryAbi.abi);
    let dstEscrowAddress = '0x'
    for (const log of receipt.logs) {
        if (log.address.toLowerCase() === EVM_CONFIG.escrowFactory.toLowerCase()) {
            try {
                const parsed = iface.parseLog(log);
                console.log(parsed?.name)
                if (parsed?.name === "DstEscrowCreated") {
                    console.log("✅ Escrow created:", parsed.args.escrow);
                    // console.log("   Hashlock:", parsed.args.hashlock);
                    // console.log("   Taker:", parsed.args.taker);
                    dstEscrowAddress = parsed.args.escrow;
                    break;
                }
            } catch (err) {
                // not all logs will match, just skip
            }
        }
    }
    
    if (dstEscrowAddress) {
        console.log("dstEscrowAddress:", dstEscrowAddress);
    } else {
        console.warn("⚠️ No DstEscrowCreated event found in this receipt");
        return;
    }
    console.log(`\n< secret-preimage shared with resolver on Dst Order filling >`);

    // 9. EVM Resolver Withdraws Funds for Strk_User from EscrowDST
    // const block = await this.evmProvider.getBlock("latest");
    // console.log("Now:", block?.timestamp);
    // console.log("DeployedAt:", deployBlockTimestamp.toString());

    await new Promise(resolve => setTimeout(resolve, 7000))

    console.log(`\n[EVM] : `, `Withdraw & Claim Funds for STRK_User in EVM.EscrowDst`);
    if (dstEscrowAddress){
        // let deployedAt = BigInt((await this.evmProvider.getBlock('latest'))!.timestamp)
        // console.log("DeployedAt:", deployedAt.toString());
        const { txHash: dstWithdrawTxHash } = await this.evmResolverOwner.send(
            resolverDst.withdraw(
                'dst',
                new Sdk.Address(dstEscrowAddress), 
                secretHex, 
                sdkImmutables.withDeployedAt(deployBlockTimestamp)
            )
        )
        console.log(`Tx: ${dstWithdrawTxHash}`)
        console.log('✅ Amount Claimed from DST Escrow')
    }


    // 9. StrkResolver Withdraws Funds for EVM_User from EscrowDST
        console.log(`\n[STRK] : `, `Withdraw & Claim Funds for EVM_User in STRK.EscrowDst`);
        let dstWithdrawTxReceipt = await stark.claim(
            this.starknetProvider, escrowSrc, starknetSwapId, BigInt(secret), this.strkResolver
        );
        console.log(`Tx: ${dstWithdrawTxReceipt}`)
  }
}

// ----------------- MAIN -----------------
async function main() {
  try {
    const strkToEvm = new swapStarknetToEVM()
    const result = await strkToEvm.swapCrossChain(
      '0x02d7ef1afd9b4cd826d23b0e3d5949f60045846ebf84880378de777053d6ecc1', // STRK USDC
      '0x07222AA96c3e7dE26fE4EfD22d5FF00C3678041A', // EVM USDC
      1000n,
      990n,
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // EVM user address
    )
    console.log('🎉 STRK->EVM Swap done!')
    console.log(result)
  } catch (err) {
    console.error('❌ Swap failed:', err)
  }
}
main()
