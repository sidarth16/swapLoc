import * as Sdk from '@1inch/cross-chain-sdk'
import {
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
} from 'ethers'
import { RpcProvider, Contract, Account, hash, Call, getChecksumAddress,  } from 'starknet';
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
    chainId: 137,
    url: 'https://polygon-mainnet.g.alchemy.com/v2/lBsaazUwt5MNRu3XvrdH9p_Fm-PrzuiC',
    limitOrderProtocol: '0x111111125421cA6dc452d289314280a0f8842A65', // 1inch LOP 
    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH 

    escrowFactory: '0x70136F3fc91752c3E4706aC8dca62BB6141b5c5B',
    resolver: '0xe4d7a77D0a71459D57438DdCD4C45fd218212C30',
    userPk : process.env.PRIVATE_KEY_EVM_USER,
    resolverPk: process.env.PRIVATE_KEY_EVM_RESOLVER,
    mockusdc : '0x783C9038A1d2BD3CB8017EdDc29F1A1904eEc584'
}

const STARKNET_CONFIG = {
    chainId: 99999, 
    url: 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
    escrowSrc : '0x026f701df9efe70496f4705b2639f36c0496a0d22da8f2a43b7bce0d05432918',
    escrowDst : '0x02589349eda3cfc79782ee9e8b48ce01cce57593cf4d4df1696094661301bfd7',
    resolver : '0x03e1d041ce0a90e16b00b47513d2fc9d63972e642439bfeb237a661d7f26ca77',
    resolverPk:  process.env.PRIVATE_KEY_STRK_RESOLVER    
}


let metaMaskProvider: any = null

// Listen for wallets announcing themselves
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event: any) => {
    const provider = event.detail.provider
    if (provider?.isMetaMask) {
      metaMaskProvider = provider
    //   console.log("✅ MetaMask provider discovered via EIP-6963")
    }
  })

  // Ask wallets to announce themselves
  window.dispatchEvent(new Event("eip6963:requestProvider"))
}

export async function connectMetaMask() {
  if (!metaMaskProvider) {
    throw new Error("❌ MetaMask provider not found. Is MetaMask installed?")
  }

  // Trigger popup if not already connected
  await metaMaskProvider.request({ method: "eth_requestAccounts" })

  const provider = new ethers.BrowserProvider(metaMaskProvider)
  const signer = await provider.getSigner()

//   console.log("✅ Connected MetaMask account:", await signer.getAddress())
  return signer
}

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



export class swapEVMtoStarknet {
    private evmProvider: JsonRpcProvider
    private starknetProvider: RpcProvider

    // private userWallet: Wallet
    private userSigner: ethers.Signer | null = null;
    private resolverWallet: Wallet
    private starknetResolverAccount: Account

    constructor() {

        this.evmProvider = new JsonRpcProvider(EVM_CONFIG.url, EVM_CONFIG.chainId)
        this.starknetProvider = new RpcProvider({ nodeUrl: STARKNET_CONFIG.url});

        // // this.userWallet = new Wallet(EVM_CONFIG.userPk as string, this.evmProvider)
        this.resolverWallet = new Wallet(EVM_CONFIG.resolverPk as string, this.evmProvider)
        if (STARKNET_CONFIG.resolverPk){
            this.starknetResolverAccount = new Account(this.starknetProvider, STARKNET_CONFIG.resolver, STARKNET_CONFIG.resolverPk)
        }
    }

    async initUserWallet() {
        this.userSigner = await connectMetaMask();
        console.log("✅ Connected User:", await this.userSigner.getAddress());
        return await this.userSigner.getAddress();
    }

