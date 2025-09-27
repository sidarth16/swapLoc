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
  chainId: 137,
    url: 'https://polygon-mainnet.g.alchemy.com/v2/lBsaazUwt5MNRu3XvrdH9p_Fm-PrzuiC',
    limitOrderProtocol: '0x111111125421cA6dc452d289314280a0f8842A65', // 1inch LOP 
    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH 

    escrowFactory: '0x70136F3fc91752c3E4706aC8dca62BB6141b5c5B',
    resolver: '0xe4d7a77D0a71459D57438DdCD4C45fd218212C30',
    userPk : process.env.PRIVATE_KEY_EVM_USER,
    resolverPk:  process.env.PRIVATE_KEY_EVM_RESOLVER,
    resolverOwner: '0x3cE4A3aa9F09926E70e8F38E2Ac8948EdDC8d96e'
//   userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
}

const STARKNET_CONFIG = {
    chainId: 99999, 
    url: 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
    escrowSrc : '0x026f701df9efe70496f4705b2639f36c0496a0d22da8f2a43b7bce0d05432918',
    escrowDst : '0x02589349eda3cfc79782ee9e8b48ce01cce57593cf4d4df1696094661301bfd7',
    user : '0x03e1d041ce0a90e16b00b47513d2fc9d63972e642439bfeb237a661d7f26ca77',
    userPk:  '0x07f81386ae652cb222b51bc1ba251e30668aa1d13a714745ebeeebd3ef1eec5c',//process.env.PRIVATE_KEY_STRK_RESOLVER    
    resolver : '0x03e1d041ce0a90e16b00b47513d2fc9d63972e642439bfeb237a661d7f26ca77',
    resolverPk:  '0x07f81386ae652cb222b51bc1ba251e30668aa1d13a714745ebeeebd3ef1eec5c'//process.env.PRIVATE_KEY_STRK_RESOLVER    
}

// import { getInjectedStarknetProvider, connectStarknetWallet } from "@/lib/starknetWallet";

