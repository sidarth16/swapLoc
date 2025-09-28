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
import escrowDstAbi from "./abi/EscrowDstOther.sol/EscrowDst.json";


// import { config } from "./config";
import { Wallet } from "./wallet";
import { Resolver } from "./resolver";
import { EscrowFactory } from "./escrow-factory";


const { Address } = Sdk

const EVM_CONFIG = {
    chainId: 137,
    url: 'https://polygon-mainnet.g.alchemy.com/v2/lBsaazUwt5MNRu3XvrdH9p_Fm-PrzuiC',
    limitOrderProtocol: '0x111111125421cA6dc452d289314280a0f8842A65', // 1inch LOP 
    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH 

    escrowFactory: '0xA32d5E236aF2B030263B18b8C6e1100f44511121',
    resolver: '0x8296D49fc713b9CD99052985bB094920c35b5B04',
    userPk : '60f64e28157c6e82187bddedf081719423a0f3c44f35d573c878bd85a4258689',//process.env.PRIVATE_KEY_EVM_USER,
    resolverPk:  '9c14990c71a00bdb1c34e9adb2119087a0236d7a87f7119cf4b557cc0561754b'//process.env.PRIVATE_KEY_EVM_RESOLVER
}


const HEDERA_CONFIG = {
  chainId: 296,
  url: "https://testnet.hashio.io/api",
  escrowSrc: '0x05c3682c757CBeAC6A282cB7F2Cdc645003A3EaD',
  escrowDst: '0xf3873574364DF9d509F304CEbf4F15791492d505',
  resolver: '0x0D2a7a7A808975dF6e1858772C1cC0A92177D5A9',
  resolverPk: '60f64e28157c6e82187bddedf081719423a0f3c44f35d573c878bd85a4258689',
  userPk : '60f64e28157c6e82187bddedf081719423a0f3c44f35d573c878bd85a4258689',//process.env.PRIVATE_KEY_EVM_USER,
  mockusdc : '0xEe58bf35b2937c6f2b9b41cAf1fD338C42d5D73C'
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
    | "kadena20"
): string {
  switch (chain) {
  
    case "polygon":
      return `https://polygonscan.com/tx/${txHash}`;
    case "kadena20":
      return `https://hashscan.io/testnet/transaction/${txHash}`;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}


export class swapEVMtoHEDERA {
    private evmProvider: JsonRpcProvider
    private kadenaProvider: JsonRpcProvider

    // private userWallet: Wallet
    private userSigner: ethers.Signer | null = null;
    private resolverWallet: Wallet
    private kadenaResolver: Wallet

    constructor() {

        this.evmProvider = new JsonRpcProvider(EVM_CONFIG.url, EVM_CONFIG.chainId)
        this.kadenaProvider = new JsonRpcProvider(HEDERA_CONFIG.url, HEDERA_CONFIG.chainId)

        // // this.userWallet = new Wallet(EVM_CONFIG.userPk as string, this.evmProvider)
        this.resolverWallet = new Wallet(EVM_CONFIG.resolverPk as string, this.evmProvider)
        this.kadenaResolver = new Wallet(HEDERA_CONFIG.resolverPk as string, this.kadenaProvider)
    }

    async initUserWallet() {
        this.userSigner = await connectMetaMask();
        console.log("✅ Connected MetaMask user:", await this.userSigner.getAddress());
        return await this.userSigner.getAddress();
    }

    async swapCrossChain(
        srcTokenAddress: string,      
        dstTokenAddress: string,      
        makingAmount: bigint,         
        takingAmount: bigint,  
        evmUserAddress: string,         
        kadenaUserAddress: string,  
    ) {
        console.log('⚡️ Swapping Tokens from EVM -> HEDERA [cross-chain] ')
        console.log(`\t(swapAmounts: ${makingAmount} -> ${takingAmount})`)

        // 1.  Check + Approve src tokens
        console.log("\n[EVM]: Check + Approve SRC tokens to LimitOrderProtocol")
        await this.checkAndApproveTokens(srcTokenAddress, makingAmount)

        // 2. Generate Secret
        console.log("\n< . . . Generating Secret . . .>")
        // const secretRaw = uint8ArrayToHex(randomBytes(32));
        const raw31 = randomBytes(31); // Generate 31 random bytes
        // Felt-safe integer
        const secretFelt = BigInt("0x" + Buffer.from(raw31).toString("hex"));
        // EVM version (right-pad with 0x00 → makes it 32 bytes total)
        const secretBytes32 = "0x" + Buffer.concat([raw31, Buffer.from([0x00])]).toString("hex");

        // 2. Create Order
        console.log("\n[EVM]: Creating HTLC CrossChainOrder ")
        const order = await this.createCrossChainOrder(
            srcTokenAddress,
            dstTokenAddress,
            makingAmount,
            takingAmount,
            secretBytes32,
            kadenaUserAddress
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

        // -------HEDERA CHAIN-------------
        
        // init EscrowDST in HEDERA Chain
        // const escrowDst = new Contract(escrowAbi.abi, HEDERA_CONFIG.escrowDst, this.starknetProvider);
        // await increaseTime()

        await this.checkBalAllowanceAndApproveEVM(dstTokenAddress, kadenaUserAddress, takingAmount) 
        
        // 6. Deploy EscrowDst in HEDERA
        console.log(`\n[HEDERA] : Deploying ErcrowDST`);
        let escrowDst = new ethers.Contract(
            HEDERA_CONFIG.escrowDst,
            escrowDstAbi.abi,
            this.kadenaResolver.signer
        )

        let deployTime = BigInt((await this.kadenaProvider.getBlock('latest'))!.timestamp);

        let tx = await escrowDst.lock(
            orderHash, //swapId
            kadenaUserAddress, //maker
            HEDERA_CONFIG.resolver, //taker
            dstTokenAddress, //token
            takingAmount, //amount
            ethers.keccak256(secretBytes32), // hashlock
            deployTime + 10n, //withdrawalTime
            deployTime + 12n, //publicWithdrawalTime
            deployTime + 400n, //cancellationTime
        )
        const rec = await tx.wait();
        
        console.log("✅ EscrowDst deployed in tx:", txLink(tx.hash,"kadena20"));
        console.log(`\n[HEDERA]`, `Created dst deposit for order ${orderHash} in tx ${tx.hash}`)


        console.log(`\n< secret-preimage shared with resolver on Dst Order filling >`);
        console.log(`(${secretBytes32})`);
        await new Promise(wait => setTimeout(wait, 7000))


        // 10. Use Secret to claim EVM Token for STRK_User from EscrowSRC
        console.log(`\n[EVM] : `, `Withdraw & Claim Funds for Kadena_User in EVM.EscrowSrc`);
        const { txHash: srcWithdrawTxHash } = await this.resolverWallet.send(
            resolverSrc.withdraw('src', srcEscrowAddress, secretBytes32, srcEscrowEvent[0])
        )
        console.log(`Tx: ${txLink(srcWithdrawTxHash,"polygon")}`)

        // 9.KadenaResolver Withdraws Funds for User from EscrowDST
        console.log(`\n[HEDERA] : `, `Withdraw & Claim Funds for User in HEDERA.EscrowDst`);
        tx = await escrowDst.claim(
            orderHash, //swapId
            secretBytes32
        )
        await tx.wait();
        console.log(`✅ Claim complete on HEDERA chain20`);
        console.log(`Tx: ${txLink(tx.hash,"kadena20")}`)

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

        

        return {
            orderHash: order.getOrderHash(EVM_CONFIG.chainId),
            secretBytes32,
            order
        }
    }

    private async checkBalAllowanceAndApproveEVM(tokenAddress: string, evmUserAddress: string, amount: bigint) {
        console.log('\n[HEDERA] : User approving token to Resolver')
        const userWallet = new Wallet(HEDERA_CONFIG.userPk as string, this.kadenaProvider);
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

        // console.log('Token : ', tokenAddress)
        // console.log('User : ', evmUserAddress)

        const userBalance = await tokenContract.balanceOf(evmUserAddress)
        // console.log(`User token balance: ${userBalance}`)

        if (userBalance < amount) {
            throw new Error(`Insufficient token balance! (${userBalance} < ${amount}`)
        }

        let allowance = await tokenContract.allowance(evmUserAddress, HEDERA_CONFIG.escrowDst);

        if (allowance < amount) {
            // console.log('🔓 Approving token')
            const approveTx = await tokenContract.approve(HEDERA_CONFIG.escrowDst, MaxUint256);
            const receipt = await approveTx.wait();
            // console.log('✅ token Approved')
        }
        allowance = await tokenContract.allowance(evmUserAddress, HEDERA_CONFIG.escrowDst)
        console.log("Resolver allowance:", allowance.toString())
    }

    private async createCrossChainOrder(
        srcTokenAddress: string,
        dstTokenAddress: string,
        makingAmount: bigint,
        takingAmount: bigint,
        secret: string,
        kadenaUserAddress: string,
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


        console.log('📋 Order Created:');
        console.log(`    orderHash: ${order.getOrderHash(EVM_CONFIG.chainId)}`);
        console.log(`    makingAmount: ${makingAmount.toString()}`);
        console.log(`    takingAmount: ${takingAmount.toString()}`);
        console.log(`    srcToken: ${srcTokenAddress}`);
        console.log(`    dstToken: ${dstTokenAddress}`);
        console.log(`    srcChain: POLYGON`);
        console.log(`    dstChain: HEDERA`);

        return order
    }


    private async checkAndApproveTokens(tokenAddress: string, amount: bigint) {
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
// console.log("Deployed code at", tokenAddress, ":", code);

        const userBalance = await tokenContract.balanceOf(userAddress);
        // console.log(`💰 Current token balance: ${userBalance}`);

        // if (userBalance < amount) {
        //     throw new Error(`Insufficient token balance! (${userBalance} < ${amount})`);
        // }

        const allowance = await tokenContract.allowance(userAddress, EVM_CONFIG.limitOrderProtocol);
        if (allowance < amount) {
            console.log("Approving tokens for LOP");
            const approveTx = await tokenContract.approve(EVM_CONFIG.limitOrderProtocol, MaxUint256);
            await approveTx.wait();
            console.log("✅ Token approved");
        }
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