    async swapCrossChain(
        srcTokenAddress: string,      
        dstTokenAddress: string,      
        makingAmount: bigint,         
        takingAmount: bigint,  
        evmUserAddress: string,         
        starknetUserAddress: string,  
    ) {
        console.log('⚡️ Swapping Tokens from EVM -> STRK [cross-chain] ')
        console.log(`\t(swapAmounts: ${makingAmount} -> ${takingAmount})`)

        // 1.  Check + Approve src tokens
        console.log("\n[EVM]: Check + Approve SRC tokens to LimitOrderProtocol")
        await this.checkApproveTokens(srcTokenAddress, makingAmount)

        // 2. Generate Secret
        console.log("\n< . . . Generating Secret . . .>")
        // const secretRaw = uint8ArrayToHex(randomBytes(32));
        const raw31 = randomBytes(31); // Generate 31 random bytes
        // Felt-safe integer
        const secretFelt = BigInt("0x" + Buffer.from(raw31).toString("hex"));
        // EVM version (right-pad with 0x00 → makes it 32 bytes total)
        const secretBytes32 = "0x" + Buffer.concat([raw31, Buffer.from([0x00])]).toString("hex");

        // 2. Create Order
        console.log("\nEVM: Creating HTLC CrossChainOrder ")
        const order = await this.createCrossChainOrder(
            srcTokenAddress,
            dstTokenAddress,
            makingAmount,
            takingAmount,
            secretBytes32,
            starknetUserAddress
        )
        const orderHash = order.getOrderHash(EVM_CONFIG.chainId)
        // console.log('📝 Order created, hash::', orderHash)

        // 5. Sign order
        console.log("\n[EVM]: Sign Order and Propagate to all Relayers")
        // const signature = await this.userWallet.signOrder(EVM_CONFIG.chainId, order);

        
        if (!this.userSigner) throw new Error('userSigner not initialized — call initUserWallet()');
        
        const typedData = order.getTypedData(EVM_CONFIG.chainId)
        const signerTypes = { [typedData.primaryType]: typedData.types[typedData.primaryType] ?? typedData.types[typedData.primaryType] };
        // console.log('Signer constructor name:', (this.userSigner as any).constructor?.name);

        const signature = await (this.userSigner as ethers.JsonRpcSigner).signTypedData(
            typedData.domain,
            signerTypes,
            typedData.message
        );
        

        // // get EIP-712 typed data from SDK
        // const { domain, types, value } = order.buildTypedData(EVM_CONFIG.chainId);

        // // MetaMask signTypedData
        // // (ethers v6 automatically maps to eth_signTypedData_v4)
        // const signature = await (this.userSigner as ethers.JsonRpcSigner).signTypedData(domain, types, value);

        console.log('📝 Signature:', signature)




        console.log('\n< A Relayer has accepted your Order > \n');



        

        // 6. Resolver receives order and deploys src & dst escrows
        console.log('\n[EVM]: Resolver Deploys EscrowSrc ')
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
        console.log("✅ EscrowSrc deployed in tx:", txLink(orderFillHash, 'polygon'));
        console.log(`\n[EVM]: Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)


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

        const secretSTRK = BigInt(hash.computePoseidonHashOnElements([secretFelt]));
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
        if (dstLockTxHash){
        console.log(`${txLink(dstLockTxHash, 'starknet-sepolia')}`)
        }

        console.log(`\n< secret-preimage shared with resolver on Dst Order filling >`);
        console.log(`${secretBytes32}`);


        // 9. StrkResolver Withdraws Funds for EVM_User from EscrowDST
        console.log(`\n[STRK] : `, `Withdraw & Claim Funds for EVM_User in STRK.EscrowDst`);
        let dstWithdrawTxReceipt = await stark.claim(
            this.starknetProvider, escrowDst, starknetSwapId, BigInt(secretFelt), this.starknetResolverAccount
        );
        console.log(`Tx: ${txLink(dstWithdrawTxReceipt, 'starknet-sepolia')}`)

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
            resolverSrc.withdraw('src', srcEscrowAddress, secretBytes32, srcEscrowEvent[0])
        )
        console.log(`Tx: ${txLink(srcWithdrawTxHash,'polygon')}`)

        console.log('\n EVM->STRK Swap Completed !')
        // return {
        //     orderHash: order.getOrderHash(EVM_CONFIG.chainId),
        //     secretBytes32,
        //     order
        // }
    }

    
    
    private async createCrossChainOrder(
        srcTokenAddress: string,
        dstTokenAddress: string,
        makingAmount: bigint,
        takingAmount: bigint,
        secret: string,
        starknetUserAddress: string,
        // starknetResolverAddress: string
    ) {
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000))
        if (!this.userSigner) return;
        const order = Sdk.CrossChainOrder.new(
            new Address(EVM_CONFIG.escrowFactory),
            {
                salt: Sdk.randBigInt(1000n),
                maker: new Address(await this.userSigner.getAddress()),
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
                dstChainId: 56,
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


        // console.log('📋 Order Created:', {
        //     orderHash: order.getOrderHash(EVM_CONFIG.chainId),
        //     makingAmount: makingAmount.toString(),
        //     takingAmount: takingAmount.toString(),
        //     srcToken: srcTokenAddress,
        //     dstToken: dstTokenAddress,
        //     srcChain: 'EVM',
        //     dstChain: 'Starknet'
        // })
        console.log('📋 Order Created:');
        console.log(`    orderHash: ${order.getOrderHash(EVM_CONFIG.chainId)}`);
        console.log(`    makingAmount: ${makingAmount.toString()}`);
        console.log(`    takingAmount: ${takingAmount.toString()}`);
        console.log(`    srcToken: ${srcTokenAddress}`);
        console.log(`    dstToken: ${dstTokenAddress}`);
        console.log(`    srcChain: EVM`);
        console.log(`    dstChain: Starknet`);

        return order
    }

    private async checkBalAllowanceAndApproveSTRK(erc20Address:string, amount:bigint){
        console.log(`\n[STRK]: Maker giving allowance to Resolver`)
        const erc20 = new Contract(erc20Abi.abi, erc20Address, this.starknetProvider);

        // Check balance
        const userBalance = await erc20.balance_of(STARKNET_CONFIG.resolver);
        // console.log(`\nMaker token balance : ${userBalance}`)
        if (amount>userBalance){
            // throw new Error(`ERR: Insufficient token Balance (${userBalance} < amount: ${amount})` )
            console.log("ERR: Insufficient token Balance (${userBalance} < amount: ${amount})")
            // console.log("Minting token to user")

            const mintCall: Call = erc20.populate(
                'mint', 
                {
                    to: STARKNET_CONFIG.resolver,
                    amount: 1000n * 10n ** 18n,
                }
            );
            const { transaction_hash: mintTxHash } = await this.starknetResolverAccount.execute(mintCall);
            // Wait for the invoke transaction to be accepted on Starknet
            // console.log(`TxHash : ${mintTxHash}`);
        }

        const allowance = await erc20.allowance(STARKNET_CONFIG.resolver, STARKNET_CONFIG.escrowDst);
        // console.log(`Maker token allowance to escrowDST : ${allowance}`)
        if (allowance < amount){
            const approveCall: Call = erc20.populate("approve", {
                spender: STARKNET_CONFIG.escrowDst,
                amount: amount,
            });
            const { transaction_hash } = await this.starknetResolverAccount.execute(approveCall);
            await this.starknetProvider.waitForTransaction(transaction_hash);
            console.log("Allowance Increased")
        }
        const upd_allowance = await erc20.allowance(STARKNET_CONFIG.resolver, STARKNET_CONFIG.escrowDst);
        console.log(`\nMaker token allowance to escrowDST : ${upd_allowance}`)
    }


    private async checkApproveTokens(tokenAddress: string, amount: bigint) {
        if (!this.userSigner) throw new Error("User signer not initialized (call initUserWallet first)");

        const tokenContract = new ethers.Contract(
            tokenAddress,
            [
            "function balanceOf(address) view returns (uint256)",
            "function approve(address,uint256) returns (bool)",
            "function allowance(address,address) view returns (uint256)"
            ],
            this.userSigner // now MetaMask signer
        );

        const userAddress = await this.userSigner.getAddress();
        // console.log(`User: ${userAddress}`);
        // console.log(`Token: ${tokenAddress}`);
        const code = await this.userSigner.provider!.getCode(tokenAddress);

        const userBalance = await tokenContract.balanceOf(userAddress);
        // console.log(`Current token balance: ${userBalance}`);

        // if (userBalance < amount) {
        //     throw new Error(`Insufficient token balance! (${userBalance} < ${amount})`);
        // }

        const allowance = await tokenContract.allowance(userAddress, EVM_CONFIG.limitOrderProtocol);
        // if (allowance < amount) {
            console.log("Approving tokens for LOP");
            const approveTx = await tokenContract.approve(EVM_CONFIG.limitOrderProtocol, MaxUint256);
            await approveTx.wait();
            console.log("✅ Tokens approved");
        // }
    }

}

// // ----------------- MAIN -----------------
// async function main() {
//     try {

//         const evmToStrk = new swapEVMtoStarknet()
//         const result = await evmToStrk.swapCrossChain(
//             '0x4cCa442799909DA8f90db889c139bcc2B4d7aC40', // Mock-USDC
//             '0x02d7ef1afd9b4cd826d23b0e3d5949f60045846ebf84880378de777053d6ecc1', // Starknet strk USDC
//             100000n, //makingAmt
//             100n, //takingAmt
//             '0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453', // Starknet user address
//         )

//         console.log('🎉 EVM->STRK Swap done!')
//         console.log('Order hash:', result.orderHash)
//         console.log('Secret:', result.secret)

//     } catch (error) {
//         console.error('❌ Swap failed:', error)
//     }
// }
// main()


