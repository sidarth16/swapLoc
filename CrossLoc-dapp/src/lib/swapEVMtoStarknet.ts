import * as Sdk from '@1inch/cross-chain-sdk'
import {
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
} from 'ethers'
import { RpcProvider, Contract, Account, hash, Call } from 'starknet';
import { ethers } from 'ethers'

import { uint8ArrayToHex, UINT_40_MAX } from '@1inch/byte-utils'

import escrowAbi from "./abi/EscrowDst.contract_class.json" assert { type: "json" };
import erc20Abi from "./abi/ERC20.contract_class.json" assert { type: "json" };

// import { config } from "./config";
import { Wallet } from "./wallet";
import { Resolver } from "./resolver";
import { EscrowFactory } from "./escrow-factory";
import { stark, OrderStrk } from "./stark";


const { Address } = Sdk

const EVM_CONFIG = {
    chainId: 1,
    url: 'http://127.0.0.1:8545',
    limitOrderProtocol: '0x111111125421cA6dc452d289314280a0f8842A65', // 1inch LOP 
    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH 

    escrowFactory: '0xE38aF3FDa379401445FFD7b9cD57D0D33d03790E',
    resolver: '0xbd99b8e3c580bFa9376c42062CD86535911bE0a2',
    userPk : process.env.PRIVATE_KEY_EVM_USER,
    resolverPk:  process.env.PRIVATE_KEY_EVM_RESOLVER
}

const STARKNET_CONFIG = {
    chainId: 99999, 
    url: 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
    // escrowSrc : '0x012b00359d5d3f0c8da7b80ea54a3df753f7c0dc8c2019f01091f911af889032',
    escrowDst : '0x0426e605b044b5c3189e82af74698fcb5d746c5e0aabe5d1b5b1bcf59e4c7ab3',
    resolver : '0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453',
    resolverPk:  '0x06165f0032ab3b175d88f7f57ad86bef6a9e2ecacf3fe0fa7988a9384c6fe529'//process.env.PRIVATE_KEY_STRK_RESOLVER    
}


export class swapEVMtoStarknet {
    private evmProvider: JsonRpcProvider
    private starknetProvider: RpcProvider

    private userWallet: Wallet
    private resolverWallet: Wallet
    private starknetResolverAccount: Account

    constructor() {

        this.evmProvider = new JsonRpcProvider(EVM_CONFIG.url, EVM_CONFIG.chainId)
        this.starknetProvider = new RpcProvider({ nodeUrl: STARKNET_CONFIG.url});

        this.userWallet = new Wallet(EVM_CONFIG.userPk as string, this.evmProvider)
        this.resolverWallet = new Wallet(EVM_CONFIG.resolverPk as string, this.evmProvider)
        if (STARKNET_CONFIG.resolverPk){
            this.starknetResolverAccount = new Account(this.starknetProvider, STARKNET_CONFIG.resolver, STARKNET_CONFIG.resolverPk)
        }
    }