// async function handleConnectBraavos() {
//   try {
//     const p = getInjectedStarknetProvider();
//     console.log("Injected provider:", p?.isBraavos, p?.isArgentX, p);
//     const { provider, address } = await connectStarknetWallet(p);
//     console.log("Connected Starknet account:", address);
//     // store provider + address in your UI state and pass to your swap class
//   } catch (err) {
//     console.error("Failed connect Braavos:", err);
//   }
// }
function txLink(
  txHash: string,
  chain:
    | "polygon"
    | "starknet-sepolia"
): string {
  switch (chain) {
  
    case "polygon":
      return `https://polygonscan.com/tx/${txHash}`;
    case "starknet-sepolia":
      return `https://sepolia.starkscan.co/tx/${txHash}`;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
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
    // console.log(`\nMaker token balance : ${userBalance}`)
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
        console.log('\n[EVM]: Taker approve tokens to resolver')
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

        // console.log('tokenAddress : ', tokenAddress)
        // console.log('evmUserAddress : ', evmUserAddress)


        // const userAddress = 
        // // console.log("Checking balance of \n\tuser: ",userAddress)
        // // console.log("\ttoken: ",tokenAddress)
        const userBalance = await tokenContract.balanceOf(evmUserAddress)
        // console.log(`User token balance: ${userBalance}`)

        if (userBalance < amount) {
            throw new Error(`Insufficient token balance! (${userBalance} < ${amount}`)
        }

        let tx = await tokenContract.approve(EVM_CONFIG.resolverOwner, amount);
        await tx.wait()
        console.log('Token Approved to resolver');
        
        tokenContract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)','function transfer(address,uint256) returns (bool)','function transferFrom(address,address,uint256) returns (bool)'],
            this.evmResolverOwner.signer
        )
        // console.log(`resolver token balance: ${await tokenContract.balanceOf(EVM_CONFIG.resolver)}`)

        tx = await tokenContract.transferFrom(evmUserAddress, EVM_CONFIG.resolver, amount);
        await tx.wait()
        // tx = await tokenContract.transfer(EVM_CONFIG.escrowFactory, amount);
        // await tx.wait()

        // console.log(`resolverOwner token balance: ${await tokenContract.balanceOf(EVM_CONFIG.resolverOwner)}`)
        // console.log(`resolverOwner Feetoken balance: ${await feeTokenContract.balanceOf(EVM_CONFIG.resolverOwner)}`)

        // console.log(`resolver token balance: ${await tokenContract.balanceOf(EVM_CONFIG.resolver)}`)
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
    evmUserAddress: string,
    strkUserAddress: string,

  ) {
    console.log('⚡️ Swapping Tokens from STRK -> EVM [cross-chain] ')
    console.log(`swapAmounts: ${makingAmount} -> ${takingAmount}`)

    // 1.  Check + Approve src tokens
    console.log("\n[STRK]: Check + Approve SRC tokens")
    await this.checkBalAllowanceAndApproveSTRK(srcTokenAddress, makingAmount)

    // 2. Generate secret
     console.log("\n< . . . Generating Secret . . .>")
    // const secretRaw = uint8ArrayToHex(randomBytes(32));
    const raw31 = randomBytes(31); // Generate 31 random bytes
    // Felt-safe integer
    const secretFelt = BigInt("0x" + Buffer.from(raw31).toString("hex"));
    // EVM version (right-pad with 0x00 → makes it 32 bytes total)
    const secretBytes32 = "0x" + Buffer.concat([raw31, Buffer.from([0x00])]).toString("hex");


    const hashlockSTRK = BigInt(hash.computePoseidonHashOnElements([secretFelt]))
    console.log('Secret + Hashlock generated')

    // 3. Create Order
    console.log("\n[STRK]: Creating HTLC CrossChainOrder ");

    
    const { order, orderArray } = await this.createCrossChainOrderSTRK(
        srcTokenAddress,
        dstTokenAddress,
        makingAmount,
        takingAmount,
        evmUserAddress
    )
    const orderHashStrk = hash.computeHashOnElements(orderArray)
    
    console.log('📋 Order Created:');
    console.log(`    orderHash: ${orderHashStrk}`);
    console.log(`    makingAmount: ${makingAmount.toString()}`);
    console.log(`    takingAmount: ${takingAmount.toString()}`);
    console.log(`    srcToken: ${srcTokenAddress}`);
    console.log(`    dstToken: ${dstTokenAddress}`);
    console.log(`    srcChain: STRK`);
    console.log(`    dstChain: EVM`);


    // 4. Sign order
    console.log("\n[STRK]: Sign Order and Propagate to all Relayers")
    const signature = ec.starkCurve.sign(orderHashStrk, STARKNET_CONFIG.userPk);
    console.log('📝 Signature: (', signature.r, signature.s,')')

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
    if (srcLockTxHash){
        console.log(txLink(srcLockTxHash, 'starknet-sepolia'))
    }
            

    // -------EVM CHAIN-------------
    
    await this.checkBalAllowanceAndApproveEVM(dstTokenAddress, evmUserAddress, takingAmount) 

    // build SDK Immutables instance
    const orderHash32 = '0x' + orderHashStrk.replace(/^0x/, '').padStart(64, '0');
    let deployedAt = BigInt((await this.evmProvider.getBlock('latest'))!.timestamp);

    const sdkImmutables = Sdk.Immutables.new({
        orderHash: orderHash32,                  // bytes32 hex
        hashLock: Sdk.HashLock.forSingleFill(secretBytes32), // HashLock
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
    console.log("\n[EVM]: Resolver Deploy EscrowDst ");
    const resolverDst = new Resolver(EVM_CONFIG.resolver, EVM_CONFIG.resolver);
    const { txHash: txHash, blockTimestamp: deployBlockTimestamp } = await this.evmResolverOwner.send(
        resolverDst.deployDst(sdkImmutables.withDeployedAt(deployedAt))
    )
    console.log("✅ EscrowDst deployed in tx:", txLink(txHash,'polygon'));
    console.log(`\n[EVM]`, `Created dst deposit for order ${orderHash32} in tx ${txHash}`)

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
                    console.log("✅ EscrowDst :", parsed.args.escrow);
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
        // console.log("dstEscrowAddress:", dstEscrowAddress);
    } else {
        console.warn("⚠️ No DstEscrowCreated event found in this receipt");
        return;
    }
    console.log(`\n< secret-preimage shared with resolver on Dst Order filling >`);
    console.log(`${secretBytes32}`);
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
                secretBytes32, 
                sdkImmutables.withDeployedAt(deployBlockTimestamp)
            )
        )
        console.log(`Tx: ${txLink(dstWithdrawTxHash,"polygon")}`)
        console.log('✅ Amount Claimed from DST Escrow')
    }


    // 9. StrkResolver Withdraws Funds for EVM_User from EscrowDST
        console.log(`\n[STRK] : `, `Withdraw & Claim Funds for EVM_User in STRK.EscrowDst`);
        let dstWithdrawTxReceipt = await stark.claim(
            this.starknetProvider, escrowSrc, starknetSwapId, BigInt(secretFelt), this.strkResolver
        );
        console.log(`Tx: ${txLink(dstWithdrawTxReceipt,"starknet-sepolia")}`)


    console.log('\n STRK -> POLYGON Swap Completed !')
  }
}

// ----------------- MAIN -----------------
// async function main() {
//   try {
//     const strkToEvm = new swapStarknetToEVM()
//     const result = await strkToEvm.swapCrossChain(
//       '0x02d7ef1afd9b4cd826d23b0e3d5949f60045846ebf84880378de777053d6ecc1', // STRK USDC
//       '0x4cCa442799909DA8f90db889c139bcc2B4d7aC40', // EVM USDC
//       1000n,
//       990n,
//       '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // EVM user address
//     )
//     console.log('🎉 STRK->EVM Swap done!')
//     console.log(result)
//   } catch (err) {
//     console.error('❌ Swap failed:', err)
//   }
// }
// main()