    async swapCrossChain(
        srcTokenAddress: string,      
        dstTokenAddress: string,      
        makingAmount: bigint,         
        takingAmount: bigint,         
        starknetUserAddress: string,  
    ) {
        console.log('🚀 Swapping Tokens from EVM -> STRK [cross-chain] ')
        console.log(`\t(swapAmounts: ${makingAmount} -> ${takingAmount})`)

        // 1.  Check + Approve src tokens
        console.log("\nEVM: Check + Approve SRC tokens to LimitOrderProtocol")
        await this.checkAndApproveTokens(srcTokenAddress, makingAmount)

        // 2. Generate Secret
        console.log("\n< . . . Generating Secret . . .>")
        // const secretRaw = uint8ArrayToHex(randomBytes(32));
        
        // Generate 32 random bytes
        const raw = randomBytes(32);

        // Convert to BigInt and mask to 252 bits
        
        // Use hex string when SDK expects string
        const secretHex = "0x" + Buffer.from(raw).toString("hex"); // 66 chars, always valid
        const secret = BigInt(secretHex) & ((1n << 252n) - 1n);

        // 2. Create Order
        console.log("\nEVM: Creating HTLC CrossChainOrder ")
        const order = await this.createCrossChainOrder(
            srcTokenAddress,
            dstTokenAddress,
            makingAmount,
            takingAmount,
            secretHex,
        )
        const orderHash = order.getOrderHash(EVM_CONFIG.chainId)
        // console.log('📝 Order created, hash::', orderHash)

        // 5. Sign order
        console.log("\nEVM: Sign Order and Propagate to all Relayers")
        const signature = await this.userWallet.signOrder(EVM_CONFIG.chainId, order)
        console.log('📝 Signature:', signature)




        console.log('\n< A Relayer has accepted your Order > \n');



        

        // 6. Resolver receives order and deploys src & dst escrows
        console.log('\nEVM: Resolver Deploys EscrowSrc ')
        const resolverSrc = new Resolver(EVM_CONFIG.resolver, EVM_CONFIG.resolver)
        const fillAmount = order.makingAmount
        const { txHash: orderFillHash, blockHash: srcDeployBlock } = await this.resolverWallet.send(
            resolverSrc.deploySrc(
                EVM_CONFIG.chainId,
                order,
                signature,
                Sdk.TakerTraits.default()
                    .setExtension(order.extension)
                    .setAmountMode(Sdk.AmountMode.maker)
                    .setAmountThreshold(order.takingAmount),
                fillAmount
            )
        )
        console.log("✅ EscrowSrc deployed in tx:", orderFillHash);
        console.log(`EVM: Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)


        // 7. Get src escrow address from event Logs
        console.log(`\n< . . . Querying srcEscrow address from Deployment logs . . . >`);
        const evmEscrowFactory = new EscrowFactory(this.evmProvider, EVM_CONFIG.escrowFactory)
        const srcEscrowEvent = await evmEscrowFactory.getSrcDeployEvent(srcDeployBlock)
        const evmEscrowImplementation = await evmEscrowFactory.getSourceImpl()
        const srcEscrowAddress = new Sdk.EscrowFactory(
            new Address(EVM_CONFIG.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                evmEscrowImplementation
        )
        console.log("srcEscrowAddress : ", srcEscrowAddress)

        // -------STRK CHAIN-------------
        
        // init EscrowDST in STRK Chain
        const escrowDst = new Contract(escrowAbi.abi, STARKNET_CONFIG.escrowDst, this.starknetProvider);
        // await increaseTime()

        await this.checkBalAllowanceAndApproveSTRK(dstTokenAddress, takingAmount);

        // 8. StrkResolver Deposit & Lock StrkUser token in EscrowDst  
        console.log(`\n\n[STRK] : `, `init STRK.EscrowDst and Deposit Funds `);
        escrowDst.connect(this.starknetResolverAccount);      

        const secretSTRK = BigInt(hash.computePoseidonHashOnElements([secret]));
        const starknetSwapId = BigInt(hash.computePoseidonHashOnElements([orderHash]));
        let now = await stark.getBlockTimestamp(this.starknetProvider);
        let dstSwapOrder: OrderStrk = {
            swap_id: starknetSwapId,
            maker: starknetUserAddress,
            taker: STARKNET_CONFIG.resolver,
            token: dstTokenAddress,
            amount: takingAmount,
            hashlock: secretSTRK,  // poseidon hash
            withdrawalTimeLock: now+10,
            publicWithdrawalTimeLock: now+12,
            cancellationTimeLock: now+400,
            publicCancellationTimeLock: 0

        }
        let dstLockTxHash = await stark.lock(
            this.starknetProvider,
            dstSwapOrder, 
            'dst',
            escrowDst,
            this.starknetResolverAccount
        );
        console.log(`[STRK]: Order ${starknetSwapId} filled for ${takingAmount} in tx ${dstLockTxHash}`)
        
        console.log(`\n< secret-preimage shared with resolver on Dst Order filling >`);

        // 9. StrkResolver Withdraws Funds for EVM_User from EscrowDST
        console.log(`\n[STRK] : `, `Withdraw & Claim Funds for EVM_User in STRK.EscrowDst`);
        let dstWithdrawTxReceipt = await stark.claim(
            this.starknetProvider, escrowDst, starknetSwapId, BigInt(secret), this.starknetResolverAccount
        );
        console.log(`Tx: ${dstWithdrawTxReceipt}`)

        // // 10. Get Secret from Claim Logs in DST
        // let preimage;
        // if (dstWithdrawTxReceipt.isSuccess()) {
        //     const CLAIMED_SELECTOR = '0x35cc0235f835cc84da50813dc84eb10a75e24a21d74d6d86278c0f037cb7429';

        //     const events = dstWithdrawTxReceipt.value.events;
        //     const ClaimedEvent = events.find(event =>
        //         event.keys && event.keys.includes(CLAIMED_SELECTOR)
        //     );
        //     if (ClaimedEvent) {
        //         preimage = ClaimedEvent.data[2];
        //     }
        // }
        // console.log(`< secret-preimage received from logs=> Preimage: ${preimage.toString()}`);

        
        // 10. Use Secret to claim EVM Token for STRK_User from EscrowSRC
        console.log(`\n[EVM] : `, `Withdraw & Claim Funds for STRK_User in EVM.EscrowSrc`);
        const { txHash: srcWithdrawTxHash } = await this.resolverWallet.send(
            resolverSrc.withdraw('src', srcEscrowAddress, secretHex, srcEscrowEvent[0])
        )
        console.log(`Tx: ${srcWithdrawTxHash}`)

        return {
            orderHash: order.getOrderHash(EVM_CONFIG.chainId),
            secret,
            order
        }
    }

    
    private async createCrossChainOrder(
        srcTokenAddress: string,
        dstTokenAddress: string,
        makingAmount: bigint,
        takingAmount: bigint,
        secret: string,
        // starknetUserAddress: string,
        // starknetResolverAddress: string
    ) {
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))

        const order = Sdk.CrossChainOrder.new(
            new Address(EVM_CONFIG.escrowFactory),
            {
                salt: Sdk.randBigInt(1000n),
                maker: new Address(await this.userWallet.getAddress()),
                makingAmount,
                takingAmount,
                makerAsset: new Address(srcTokenAddress),
                takerAsset: new Address('0x0000000000000000000000000000000000000000')
            },
            {
                hashLock: Sdk.HashLock.forSingleFill(secret.toString()),
                timeLocks: Sdk.TimeLocks.new({
                    srcWithdrawal: 10n, 
                    srcPublicWithdrawal: 120n, 
                    srcCancellation: 121n, 
                    srcPublicCancellation: 122n, 
                    dstWithdrawal: 10n, 
                    dstPublicWithdrawal: 100n, 
                    dstCancellation: 101n 
                }),
                srcChainId: EVM_CONFIG.chainId,
                dstChainId: 137,
                srcSafetyDeposit: parseEther('0'), 
                dstSafetyDeposit: parseEther('0')
            },
            {
                auction: new Sdk.AuctionDetails({
                    initialRateBump: 0,
                    points: [],
                    duration: 3600n, // 1小时
                    startTime: currentTimestamp
                }),
                whitelist: [
                    {
                        address: new Address(EVM_CONFIG.resolver),
                        allowFrom: 0n
                    }
                ],
                resolvingStartTime: 0n
            },
            {
                nonce: Sdk.randBigInt(UINT_40_MAX),
                allowPartialFills: false,
                allowMultipleFills: false
            }
        ) as any


        console.log('📋 Order Created:', {
            orderHash: order.getOrderHash(EVM_CONFIG.chainId),
            makingAmount: makingAmount.toString(),
            takingAmount: takingAmount.toString(),
            srcToken: srcTokenAddress,
            dstToken: dstTokenAddress,
            srcChain: 'EVM',
            dstChain: 'Starknet'
        })
        return order
    }

    private async checkBalAllowanceAndApproveSTRK(erc20Address:string, amount:bigint){
        const erc20 = new Contract(erc20Abi.abi, erc20Address, this.starknetProvider);

        // Check balance
        const userBalance = await erc20.balance_of(STARKNET_CONFIG.resolver);
        console.log(`\nMaker token balance : ${userBalance}`)
        if (amount>userBalance){
            throw new Error(`ERR: Insufficient token Balance (${userBalance} < amount: ${amount})` )
        }

        const allowance = await erc20.allowance(STARKNET_CONFIG.resolver, STARKNET_CONFIG.escrowDst);
        console.log(`\nMaker token allowance to escrowDST : ${allowance}`)
        if (allowance < amount){
            const approveCall: Call = erc20.populate("approve", {
                spender: STARKNET_CONFIG.escrowDst,
                amount: amount,
            });
            const { transaction_hash } = await this.starknetResolverAccount.execute(approveCall);
            await this.starknetProvider.waitForTransaction(transaction_hash);
            console.log("Allowance updated")
        }
        const upd_allowance = await erc20.allowance(STARKNET_CONFIG.resolver, STARKNET_CONFIG.escrowDst);
        console.log(`\nMaker token allowance to escrowDST : ${upd_allowance}`)
    }


    private async checkAndApproveTokens(tokenAddress: string, amount: bigint) {
        const tokenContract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'],
            this.userWallet.signer
        )

        const userAddress = await this.userWallet.getAddress()
        // console.log("Checking balance of \n\tuser: ",userAddress)
        // console.log("\ttoken: ",tokenAddress)
        const userBalance = await tokenContract.balanceOf(userAddress)
        console.log(`💰 Current token balance: ${userBalance}`)

        if (userBalance < amount) {
            throw new Error(`Insufficient token balance! (${userBalance} < ${amount}`)
        }

        const allowance = await tokenContract.allowance(userAddress, EVM_CONFIG.limitOrderProtocol)

        if (allowance < amount) {
            console.log('🔓 Approving token for 1inch limit order protocol...')
            const approveTx = await tokenContract.approve(EVM_CONFIG.limitOrderProtocol, MaxUint256)
            await approveTx.wait()
            console.log('✅ token Approved')
        }
    }

}

// ----------------- MAIN -----------------
async function main() {
    try {

        const evmToStrk = new swapEVMtoStarknet()
        const result = await evmToStrk.swapCrossChain(
            '0x07222AA96c3e7dE26fE4EfD22d5FF00C3678041A', // Mock-USDC
            '0x02d7ef1afd9b4cd826d23b0e3d5949f60045846ebf84880378de777053d6ecc1', // Starknet strk USDC
            100000n, //makingAmt
            100n, //takingAmt
            '0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453', // Starknet user address
        )

        console.log('🎉 EVM->STRK Swap done!')
        console.log('Order hash:', result.orderHash)
        console.log('Secret:', result.secret)

    } catch (error) {
        console.error('❌ Swap failed:', error)
    }
}
main()